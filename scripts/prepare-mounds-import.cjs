// Prepare a reviewed SQL import; this script never connects to the database.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'Montes.geojson'), 'utf8');
const geojson = JSON.parse(source);
if (geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features) || !geojson.features.length) throw Error('GeoJSON vazio ou inválido.');
const keys = new Set();
const rows = geojson.features.map(feature => {
    const p = feature.properties || {}, g = feature.geometry;
    if (!['Point', 'MultiPoint'].includes(g?.type) || (g.type === 'MultiPoint' && g.coordinates.length !== 1)) throw Error('Cada monte deve ter exatamente um ponto.');
    const xy = g.type === 'Point' ? g.coordinates : g.coordinates[0];
    const row = { farm_code: String(p.Fazenda || '').trim(), name: String(p.nome || '').trim(), source_gleba: String(p.Gleba || '').trim(), longitude: xy[0], latitude: xy[1] };
    if (!row.farm_code || !row.name || !row.source_gleba || !xy.slice(0, 2).every(Number.isFinite) || Math.abs(xy[0]) > 180 || Math.abs(xy[1]) > 90) throw Error('Nome, fazenda, gleba ou coordenadas inválidos.');
    const key = JSON.stringify([row.farm_code, row.name]);
    if (keys.has(key)) throw Error('Nome de monte repetido na mesma fazenda: ' + key);
    keys.add(key);
    return row;
});
const hash = crypto.createHash('sha256').update(source).digest('hex');
const payload = JSON.stringify(rows).replaceAll("'", "''");
const sql = `-- Montes.geojson SHA256: ${hash}\n-- ${rows.length} pontos. Preserva IDs e registros existentes; alterações exigem revisão separada.\ninsert into public.fertilizer_mounds (farm_code,name,source_gleba,longitude,latitude)\nselect farm_code,name,source_gleba,longitude,latitude\nfrom jsonb_to_recordset('${payload}'::jsonb)\nas r(farm_code text,name text,source_gleba text,longitude double precision,latitude double precision)\non conflict (farm_code,name) do nothing;\n`;
const destination = path.join(root, 'supabase', 'maintenance', 'import-montes.sql');
fs.writeFileSync(destination, sql);
console.log(`${rows.length} montes preparados em ${destination}. SHA256 ${hash}`);
