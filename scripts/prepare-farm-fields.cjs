const fs = require('node:fs');
const path = require('node:path');
const input = JSON.parse(fs.readFileSync('Talhoes.geojson', 'utf8'));
const destination = path.join('.publish', 'farm-field-import');
fs.mkdirSync(destination, { recursive: true });
const groups = []; let batch = [], bytes = 0; const keys = new Map();
for (const feature of input.features) {
    const farm = feature.properties?.Fazenda, campo = feature.properties?.Campo;
    if (!farm || !campo) continue;
    const key = `${farm}__${campo}`;
    if (keys.has(key)) {
        const original = keys.get(key);
        if (JSON.stringify(original.geometry) === JSON.stringify(feature.geometry)) continue;
        const polygons = geometry => geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : null;
        const first = polygons(original.geometry), next = polygons(feature.geometry);
        if (!first || !next) throw Error(`Geometria repetida incompatível: ${key}`);
        original.geometry = { type: 'MultiPolygon', coordinates: [...first, ...next] };
        original.properties.Area = Number(original.properties.Area || 0) + Number(feature.properties.Area || 0);
    } else keys.set(key, JSON.parse(JSON.stringify(feature)));
}
for (const feature of keys.values()) {
    const farm = feature.properties.Fazenda, campo = feature.properties.Campo;
    const row = { farm_code: farm, campo, feature };
    const size = JSON.stringify(row).length;
    if (batch.length && bytes + size > 90000) { groups.push(batch); batch = []; bytes = 0; }
    batch.push(row); bytes += size;
}
if (batch.length) groups.push(batch);
groups.forEach((rows, index) => {
    const json = JSON.stringify(rows).replaceAll("'", "''");
    fs.writeFileSync(path.join(destination, `${index}.sql`),
        `insert into public.farm_fields(farm_code,campo,feature) select farm_code,campo,feature from jsonb_to_recordset('${json}'::jsonb) as x(farm_code text,campo text,feature jsonb) on conflict(farm_code,campo) do nothing;`);
});
fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify({ batches: groups.length, fields: keys.size, excluded: input.features.length - keys.size }));
console.log(fs.readFileSync(path.join(destination, 'manifest.json'), 'utf8'));
