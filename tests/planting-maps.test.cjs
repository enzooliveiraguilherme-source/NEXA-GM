const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const F = require('../js/planting-forecast.js');
const feature = { properties: { Fazenda: 'FE', Campo: 'FE 01', Area: 100, Variedade: 'Olimpo' } };
function harness() {
    const elements = new Map();
    const document = { addEventListener() {}, querySelectorAll: () => [], getElementById(id) {
        if (!elements.has(id)) elements.set(id, { innerHTML: '', classList: { toggle(name, value) { this[name] = value; } } });
        return elements.get(id);
    } };
    const window = { PlantingForecast: F };
    const context = vm.createContext({ window, document, console, Date, L: { DomEvent: { stopPropagation() {}, preventDefault() {} } } });
    vm.runInContext(fs.readFileSync(require.resolve('../js/planting-maps.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(require.resolve('../app.js'), 'utf8'), context);
    const app = vm.runInContext('({state,isOperationalMapMode,isPlantingAnalysisMode,onEachFeature,getFeatureStyle,TalhaoSelection})', context);
    app.state.currentTab = 'plantio'; app.state.currentSubTab = 'data-estimada-colheita';
    app.state.userRole = 'editor'; app.state.operationalMode = 'planejamento';
    let records = { a: { operationType: 'plantio', produto: 'Plantio', fazenda: 'FE', campo: 'FE 01', ano: '2026', cultura: 'Soja', status: 'em_andamento', areaRealizada: 40, variedadeSemente: 'Olimpo', dataPlantio: '2026-10-15' } };
    app.state.cloudStore = { getRecords: () => records, getPlanning: () => ({}) };
    return { ...app, maps: window.PlantingMaps, elements, setRecords(value) { records = value; } };
}
test('mapas usam execução real e área parcial, sem exigir inclusão no planejamento', () => {
    const h = harness(); h.maps.refresh(h.state, [feature]);
    assert.match(h.maps.tooltip(h.state, feature), /06\/02\/2027/);
    assert.match(h.maps.tooltip(h.state, feature), /40 ha \/ 100 ha/);
    assert.equal(h.maps.style(h.state, feature).dashArray, '5 4');
    assert.match(h.elements.get('planting-map-summary').innerHTML, /40 ha/);
    h.setRecords({}); h.maps.refresh(h.state, [feature]);
    assert.match(h.elements.get('planting-map-summary').innerHTML, /Não há plantio executado/);
    assert.equal(h.maps.style(h.state, feature).fillOpacity, .16);
});
test('filtros de safra e cultura não reaproveitam execução de outro contexto', () => {
    const h = harness(); h.state.currentAno = '2027'; h.maps.refresh(h.state, [feature]);
    assert.match(h.maps.tooltip(h.state, feature), /Sem plantio executado/);
    h.state.currentAno = '2026'; h.state.currentCultura = 'Milho'; h.maps.refresh(h.state, [feature]);
    assert.match(h.maps.tooltip(h.state, feature), /Sem plantio executado/);
});
test('abas derivadas não permitem seleção, edição nem alteração de planejamento', () => {
    const h = harness(); h.maps.refresh(h.state, [feature]);
    const events = {}; let popup = '', opened = 0;
    const layer = { on: (event, action) => { events[event] = action; }, getTooltip: () => null, bindTooltip() {},
        bindPopup(html) { popup = html; return this; }, openPopup() { opened++; } };
    h.onEachFeature(feature, layer);
    assert.equal(h.isOperationalMapMode(), false); assert.equal(h.isPlantingAnalysisMode(), true);
    events.click({}); events.contextmenu({}); h.TalhaoSelection.toggle(feature);
    assert.equal(opened, 1); assert.match(popup, /06\/02\/2027/); assert.equal(h.state.selectedFeatures.size, 0);
    h.state.currentSubTab = 'mapa-plantio'; assert.equal(h.isOperationalMapMode(), true);
});
test('legenda de variedades, escape e ocultação ao sair das abas de análise', () => {
    const h = harness(); h.state.currentSubTab = 'variedades-plantadas';
    h.setRecords({ a: { produto: 'Plantio', fazenda: 'FE', campo: 'FE 01', ano: '2026', cultura: 'Soja', status: 'concluido', areaRealizada: 100, variedadeSemente: '<img onerror=alert(1)>', dataPlantio: '2026-10-15' } });
    h.maps.refresh(h.state, [feature]);
    assert.match(h.elements.get('planting-map-legend').innerHTML, /&lt;img/);
    assert.doesNotMatch(h.elements.get('planting-map-legend').innerHTML, /<img/);
    assert.match(h.maps.tooltip(h.state, feature), /Ciclo da variedade não definido/);
    h.state.currentTab = 'adubacao'; h.maps.refresh(h.state, [feature]);
    assert.equal(h.elements.get('planting-map-summary').classList.hidden, true);
    assert.equal(h.elements.get('planting-map-legend').classList.hidden, true);
});
