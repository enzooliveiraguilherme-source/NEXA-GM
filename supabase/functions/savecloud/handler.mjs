const BASE = 'https://savecloud.savefarm.com.br/api/';
const MAX_BYTES = 6 * 1024 * 1024;
const MAX_PAGES = 20;
const id = value => typeof value === 'string' && /^[\w-]{1,100}$/.test(value);
class Failure extends Error {
    constructor(status, message, retryAfter) { super(message); this.status = status; this.retryAfter = retryAfter; }
}

// Lê o fluxo com teto real, inclusive se Content-Length não vier na resposta.
async function readJson(response, limit = MAX_BYTES) {
    if (Number(response.headers.get('content-length')) > limit) {
        await response.body?.cancel();
        throw new Failure(413, 'Consulta muito grande. Reduza o período.');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Failure(502, 'Resposta vazia da SaveCloud.');
    const decoder = new TextDecoder();
    let size = 0, text = '';
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > limit) { await reader.cancel(); throw new Failure(413, 'Consulta muito grande. Reduza o período.'); }
            text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
        return { value: JSON.parse(text), bytes: size };
    } catch (error) {
        if (error instanceof Failure || error?.name === 'TimeoutError' || error?.name === 'AbortError') throw error;
        throw new Failure(502, 'A SaveCloud retornou dados que não puderam ser interpretados.');
    } finally { reader.releaseLock(); }
}

function bindings(raw, farms) {
    let parsed;
    try { parsed = JSON.parse(raw || '[]'); } catch { throw new Failure(503, 'A vinculação SaveCloud precisa ser revisada.'); }
    if (!Array.isArray(parsed) || parsed.length > 100) throw new Failure(503, 'A vinculação SaveCloud precisa ser revisada.');
    const seen = new Set();
    return parsed.map(binding => {
        if (!binding || !id(binding.farm) || !id(binding.campo) || seen.has(binding.farm) ||
            !Array.isArray(binding.polygons) || !binding.polygons.length || binding.polygons.length > 500 ||
            !Array.isArray(binding.machines) || !binding.machines.length || binding.machines.length > 100 ||
            [...binding.polygons, ...binding.machines].some(item => !item || !id(item.id) || typeof item.label !== 'string' || !item.label.trim() || item.label.length > 150) ||
            new Set(binding.polygons.map(item => item.id)).size !== binding.polygons.length ||
            new Set(binding.machines.map(item => item.id)).size !== binding.machines.length) {
            throw new Failure(503, 'A vinculação SaveCloud precisa ser revisada.');
        }
        seen.add(binding.farm);
        return { farm: binding.farm, campo: binding.campo,
            polygons: binding.polygons.map(({ id, label }) => ({ id, label })),
            machines: binding.machines.map(({ id, label }) => ({ id, label })) };
    }).filter(binding => farms.some(farm => farm.code === binding.farm));
}

function datePart(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:00$/.test(value)) throw new Failure(400, 'Use datas e horas completas, sem minutos.');
    const date = new Date(value + ':00Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 16) !== value) throw new Failure(400, 'Período inválido.');
    return date;
}

function geojson(input) {
    const features = input?.type === 'FeatureCollection' ? input.features : input?.type === 'Feature' ? [input] : null;
    if (!Array.isArray(features) || features.length > 20000) throw new Failure(502, 'Formato do mapa SaveCloud não reconhecido.');
    const depths = { Point: 0, MultiPoint: 1, LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3 };
    let points = 0;
    function coordinates(value, depth) {
        if (!Array.isArray(value)) return false;
        if (depth > 0) return value.length > 0 && value.every(child => coordinates(child, depth - 1));
        return ++points <= 250000 && value.length >= 2 && value.length <= 3 &&
            value.every(Number.isFinite) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
    }
    return { type: 'FeatureCollection', features: features.map(feature => {
        const geometry = feature?.geometry;
        if (feature?.type !== 'Feature' || !geometry || !Object.hasOwn(depths, geometry.type) ||
            !coordinates(geometry.coordinates, depths[geometry.type])) throw new Failure(502, 'Geometria SaveCloud inválida ou muito grande.');
        // Primeiro ciclo: apenas geometria. Metadados por máquina exigem validação do contrato real.
        return { type: 'Feature', geometry: { type: geometry.type, coordinates: geometry.coordinates }, properties: {} };
    }) };
}

function summary(rows) {
    // O contrato online atual usa hectareas; o PDF cita Hectareas.
    rows = rows.map(row => ({ ...row, Hectareas: row?.hectareas ?? row?.Hectareas }));
    const keys = ['ltsTotal', 'Hectareas', 'hectareasSelectiva'];
    const totals = Object.fromEntries(keys.map(key => [key, rows.length && rows.every(row =>
        typeof row?.[key] === 'number' && Number.isFinite(row[key]) && row[key] >= 0)
        ? rows.reduce((sum, row) => sum + row[key], 0) : null]));
    for (const key of keys) if (!Number.isFinite(totals[key])) totals[key] = null;
    // Percentuais não são somados nem calculados por média simples.
    let reference = 0;
    const comparable = rows.length && rows.every(row => typeof row?.Hectareas === 'number' && row.Hectareas >= 0 && Number.isFinite(row.Hectareas) &&
        typeof row?.ltsHectObj === 'number' && row.ltsHectObj >= 0 && Number.isFinite(row.ltsHectObj));
    if (comparable) reference = rows.reduce((sum, row) => sum + row.Hectareas * row.ltsHectObj, 0);
    return { ...totals, workCount: rows.length, referenceLiters: comparable && Number.isFinite(reference) ? reference : null,
        savedLiters: comparable && Number.isFinite(reference) && reference > 0 && totals.ltsTotal !== null ? Math.max(0, reference - totals.ltsTotal) : null };
}

export function makeSavecloudHandler({ env, userClient, fetchImpl = fetch, now = () => new Date() }) {
    return async request => {
        const origin = request.headers.get('origin') || '';
        const origins = ['https://nexa-gm.vercel.app', ...(env('SAVECLOUD_ALLOWED_ORIGINS') || '').split(',').map(value => value.trim()).filter(Boolean)];
        const allowedOrigin = origins.includes(origin) || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin);
        const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store',
            'Vary': 'Origin', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
            'Access-Control-Allow-Methods': 'POST, OPTIONS', ...(allowedOrigin ? { 'Access-Control-Allow-Origin': origin } : {}) };
        const reply = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...headers, ...extra } });
        if (origin && !allowedOrigin) return reply(403, { error: 'Origem não permitida.' });
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
        if (request.method !== 'POST') return reply(405, { error: 'Método não permitido.' });
        const authorization = request.headers.get('authorization') || '';
        if (!/^Bearer\s+\S+$/i.test(authorization)) return reply(401, { error: 'Entre novamente no NEXA.' });
        try {
            const client = userClient(authorization);
            const { data, error } = await client.auth.getUser(authorization.replace(/^Bearer\s+/i, ''));
            if (error || !data?.user?.email_confirmed_at) return reply(401, { error: 'Seu acesso expirou. Entre novamente.' });
            const admin = await client.rpc('is_admin');
            if (admin.error || admin.data !== true) return reply(403, { error: 'Integração em validação, disponível inicialmente para administradores.' });
            const accessible = await client.rpc('list_accessible_farms_by_gleba');
            if (accessible.error || !Array.isArray(accessible.data)) throw new Failure(503, 'Não foi possível conferir as fazendas liberadas.');
            let body;
            try { ({ value: body } = await readJson(request, 8192)); }
            catch (error) {
                if (error instanceof Failure && error.status === 502) throw new Failure(400, 'Consulta inválida.');
                throw error;
            }
            if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Failure(400, 'Consulta inválida.');
            if (body.action === 'authenticate') {
                if (Object.keys(body).some(key => !['action', 'username', 'password'].includes(key)) ||
                    typeof body.username !== 'string' || !body.username.trim() || body.username.length > 150 ||
                    typeof body.password !== 'string' || !body.password || body.password.length > 1000) throw new Failure(400, 'Informe seu usuário e sua senha SaveCloud.');
                // Uso único: a senha segue para a SaveCloud e não é gravada nem registrada.
                const response = await fetchImpl(BASE + 'auth', { method: 'POST', redirect: 'error', cache: 'no-store',
                    signal: AbortSignal.timeout(25000), headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
                    body: new URLSearchParams({ username: body.username.trim(), password: body.password }) });
                body.password = '';
                if (!response.ok) {
                    await response.body?.cancel();
                    throw new Failure(response.status === 429 ? 429 : 502, response.status === 429
                        ? 'Aguarde antes de tentar gerar outro token.' : 'A SaveCloud não aceitou o acesso. Confira usuário e senha.');
                }
                const { value } = await readJson(response, 65536);
                if (typeof value?.token !== 'string' || !/^[a-f0-9]{40}$/i.test(value.token)) throw new Failure(502, 'A SaveCloud não retornou um token reconhecido.');
                return reply(200, { connectionToken: value.token, message: 'Token gerado. Salve-o no segredo SAVECLOUD_TOKEN do Supabase.' });
            }
            if (Object.keys(body).some(key => !['action', 'farm', 'polygon', 'machine', 'from', 'to', 'mode'].includes(key))) throw new Failure(400, 'Consulta inválida.');
            const directory = bindings(env('SAVECLOUD_BINDINGS'), accessible.data);
            const token = env('SAVECLOUD_TOKEN')?.trim().replace(/^Token\s+/i, '');
            const timezone = env('SAVECLOUD_TIME_ZONE');
            let validZone = false;
            try { if (timezone) { new Intl.DateTimeFormat('pt-BR', { timeZone: timezone }); validZone = true; } } catch { /* falha fechada */ }
            const accountMode = env('SAVECLOUD_ACCOUNT_MODE') === '1';
            const configured = Boolean(token && (directory.length || accountMode) && validZone);
            const deadline = AbortSignal.timeout(25000);
            let budget = MAX_BYTES;
            async function remote(url) {
                const target = new URL(url, BASE);
                if (target.origin !== new URL(BASE).origin || !target.pathname.startsWith('/api/') || target.username || target.password) throw new Failure(502, 'Paginação SaveCloud inválida.');
                const response = await fetchImpl(target.href, { method: 'GET', headers: { Authorization: `Token ${token}`, Accept: 'application/json' },
                    redirect: 'error', cache: 'no-store', signal: deadline });
                if (!response.ok) {
                    await response.body?.cancel();
                    const retry = response.headers.get('retry-after');
                    throw new Failure(response.status === 429 ? 429 : 502,
                        response.status === 429 ? 'Limite SaveCloud atingido. Aguarde antes de atualizar.'
                            : response.status === 401 ? 'A SaveCloud recusou o token configurado (401). Gere um token real em POST /api/auth e confira o segredo SAVECLOUD_TOKEN.'
                            : response.status === 403 ? 'A SaveCloud recusou a permissão da conexão (403). Confira o acesso da conta às máquinas.'
                            : `Não foi possível consultar a SaveCloud (HTTP ${response.status}). Tente mais tarde.`,
                        retry && /^\d{1,6}$/.test(retry) ? retry : undefined);
                }
                const result = await readJson(response, budget);
                budget -= result.bytes;
                return result.value;
            }
            async function pages(first, path, filters) {
                let url = new URL(first, BASE), rows = [], seen = new Set();
                for (let page = 0; page < MAX_PAGES; page++) {
                    // Cursores externos nunca podem trocar endpoint, conta ou escopo.
                    if (url.origin !== new URL(BASE).origin || url.pathname !== path || seen.has(url.href)) throw new Failure(502, 'Paginação SaveCloud inválida.');
                    for (const [key, value] of Object.entries(filters)) url.searchParams.set(key, value);
                    seen.add(url.href);
                    const data = await remote(url.href);
                    if (!Array.isArray(data?.results)) throw new Failure(502, 'Estatísticas ou catálogo SaveCloud em formato não reconhecido.');
                    rows.push(...data.results);
                    if (rows.length > 20000) throw new Failure(413, 'Consulta muito grande. Reduza o período.');
                    if (data.next === null || data.next === undefined) return rows;
                    if (typeof data.next !== 'string') throw new Failure(502, 'Paginação SaveCloud inválida.');
                    url = new URL(data.next, url);
                }
                throw new Failure(413, 'Há muitas páginas. Reduza o período da consulta.');
            }
            async function machines() {
                const rows = await remote('moviles/?full=0');
                if (!Array.isArray(rows) || rows.length > 200) throw new Failure(502, 'Catálogo de máquinas em formato não reconhecido.');
                return rows.map(row => {
                    const key = String(row?.id);
                    if (!id(key) || typeof row?.description !== 'string') throw new Failure(502, 'Máquina SaveCloud em formato não reconhecido.');
                    return { id: key, label: (row.description + (row.referencia ? ' · ' + String(row.referencia) : '')).slice(0, 150) };
                });
            }
            if (body.action === 'catalog') {
                const farms = directory.map(binding => ({ code: binding.farm, name: accessible.data.find(farm => farm.code === binding.farm)?.name || binding.farm,
                    polygons: binding.polygons, machines: binding.machines }));
                if (accountMode && configured) farms.push({ code: '__savecloud__', name: 'Máquinas da conta SaveCloud',
                    polygons: [{ id: '__machine__', label: 'Sem vínculo de talhão' }], machines: await machines() });
                return reply(200, { configured: configured && farms.some(farm => farm.machines.length), phase: 'admin-validation', timezone: validZone ? timezone : null,
                    message: configured ? 'Conexão configurada. Dados sujeitos à validação com a SaveCloud.' : 'Aguardando acesso à SaveCloud e configuração da conexão.', farms });
            }
            if (!['map', 'statistics', 'boundaries'].includes(body.action)) throw new Failure(400, 'Consulta inválida.');
            if (!configured) throw new Failure(503, 'A conexão SaveCloud ainda não foi configurada.');
            const machineScope = accountMode && body.farm === '__savecloud__' && body.polygon === '__machine__';
            const binding = machineScope ? { machines: await machines() } : directory.find(binding => binding.farm === body.farm);
            if (!binding || (!machineScope && !binding.polygons.some(item => item.id === body.polygon))) throw new Failure(403, 'Talhão fora das fazendas vinculadas ao seu acesso.');
            if (machineScope && body.action === 'boundaries') throw new Failure(400, 'A consulta por máquina não possui limite de talhão vinculado.');
            const scope = machineScope ? 'machine' : 'field';
            const queriedAt = now().toISOString();
            if (body.action === 'boundaries') {
                const filters = { campos_ids: binding.campo, poligonos_ids: body.polygon, full: '1', page_size: '100' };
                const rows = await pages('poligonos/', '/api/poligonos/', filters);
                const row = rows.find(item => String(item?.id) === body.polygon);
                if (!row) throw new Failure(404, 'Talhão não encontrado na SaveCloud.');
                // O schema online nomeia a geometria como mpoly.
                let geometry = row.mpoly || row.geometry;
                if (typeof geometry === 'string') {
                    try { geometry = JSON.parse(geometry); } catch { throw new Failure(502, 'Formato do limite SaveCloud não reconhecido.'); }
                }
                const shape = row.type === 'Feature' ? row : geometry ? { type: 'Feature', geometry } : null;
                return reply(200, { source: 'SaveCloud', scope, queriedAt, timezone, geojson: geojson(shape) });
            }
            if (!binding.machines.some(item => item.id === body.machine)) throw new Failure(403, 'Máquina não vinculada à fazenda.');
            const from = datePart(body.from), to = datePart(body.to);
            if (to <= from || to - from > 7 * 86400000) throw new Failure(400, 'Escolha um período maior que zero e de até sete dias.');
            const stamp = value => value.replace('T', '-').replace(':', '-') + '-00';
            if (body.action === 'map') {
                if (![1, 3, 4, 5].includes(body.mode)) throw new Failure(400, 'Camada inválida.');
                const params = new URLSearchParams({ movil: body.machine, from: stamp(body.from), to: stamp(body.to),
                    mode: String(body.mode), ...(!machineScope ? { poligonos_ids: body.polygon } : {}) });
                return reply(200, { source: 'SaveCloud', scope, queriedAt, timezone, geojson: geojson(await remote('mapa?' + params)) });
            }
            const filters = { movil: body.machine, ...(!machineScope ? { poligono: body.polygon, campo: binding.campo } : {}), meta: '1',
                from: stamp(body.from).slice(0, 13), to: stamp(body.to).slice(0, 13) };
            const rows = await pages('estadistica_trabajo/', '/api/estadistica_trabajo/', filters);
            return reply(200, { source: 'SaveCloud', scope, queriedAt, timezone, summary: summary(rows),
                warning: 'Indicadores preliminares: unidades, intervalos e agregações aguardam validação com a SaveCloud.' });
        } catch (error) {
            if (error instanceof Failure) return reply(error.status, { error: error.message }, error.retryAfter ? { 'Retry-After': error.retryAfter } : {});
            if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return reply(504, { error: 'A SaveCloud demorou para responder. Reduza o período ou tente mais tarde.' });
            return reply(502, { error: 'Não foi possível concluir a consulta. Tente novamente mais tarde.' });
        }
    };
}
