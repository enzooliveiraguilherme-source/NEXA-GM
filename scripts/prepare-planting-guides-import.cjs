const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'Sentido_plantio_milho.geojson'));
const data = JSON.parse(source);
if (data.crs?.properties?.name !== 'urn:ogc:def:crs:OGC:1.3:CRS84') throw Error('As guias devem estar em CRS84.');
const sha = crypto.createHash('sha256').update(source).digest('hex');
const quote = text => `'${String(text).replace(/'/g, "''")}'`;
let empty = 0;
const values = data.features.flatMap((feature, index) => {
    const lines = feature.geometry?.type === 'LineString' ? [feature.geometry.coordinates]
        : feature.geometry?.type === 'MultiLineString' ? feature.geometry.coordinates : null;
    if (!lines) throw Error(`Guia ${index + 1}: geometria inválida.`);
    if (!lines.length) { empty++; return []; }
    // Reject curves instead of deriving an arbitrary axis from their endpoints.
    if (lines.length !== 1 || lines[0].length !== 2 || lines[0].some(p =>
        p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0])>180 || Math.abs(p[1])>90) ||
        lines[0][0].slice(0,2).every((x,i) => x===lines[0][1][i])) throw Error(`Guia ${index + 1}: esperada uma linha AB de dois pontos.`);
    return [`(${index + 1},${quote(feature.properties?.Campo || '')},${quote(JSON.stringify({ type:'LineString',coordinates:lines[0] }))})`];
});
const sql = `-- User-supplied maize ABs for the existing NEXA-GM Supabase project configured in config.js.
-- Private import, never bundled or committed. Source SHA256 ${sha}
-- Only FE, PA and RM 01/02 in the existing 2026 pilot. No other field is changed.
with input(source_id,source_name,geometry) as (values
${values.join(',\n')}
), guides as materialized (
 select source_id,source_name,gis.st_transform(gis.st_setsrid(gis.st_geomfromgeojson(geometry),4326),32722) geom from input
), fields as materialized (select * from gis.fertilizer_direction_fields('2026',array['FE','PA','RM'])),
parents as materialized (
 select f.farm_code,f.campo,p.campo parent,gis.st_transform(gis.st_setsrid(gis.st_geomfromgeojson(p.feature->'geometry'),4326),32722) geom
 from fields f join public.farm_fields p on p.farm_code=f.farm_code and p.feature->'properties'->'ReplacedBy' ? f.campo
), candidates as (
 select f.farm_code,f.campo,g.source_id,g.source_name,g.geom,null::text inherited_from,0 priority,
  gis.st_length(gis.st_intersection(g.geom,gis.st_buffer(f.geom,10))) overlap
 from fields f join guides g on gis.st_dwithin(f.geom,g.geom,10)
 union all
 select p.farm_code,p.campo,g.source_id,g.source_name,g.geom,p.parent,1,
  gis.st_length(gis.st_intersection(g.geom,gis.st_buffer(p.geom,10)))
 from parents p join guides g on gis.st_dwithin(p.geom,g.geom,10)
), selected as (
 select distinct on(farm_code,campo) * from candidates where overlap>=10
 order by farm_code,campo,priority,overlap desc,source_id
)
insert into public.fertilizer_application_guides(map_year,farm_code,campo,source_id,source_name,inherited_from,source_sha256,geom)
select '2026',farm_code,campo,source_id,source_name,inherited_from,'${sha}',geom from selected
on conflict(map_year,farm_code,campo) do update set source_id=excluded.source_id,source_name=excluded.source_name,
 inherited_from=excluded.inherited_from,source_sha256=excluded.source_sha256,geom=excluded.geom;
`;
const output = path.join(root,'tmp','routing','planting-guide-import.sql');
fs.mkdirSync(path.dirname(output),{recursive:true}); fs.writeFileSync(output,sql);
console.log(JSON.stringify({ records:data.features.length,valid:values.length,empty,sha256:sha,output }));
