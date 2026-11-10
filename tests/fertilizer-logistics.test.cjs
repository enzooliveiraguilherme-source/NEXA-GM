const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../js/fertilizer-logistics.js'), 'utf8');

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function harness({ result, error, farms = [{ code: 'FE' }, { code: 'GM' }, { code: 'RM' }] } = {}) {
    const elements = new Map();
    const document = { getElementById(id) {
        if (!elements.has(id)) elements.set(id, { id, hidden: true, innerHTML: '', value: '', onchange: null, onclick: null, offsetTop: 8, offsetHeight: 20, details: { open: true }, querySelector(selector) { return selector === 'details' ? this.details : null; } });
        return elements.get(id);
    } };
    const groups = [], markers = [], popups = [];
    const map = { fits: [], closed: 0, pans: [], closePopup() { this.closed++; }, fitBounds(bounds, opts) { this.fits.push([bounds, opts]); }, panTo(point) { this.pans.push(point); } };
    const layer = (feature) => ({ feature, styles: [], events: {}, addTo(group) { group.items.push(this); return this; }, bindTooltip(content, opts) { this.tooltip = content; this.tooltipOptions = opts; return this; }, getTooltip() { return { getContent: () => this.tooltip }; }, unbindTooltip() { this.tooltip = null; return this; }, on(name, fn) { this.events[name] = fn; return this; }, bindPopup(content) { this.popup = content; return this; }, openPopup() { return this; }, setStyle(style) { this.styles.push(style); return this; } });
    const L = {
        DomEvent: { disableClickPropagation() {}, disableScrollPropagation() {}, stopPropagation() {} },
        featureGroup() { const g = { items: [], removed: false, addTo() { groups.push(this); return this; }, remove() { this.removed = true; }, removeLayer(item) { this.items = this.items.filter(x => x !== item); }, getBounds() { return { isValid: () => true }; } }; return g; },
        geoJSON(collection, opts = {}) { const g = { items: [], collection, opts, addTo(parent) { this.parent = parent; if (parent.items) parent.items.push(this); return this; }, getBounds() { return { isValid: () => true }; } }; for (const f of collection.features || []) { const item = layer(f); g.items.push(item); opts.onEachFeature?.(f, item); } return g; },
        marker(point, opts) { const item = layer(null); item.point = point; item.options = opts; markers.push(item); return item; },
        divIcon: opts => opts,
        polyline(points, opts) { return { points, opts, addTo(parent) { parent.items.push(this); return this; }, remove() {} }; },
        popup(opts) { const p = { opts, setLatLng(point) { this.point = point; return this; }, setContent(content) { this.content = content; return this; }, openOn() { popups.push(this); return this; } }; return p; }
    };
    const client = { calls: [], async rpc(name, args) { this.calls.push([name, args]); if (error) return { error }; return { data: result, error: null }; } };
    const window = { portalFarms: farms, supabaseClient: client };
    vm.runInNewContext(source, vm.createContext({ window, document, console, L, Intl, Map, Set, JSON, Math, String, Number }));
    const api = window.FertilizerLogistics;
    const state = { currentTab: 'adubacao', currentSubTab: 'logistica', currentAno: '2026', currentFazenda: 'ALL', currentGleba: 'ALL', map };
    const fields = [
        { type: 'Feature', properties: { Fazenda: 'FE', Campo: 'FE 01' }, geometry: null },
        { type: 'Feature', properties: { Fazenda: 'GM', Campo: 'GM 02' }, geometry: null },
        { type: 'Feature', properties: { Fazenda: 'RM', Campo: 'RM 02' }, geometry: null }
    ];
    return { api, client, state, fields, elements, element: id => document.getElementById(id), groups, markers, popups, map };
}

const response = () => ({
    mounds: [
        { id: 'm1', name: 'Monte Um', farm_code: 'FE', gleba: 'FE 01', source_gleba: 'FE 01', longitude: -50, latitude: -20 },
        { id: 'm2', name: 'Monte Dois', farm_code: 'GM', gleba: 'GM 02', source_gleba: 'GM 02', longitude: -51, latitude: -21 },
        { id: 'm3', name: '<img src=x onerror=alert(1)>', farm_code: 'FE', gleba: 'FE 02', source_gleba: 'raw <script>', longitude: -49, latitude: -19 },
        { id: 'm4', name: 'Monte fornecedor FE', farm_code: 'FE', gleba: 'RM 02', source_gleba: 'FE 04', longitude: -52, latitude: -22 }
    ],
    zones: { type: 'FeatureCollection', features: [
        { type: 'Feature', properties: { mound_id: 'm1', mound_ids: ['m1'], name: 'Zona FE 01', farm_code: 'FE', gleba: 'FE 01', area_ha: 10 }, geometry: null },
        { type: 'Feature', properties: { mound_id: 'm2', mound_ids: ['m2'], name: 'Zona GM 02', farm_code: 'GM', gleba: 'GM 02', area_ha: 20 }, geometry: null },
        { type: 'Feature', properties: { mound_id: 'm3', mound_ids: ['m3'], name: 'Zona FE 02', farm_code: 'FE', gleba: 'FE 02', area_ha: 5 }, geometry: null },
        { type: 'Feature', properties: { mound_id: 'm4', mound_ids: ['m4'], name: 'Zona RM 02', farm_code: 'RM', gleba: 'RM 02', area_ha: 12 }, geometry: null }
    ] }
});

test('active e filtros de fazenda/gleba usam apenas o contexto atual', () => {
    const h = harness();
    assert.equal(h.api.active(h.state), true);
    assert.equal(h.api.active({ ...h.state, currentSubTab: 'estoque' }), false);
    const m = response().mounds[0];
    assert.equal(h.api.matches(m, h.state), true);
    assert.equal(h.api.matches(m, { ...h.state, currentFazenda: 'GM' }), false);
    assert.equal(h.api.matches(m, { ...h.state, currentGleba: 'FE 02' }), false);
});

test('load chama a RPC do ano, limita fazendas autorizadas e reaproveita cache por escopo', async () => {
    const h = harness({ result: response() });
    const first = await h.api.load(h.client, 2026, ['FE']);
    const again = await h.api.load(h.client, 2026, ['FE']);
    assert.equal(h.client.calls.length, 1);
    assert.equal(h.client.calls[0][0], 'fertilizer_logistics');
    assert.equal(h.client.calls[0][1].map_year, '2026');
    assert.deepEqual(first.mounds.map(m => m.id), ['m1', 'm3', 'm4']);
    assert.deepEqual(first.zones.features.map(f => f.properties.mound_id), ['m1', 'm3']);
    assert.equal(first, again);
    const wider = await h.api.load(h.client, 2026, ['FE', 'GM']);
    assert.equal(wider.mounds.length, 4);
    assert.equal(h.client.calls.length, 2);
});

test('load falha em erro/incompleto e remove falha do cache para permitir retry', async () => {
    const h = harness({ error: new Error('temporary') });
    await assert.rejects(h.api.load(h.client, 2026, ['FE']), /temporary/);
    h.client.rpc = async () => ({ data: response(), error: null });
    assert.equal((await h.api.load(h.client, 2026, ['FE'])).mounds.length, 3);
    await assert.rejects(h.api.load({ rpc: async () => ({ data: {}, error: null }) }, 2027, ['FE']), /incompleta/i);
    await assert.rejects(h.api.load(null, 2026, ['FE']), /indispon/i);
});

test('refresh mostra resumo filtrado e texto de estoque ainda não cadastrado; popup escapa HTML', async () => {
    const h = harness({ result: response() });
    const panel = h.element('fertilizer-logistics-panel');
    await h.api.refresh(h.state, h.fields, true);
    assert.equal(h.elements.get('fertilizer-logistics-panel').hidden, false);
    assert.match(h.elements.get('fertilizer-logistics-panel').innerHTML, /4 montes/);
    assert.doesNotMatch(h.elements.get('fertilizer-logistics-panel').innerHTML, /Sem cobertura de montes/);
    assert.doesNotMatch(h.elements.get('fertilizer-logistics-panel').innerHTML, /<img/);
    assert.equal(h.map.fits.length, 2);
    assert.equal(h.markers.length, 4);
    const moundSelect = h.element('logistics-mound');
    moundSelect.value = 'm1';
    moundSelect.onchange({ target: moundSelect });
    assert.equal(moundSelect.value, 'm1');
    assert.equal(panel.details.open, false);
    assert.deepEqual(Array.from(h.popups[0].opts.autoPanPaddingTopLeft), [12, 40]);
    assert.deepEqual(Array.from(h.popups[0].opts.autoPanPaddingBottomRight), [12, 12]);
    assert.match(h.popups[0].content, /Monte Um/);
    assert.match(h.popups[0].content, /Estoque ainda n[aã]o cadastrado/);
    const popup = h.api.moundDetails(response().mounds[2]);
    assert.match(popup, /&lt;img/);
    assert.match(popup, /Estoque ainda n[aã]o cadastrado/);
    assert.doesNotMatch(popup, /<script>/);
    assert.doesNotMatch(popup, /toneladas disponíveis/);
});

test('refresh filtra pelo seletor de fazenda e mostra estado sem montes', async () => {
    const h = harness({ result: response() });
    h.state.currentFazenda = 'GM';
    await h.api.refresh(h.state, h.fields);
    assert.match(h.elements.get('fertilizer-logistics-panel').innerHTML, /1 montes/);
    assert.doesNotMatch(h.elements.get('fertilizer-logistics-panel').innerHTML, /Monte Um/);
    h.state.currentGleba = 'inexistente';
    await h.api.refresh(h.state, h.fields);
    assert.match(h.elements.get('fertilizer-logistics-panel').innerHTML, /Nenhum monte cadastrado/);
});

test('FE fornecedor atende RM destino e load aplica whitelist também aos destinos', async () => {
    const h = harness({ result: response() });
    const allAuthorized = await h.api.load(h.client, 2026, ['FE', 'GM', 'RM']);
    const rmState = { ...h.state, currentFazenda: 'RM', currentGleba: 'RM 02' };
    const rmField = h.fields.filter(field => field.properties.Fazenda === 'RM');
    const rmView = h.api.view(allAuthorized, rmState, rmField);
    assert.deepEqual(rmView.mounds.map(mound => mound.id), ['m4']);
    assert.deepEqual(rmView.zones.map(zone => zone.properties.farm_code), ['RM']);
    const feOnly = await h.api.load(h.client, 2026, ['FE']);
    assert.equal(feOnly.zones.features.some(zone => zone.properties.farm_code === 'RM'), false);
});

test('resposta atrasada após sair da aba não repõe painel ou camadas', async () => {
    const pending = deferred();
    const h = harness();
    h.client.rpc = () => pending.promise;
    const work = h.api.refresh(h.state, h.fields);
    h.state.currentSubTab = 'estoque';
    h.api.clear();
    pending.resolve({ data: response(), error: null });
    await work;
    assert.equal(h.elements.get('fertilizer-logistics-panel').hidden, true);
    assert.equal(h.groups[0].removed, true);
    assert.equal(h.markers.length, 0);
});

test('erro de RPC oferece retry e mantém outlines neutros', async () => {
    const h = harness({ error: new Error('offline') });
    const errors = [];
    const originalError = console.error;
    // Module uses the shared console; silence expected failure in test output.
    console.error = (...args) => errors.push(args);
    try { await h.api.refresh(h.state, h.fields); } finally { console.error = originalError; }
    assert.match(h.elements.get('fertilizer-logistics-panel').innerHTML, /Tentar novamente/);
    assert.equal(h.groups[0].items.length, 1);
    assert.equal(errors.length, 1);
});

test('distance uses great-circle distance in meters', () => {
    const { api } = harness();
    assert.ok(Math.abs(api.distance([0, 0], [1, 0]) - 111195) < 100);
});
