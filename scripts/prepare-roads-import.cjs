const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'Estradas.geojson'));
const data = JSON.parse(source);
if (data.crs?.properties?.name !== 'urn:ogc:def:crs:OGC:1.3:CRS84') throw Error('Estradas deve estar em CRS84.');
const values = data.features.map((feature, index) => {
    if (!['LineString', 'MultiLineString'].includes(feature.geometry?.type)) throw Error('Geometria de estrada inválida.');
    for (const line of feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.coordinates) {
        if (line.length < 2 || line.some(p => !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)) throw Error('Coordenadas de estrada inválidas.');
    }
    return `(${index + 1},'${JSON.stringify(feature.geometry).replace(/'/g, "''")}')`;
});
const sql = `-- Estradas.geojson SHA256 ${crypto.createHash('sha256').update(source).digest('hex')}
-- Importação inicial. Não altera talhões nem montes. Reimportação exige revisão.
with sources(source_id,geometry) as (values
${values.join(',\n')}
), masks as (
 select farm_code,gis.st_unaryunion(gis.st_collect(gis.st_makevalid(gis.st_transform(gis.st_setsrid(
  gis.st_geomfromgeojson(feature->'geometry'),4326),32722)))) geom
 from public.farm_fields where feature->'geometry'->>'type' in ('Polygon','MultiPolygon') group by farm_code
), roads as (
 select source_id,gis.st_transform(gis.st_setsrid(gis.st_geomfromgeojson(geometry),4326),32722) geom from sources
), assigned as (
 select r.source_id,r.geom,coalesce(
  (select array_agg(m.farm_code order by m.farm_code) from masks m where gis.st_dwithin(r.geom,m.geom,100)),
  (select array[m.farm_code] from masks m order by gis.st_distance(r.geom,m.geom),m.farm_code limit 1)
 ) farm_codes from roads r
)
insert into public.fertilizer_roads(source_id,farm_codes,geom)
select source_id,farm_codes,gis.st_multi(geom) from assigned where not gis.st_isempty(geom) and cardinality(farm_codes)>0
on conflict(source_id) do nothing;
`;
fs.writeFileSync(path.join(__dirname, '..', 'supabase', 'maintenance', 'import-estradas.sql'), sql);
console.log(`${values.length} feições validadas; importação SQL preparada sem conectar ao banco.`);
