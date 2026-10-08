const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('visão geral consulta o banco por versão, reutiliza índice e não busca arquivos públicos', async () => {
    const calls = [];
    const window = { HarvestStore: { async loadRaster(dataset, name) {
        calls.push([dataset.version, name]);
        return { records: [{ campo: 'FE 01', levels: [] }] };
    } } };
    const L = { Layer: { extend(methods) { return function () { methods.initialize.call(this); }; } } };
    vm.runInNewContext(fs.readFileSync('js/harvest-pyramid.js', 'utf8'), { window, L });
    await window.HarvestPyramid.create([{ campo: 'FE 01' }], [], { version: 'v1' });
    await window.HarvestPyramid.create([{ campo: 'FE 01' }], [], { version: 'v1' });
    await window.HarvestPyramid.create([{ campo: 'FE 01' }], [], { version: 'v2' });
    assert.deepEqual(calls, [['v1', 'index.json'], ['v2', 'index.json']]);
});

test('falha de índice pode ser tentada novamente sem conservar promessa rejeitada', async () => {
    let calls = 0;
    const window = { HarvestStore: { async loadRaster() {
        if (++calls === 1) throw Error('offline');
        return { records: [] };
    } } };
    const L = { Layer: { extend(methods) { return function () { methods.initialize.call(this); }; } } };
    vm.runInNewContext(fs.readFileSync('js/harvest-pyramid.js', 'utf8'), { window, L });
    await assert.rejects(window.HarvestPyramid.create([], [], { version: 'v1' }), /offline/);
    await window.HarvestPyramid.create([], [], { version: 'v1' });
    assert.equal(calls, 2);
});

test('resoluções da colheita são consultadas pela fazenda e versão autorizadas', async () => {
    const calls = [];
    const query = { select() { return this; }, eq(key, value) { calls.push([key, value]); return this; },
        async single() { return { data: { contents: { format: 'harvest-values-f64-v1' } }, error: null }; } };
    const window = { portalFarm: { code: 'FE' }, supabaseClient: { from(table) {
        assert.equal(table, 'harvest_raster_files'); return query;
    } } };
    vm.runInNewContext(fs.readFileSync('js/harvest-store.js', 'utf8'), { window });
    const dataset = { source: 'supabase', version: 'v1' };
    await window.HarvestStore.loadRaster(dataset, 'fe-01-0.json');
    assert.deepEqual(calls, [['version_id', 'v1'], ['path', 'fe-01-0.json']]);
    await assert.rejects(window.HarvestStore.loadRaster(dataset, '../index.json'));
    window.portalFarm.code = 'FE2';
    await assert.rejects(window.HarvestStore.loadRaster(dataset, 'index.json'));
    assert.equal(calls.length, 2);
});
