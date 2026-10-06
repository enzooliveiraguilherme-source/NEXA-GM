const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const folder = path.resolve(__dirname, '../dados/colheita/2026/milho');
const source = path.join(folder, 'FE.geojson');
const output = path.join(folder, 'fe');
const groups = new Map();
const cellSize = 25;
async function main() {
    const before = fs.statSync(source);
    const reader = readline.createInterface({ input: fs.createReadStream(source), crlfDelay: Infinity });
    let started = false, closed = false, total = 0;
    for await (const raw of reader) {
        const line = raw.trim();
        if (line === '"features": [') { started = true; continue; }
        if (!started || !line) continue;
        if (line === ']') { closed = true; continue; }
        if (closed) continue;
        const f = JSON.parse(line.replace(/,$/, ''));
        const p = f.properties;
        const campo = String(p.layer || '').replace(/_Kriged$/i, '').trim();
        if (!/^FE\s+\S+$/.test(campo)) throw new Error(`Camada inesperada: ${campo}`);
        const [lon, lat] = f.geometry.coordinates;
        if (f.geometry.type !== 'Point' || ![lon, lat, p.X, p.Y, p.prod_corig].every(Number.isFinite) || Math.abs(lon) > 180 || Math.abs(lat) > 90 || p.prod_corig < 0) throw new Error('Ponto inválido.');
        let group = groups.get(campo);
        if (!group) { group = { campo, count: 0, sum: 0, min: Infinity, max: -Infinity, cells: new Map() }; groups.set(campo, group); }
        group.count++; group.sum += p.prod_corig; group.min = Math.min(group.min, p.prod_corig); group.max = Math.max(group.max, p.prod_corig);
        const id = `${Math.floor(p.X / cellSize)}:${Math.floor(p.Y / cellSize)}`;
        let cell = group.cells.get(id);
        if (!cell) { cell = { count: 0, sum: 0, lon: 0, lat: 0 }; group.cells.set(id, cell); }
        cell.count++; cell.sum += p.prod_corig; cell.lon += lon; cell.lat += lat;
        total++;
        if (total % 500000 === 0) console.log(`${total.toLocaleString('pt-BR')} pontos processados.`);
    }
    const after = fs.statSync(source);
    if (!closed || !total || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('Arquivo incompleto ou alterado durante a leitura.');
    const base = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../Talhoes.geojson'), 'utf8'));
    const known = new Set(base.features.filter(f => f.properties.Fazenda === 'FE').map(f => f.properties.Campo));
    const unmatched = [...groups.keys()].filter(campo => !known.has(campo));
    if (unmatched.length) throw new Error(`Talhões sem limites cadastrais: ${unmatched.join(', ')}`);
    fs.mkdirSync(output, { recursive: true });
    const records = [];
    for (const group of groups.values()) {
        const features = [...group.cells.values()].map(cell => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [cell.lon / cell.count, cell.lat / cell.count] },
            properties: { Fazenda: 'FE', Campo: group.campo, produtividade: cell.sum / cell.count, unidade_produtividade: 'sc/ha', pontos_originais: cell.count, ano: '2026', cultura: 'Milho' } }));
        const filename = group.campo.replace(/\s+/g, '-').toLowerCase() + '.geojson';
        fs.writeFileSync(path.join(output, filename), JSON.stringify({ type: 'FeatureCollection', features }));
        records.push({ campo: group.campo, fazenda: 'FE', points: group.count, cells: features.length, mean: group.sum / group.count, min: group.min, max: group.max, file: filename, data_inicio: null, data_fim: null });
    }
    const summary = { source: 'FE.geojson', fazenda: 'FE', name: 'Fazenda Esperança', ano: 2026, cultura: 'Milho', field: 'prod_corig', unit: 'sc/ha', points: total,
        cell_size_m: cellSize, aggregation: 'Média de todos os pontos por célula de 25 m; não é amostragem. Médias do talhão são médias aritméticas da grade interpolada.', records: records.sort((a, b) => a.campo.localeCompare(b.campo, 'pt-BR', { numeric: true })) };
    fs.writeFileSync(path.join(output, 'index.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ points: total, fields: records.length, cells: records.reduce((sum, r) => sum + r.cells, 0) }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
