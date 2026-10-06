const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const folder = path.resolve(__dirname, '../dados/colheita/2026/milho');
const source = path.join(folder, 'FE.geojson');
const out = path.join(folder, 'fe-original');
const columns = ['longitude', 'latitude', 'prod_corig', 'No', 'X', 'Y', 'Predicted', 'SE_Pred'];
const capacity = 50000;
const groups = new Map();
function flush(group) {
    if (!group.used) return;
    const bytes = group.buffer.subarray(0, group.used * columns.length * 8);
    const name = group.campo.replace(/\s+/g, '-').toLowerCase() + '.' + String(group.chunks.length + 1).padStart(3, '0') + '.json';
    const payload = { format: 'original-float64-v1', columns, count: group.used, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), gzip_base64: zlib.gzipSync(bytes).toString('base64') };
    fs.writeFileSync(path.join(out, name), JSON.stringify(payload));
    group.chunks.push(name);
    group.used = 0;
}
async function main() {
    fs.mkdirSync(out, { recursive: true });
    const before = fs.statSync(source);
    const reader = readline.createInterface({ input: fs.createReadStream(source), crlfDelay: Infinity });
    let started = false, closed = false, total = 0;
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    for await (const raw of reader) {
        const line = raw.trim();
        if (line === '"features": [') { started = true; continue; }
        if (!started || !line) continue;
        if (line === ']') { closed = true; continue; }
        if (closed) continue;
        const f = JSON.parse(line.replace(/,$/, ''));
        const p = f.properties;
        const campo = String(p.layer || '').replace(/_Kriged$/i, '').trim();
        if (!/^FE\s+\S+$/.test(campo) || f.geometry?.type !== 'Point') throw new Error('Camada ou geometria inesperada.');
        const values = [...f.geometry.coordinates.slice(0, 2), ...columns.slice(2).map(key => p[key])];
        if (!values.every(value => typeof value === 'number' && Number.isFinite(value))) throw new Error('Atributos numéricos inesperados.');
        let group = groups.get(campo);
        if (!group) {
            group = { campo, points: 0, sum: 0, min: Infinity, max: -Infinity, chunks: [], used: 0, buffer: Buffer.alloc(capacity * columns.length * 8), hash: crypto.createHash('sha256'), layer: p.layer };
            groups.set(campo, group);
        }
        const offset = group.used * columns.length * 8;
        values.forEach((value, col) => group.buffer.writeDoubleLE(value, offset + col * 8));
        group.hash.update(group.buffer.subarray(offset, offset + columns.length * 8));
        group.used++; group.points++; group.sum += p.prod_corig;
        group.min = Math.min(group.min, p.prod_corig); group.max = Math.max(group.max, p.prod_corig);
        bounds[0] = Math.min(bounds[0], values[0]); bounds[1] = Math.min(bounds[1], values[1]);
        bounds[2] = Math.max(bounds[2], values[0]); bounds[3] = Math.max(bounds[3], values[1]);
        if (group.used === capacity) flush(group);
        total++;
        if (total % 500000 === 0) console.log(`${total.toLocaleString('pt-BR')} pontos originais preservados.`);
    }
    const after = fs.statSync(source);
    if (!closed || !total || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('Origem incompleta ou alterada durante a leitura.');
    const records = [...groups.values()].map(group => {
        flush(group);
        return { campo: group.campo, fazenda: 'FE', points: group.points, chunks: group.chunks, file: group.chunks[0], sha256: group.hash.digest('hex'),
            source_layer: group.layer, mean: group.sum / group.points, min: group.min, max: group.max, data_inicio: null, data_fim: null };
    }).sort((a,b) => a.campo.localeCompare(b.campo, 'pt-BR', { numeric: true }));
    fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify({ representation: 'original-points-v1', source: 'FE.geojson', fazenda: 'FE', name: 'Fazenda Esperança', ano: 2026, cultura: 'Milho', field: 'prod_corig', unit: 'sc/ha', columns, points: total, bounds, records }, null, 2));
    console.log(JSON.stringify({ points: total, fields: records.length, chunks: records.reduce((sum,r) => sum + r.chunks.length,0) }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
