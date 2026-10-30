const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient, createView } = require('../js/savefarm-view.js');

function harness({ role = 'admin', request = async () => ({}) } = {}) {
    const elements = new Map();
    const handlers = new Map();
    const mapCalls = { added: [], removed: [], fit: 0, closed: 0, invalidated: 0 };

    class Element {
        constructor(id = '') {
            this.id = id; this.children = []; this.listeners = new Map(); this.value = '';
            this.textContent = ''; this.hidden = false; this.disabled = false; this.selected = false;
        }
        append(...items) {
            this.children.push(...items);
            if (['savefarm-farm', 'savefarm-polygon', 'savefarm-machine'].includes(this.id) && !this.value && items.length) this.value = items[0].value;
        }
        replaceChildren(...items) { this.children = [...items]; }
        addEventListener(name, fn) { this.listeners.set(name, fn); }
        dispatch(name, event = {}) { return this.listeners.get(name)?.({ preventDefault() {}, ...event }); }
        querySelectorAll() { return ['farm', 'polygon', 'machine', 'from', 'to', 'mode', 'submit'].map(name => document.getElementById(name === 'submit' ? 'savefarm-submit' : 'savefarm-' + name)); }
        get selectedOptions() { return [this.children.find(item => item.value === this.value) || this.children[0]].filter(Boolean); }
    }
    const document = {
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, new Element(id));
            return elements.get(id);
        },
        createElement: tag => new Element(tag)
    };
    for (const name of ['farm', 'polygon', 'machine', 'from', 'to', 'mode', 'submit', 'connect', 'connect-form', 'connect-submit', 'username', 'password', 'token', 'token-row']) document.getElementById(name === 'submit' ? 'savefarm-submit' : 'savefarm-' + name);
    const nativeReplaceChildren = Element.prototype.replaceChildren;
    Element.prototype.replaceChildren = function (...items) {
        nativeReplaceChildren.call(this, ...items);
        if (['savefarm-farm', 'savefarm-polygon', 'savefarm-machine'].includes(this.id)) this.value = '';
        if (['savefarm-farm', 'savefarm-polygon', 'savefarm-machine'].includes(this.id) && this.children.length) this.value = this.children[0].value;
    };
    const map = {
        invalidateSize() { mapCalls.invalidated++; },
        closePopup() { mapCalls.closed++; },
        removeLayer(layer) { mapCalls.removed.push(layer); },
        fitBounds() { mapCalls.fit++; }
    };
    const L = {
        canvas: opts => ({ ...opts }),
        geoJSON(geojson, options) {
            const layer = {
                data: geojson, options, cleared: false,
                clearLayers() { this.cleared = true; },
                addTo(target) { mapCalls.added.push(this); this.map = target; return this; },
                getBounds() { return { isValid: () => geojson.features.length > 0 }; }
            };
            return layer;
        }
    };
    const api = createView({ document, L, request, role: () => role });
    const state = { currentTab: 'savefarm', map };
    return {
        api, state, elements, mapCalls,
        el(name) { return document.getElementById('savefarm-' + name); },
        logout() { document.getElementById('btn-logout').dispatch('click'); }
    };
}

const catalog = {
    configured: true, timezone: 'America/Sao_Paulo', message: 'Conexão pronta.',
    farms: [{ code: 'F1', name: 'Fazenda simulada', polygons: [{ id: 'P1', label: 'Talhão 1' }], machines: [{ id: 'M1', label: 'Máquina 1' }] }]
};
const simulatedMap = {
    geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Simulado' }, geometry: { type: 'Polygon', coordinates: [] } }] },
    queriedAt: '2026-10-30T12:00:00Z'
};
const simulatedStats = { summary: { ltsTotal: 1234.5, Hectareas: 20, hectareasSelectiva: 5, savedLiters: 80 } };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('cliente exige JWT de sessão e consulta somente a função Supabase sem cache', async () => {
    let fetches = 0;
    const noSession = createClient({
        client: { auth: { getSession: async () => ({ data: { session: null } }) } },
        config: { supabaseUrl: 'https://project.supabase.co', supabaseAnonKey: 'anon' },
        fetchImpl: async () => { fetches++; }
    });
    await assert.rejects(noSession({ action: 'catalog' }), /Entre novamente/);
    assert.equal(fetches, 0);

    let call;
    const request = createClient({
        client: { auth: { getSession: async () => ({ data: { session: { access_token: 'session-jwt' } } }) } },
        config: { supabaseUrl: 'https://project.supabase.co', supabaseAnonKey: 'anon-key' },
        fetchImpl: async (...args) => {
            call = args;
            return { ok: true, json: async () => ({ configured: false, farms: [] }) };
        }
    });
    await request({ action: 'catalog' });
    assert.equal(call[0], 'https://project.supabase.co/functions/v1/savecloud');
    assert.equal(call[1].cache, 'no-store');
    assert.equal(call[1].credentials, 'omit');
    assert.equal(call[1].headers.Authorization, 'Bearer session-jwt');
    assert.equal(call[1].headers.apikey, 'anon-key');
    assert.deepEqual(JSON.parse(call[1].body), { action: 'catalog' });
    assert.equal(Object.hasOwn(call[1], 'localStorage'), false);
});

test('perfil não administrador mantém a visão sem chamar o catálogo', async () => {
    let calls = 0;
    const h = harness({ role: 'operator', request: async () => { calls++; } });
    h.api.refresh(h.state);
    await tick();
    assert.equal(calls, 0);
    assert.equal(h.el('panel').hidden, false);
    assert.match(h.el('status').textContent, /inicialmente para administradores/);
    assert.equal(h.el('farm').children.length, 1);
    assert.equal(h.el('farm').disabled, true);
    assert.equal(h.el('connect').hidden, true);
    h.el('username').value = 'demo-user'; h.el('password').value = 'demo-password';
    await h.el('connect-form').dispatch('submit');
    assert.equal(calls, 0);
});

test('admin gera token de conexão na sessão e limpa a senha após sucesso', async () => {
    const requests = [];
    const h = harness({ request: async body => {
        requests.push(body);
        if (body.action === 'catalog') return { ...catalog, configured: false, farms: [] };
        if (body.action === 'authenticate') return { connectionToken: 'token-ficticio-da-sessao' };
        throw new Error('Ação inesperada');
    } });
    h.api.refresh(h.state); await tick();
    assert.equal(h.el('connect').hidden, false);
    h.el('username').value = 'usuario-ficticio';
    h.el('password').value = 'senha-ficticia';
    await h.el('connect-form').dispatch('submit');
    assert.deepEqual(requests[1], { action: 'authenticate', username: 'usuario-ficticio', password: 'senha-ficticia' });
    assert.equal(h.el('password').value, '');
    assert.equal(h.el('token').value, 'token-ficticio-da-sessao');
    assert.equal(h.el('token-row').hidden, false);
    assert.match(h.el('status').textContent, /Token gerado pela SaveCloud/);
    assert.equal(Object.hasOwn(h.elements, 'localStorage'), false);
});

test('erro ao autenticar limpa a senha e não exibe token', async () => {
    const h = harness({ request: async body => {
        if (body.action === 'catalog') return { ...catalog, configured: false, farms: [] };
        if (body.action === 'authenticate') throw new Error('Credenciais rejeitadas');
        throw new Error('Ação inesperada');
    } });
    h.api.refresh(h.state); await tick();
    h.el('username').value = 'usuario-ficticio'; h.el('password').value = 'senha-ficticia';
    await h.el('connect-form').dispatch('submit');
    assert.equal(h.el('password').value, '');
    assert.equal(h.el('token').value, '');
    assert.equal(h.el('token-row').hidden, true);
    assert.match(h.el('status').textContent, /Credenciais rejeitadas/);
});

test('sair da aba e logout limpam senha, token e detalhes; resposta atrasada não restaura token', async () => {
    let finishAuthentication, authenticationCalls = 0;
    const h = harness({ request: body => {
        if (body.action === 'catalog') return Promise.resolve({ ...catalog, configured: false, farms: [] });
        if (body.action === 'authenticate' && ++authenticationCalls === 1) return new Promise(resolve => { finishAuthentication = resolve; });
        if (body.action === 'authenticate') return Promise.resolve({ connectionToken: 'outro-token-ficticio' });
    } });
    h.api.refresh(h.state); await tick();
    h.el('username').value = 'usuario-ficticio'; h.el('password').value = 'senha-ficticia';
    const pending = h.el('connect-form').dispatch('submit');
    await tick();
    h.state.currentTab = 'mapa'; h.api.refresh(h.state);
    assert.equal(h.el('password').value, '');
    assert.equal(h.el('token').value, '');
    assert.equal(h.el('token-row').hidden, true);
    assert.equal(h.el('connect').hidden, true);
    finishAuthentication({ connectionToken: 'token-atrasado-ficticio' });
    await pending;
    assert.equal(h.el('token').value, '');

    h.state.currentTab = 'savefarm'; h.api.refresh(h.state); await tick();
    h.el('username').value = 'usuario-ficticio'; h.el('password').value = 'senha-ficticia';
    await h.el('connect-form').dispatch('submit');
    assert.equal(h.el('token').value, 'outro-token-ficticio');
    h.logout();
    assert.equal(h.el('password').value, '');
    assert.equal(h.el('token').value, '');
    assert.equal(h.el('token-row').hidden, true);
    assert.equal(h.el('connect').hidden, true);
});

test('catálogo simulado popula filtros, e consulta renderiza mapa e cartões', async () => {
    const requests = [];
    const h = harness({ request: async body => {
        requests.push(body);
        if (body.action === 'catalog') return catalog;
        if (body.action === 'map') return simulatedMap;
        if (body.action === 'statistics') return simulatedStats;
        throw new Error('Ação inesperada');
    } });
    h.api.refresh(h.state);
    await tick();
    assert.deepEqual(requests[0], { action: 'catalog' });
    assert.equal(h.el('farm').children[0].textContent, 'Fazenda simulada');
    assert.equal(h.el('polygon').children[0].textContent, 'Talhão 1');
    assert.equal(h.el('machine').children[0].textContent, 'Máquina 1');
    assert.match(h.el('timezone').textContent, /America\/Sao_Paulo/);
    h.el('farm').value = 'F1'; h.el('polygon').value = 'P1'; h.el('machine').value = 'M1';
    await h.el('form').dispatch('submit');
    assert.deepEqual(requests.slice(1).map(item => item.action), ['map', 'statistics']);
    assert.equal(h.mapCalls.added.length, 1);
    assert.equal(h.mapCalls.fit, 1);
    assert.equal(h.el('results').children.length, 4);
    assert.equal(h.el('results').children[0].children[1].textContent, '1.234,5 L');
    assert.match(h.el('status').textContent, /Mapa recebido/);
    assert.match(h.el('status').textContent, /Indicadores preliminares/);
});

test('consulta por máquina avisa o escopo amplo e troca vinculada descarta resultados anteriores', async () => {
    let mapRequests = 0;
    const h = harness({ request: async body => {
        if (body.action === 'catalog') return catalog;
        if (body.action === 'map') return { ...simulatedMap, scope: ++mapRequests === 1 ? 'machine' : 'polygon' };
        return simulatedStats;
    } });
    h.api.refresh(h.state); await tick();
    h.el('farm').value = 'F1'; h.el('polygon').value = 'P1'; h.el('machine').value = 'M1';
    await h.el('form').dispatch('submit');
    const machineLayer = h.mapCalls.added[0];
    assert.match(h.el('status').textContent, /Consulta por máquina, sem vínculo de talhão; pode incluir várias fazendas\./);
    assert.equal(h.el('results').children.length, 4);

    h.el('machine').value = '';
    h.el('machine').dispatch('change');
    assert.equal(machineLayer.cleared, true);
    assert.equal(h.mapCalls.removed.at(-1), machineLayer);
    assert.equal(h.el('results').children.length, 0);
    await h.el('form').dispatch('submit');
    assert.equal(h.mapCalls.added.length, 2);
    assert.equal(h.el('results').children.length, 4);
    assert.doesNotMatch(h.el('status').textContent, /Consulta por máquina/);
});

test('trocar filtro, sair da aba e logout descartam camada e cartões', async () => {
    const h = harness({ request: async body => body.action === 'catalog' ? catalog : body.action === 'map' ? simulatedMap : simulatedStats });
    h.api.refresh(h.state); await tick();
    await h.el('form').dispatch('submit');
    const layer = h.mapCalls.added[0];
    assert.equal(h.el('results').children.length, 4);
    h.el('farm').dispatch('change');
    assert.equal(layer.cleared, true);
    assert.equal(h.mapCalls.removed.at(-1), layer);
    assert.equal(h.el('results').children.length, 0);
    await h.el('form').dispatch('submit');
    assert.equal(h.el('results').children.length, 4);
    h.state.currentTab = 'mapa'; h.api.refresh(h.state);
    assert.equal(h.el('panel').hidden, true);
    assert.equal(h.el('results').children.length, 0);
    assert.equal(h.el('farm').children[0].textContent, 'Aguardando conexão');
    h.state.currentTab = 'savefarm'; h.api.refresh(h.state); await tick();
    await h.el('form').dispatch('submit');
    h.logout();
    assert.equal(h.el('panel').hidden, true);
    assert.equal(h.el('results').children.length, 0);
    assert.equal(h.el('farm').children[0].textContent, 'Aguardando conexão');
});

test('resposta atrasada após mudança de filtro não renderiza mapa nem cartões', async () => {
    let finishMap, finishStats, mapSignal;
    const h = harness({ request: body => {
        if (body.action === 'catalog') return Promise.resolve(catalog);
        if (body.action === 'map') return new Promise(resolve => { finishMap = resolve; });
        if (body.action === 'statistics') return new Promise(resolve => { finishStats = resolve; });
    } });
    h.api.refresh(h.state); await tick();
    const submit = h.el('form').dispatch('submit');
    await tick();
    h.el('mode').dispatch('change');
    finishMap(simulatedMap); finishStats(simulatedStats);
    await submit;
    assert.equal(h.mapCalls.added.length, 0);
    assert.equal(h.el('results').children.length, 0);
    assert.match(h.el('status').textContent, /Filtros alterados/);
});

test('falha parcial preserva mapa quando estatísticas falham e mostra cartões quando o mapa falha', async () => {
    let phase = 0;
    const h = harness({ request: async body => {
        if (body.action === 'catalog') return catalog;
        if (body.action === 'map') {
            if (phase === 0) return simulatedMap;
            throw new Error('Mapa indisponível');
        }
        if (body.action === 'statistics') {
            if (phase === 0) throw new Error('Indicadores indisponíveis');
            return simulatedStats;
        }
    } });
    h.api.refresh(h.state); await tick();
    await h.el('form').dispatch('submit');
    assert.equal(h.mapCalls.added.length, 1);
    assert.equal(h.el('results').children.length, 0);
    assert.match(h.el('status').textContent, /Estatísticas indisponíveis: Indicadores indisponíveis/);
    phase = 1;
    h.el('mode').dispatch('change');
    await h.el('form').dispatch('submit');
    assert.equal(h.mapCalls.added.length, 1);
    assert.equal(h.el('results').children.length, 4);
    assert.match(h.el('status').textContent, /Mapa indisponível/);
});
