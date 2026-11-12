const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../js/fertilizer-service-areas.js'), 'utf8');
const routeProfile = { version: 'machine-road-v2' };
const expectedAnalysis = { method: 'ab_blocks', model_version: 'ab-blocks-v2', routing_model: 'machine-road-v2', strip_width_m: 50, sampling_step_m: 100 };
function moduleWith(routing) {
    const window = { FertilizerRouting: routing };
    vm.runInNewContext(source, vm.createContext({ window, Promise, Set, String, Array, Error, Math, Number, JSON }));
    return window.FertilizerServiceAreas;
}
const emptyZones = () => ({ type: 'FeatureCollection', features: [] });
const emptyBase = () => ({ zones: emptyZones(), mounds: [{ id: 'fe-mound', gleba: 'FE' }, { id: 'pa-mound', gleba: 'PA' }] });
function grid(cells, overrides = {}) {
    return { year: '2026', gleba: 'FE', model_version: 'ab-blocks-v2', routing_model: 'machine-road-v2', strip_width_m: 50,
        sampling_step_m: 100, signature: 'sig-1', cells, ...overrides };
}
function cell(farm_code, campo, strip_id, i = 1, area_ha = 1) {
    return { farm_code, campo, strip_id, point: [-52 + i / 10000, -10], area_ha };
}
function resultData(zones = emptyZones(), signature = 'sig-final') { return { signature, zones, analysis: { ...expectedAnalysis } }; }
function validZones() {
    return { type: 'FeatureCollection', features: [
        { type: 'Feature', properties: { farm_code: 'FE', mound_id: 'fe-mound', mound_ids: ['fe-mound'] }, geometry: null }
    ] };
}

test('ignores farms outside FE/PA/RM scope without RPC and returns base zones', async () => {
    const calls = [];
    const service = moduleWith({ load: async (...args) => { calls.push(args); } });
    const base = emptyBase();
    const result = await service.calculate({ async rpc(...args) { calls.push(args); } }, 2026, ['FE2', 'GM'], base, { farm: 'FE2' });
    assert.equal(calls.length, 0);
    assert.equal(result.zones, base.zones);
    assert.equal(result.analysis, null);
});

test('requests authorized farms, scores blocks and submits one assignment per farm/campo/strip', async () => {
    const cells = [cell('FE', 'FE01', 'strip-1', 1), cell('FE', 'FE01', 'strip-1', 2, 2),
        cell('PA', 'PA01', 'strip-2', 3), cell('RM', 'RM01', 'strip-3', 4)];
    const rpcCalls = [], routingCalls = [];
    const base = emptyBase();
    const zones = validZones();
    const client = { async rpc(name, args) {
        rpcCalls.push([name, args]);
        if (name === 'fertilizer_service_cached_profile') return { data: null, error: null };
        if (name === 'fertilizer_block_grid') return { data: grid(cells), error: null };
        return { data: resultData(zones), error: null };
    } };
    const routing = { profile: routeProfile, async load(...args) {
        routingCalls.push(args);
        return { graph: { async serviceBlockCosts(samples, mounds) {
            assert.equal(samples.length, 4);
            assert.deepEqual(Array.from(mounds, mound => mound.id), ['fe-mound']);
            return [
                { farm_code: 'FE', campo: 'FE01', strip_id: 'strip-1', mound_id: 'fe-mound', score: 200, meters: 100 },
                { farm_code: 'PA', campo: 'PA01', strip_id: 'strip-2', mound_id: 'fe-mound', score: 210, meters: 110 },
                { farm_code: 'RM', campo: 'RM01', strip_id: 'strip-3', mound_id: 'fe-mound', score: 220, meters: 120 }
            ];
        } } };
    } };
    const service = moduleWith(routing), scope = { farm: 'authorized' };
    const result = await service.calculate(client, 2026, ['FE', 'FE2', 'PA', 'RM', 'GM'], base, scope);
    assert.deepEqual(Array.from(rpcCalls[0][1].requested_farms), ['FE', 'PA', 'RM']);
    assert.equal(rpcCalls[0][1].route_model, 'ab-blocks-v2');
    assert.equal(rpcCalls[0][1].map_year, '2026');
    assert.deepEqual(routingCalls[0], [client, 2026, 'FE', scope]);
    assert.equal(rpcCalls[1][0], 'fertilizer_block_grid');
    const payload = rpcCalls[2][1];
    assert.equal(rpcCalls[2][0], 'fertilizer_block_zones');
    assert.deepEqual(Array.from(payload.requested_farms), ['FE', 'PA', 'RM']);
    assert.equal(payload.grid_signature, 'sig-1');
    assert.deepEqual(Array.from(payload.assignments, assignment => [assignment.f, assignment.c, assignment.s, assignment.m]), [
        ['FE', 'FE01', 'strip-1', 'fe-mound'], ['PA', 'PA01', 'strip-2', 'fe-mound'], ['RM', 'RM01', 'strip-3', 'fe-mound']
    ]);
    assert.equal(payload.assignments.length, 3);
    assert.equal(result.zones, zones);
    assert.equal(result.signature, 'sig-final');
    assert.deepEqual(result.analysis, expectedAnalysis);
});

test('propagates grid or routing failures and never returns fallback zones', async () => {
    const base = emptyBase(), failure = new Error('block grid offline');
    const failedGrid = moduleWith({ profile: routeProfile, load: async () => { throw new Error('should not load graph'); } });
    await assert.rejects(failedGrid.calculate({ async rpc(name) {
        return name === 'fertilizer_service_cached_profile' ? { data: null, error: null } : { data: null, error: failure };
    } }, 2026, ['FE'], base, {}), error => error === failure);

    const routingFailure = new Error('network graph unavailable');
    const validGridClient = { async rpc(name) {
        if (name === 'fertilizer_service_cached_profile') return { data: null, error: null };
        if (name === 'fertilizer_block_grid') return { data: grid([cell('FE', 'FE01', 's1')]), error: null };
        throw new Error('zones RPC must not run after routing error');
    } };
    const failedRouting = moduleWith({ profile: routeProfile, async load() { throw routingFailure; } });
    await assert.rejects(failedRouting.calculate(validGridClient, 2026, ['FE'], base, {}), error => error === routingFailure);
});

test('invalidate makes an older cache lookup stale before grid, graph or zone RPC', async () => {
    let resolveCache, networkLoads = 0, gridCalls = 0, zoneCalls = 0;
    const pending = new Promise(resolve => { resolveCache = resolve; });
    const client = { async rpc(name) {
        if (name === 'fertilizer_service_cached_profile') return pending;
        if (name === 'fertilizer_block_grid') gridCalls++;
        zoneCalls++;
        return { data: resultData(), error: null };
    } };
    const service = moduleWith({ profile: routeProfile, async load() { networkLoads++; return { graph: { serviceBlockCosts: () => [] } }; } });
    const work = service.calculate(client, 2026, ['FE'], emptyBase(), {});
    service.invalidate();
    resolveCache({ data: null, error: null });
    await assert.rejects(work, /cancelado/i);
    assert.equal(networkLoads, 0);
    assert.equal(gridCalls, 0);
    assert.equal(zoneCalls, 0);
});

test('valid cached ab-blocks zones return directly without loading the graph', async () => {
    const cached = resultData({ type: 'FeatureCollection', features: [
        ...validZones().features,
        { type: 'Feature', properties: { farm_code: 'PA', mound_id: 'pa-mound', mound_ids: ['pa-mound'] }, geometry: null }
    ] }, 'full-scope-signature');
    const calls = [];
    const service = moduleWith({ profile: routeProfile, async load() { throw new Error('cache hit must skip graph load'); } });
    const result = await service.calculate({ async rpc(name, args) {
        calls.push([name, args]);
        return { data: cached, error: null };
    } }, 2026, ['FE', 'PA', 'FE2'], emptyBase(), {});
    assert.deepEqual(calls.map(([name]) => name), ['fertilizer_service_cached_profile']);
    assert.deepEqual(Array.from(calls[0][1].requested_farms), ['FE', 'PA']);
    assert.equal(calls[0][1].route_model, 'ab-blocks-v2');
    assert.equal(result, cached);
});

test('missing block RPC falls back to the valid cached road study without loading a graph', async () => {
    const cachedV2 = {
        signature: 'v2-signature', zones: validZones(),
        analysis: { method: 'network_grid', model_version: 'machine-road-v2', resolution_m: 100 }
    };
    const calls = [];
    const service = moduleWith({ profile: routeProfile, async load() { throw new Error('cached v2 must skip graph load'); } });
    const result = await service.calculate({ async rpc(name, args) {
        calls.push([name, args]);
        if (name === 'fertilizer_service_cached_profile' && args.route_model === 'ab-blocks-v2') return { data: null, error: null };
        if (name === 'fertilizer_block_grid') return { data: null, error: { code: 'PGRST202', message: 'function not found' } };
        if (name === 'fertilizer_service_cached_profile' && args.route_model === 'machine-road-v2') return { data: cachedV2, error: null };
        throw new Error(`unexpected RPC ${name}`);
    } }, 2026, ['FE'], emptyBase(), {});
    assert.deepEqual(Array.from(calls, ([name, args]) => [name, args.route_model ?? null]), [
        ['fertilizer_service_cached_profile', 'ab-blocks-v2'],
        ['fertilizer_block_grid', null],
        ['fertilizer_service_cached_profile', 'machine-road-v2']
    ]);
    assert.equal(result, cachedV2);
});

test('generic block grid errors do not trigger the road-study fallback', async () => {
    const failure = { code: '500', message: 'network unavailable' }, calls = [];
    const service = moduleWith({ profile: routeProfile, async load() { throw new Error('graph must not load'); } });
    await assert.rejects(service.calculate({ async rpc(name, args) {
        calls.push([name, args]);
        if (name === 'fertilizer_service_cached_profile') return { data: null, error: null };
        return { data: null, error: failure };
    } }, 2026, ['FE'], emptyBase(), {}), error => error === failure);
    assert.deepEqual(Array.from(calls, ([name]) => name), ['fertilizer_service_cached_profile', 'fertilizer_block_grid']);
});

test('rejects stale v1/v2 caches, duplicate or missing block results, and unauthorized output', async () => {
    const service = moduleWith({ profile: routeProfile, async load() { return { graph: { serviceBlockCosts: async () => [] } }; } });
    const stale = resultData(validZones());
    stale.analysis = { method: 'ab_strips', model_version: 'ab-strips-v1', routing_model: 'machine-road-v2', strip_width_m: 50, sampling_step_m: 100 };
    let calls = 0;
    await assert.rejects(service.calculate({ async rpc() { calls++; return { data: stale, error: null }; } },
        2026, ['FE'], emptyBase(), {}), /preparado incompleto/i);
    assert.equal(calls, 1);
    const staleV2 = resultData(validZones());
    staleV2.analysis = { method: 'network_grid', model_version: 'machine-road-v2', resolution_m: 100 };
    await assert.rejects(service.calculate({ async rpc() { return { data: staleV2, error: null }; } },
        2026, ['FE'], emptyBase(), {}), /preparado incompleto/i);

    const outOfScopeGrid = moduleWith({ profile: routeProfile, async load() { throw new Error('out-of-scope grid must be rejected before graph load'); } });
    await assert.rejects(outOfScopeGrid.calculate({ async rpc(name) {
        if (name === 'fertilizer_service_cached_profile') return { data: null, error: null };
        return { data: grid([cell('FE2', 'FE201', 'outside')]), error: null };
    } }, 2026, ['FE'], emptyBase(), {}), /fora do escopo/i);

    async function runWithCosts(costs) {
        const client = { async rpc(name) {
            if (name === 'fertilizer_service_cached_profile') return { data: null, error: null };
        if (name === 'fertilizer_block_grid') return { data: grid([cell('FE', 'FE01', 's1')]), error: null };
            return { data: resultData(validZones()), error: null };
        } };
        const badRouting = { profile: routeProfile, async load() { return { graph: { serviceBlockCosts: async () => costs } }; } };
        return moduleWith(badRouting).calculate(client, 2026, ['FE'], emptyBase(), {});
    }
    const cost = { farm_code: 'FE', campo: 'FE01', strip_id: 's1', mound_id: 'fe-mound', score: 10, meters: 9 };
    await assert.rejects(runWithCosts([cost, cost]), /inválido/i);
    await assert.rejects(runWithCosts([]), /inválido/i);

    const forbidden = resultData({ type: 'FeatureCollection', features: [
        { type: 'Feature', properties: { farm_code: 'FE2', mound_id: 'fe-mound', mound_ids: ['fe-mound'] }, geometry: null }
    ] });
    await assert.rejects(moduleWith({ profile: routeProfile, async load() { throw new Error('cache should be rejected before graph load'); } })
        .calculate({ async rpc() { return { data: forbidden, error: null }; } }, 2026, ['FE'], emptyBase(), {}), /fora do acesso atual/i);

    const unknownMound = resultData({ type: 'FeatureCollection', features: [
        { type: 'Feature', properties: { farm_code: 'FE', mound_id: 'fe-mound', mound_ids: ['unknown'] }, geometry: null }
    ] });
    await assert.rejects(moduleWith({ profile: routeProfile, async load() { throw new Error('cache should be rejected before graph load'); } })
        .calculate({ async rpc() { return { data: unknownMound, error: null }; } }, 2026, ['FE'], emptyBase(), {}), /fora do acesso atual/i);
});
