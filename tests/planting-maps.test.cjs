const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const F = require('../js/planting-forecast.js');
const feature = { properties: { Fazenda: 'FE', Campo: 'FE 01', Area: 100, Variedade: 'Olimpo' } };
function harness(options = {}) {
    const elements = new Map();
    const document = { addEventListener() {}, querySelectorAll: () => [], getElementById(id) {
        if (!elements.has(id)) elements.set(id, { innerHTML: '', classList: { toggle(name, value) { this[name] = value; } } });
        return elements.get(id);
    } };
    const window = { PlantingForecast: F, ...options };
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
test('FE 05.1 concluído mantém hectares e previsão sem borda nem aviso de parcial', () => {
    const h = harness();
    const completedField = { properties: { Fazenda: 'FE', Campo: 'FE 05.1', Area: 64.8 } };
    h.setRecords({ a: { produto: 'Plantio', fazenda: 'FE', campo: 'FE 05.1', ano: '2026', cultura: 'Soja', status: 'concluido', areaRealizada: 62.51, variedadeSemente: 'Olimpo', dataPlantio: '2026-10-09' } });
    h.maps.refresh(h.state, [completedField]);
    assert.equal(h.maps.style(h.state, completedField).dashArray, null);
    assert.doesNotMatch(h.maps.tooltip(h.state, completedField), /Plantio parcial/);
    assert.match(h.maps.tooltip(h.state, completedField), /62,51 ha/);
    assert.match(h.maps.tooltip(h.state, completedField), /31\/01\/2027/);
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
        closeTooltip() {}, unbindTooltip() {},
        bindPopup(html) { popup = html; return this; }, openPopup() { opened++; events.popupopen(); } };
    h.onEachFeature(feature, layer);
    assert.equal(h.isOperationalMapMode(), false); assert.equal(h.isPlantingAnalysisMode(), true);
    events.click({}); events.contextmenu({}); h.TalhaoSelection.toggle(feature);
    assert.equal(opened, 1); assert.match(popup, /06\/02\/2027/); assert.equal(h.state.selectedFeatures.size, 0);
    h.state.currentSubTab = 'mapa-plantio'; assert.equal(h.isOperationalMapMode(), true);
});
test('clique nas duas abas mantém somente o popup e restaura o hover ao fechar', () => {
    for (const tab of ['data-estimada-colheita', 'variedades-plantadas']) {
        const h = harness(); h.state.currentSubTab = tab; h.maps.refresh(h.state, [feature]);
        const events = {}; let tooltip = null, hoverVisible = false, popupVisible = false;
        const layer = {
            on(event, action) { events[event] = action; }, getTooltip: () => tooltip,
            bindTooltip(html) { tooltip = html; }, setTooltipContent(html) { tooltip = html; },
            closeTooltip() { hoverVisible = false; }, unbindTooltip() { tooltip = null; hoverVisible = false; },
            bindPopup() { return this; }, openPopup() { popupVisible = true; events.popupopen(); }
        };
        h.onEachFeature(feature, layer);
        assert.ok(tooltip); hoverVisible = true;
        events.click({});
        assert.equal(popupVisible, true); assert.equal(hoverVisible, false); assert.equal(tooltip, null);
        events.mouseover();
        assert.equal(tooltip, null);
        events.popupclose(); assert.ok(tooltip);
        events.click({}); assert.equal(tooltip, null);
    }
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

test('legenda de colheita separa dias consecutivos da mesma semana e soma as áreas reais', () => {
    const h = harness();
    const secondFeature = { properties: { Fazenda: 'FE', Campo: 'FE 02', Area: 100, Variedade: 'Olimpo' } };
    const record = { operationType: 'plantio', produto: 'Plantio', fazenda: 'FE', ano: '2026', cultura: 'Soja', status: 'em_andamento', variedadeSemente: 'Olimpo' };
    h.setRecords({
        a: { ...record, campo: 'FE 01', areaRealizada: 40, dataPlantio: '2026-10-15' },
        b: { ...record, campo: 'FE 02', areaRealizada: 60, dataPlantio: '2026-10-16' }
    });
    h.maps.refresh(h.state, [feature, secondFeature]);
    const legend = h.elements.get('planting-map-legend').innerHTML;
    const datedRows = [...legend.matchAll(/<span>(\d{2}\/\d{2}\/\d{4})<\/span><b>([^<]+)<\/b>/g)];
    assert.match(legend, /<h3>Dia estimado de colheita<\/h3>/);
    assert.doesNotMatch(legend, /Semana|06\/02\/2027\s*[–-]\s*07\/02\/2027/);
    assert.deepEqual(datedRows.map(match => [match[1], match[2]]), [
        ['06/02/2027', '40 ha'], ['07/02/2027', '60 ha']
    ]);
    assert.match(h.elements.get('planting-map-summary').innerHTML, /Área plantada<\/span><b>100 ha<\/b>/);
    assert.match(h.elements.get('planting-map-summary').innerHTML, /Com previsão<\/span><b>100 ha<\/b>/);
    assert.match(h.maps.tooltip(h.state, secondFeature), /07\/02\/2027/);
    assert.notEqual(h.maps.style(h.state, feature).fillColor, h.maps.style(h.state, secondFeature).fillColor);
});

test('cores fortes são compartilhadas com o relatório e botão só aparece para perfis autorizados', () => {
    for (const role of ['admin', 'projetista', 'visualizador']) {
        let exported = 0;
        const h = harness({portalAccessRole:role, PlantingReport:{download(state) { assert.equal(state,h.state); exported++; }}});
        for (const tab of ['data-estimada-colheita','variedades-plantadas']) {
            h.state.currentSubTab=tab; h.maps.refresh(h.state,[feature]);
            const html=h.elements.get('planting-map-summary').innerHTML;
            assert.equal(html.includes('Exportar relatório PDF'),role!=='visualizador');
            if(role!=='visualizador') {h.elements.get('planting-report-button').onclick();assert.ok(exported);}
            assert.equal(h.maps.style(h.state,feature).fillColor,h.maps.palette[0]);
            assert.equal(h.maps.style(h.state,feature).fillOpacity,.88);
        }
    }
});

test('clique na legenda destaca a data, suaviza os outros talhões e pode ser desfeito', () => {
    const h=harness();
    const second={properties:{Fazenda:'FE',Campo:'FE 02',Area:100}};
    const base={produto:'Plantio',fazenda:'FE',ano:'2026',cultura:'Soja',status:'concluido',areaRealizada:100,variedadeSemente:'Olimpo'};
    const records={a:{...base,campo:'FE 01',dataPlantio:'2026-10-15'},b:{...base,campo:'FE 02',dataPlantio:'2026-10-16'}};
    const before=JSON.stringify(records);
    h.setRecords(records);h.maps.refresh(h.state,[feature,second]);
    const layers=[feature,second].map(feature=>({feature,setStyle(value){this.style=value;},bringToFront(){this.raised=true;}}));
    h.state.geojsonLayer={eachLayer(action){layers.forEach(action);}};
    h.state.map={closePopup(){},closeTooltip(){throw Error('O mapa exige uma referência de tooltip; feche pelo talhão.');}};
    const summary=h.elements.get('planting-map-summary').innerHTML;
    const legend=h.elements.get('planting-map-legend');
    assert.match(legend.innerHTML,/data-planting-group="2027-02-06"/);
    legend.onclick({target:{closest:()=>({dataset:{plantingGroup:'2027-02-06'}})}});
    assert.equal(layers[0].style.fillOpacity,1);assert.equal(layers[0].style.weight,3);assert.equal(layers[0].raised,true);
    assert.equal(layers[1].style.fillOpacity,.07);assert.equal(h.elements.get('planting-legend-reset').hidden,false);
    assert.equal(h.elements.get('planting-map-summary').innerHTML,summary);assert.equal(JSON.stringify(records),before);
    h.maps.selectGroup(h.state,'2027-02-06');assert.equal(layers[0].style.fillOpacity,.88);assert.equal(layers[1].style.fillOpacity,.88);
    h.maps.selectGroup(h.state,'2027-02-07');h.elements.get('planting-legend-reset').onclick();
    assert.equal(h.elements.get('planting-legend-reset').hidden,true);assert.equal(layers[1].style.fillOpacity,.88);
});

test('destaque respeita variedades, áreas sem previsão e reinicia ao mudar filtros ou aba', () => {
    const h=harness(),second={properties:{Fazenda:'FE',Campo:'FE 02',Area:100}};
    const base={produto:'Plantio',fazenda:'FE',ano:'2026',cultura:'Soja',status:'concluido',areaRealizada:100,dataPlantio:'2026-10-15'};
    h.setRecords({a:{...base,campo:'FE 01',variedadeSemente:'Olimpo'},b:{...base,campo:'FE 02',variedadeSemente:'NEO790'}});
    h.state.currentSubTab='variedades-plantadas';h.maps.refresh(h.state,[feature,second]);
    h.maps.selectGroup(h.state,'OLIMPO');assert.equal(h.maps.style(h.state,feature).fillOpacity,1);assert.equal(h.maps.style(h.state,second).fillOpacity,.07);
    h.state.currentSubTab='data-estimada-colheita';h.maps.refresh(h.state,[feature,second]);assert.equal(h.maps.style(h.state,feature).fillOpacity,.88);
    h.maps.selectGroup(h.state,'');assert.equal(h.maps.style(h.state,feature).fillOpacity,.07);
    h.state.currentAno='2027';h.maps.refresh(h.state,[feature,second]);assert.equal(h.maps.style(h.state,feature).fillOpacity,.16);
});
