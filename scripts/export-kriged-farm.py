"""Exporta somente *_Kriged.shp, uma fazenda por execução, sem juntar fazendas em memória."""
import argparse
import gzip
import hashlib
import json
import math
import os
import re
import struct
import uuid
from pathlib import Path

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
import numpy as np
from osgeo import gdal, ogr, osr
from qgis.core import (QgsApplication, QgsCoordinateReferenceSystem,
                       QgsCoordinateTransform, QgsProject, QgsVectorLayer)

ROOT = Path(__file__).resolve().parent.parent
COLUMNS = ['longitude', 'latitude', 'prod_corig', 'No', 'X', 'Y', 'Predicted', 'SE_Pred']
FARM_ALIASES = {'YP': 'IPE', 'FHCV': 'FEAR'}
GLEBAS = {'FE': 'FE', 'FE2': 'FE', 'PA': 'FE', 'RM': 'FE', 'SH': 'FE',
          'SM': 'FE', 'SMA': 'FE', 'IPE': 'FE', 'FBLA': 'FBLA', 'FBAG': 'FBAG',
          'FEAR': 'FEAR', 'FPAR': 'FPAR', 'FPER': 'FPER', 'FSTV': 'FSTV'}


def packed_file(destination, relative, raw, **metadata):
    compressed = gzip.compress(raw, compresslevel=6, mtime=0)
    target = destination / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(compressed)
    return dict(path=relative, bytes=len(compressed), sha256=hashlib.sha256(raw).hexdigest(),
                compressed_sha256=hashlib.sha256(compressed).hexdigest(), **metadata)


def mercator_inverse(x, y):
    return [x / 6378137 * 180 / math.pi,
            (2 * math.atan(math.exp(y / 6378137)) - math.pi / 2) * 180 / math.pi]


def footprint(native, source_crs):
    """Contorno da cobertura krigada; usado somente na Colheita quando o nome mudou."""
    valid = np.isfinite(native.GetRasterBand(1).ReadAsArray()).astype(np.uint8)
    mask = gdal.GetDriverByName('MEM').Create('', native.RasterXSize, native.RasterYSize, 1, gdal.GDT_Byte)
    mask.SetGeoTransform(native.GetGeoTransform())
    mask.SetProjection(native.GetProjection())
    mask.GetRasterBand(1).WriteArray(valid)
    vector = ogr.GetDriverByName('Memory').CreateDataSource('')
    srs = osr.SpatialReference(); srs.ImportFromEPSG(source_crs)
    layer = vector.CreateLayer('coverage', srs=srs, geom_type=ogr.wkbPolygon)
    layer.CreateField(ogr.FieldDefn('value', ogr.OFTInteger))
    gdal.Polygonize(mask.GetRasterBand(1), mask.GetRasterBand(1), layer, 0, [])
    geographic = osr.SpatialReference(); geographic.ImportFromEPSG(4326)
    srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    geographic.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    transform = osr.CoordinateTransformation(srs, geographic)
    polygons = []
    for feature in layer:
        geom = feature.GetGeometryRef().Clone(); geom.Transform(transform)
        polygons.append(json.loads(geom.ExportToJson())['coordinates'])
    return dict(type='MultiPolygon', coordinates=polygons)


def crop_to_field(raster, geometry):
    vector = ogr.GetDriverByName('Memory').CreateDataSource('')
    geographic = osr.SpatialReference(); geographic.ImportFromEPSG(4326)
    mercator = osr.SpatialReference(); mercator.ImportFromEPSG(3857)
    for srs in [geographic, mercator]: srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    layer = vector.CreateLayer('field', srs=mercator, geom_type=ogr.wkbMultiPolygon)
    geom = ogr.CreateGeometryFromJson(json.dumps(geometry))
    geom.Transform(osr.CoordinateTransformation(geographic, mercator))
    feature = ogr.Feature(layer.GetLayerDefn()); feature.SetGeometry(geom); layer.CreateFeature(feature)
    mask = gdal.GetDriverByName('MEM').Create('', raster.RasterXSize, raster.RasterYSize, 1, gdal.GDT_Byte)
    mask.SetGeoTransform(raster.GetGeoTransform()); mask.SetProjection(raster.GetProjection())
    gdal.RasterizeLayer(mask, [1], layer, burn_values=[1])
    return mask.GetRasterBand(1).ReadAsArray().astype(bool)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--farm', required=True, choices=sorted(GLEBAS))
    parser.add_argument('--field', help='Restrição usada para validar o pipeline com um talhão.')
    args = parser.parse_args()
    source = Path(args.source).resolve()
    candidates = sorted(path for path in source.rglob('*.shp')
                        if path.stem.endswith('_Kriged')
                        and FARM_ALIASES.get(path.relative_to(source).parts[0], path.relative_to(source).parts[0]) == args.farm
                        and (not args.field or path.stem == args.field + '_Kriged'))
    if not candidates: raise ValueError('Nenhum *_Kriged.shp encontrado para esta fazenda.')
    destination = ROOT / '.publish' / 'kriged-milho-2026' / GLEBAS[args.farm] / args.farm
    destination.mkdir(parents=True, exist_ok=True)
    if (destination / 'dataset.json').exists(): raise ValueError('Fazenda já preparada. Preserve a versão existente antes de reprocessar.')
    app = QgsApplication([], False); app.initQgis()
    gdal.UseExceptions()
    cadastral = json.loads((ROOT / 'Talhoes.geojson').read_text(encoding='utf-8'))['features']
    lookup = {}
    for feature in cadastral:
        p = feature['properties']
        if (p.get('Fazenda') or p.get('Gleba')) != args.farm: continue
        key = p['Campo']
        if key not in lookup: lookup[key] = feature
        else:
            old = lookup[key]['geometry']; new = feature['geometry']
            if old == new: continue
            lookup[key]['geometry'] = dict(type='MultiPolygon', coordinates=
                (old['coordinates'] if old['type'] == 'MultiPolygon' else [old['coordinates']]) +
                (new['coordinates'] if new['type'] == 'MultiPolygon' else [new['coordinates']]))
    records, raster_records, files, shapes = [], [], [], []
    bounds = [math.inf, math.inf, -math.inf, -math.inf]
    points = 0
    partial = destination / 'points.partial.geojson'
    with partial.open('w', encoding='utf-8') as geojson:
        geojson.write('{"type":"FeatureCollection","features":[\n')
        first = True
        for path in candidates:
            before = [(p, p.stat().st_size, p.stat().st_mtime_ns) for p in path.parent.glob(path.stem + '.*')]
            campo = path.stem[:-len('_Kriged')]
            stem = re.sub('[^a-z0-9.]+', '-', campo.lower()).strip('-')
            layer = QgsVectorLayer(str(path), path.stem, 'ogr')
            if not layer.isValid() or layer.crs().authid() != 'EPSG:31982': raise ValueError('Origem inválida: ' + str(path))
            transform = QgsCoordinateTransform(layer.crs(), QgsCoordinateReferenceSystem('EPSG:4326'), QgsProject.instance())
            extent = layer.extent(); minx, maxy = extent.xMinimum(), extent.yMaximum()
            width = round((extent.xMaximum() - minx) / 5) + 1
            height = round((maxy - extent.yMinimum()) / 5) + 1
            grid = np.full((height, width), np.nan, dtype=np.float64)
            grid_hits = np.zeros((height, width), dtype=np.uint32)
            irregular = 0
            count, total, smallest, largest, block_count = 0, 0.0, math.inf, -math.inf, 0
            buffer = bytearray(); chunks = []; digest = hashlib.sha256()
            def flush():
                nonlocal buffer, block_count
                if not block_count: return
                name = f'original/{stem}.{len(chunks)+1:03}.bin.gz'
                files.append(packed_file(destination, name, buffer, kind='original', count=block_count, columns=COLUMNS))
                chunks.append(name); buffer = bytearray(); block_count = 0
            for feature in layer.getFeatures():
                coordinate = feature.geometry().asPoint(); geographic = transform.transform(coordinate)
                attrs = {key: float(feature[key]) for key in COLUMNS[2:]}
                values = [geographic.x(), geographic.y(), *[attrs[k] for k in COLUMNS[2:]]]
                if not all(math.isfinite(value) for value in values): raise ValueError('Valor não finito em ' + campo)
                raw = struct.pack('<8d', *values); buffer.extend(raw); digest.update(raw); block_count += 1
                if block_count == 50000: flush()
                x = round((coordinate.x() - minx) / 5); y = round((maxy - coordinate.y()) / 5)
                if abs(coordinate.x() - (minx+x*5)) > .002 or abs(coordinate.y()-(maxy-y*5)) > .002:
                    irregular += 1
                # Somente a prévia usa células; todos os pontos e posições originais já foram gravados sem perdas.
                previous = grid[y, x] if grid_hits[y, x] else 0.0
                grid[y, x] = (previous * grid_hits[y, x] + attrs['prod_corig']) / (grid_hits[y, x] + 1)
                grid_hits[y, x] += 1
                count += 1; total += attrs['prod_corig']
                smallest = min(smallest, attrs['prod_corig']); largest = max(largest, attrs['prod_corig'])
                bounds = [min(bounds[0],values[0]), min(bounds[1],values[1]), max(bounds[2],values[0]), max(bounds[3],values[1])]
                attrs.update(layer=path.stem, Fazenda=args.farm, Campo=campo)
                output = dict(type='Feature', properties=attrs, geometry=dict(type='Point', coordinates=values[:2]))
                geojson.write(('' if first else ',\n') + json.dumps(output, separators=(',', ':'), allow_nan=False)); first = False
            flush()
            if count != layer.featureCount() or any(p.stat().st_size != size or p.stat().st_mtime_ns != stamp for p,size,stamp in before):
                raise ValueError('Origem incompleta ou alterada: ' + campo)
            native = gdal.GetDriverByName('MEM').Create('', width, height, 1, gdal.GDT_Float64)
            srs = osr.SpatialReference(); srs.ImportFromEPSG(31982)
            native.SetProjection(srs.ExportToWkt()); native.SetGeoTransform([minx-2.5,5,0,maxy+2.5,0,-5])
            native.GetRasterBand(1).SetNoDataValue(float('nan')); native.GetRasterBand(1).WriteArray(grid)
            existing = lookup.get(campo)
            geometry = existing['geometry'] if existing else footprint(native, 31982)
            properties = dict(existing['properties']) if existing else dict(Campo=campo, Fazenda=args.farm, Gleba=GLEBAS[args.farm], Area=None)
            properties.update(Fazenda=args.farm, Gleba=GLEBAS[args.farm])
            shapes.append(dict(type='Feature', properties=properties, geometry=geometry))
            projected = gdal.Warp('', native, format='MEM', dstSRS='EPSG:3857', xRes=5, yRes=5,
                                  resampleAlg='near', srcNodata=float('nan'), dstNodata=float('nan'), errorThreshold=0)
            display = projected.GetRasterBand(1).ReadAsArray(); display[~crop_to_field(projected, geometry)] = np.nan
            gt = projected.GetGeoTransform(); levels = []
            sums = np.nan_to_num(display, nan=0.0); counts = np.isfinite(display).astype(np.uint32)
            for level in range(6):
                h,w = sums.shape
                values = np.full((h,w), np.nan, dtype=np.float64)
                np.divide(sums, counts, out=values, where=counts>0)
                filename = f'raster/{stem}-{level}.bin.gz'
                files.append(packed_file(destination, filename, values.astype('<f8').tobytes(), kind='raster', width=w, height=h))
                resolution = 5 * 2 ** level
                sw = mercator_inverse(gt[0],gt[3]-h*resolution); ne = mercator_inverse(gt[0]+w*resolution,gt[3])
                levels.append(dict(valuesFile=filename,width=w,height=h,resolution=resolution,bounds=[[sw[1],sw[0]],[ne[1],ne[0]]]))
                ph,pw = h%2,w%2
                sums = np.pad(sums,((0,ph),(0,pw))).reshape((h+ph)//2,2,(w+pw)//2,2).sum(axis=(1,3))
                counts = np.pad(counts,((0,ph),(0,pw))).reshape((h+ph)//2,2,(w+pw)//2,2).sum(axis=(1,3))
            records.append(dict(campo=campo,fazenda=args.farm,points=count,chunks=chunks,sha256=digest.hexdigest(),
                mean=total/count,min=smallest,max=largest,data_inicio=None,data_fim=None,source_layer=path.stem,preview_irregular_points=irregular))
            raster_records.append(dict(campo=campo,fazenda=args.farm,levels=levels,bounds=levels[0]['bounds']))
            points += count
            print(f'{args.farm}: {campo}: {count:,} pontos preservados.',flush=True)
        geojson.write('\n]}\n')
    partial.replace(destination / 'points.geojson')
    index = dict(representation='original-points-v1',source='*_Kriged.shp',fazenda=args.farm,gleba=GLEBAS[args.farm],
                 ano=2026,cultura='Milho',unit='sc/ha',field='prod_corig',columns=COLUMNS,points=points,bounds=bounds,records=records,features=shapes)
    rasters = dict(representation='display-pyramid-v1',unit='sc/ha',records=raster_records)
    result = dict(farm=args.farm,gleba=GLEBAS[args.farm],year=2026,culture='Milho',version=str(uuid.uuid4()),
                  index=index,rasters=rasters,files=files,upload_bytes=sum(file['bytes'] for file in files))
    (destination / 'dataset.json').write_text(json.dumps(result,separators=(',',':'),allow_nan=False),encoding='utf-8')
    print(json.dumps(dict(farm=args.farm,fields=len(records),points=points,files=len(files),upload_bytes=result['upload_bytes'])),flush=True)


if __name__ == '__main__':
    main()
