const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../js/harvest-import.js');
const folder = path.resolve(__dirname, '../dados/colheita/2026/milho/fe');
const index = JSON.parse(fs.readFileSync(path.join(folder, 'index.json')));
assert.equal(index.points, 2619944);
assert.equal(index.records.length, 21);
const base = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../Talhoes.geojson')));
const known = new Set(base.features.filter(f => f.properties.Fazenda === 'FE').map(f => f.properties.Campo));
let total = 0;
for (const record of index.records) {
    assert.ok(known.has(record.campo));
    const data = HarvestImport.normalize(JSON.parse(fs.readFileSync(path.join(folder, record.file))));
    assert.equal(data.features.length, record.cells);
    const weight = data.features.reduce((sum,f) => sum + f.properties.pontos_originais, 0);
    assert.equal(weight, record.points);
    const mean = data.features.reduce((sum,f) => sum + f.properties.produtividade * f.properties.pontos_originais, 0) / weight;
    assert.ok(Math.abs(mean - record.mean) < 1e-8, 'A agregação deve preservar a média de todos os pontos');
    for (const f of data.features) {
        assert.equal(f.properties.Campo, record.campo);
        assert.equal(f.properties.unidade_produtividade, 'sc/ha');
        assert.equal(f.properties.data_inicio, null);
    }
    total += weight;
}
assert.equal(total, index.points);
const vm = require('node:vm');
const context = vm.createContext({ window: {}, document: { addEventListener() {} }, console });
context.window = context;
context.HarvestImport = globalThis.HarvestImport;
const requested = [];
context.fetch = async url => { requested.push(url); return { ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(folder, path.basename(url)))) }; };
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../js/harvest-store.js'), 'utf8'), context);
(async () => {
    const dataset = await context.HarvestStore.load();
    assert.equal(requested.length, 1, 'A visão geral deve carregar somente o índice');
    await context.HarvestStore.loadField(dataset, index.records[0].file);
    assert.equal(requested.length, 2, 'O detalhe é solicitado separadamente por talhão');
    await assert.rejects(async () => context.HarvestStore.loadField(dataset, '../FE.geojson'), /Talhão inválido/);
    console.log('FE: 21 talhões validados; 2.619.944 pontos preservados na agregação; detalhes carregados somente por talhão.');
})().catch(error => { console.error(error); process.exitCode = 1; });
