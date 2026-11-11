const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../js/fertilizer-service-areas.js'), 'utf8');
function moduleWith(routing) {
    const window = { FertilizerRouting: routing };
    vm.runInNewContext(source, vm.createContext({ window, Promise, Set, String, Array, Error, Math }));
    return window.FertilizerServiceAreas;
}
const emptyZones = () => ({ type: 'FeatureCollection', features: [] });
const emptyBase = () => ({ zones: emptyZones(), mounds: [{ id: 'fe-mound', gleba: 'FE' }, { id: 'pa-mound', gleba: 'PA' }] });
function grid(cells, overrides = {}) {
    return { year: '2026', gleba: 'FE', resolution_m: 100, signature: 'sig-1', cells, ...overrides };
}
function cell(farm_code, i) { return { farm_code, i, j: i + 10, point: [-52 + i / 10000, -10], area_ha: 1 }; }

test('ignores farms outside FE/PA/RM scope without RPC and returns base zones', async () => {
    const calls = [];
    const service = moduleWith({ load: async (...args) => { calls.push(args); } });
    const base = emptyBase();
    const result = await service.calculate({ async rpc(...args) { calls.push(args); } }, 2026, ['FE2', 'GM'], base, { farm: 'FE2' });
    assert.equal(calls.length, 0);
    assert.equal(result.zones, base.zones);
    assert.equal(result.analysis, null);
});

test('requests only authorized farm codes at 100 m and submits one winning assignment per cell', async () => {
    const cells = [cell('FE', 1), cell('PA', 2), cell('RM', 3)];
    const rpcCalls = [], routingCalls = [];
    const base = emptyBase();
    const zones = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: null }] };
    const client = { async rpc(name, args) {
        rpcCalls.push([name, args]);
        if (name === 'fertilizer_service_cached') return { data: null, error: null };
        if (name === 'fertilizer_service_grid') return { data: grid(cells), error: null };
        return { data: { zones, analysis: { method: 'network_grid' } }, error: null };
    } };
    const routing = { async load(...args) {
        routingCalls.push(args);
        return { graph: { serviceCosts(samples, mounds) {
            assert.equal(samples.length, 3);
            assert.deepEqual(Array.from(mounds, mound => mound.id), ['fe-mound']);
            return samples.map(sample => ({ ...sample, mound_id: 'fe-mound', meters: 100 + sample.i }));
        } } };
    } };
    const service = moduleWith(routing), scope = { farm: 'authorized' };
    const result = await service.calculate(client, 2026, ['FE', 'FE2', 'PA', 'RM', 'GM'], base, scope);
    assert.deepEqual(Array.from(rpcCalls[0][1].requested_farms), ['FE', 'PA', 'RM']);
    assert.equal(rpcCalls[0][1].map_year, '2026');
    assert.deepEqual(routingCalls[0], [client, 2026, 'FE', scope]);
    assert.equal(rpcCalls[2][0], 'fertilizer_service_zones');
    const payload = rpcCalls[2][1];
    assert.deepEqual(Array.from(payload.requested_farms), ['FE', 'PA', 'RM']);
    assert.equal(payload.grid_signature, 'sig-1');
    assert.deepEqual(Array.from(payload.assignments, assignment => [assignment.f, assignment.i, assignment.j, assignment.m]), [
        ['FE', 1, 11, 'fe-mound'], ['PA', 2, 12, 'fe-mound'], ['RM', 3, 13, 'fe-mound']
    ]);
    assert.equal(payload.assignments.length, cells.length);
    assert.equal(result.zones, zones);
});

test('propagates grid or routing failures and never returns fallback straight-line zones', async () => {
    const base = emptyBase(), failure = new Error('service grid offline');
    const failedGrid = moduleWith({ load: async () => { throw new Error('should not load graph'); } });
    await assert.rejects(failedGrid.calculate({ async rpc(name) {
        return name === 'fertilizer_service_cached' ? { data: null, error: null } : { data: null, error: failure };
    } }, 2026, ['FE'], base, {}), error => error === failure);

    const routingFailure = new Error('network graph unavailable');
    const validGridClient = { async rpc(name) {
        if (name === 'fertilizer_service_cached') return { data: null, error: null };
        if (name === 'fertilizer_service_grid') return { data: grid([cell('FE', 1)]), error: null };
        throw new Error('zones RPC must not run after routing error');
    } };
    const failedRouting = moduleWith({ async load() { throw routingFailure; } });
    await assert.rejects(failedRouting.calculate(validGridClient, 2026, ['FE'], base, {}), error => error === routingFailure);
});

test('invalidate makes an older cache lookup stale before grid, graph or zone RPC', async () => {
    let resolveCache, networkLoads = 0, gridCalls = 0, zoneCalls = 0;
    const pending = new Promise(resolve => { resolveCache = resolve; });
    const client = { async rpc(name) {
        if (name === 'fertilizer_service_cached') return pending;
        if (name === 'fertilizer_service_grid') gridCalls++;
        zoneCalls++;
        return { data: { zones: emptyZones(), analysis: { method: 'network_grid' } }, error: null };
    } };
    const service = moduleWith({ async load() { networkLoads++; return { graph: { serviceCosts: () => [] } }; } });
    const work = service.calculate(client, 2026, ['FE'], emptyBase(), {});
    service.invalidate();
    resolveCache({ data: null, error: null });
    await assert.rejects(work, /cancelado/i);
    assert.equal(networkLoads, 0);
    assert.equal(gridCalls, 0);
    assert.equal(zoneCalls, 0);
});

test('valid cached zones return directly without loading the graph or generating cell costs', async () => {
    const zones = { type: 'FeatureCollection', features: [
        { type: 'Feature', properties: { farm_code: 'FE', mound_ids: ['fe-mound'] }, geometry: null },
        { type: 'Feature', properties: { farm_code: 'PA', mound_ids: ['pa-mound'] }, geometry: null }
    ] };
    const cached = { signature: 'full-scope-signature', zones, analysis: { method: 'network_grid', resolution_m: 100 } };
    const calls = [];
    const service = moduleWith({ async load() { throw new Error('cache hit must skip graph load'); } });
    const result = await service.calculate({ async rpc(name, args) {
        calls.push([name, args]);
        return { data: cached, error: null };
    } }, 2026, ['FE', 'PA', 'FE2'], emptyBase(), {});
    assert.deepEqual(calls.map(([name]) => name), ['fertilizer_service_cached']);
    assert.deepEqual(Array.from(calls[0][1].requested_farms), ['FE', 'PA']);
    assert.equal(result, cached);
});

test('rejects cached zones outside authorized farms or mound IDs without loading the graph', async () => {
    const service = moduleWith({ async load() { throw new Error('invalid cache must not load graph'); } });
    const cached = { signature: 'signature', zones: { type: 'FeatureCollection', features: [
        { type: 'Feature', properties: { farm_code: 'FE2', mound_ids: ['fe-mound'] }, geometry: null }
    ] }, analysis: { method: 'network_grid', resolution_m: 100 } };
    let calls = 0;
    await assert.rejects(service.calculate({ async rpc() { calls++; return { data: cached, error: null }; } },
        2026, ['FE'], emptyBase(), {}), /fora do acesso atual/i);
    assert.equal(calls, 1);

    const unknownMound = { ...cached, zones: { type: 'FeatureCollection', features: [
        { type: 'Feature', properties: { farm_code: 'FE', mound_ids: ['unknown'] }, geometry: null }
    ] } };
    await assert.rejects(service.calculate({ async rpc() { calls++; return { data: unknownMound, error: null }; } },
        2026, ['FE'], emptyBase(), {}), /fora do acesso atual/i);
    assert.equal(calls, 2);
});
