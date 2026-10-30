import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSavecloudHandler } from '../supabase/functions/savecloud/handler.mjs';

const binding = {
  farm: 'farm-1', campo: 'campo-1',
  polygons: [{ id: 'poly-1', label: 'Talhão 1' }],
  machines: [{ id: 'machine-1', label: 'Máquina 1' }],
};

function setup({ token = 'test-token', bindings = [binding], farms = [{ code: 'farm-1', name: 'Fazenda 1' }], accountMode = false,
  admin = true, auth = true, timezone = 'America/Sao_Paulo', fetchImpl = async () => { throw new Error('upstream inesperado'); },
  now = () => new Date('2026-10-30T12:00:00.000Z') } = {}) {
  const calls = { user: [], rpc: [], fetch: [] };
  const envValues = {
    SAVECLOUD_TOKEN: token,
    SAVECLOUD_BINDINGS: JSON.stringify(bindings),
    SAVECLOUD_TIME_ZONE: timezone,
    SAVECLOUD_ACCOUNT_MODE: accountMode ? '1' : '0',
  };
  const env = name => envValues[name];
  const userClient = authorization => {
    calls.user.push(authorization);
    return {
      auth: { getUser: async value => ({ data: { user: auth ? { email_confirmed_at: '2026-01-01T00:00:00Z' } : null }, error: auth ? null : new Error('auth') }) },
      rpc: async name => {
        calls.rpc.push(name);
        if (name === 'is_admin') return { data: admin, error: null };
        return { data: farms, error: null };
      },
    };
  };
  const wrappedFetch = async (...args) => { calls.fetch.push(args); return fetchImpl(...args); };
  const handler = makeSavecloudHandler({ env, userClient, fetchImpl: wrappedFetch, now });
  const request = (body = {}, options = {}) => new Request('https://nexa.test/functions/v1/savecloud', {
    method: options.method || 'POST',
    headers: { authorization: options.authorization ?? 'Bearer session-test', ...(options.origin ? { origin: options.origin } : {}), ...(options.headers || {}) },
    body: ['GET', 'HEAD', 'OPTIONS'].includes(options.method) ? undefined : JSON.stringify(body),
  });
  return { handler, request, calls, envValues };
}

async function json(response) { return response.json(); }
const query = (action, extra = {}) => ({ action, farm: 'farm-1', polygon: 'poly-1', ...extra });
const dateRange = { from: '2026-10-29T00:00', to: '2026-10-30T00:00' };

test('requires a confirmed user and administrator authorization before accessing farms', async () => {
  const unauthenticated = setup({ auth: false });
  assert.equal((await unauthenticated.handler(unauthenticated.request({ action: 'catalog' }))).status, 401);
  assert.deepEqual(unauthenticated.calls.rpc, []);

  const nonAdmin = setup({ admin: false });
  assert.equal((await nonAdmin.handler(nonAdmin.request({ action: 'catalog' }))).status, 403);
  assert.deepEqual(nonAdmin.calls.rpc, ['is_admin']);

  const inaccessible = setup({ farms: null });
  const response = await inaccessible.handler(inaccessible.request({ action: 'catalog' }));
  assert.equal(response.status, 503);
  assert.deepEqual(inaccessible.calls.rpc, ['is_admin', 'list_accessible_farms_by_gleba']);
});

test('catalog reports unconfigured state without contacting SaveCloud', async () => {
  const ctx = setup({ token: '' });
  const response = await ctx.handler(ctx.request({ action: 'catalog' }));
  assert.equal(response.status, 200);
  assert.equal((await json(response)).configured, false);
  assert.equal(ctx.calls.fetch.length, 0);
});

test('rejects malformed and conflicting SaveCloud bindings', async () => {
  for (const raw of ['{', 'null', JSON.stringify([{ ...binding, polygons: [] }]),
    JSON.stringify([binding, binding]), JSON.stringify([{ ...binding, machines: [{ id: 'x', label: 'ok' }, { id: 'x', label: 'duplicate' }] }])]) {
    const ctx = setup();
    ctx.envValues.SAVECLOUD_BINDINGS = raw;
    const response = await ctx.handler(ctx.request({ action: 'catalog' }));
    assert.equal(response.status, 503, raw);
  }
});

test('filters catalog bindings to farms the user can access', async () => {
  const ctx = setup({ farms: [{ code: 'other-farm', name: 'Outra' }] });
  const data = await json(await ctx.handler(ctx.request({ action: 'catalog' })));
  assert.equal(data.configured, false);
  assert.deepEqual(data.farms, []);
});

test('validates request keys, farm and polygon identifiers before upstream calls', async () => {
  for (const body of [
    { action: 'surprise' },
    { action: 'boundaries', extra: true },
    { action: 'boundaries', farm: 'not-bound', polygon: 'poly-1' },
    { action: 'boundaries', farm: 'farm-1', polygon: '../poly-1' },
  ]) {
    const ctx = setup();
    const response = await ctx.handler(ctx.request(body));
    assert.ok([400, 403].includes(response.status), JSON.stringify(body));
    assert.equal(ctx.calls.fetch.length, 0);
  }
});

test('validates machine IDs, whole-hour dates, bounded period and map modes', async () => {
  const invalidBodies = [
    query('statistics', { machine: 'machine-1', from: '2026-10-29T00:30', to: '2026-10-30T00:00' }),
    query('statistics', { machine: 'machine-1', from: '2026-02-30T00:00', to: '2026-03-01T00:00' }),
    query('statistics', { machine: 'machine-1', from: '2026-10-30T00:00', to: '2026-10-29T00:00' }),
    query('statistics', { machine: 'machine-1', from: '2026-10-20T00:00', to: '2026-10-29T00:00' }),
    query('map', { machine: 'machine-1', ...dateRange, mode: 2 }),
  ];
  for (const body of invalidBodies) {
    const ctx = setup();
    const response = await ctx.handler(ctx.request(body));
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(ctx.calls.fetch.length, 0);
  }
  const unboundMachine = setup();
  assert.equal((await unboundMachine.handler(unboundMachine.request(query('statistics', { machine: 'machine-2', ...dateRange })))).status, 403);
  assert.equal(unboundMachine.calls.fetch.length, 0);
});

test('rejects oversized request and oversized upstream response bodies', async () => {
  const ctx = setup();
  const oversizeRequest = new Request('https://nexa.test/f', { method: 'POST', headers: { authorization: 'Bearer test' }, body: JSON.stringify({ action: 'catalog', padding: 'x'.repeat(9000) }) });
  assert.equal((await ctx.handler(oversizeRequest)).status, 413);

  const large = setup({ fetchImpl: async () => new Response(' '.repeat(6 * 1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } }) });
  const response = await large.handler(large.request(query('map', { machine: 'machine-1', ...dateRange, mode: 1 })));
  assert.equal(response.status, 413);
  assert.equal(large.calls.fetch.length, 1);
});

test('maps malformed request JSON to 400 while preserving the oversized request limit', async () => {
  const ctx = setup();
  const malformed = new Request('https://nexa.test/functions/v1/savecloud', {
    method: 'POST', headers: { authorization: 'Bearer session-test', 'content-type': 'application/json' }, body: '{broken',
  });
  assert.equal((await ctx.handler(malformed)).status, 400);

  const oversized = new Request('https://nexa.test/functions/v1/savecloud', {
    method: 'POST', headers: { authorization: 'Bearer session-test', 'content-type': 'application/json' }, body: '{"action":"catalog","padding":"' + 'x'.repeat(9000) + '"}',
  });
  assert.equal((await ctx.handler(oversized)).status, 413);
});

test('blocks pagination redirects to another host or endpoint', async () => {
  for (const next of ['https://attacker.invalid/api/estadistica_trabalho/?page=2', '/api/other/?page=2']) {
    const ctx = setup({ fetchImpl: async () => Response.json({ results: [], next }) });
    const response = await ctx.handler(ctx.request(query('statistics', { machine: 'machine-1', ...dateRange })));
    assert.equal(response.status, 502, next);
    assert.equal(ctx.calls.fetch.length, 1);
    assert.equal(new URL(ctx.calls.fetch[0][0]).pathname, '/api/estadistica_trabajo/');
  }
});

test('rejects repeated pagination cursors and stops after the page limit', async () => {
  const repeated = setup({ fetchImpl: async url => {
    const current = new URL(url);
    return Response.json({ results: [], next: current.href });
  } });
  const repeatedResponse = await repeated.handler(repeated.request(query('statistics', { machine: 'machine-1', ...dateRange })));
  assert.equal(repeatedResponse.status, 502);
  assert.equal(repeated.calls.fetch.length, 1);

  let calls = 0;
  const manyPages = setup({ fetchImpl: async () => {
    calls++;
    return Response.json({ results: [], next: `?page=${calls + 1}` });
  } });
  const pagesResponse = await manyPages.handler(manyPages.request(query('statistics', { machine: 'machine-1', ...dateRange })));
  assert.equal(pagesResponse.status, 413);
  assert.equal(calls, 20);
});

test('follows same-endpoint pages and computes weighted saved liters', async () => {
  let page = 0;
  const ctx = setup({ fetchImpl: async url => {
    page++;
    assert.equal(new URL(url).pathname, '/api/estadistica_trabajo/');
    return Response.json(page === 1
      ? { results: [{ ltsTotal: 10, hectareas: 2, ltsHectObj: 8 }], next: '?page=2' }
      : { results: [{ ltsTotal: 20, hectareas: 1, ltsHectObj: 20 }], next: null });
  } });
  const response = await ctx.handler(ctx.request(query('statistics', { machine: 'machine-1', ...dateRange })));
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.deepEqual(body.summary, { ltsTotal: 30, Hectareas: 3, hectareasSelectiva: null, workCount: 2, referenceLiters: 36, savedLiters: 6 });
  assert.equal(page, 2);
  assert.equal(ctx.calls.fetch[0][1].cache, 'no-store');
  const statsUrl = new URL(ctx.calls.fetch[0][0]);
  assert.equal(statsUrl.searchParams.get('campo'), 'campo-1');
  assert.equal(statsUrl.searchParams.get('poligono'), 'poly-1');
});

test('map and boundary geometries are returned as validated GeoJSON', async () => {
  const feature = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: { private: 'discarded' } };
  const map = setup({ fetchImpl: async () => Response.json({ type: 'FeatureCollection', features: [feature] }) });
  const mapResponse = await map.handler(map.request(query('map', { machine: 'machine-1', ...dateRange, mode: 3 })));
  assert.equal(mapResponse.status, 200);
  assert.deepEqual((await json(mapResponse)).geojson.features[0].properties, {});
  const calledUrl = new URL(map.calls.fetch[0][0]);
  assert.equal(calledUrl.pathname, '/api/mapa');
  assert.equal(calledUrl.searchParams.get('poligonos_ids'), 'poly-1');

  const boundaries = setup({ fetchImpl: async () => Response.json({ results: [{ id: 'poly-1', ...feature }], next: null }) });
  const boundaryResponse = await boundaries.handler(boundaries.request(query('boundaries')));
  assert.equal(boundaryResponse.status, 200);
  assert.equal((await json(boundaryResponse)).geojson.features[0].geometry.type, 'Polygon');
  const boundariesUrl = new URL(boundaries.calls.fetch[0][0]);
  assert.equal(boundariesUrl.pathname, '/api/poligonos/');
  assert.equal(boundariesUrl.searchParams.get('campos_ids'), 'campo-1');
  assert.equal(boundariesUrl.searchParams.get('poligonos_ids'), 'poly-1');
  assert.equal(boundariesUrl.searchParams.get('full'), '1');
});

test('parses an mpoly GeoJSON string from the boundaries contract', async () => {
  const geometry = { type: 'MultiPolygon', coordinates: [[[[1, 2], [3, 2], [3, 4], [1, 2]]]] };
  const ctx = setup({ fetchImpl: async () => Response.json({ results: [{ id: 'poly-1', mpoly: JSON.stringify(geometry) }], next: null }) });
  const response = await ctx.handler(ctx.request(query('boundaries')));
  assert.equal(response.status, 200);
  assert.deepEqual((await json(response)).geojson.features[0].geometry, geometry);
});

test('rejects invalid GeoJSON coordinates and non-JSON upstream bodies', async () => {
  for (const payload of [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [181, 0] } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [0] } },
  ]) {
    const ctx = setup({ fetchImpl: async () => Response.json(payload) });
    assert.equal((await ctx.handler(ctx.request(query('map', { machine: 'machine-1', ...dateRange, mode: 1 })))).status, 502);
  }
  const malformed = setup({ fetchImpl: async () => new Response('not json') });
  assert.equal((await malformed.handler(malformed.request(query('map', { machine: 'machine-1', ...dateRange, mode: 1 })))).status, 502);

  for (const geometry of [
    { type: '__proto__', coordinates: [] },
    { type: 'constructor', coordinates: [] },
    { type: 'MultiPolygon', coordinates: [[]] },
    { type: 'Polygon', coordinates: [] },
  ]) {
    const unsafe = setup({ fetchImpl: async () => Response.json({ type: 'Feature', geometry }) });
    assert.equal((await unsafe.handler(unsafe.request(query('map', { machine: 'machine-1', ...dateRange, mode: 1 })))).status, 502, geometry.type);
  }
});

test('returns null for totals and weighted references that overflow finite numbers', async () => {
  const ctx = setup({ fetchImpl: async () => Response.json({ results: [
    { ltsTotal: Number.MAX_VALUE, Hectareas: Number.MAX_VALUE, ltsHectObj: 2, hectareasSelectiva: 1 },
    { ltsTotal: Number.MAX_VALUE, Hectareas: Number.MAX_VALUE, ltsHectObj: 1, hectareasSelectiva: 1 },
  ], next: null }) });
  const response = await ctx.handler(ctx.request(query('statistics', { machine: 'machine-1', ...dateRange })));
  assert.equal(response.status, 200);
  assert.deepEqual((await json(response)).summary, {
    ltsTotal: null, Hectareas: null, hectareasSelectiva: 2, workCount: 2,
    referenceLiters: null, savedLiters: null,
  });
});

test('preserves an upstream read timeout as a 504 response', async () => {
  const ctx = setup({ fetchImpl: async () => new Response(new ReadableStream({
    pull() { throw Object.assign(new Error('upstream timed out'), { name: 'TimeoutError' }); },
  })) });
  const response = await ctx.handler(ctx.request(query('map', { machine: 'machine-1', ...dateRange, mode: 1 })));
  assert.equal(response.status, 504);
});

test('sets private no-store and CORS headers without persisting response data', async () => {
  const ctx = setup({ fetchImpl: async () => Response.json({ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] } }) });
  const response = await ctx.handler(ctx.request(query('map', { machine: 'machine-1', ...dateRange, mode: 1 }), { origin: 'https://nexa-gm.vercel.app' }));
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('vary'), 'Origin');
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://nexa-gm.vercel.app');
  assert.deepEqual(ctx.calls.rpc, ['is_admin', 'list_accessible_farms_by_gleba']);
  assert.equal(ctx.calls.fetch.length, 1);
  assert.equal(ctx.calls.fetch[0][1].method, 'GET');
  assert.equal(ctx.calls.fetch[0][1].redirect, 'error');
});

test('rejects disallowed origins, unauthenticated requests and non-POST methods', async () => {
  const ctx = setup();
  assert.equal((await ctx.handler(ctx.request({}, { origin: 'https://evil.invalid' }))).status, 403);
  assert.equal((await ctx.handler(ctx.request({}, { authorization: '' }))).status, 401);
  assert.equal((await ctx.handler(ctx.request({}, { method: 'GET' }))).status, 405);
  assert.equal(ctx.calls.fetch.length, 0);
});

test('account mode adds only sanitized machine labels to the catalog', async () => {
  const ctx = setup({ accountMode: true, bindings: [], farms: [], fetchImpl: async url => {
    assert.equal(new URL(url).pathname, '/api/moviles/');
    assert.equal(new URL(url).searchParams.get('full'), '0');
    return Response.json([
      { id: 42, description: 'Trator', referencia: 'REF-42', token: 'secret-upstream-value', internal: 'private' },
      { id: 'machine-2', description: 'Colheitadeira', internal: 'private' },
    ]);
  } });
  const response = await ctx.handler(ctx.request({ action: 'catalog' }));
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.equal(text.includes('secret-upstream-value'), false);
  assert.equal(text.includes('private'), false);
  const body = JSON.parse(text);
  assert.equal(body.configured, true);
  assert.deepEqual(body.farms, [{
    code: '__savecloud__', name: 'Máquinas da conta SaveCloud',
    polygons: [{ id: '__machine__', label: 'Sem vínculo de talhão' }],
    machines: [{ id: '42', label: 'Trator · REF-42' }, { id: 'machine-2', label: 'Colheitadeira' }],
  }]);
});

test('account mode revalidates machine access, permits map and stats without polygon filters, and blocks boundaries', async () => {
  const machineList = [{ id: 'machine-real', description: 'Máquina real' }];
  const scopeBody = extra => ({ action: 'map', farm: '__savecloud__', polygon: '__machine__', machine: 'machine-real', ...dateRange, mode: 1, ...extra });

  const invalid = setup({ accountMode: true, bindings: [], farms: [], fetchImpl: async () => Response.json(machineList) });
  const invalidResponse = await invalid.handler(invalid.request(scopeBody({ machine: 'machine-other' })));
  assert.equal(invalidResponse.status, 403);
  assert.equal(invalid.calls.fetch.length, 1);
  assert.equal(new URL(invalid.calls.fetch[0][0]).pathname, '/api/moviles/');

  for (const action of ['map', 'statistics']) {
    const ctx = setup({ accountMode: true, bindings: [], farms: [], fetchImpl: async url => {
      const parsed = new URL(url);
      if (parsed.pathname === '/api/moviles/') return Response.json(machineList);
      if (action === 'map') return Response.json({ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] } });
      return Response.json({ results: [], next: null });
    } });
    const response = await ctx.handler(ctx.request(scopeBody({ action })));
    assert.equal(response.status, 200, action);
    assert.equal((await json(response)).scope, 'machine');
    const dataUrl = new URL(ctx.calls.fetch[1][0]);
    assert.equal(dataUrl.searchParams.has('poligonos_ids'), false);
    assert.equal(dataUrl.searchParams.has('poligono'), false);
    assert.equal(dataUrl.searchParams.has('campo'), false);
  }

  const boundaries = setup({ accountMode: true, bindings: [], farms: [], fetchImpl: async () => Response.json(machineList) });
  const boundaryResponse = await boundaries.handler(boundaries.request({ ...scopeBody({ action: 'boundaries' }), mode: undefined }));
  assert.equal(boundaryResponse.status, 400);
  assert.equal(boundaries.calls.fetch.length, 1);
  assert.equal(new URL(boundaries.calls.fetch[0][0]).pathname, '/api/moviles/');
});

test('account mode remains admin-only and the sentinel scope stays disabled when its flag is off', async () => {
  const nonAdmin = setup({ accountMode: true, bindings: [], farms: [], admin: false });
  assert.equal((await nonAdmin.handler(nonAdmin.request({ action: 'catalog' }))).status, 403);
  assert.equal(nonAdmin.calls.fetch.length, 0);

  const disabled = setup({ accountMode: false });
  const response = await disabled.handler(disabled.request({ action: 'map', farm: '__savecloud__', polygon: '__machine__', machine: 'machine-1', ...dateRange, mode: 1 }));
  assert.equal(response.status, 403);
  assert.equal(disabled.calls.fetch.length, 0);
});
