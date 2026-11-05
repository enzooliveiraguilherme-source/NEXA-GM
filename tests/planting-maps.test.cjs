const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const F = require('../js/planting-forecast.js');
const feature = { properties: { Fazenda: 'FE', Campo: 'FE 01', Area: 100, Variedade: 'Olimpo' } };
function harness(options = {}) {
    const elements = new Map();
    const labelLayers = [], markers = [];
    const document = { addEventListener() {}, querySelectorAll: () => [], getElementById(id) {
        if (!elements.has(id)) elements.set(id, { innerHTML: '', hidden: false, classList: { toggle(name, value) { this[name] = value; } } });
        return elements.get(id);
    } };
    const window = { PlantingForecast: F, ...options };
    const context = vm.createContext({ window, document, console, Date, L: {
        DomEvent: { stopPropagation() {}, preventDefault() {} },
        layerGroup() { const group = { items: [], removed: false, addTo(map) { this.map = map; labelLayers.push(this); return this; }, remove() { this.removed = true; } }; return group; },
        marker(center, settings) { const marker = { center, settings, addTo(group) { group.items.push(this); markers.push(this); return this; } }; return marker; },
        divIcon(settings) { return settings; }
    } });
    vm.runInContext(fs.readFileSync(require.resolve('../js/planting-maps.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(require.resolve('../app.js'), 'utf8'), context);
    const app = vm.runInContext('({state,isOperationalMapMode,isPlantingAnalysisMode,onEachFeature,getFeatureStyle,TalhaoSelection})', context);
    app.state.currentTab = 'plantio'; app.state.currentSubTab = 'data-estimada-colheita';
    app.state.userRole = 'editor'; app.state.operationalMode = 'planejamento';
    let records = { a: { operationType: 'plantio', produto: 'Plantio', fazenda: 'FE', campo: 'FE 01', ano: '2026', cultura: 'Soja', status: 'em_andamento', areaRealizada: 40, variedadeSemente: 'Olimpo', dataPlantio: '2026-10-15' } };
    app.state.cloudStore = { getRecords: () => records, getPlanning: () => ({}) };
    return { ...app, maps: window.PlantingMaps, elements, labelLayers, markers, setRecords(value) { records = value; } };
}
test('mapas usam execução real e área parcial, sem exigir inclusão no planejamento', () => {
    const h = harness(); h.maps.refresh(h.state, [feature]);
    assert.match(h.maps.tooltip(h.state, feature), /06\/02\/2027/);
    assert.match(h.maps.tooltip(h.state, feature), /40 ha \/ 100 ha/);
    assert.equal(h.maps.style(h.state, feature).dashArray, '5 4');
    assert.equal(h.elements.get('planting-map-summary').innerHTML, '');
    h.setRecords({}); h.maps.refresh(h.state, [feature]);
    assert.equal(h.elements.get('planting-map-summary').innerHTML, '');
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
test('abas de análise não vinculam tooltip no início, mouseover ou fechamento do popup', () => {
    for (const tab of ['data-estimada-colheita', 'variedades-plantadas']) {
        const h = harness(); h.state.currentSubTab = tab; h.maps.refresh(h.state, [feature]);
        const events = {}; let tooltip = null, hoverVisible = false, popupVisible = false, binds = 0;
        const layer = {
            on(event, action) { events[event] = action; }, getTooltip: () => tooltip,
            bindTooltip(html) { binds++; tooltip = html; }, setTooltipContent(html) { tooltip = html; },
            closeTooltip() { hoverVisible = false; }, unbindTooltip() { tooltip = null; hoverVisible = false; },
            bindPopup() { return this; }, openPopup() { popupVisible = true; events.popupopen(); }
        };
        h.onEachFeature(feature, layer);
        assert.equal(tooltip, null); assert.equal(binds, 0);
        events.mouseover(); assert.equal(tooltip, null); assert.equal(hoverVisible, false);
        events.click({});
        assert.equal(popupVisible, true); assert.equal(tooltip, null);
        events.popupclose(); assert.equal(tooltip, null); assert.equal(binds, 0);
        popupVisible = false; events.click({});
        assert.equal(popupVisible, true); assert.equal(tooltip, null); assert.equal(binds, 0);
    }
});

test('transição entre aba operacional e análise remove e restaura tooltip existente', () => {
    const h = harness(); h.state.currentTab = 'adubacao';
    const events = {}; let tooltip = null, binds = 0, unbinds = 0;
    const layer = {
        on(event, action) { events[event] = action; }, getTooltip: () => tooltip,
        bindTooltip(html) { binds++; tooltip = html; }, setTooltipContent(html) { tooltip = html; },
        unbindTooltip() { unbinds++; tooltip = null; }, closeTooltip() {}, bindPopup() { return this; }, openPopup() {}
    };
    h.onEachFeature(feature, layer);
    assert.ok(tooltip); assert.equal(binds, 1);
    h.state.currentTab = 'plantio'; h.state.currentSubTab = 'data-estimada-colheita';
    h.onEachFeature(feature, layer);
    assert.equal(tooltip, null); assert.equal(unbinds, 1);
    h.state.currentSubTab = 'mapa-plantio';
    h.onEachFeature(feature, layer);
    assert.ok(tooltip); assert.equal(binds, 2);
});
test('legenda de variedades, escape e ocultação ao sair das abas de análise', () => {
    const h = harness(); h.state.currentSubTab = 'variedades-plantadas';
    h.setRecords({ a: { produto: 'Plantio', fazenda: 'FE', campo: 'FE 01', ano: '2026', cultura: 'Soja', status: 'concluido', areaRealizada: 100, variedadeSemente: '<img onerror=alert(1)>', dataPlantio: '2026-10-15' } });
    h.maps.refresh(h.state, [feature]);
    assert.match(h.elements.get('planting-map-legend').innerHTML, /&lt;img/);
    assert.doesNotMatch(h.elements.get('planting-map-legend').innerHTML, /<img/);
    assert.match(h.maps.tooltip(h.state, feature), /&lt;img/);
    assert.doesNotMatch(h.maps.tooltip(h.state, feature), /Ciclo|Colheita estimada/);
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
    assert.doesNotMatch(legend, /Semana/);
    assert.deepEqual(datedRows.map(match => [match[1], match[2]]), [
        ['06/02/2027', '40 ha'], ['07/02/2027', '60 ha']
    ]);
    assert.equal(h.elements.get('planting-map-summary').innerHTML, '');
    assert.match(legend, /<div class="planting-legend-window"><span>Janela estimada<\/span><strong>06\/02\/2027 – 07\/02\/2027<\/strong><\/div>/);
    assert.match(h.maps.tooltip(h.state, secondFeature), /07\/02\/2027/);
    assert.notEqual(h.maps.style(h.state, feature).fillColor, h.maps.style(h.state, secondFeature).fillColor);
});

test('cores fortes são compartilhadas e exportação aparece uma vez na legenda inferior para perfis autorizados', () => {
    for (const role of ['admin', 'projetista', 'visualizador']) {
        let exported = 0;
        const h = harness({portalAccessRole:role, PlantingReport:{download(state) { assert.equal(state,h.state); exported++; }}});
        for (const tab of ['data-estimada-colheita','variedades-plantadas']) {
            h.state.currentSubTab=tab; h.maps.refresh(h.state,[feature]);
            const html=h.elements.get('planting-map-legend').innerHTML;
            assert.equal(h.elements.get('planting-map-summary').innerHTML,'');
            assert.equal(h.elements.get('planting-map-summary').classList.hidden,true);
            assert.equal(html.includes('Exportar relatório PDF'),role!=='visualizador');
            assert.equal((html.match(/Exportar relatório PDF/g)||[]).length,role==='visualizador'?0:1);
            if(role!=='visualizador') {h.elements.get('planting-report-button').onclick();assert.ok(exported);}
            assert.equal(h.maps.style(h.state,feature).fillColor,tab==='variedades-plantadas'?h.maps.varietyColor('Olimpo'):h.maps.palette[0]);
            assert.equal(h.maps.style(h.state,feature).fillOpacity,tab==='variedades-plantadas'?1:.88);
        }
    }
});

test('cores de variedade são estáveis por nome, independente de fazenda, filtros, ordem e sessão', () => {
    const h = harness(), other = { properties: { Fazenda: 'PA', Campo: 'PA 01', Area: 100 } };
    const record = (farm, field, variety='Olimpo') => ({ produto:'Plantio', fazenda:farm, campo:field, ano:'2026', cultura:'Soja', status:'concluido', areaRealizada:100, variedadeSemente:variety, dataPlantio:'2026-10-15' });
    const records = { a:record('FE','FE 01'), b:record('PA','PA 01'), c:record('FE','FE 02','NEO 790') };
    h.state.currentSubTab='variedades-plantadas'; h.setRecords(records); h.maps.refresh(h.state,[feature,other]);
    const color = h.maps.style(h.state,feature).fillColor;
    assert.match(color,/^hsl\(\d+, \d+%, \d+%\)$/);
    assert.equal(h.maps.style(h.state,other).fillColor,color);
    h.state.currentFazenda='PA'; h.maps.refresh(h.state,[other]); assert.equal(h.maps.style(h.state,other).fillColor,color);
    h.state.currentFazenda='ALL'; h.maps.refresh(h.state,[other,feature]); assert.equal(h.maps.style(h.state,feature).fillColor,color);
    const reloaded=harness(); reloaded.state.currentSubTab='variedades-plantadas'; reloaded.setRecords(records); reloaded.maps.refresh(reloaded.state,[feature,other]);
    assert.equal(reloaded.maps.style(reloaded.state,feature).fillColor,color);
    assert.equal(h.maps.varietyColor(' ÓLIMPO '),h.maps.varietyColor('olimpo'));
    assert.equal(h.maps.varietyColor('Neo 790'),h.maps.varietyColor('NEO790'));
    for (const variety of ['Olimpo','NEO 790','Safira']) {
        const vivid=h.maps.varietyColor(variety);
        assert.match(vivid,/^hsl\(\d+, 100%, 40%\)$/);
    }
    const legend=h.elements.get('planting-map-legend').innerHTML;
    assert.match(legend,new RegExp(`background:${color.replace(/[()%,]/g,'\\$&')}`));
    assert.equal(h.maps.varietyColor(''), '#94a3b8');
    assert.equal(h.maps.varietyColor('Não informada'), '#94a3b8');
    h.state.currentSubTab='data-estimada-colheita'; h.maps.refresh(h.state,[feature,other]);
    assert.equal(h.maps.style(h.state,feature).fillColor,h.maps.palette[0]);
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
test('o botão PDF desaparece no modo Visualizador mesmo para ADM e volta em Editor',()=>{
    const h=harness({portalAccessRole:'admin'});
    for(const tab of ['data-estimada-colheita','variedades-plantadas']){
        h.state.currentSubTab=tab;h.state.userRole='editor';h.maps.refresh(h.state,[feature]);
        assert.match(h.elements.get('planting-map-legend').innerHTML,/Exportar relatório PDF/);
        h.state.userRole='viewer';h.maps.refresh(h.state,[feature]);
        assert.doesNotMatch(h.elements.get('planting-map-legend').innerHTML,/Exportar relatório PDF/);
        h.state.userRole='editor';h.maps.refresh(h.state,[feature]);
        assert.match(h.elements.get('planting-map-legend').innerHTML,/Exportar relatório PDF/);
    }
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
test('textos das variedades e da colheita têm conteúdos próprios para cada mapa',()=>{
    const h=harness();h.maps.refresh(h.state,[feature]);
    const harvest=h.maps.tooltip(h.state,feature);
    assert.match(harvest,/Colheita estimada/);assert.match(harvest,/Área prevista/);assert.match(harvest,/Ciclo: 114 dias/);
    h.state.currentSubTab='variedades-plantadas';h.maps.refresh(h.state,[feature]);
    const varieties=h.maps.tooltip(h.state,feature);
    assert.match(varieties,/Variedade plantada/);assert.match(varieties,/Área plantada/);
    assert.doesNotMatch(varieties,/Colheita estimada|Ciclo:/);assert.notEqual(varieties,harvest);
});

test('legenda e exportação acompanham a aba sem preencher o resumo superior',()=>{
    const h=harness({portalAccessRole:'projetista',PlantingReport:{download(state){assert.equal(state,h.state);}}});
    h.maps.refresh(h.state,[feature]);
    assert.equal(h.elements.get('planting-map-summary').innerHTML,'');
    assert.equal(h.elements.get('planting-map-summary').classList.hidden,true);
    assert.match(h.elements.get('planting-map-legend').innerHTML,/Janela estimada/);
    assert.match(h.elements.get('planting-map-legend').innerHTML,/Exportar relatório PDF/);
    assert.equal(typeof h.elements.get('planting-report-button').onclick,'function');
    h.elements.get('planting-report-button').onclick();
    h.state.currentSubTab='variedades-plantadas';h.maps.refresh(h.state,[feature]);
    assert.equal(h.elements.get('planting-map-summary').innerHTML,'');
    assert.equal(h.elements.get('planting-map-summary').classList.hidden,true);
    assert.match(h.elements.get('planting-map-legend').innerHTML,/área plantada/i);
    assert.match(h.elements.get('planting-map-legend').innerHTML,/Exportar relatório PDF/);
    assert.doesNotMatch(h.elements.get('planting-map-legend').innerHTML,/Janela estimada/);
    assert.equal(typeof h.elements.get('planting-report-button').onclick,'function');
});

test('resumo permanece oculto e vazio nas duas abas; legenda mostra dados e estados da cultura',()=>{
    const h=harness();
    h.setRecords({a:{produto:'Plantio',fazenda:'FE',campo:'FE 01',ano:'2026',cultura:'Soja',status:'em_andamento',areaRealizada:40}});
    h.maps.refresh(h.state,[feature]);
    assert.equal(h.elements.get('planting-map-summary').innerHTML,'');
    assert.equal(h.elements.get('planting-map-summary').classList.hidden,true);
    const legend=h.elements.get('planting-map-legend').innerHTML;
    assert.match(legend,/<strong>Sem previsão<\/strong>/);
    assert.match(legend,/Sem previsão: confira a variedade e a data de plantio/);
    assert.match(legend,/40 ha plantados sem previsão/);
    assert.match(legend,/Sem previsão \/ sem plantio/);
    h.state.currentSubTab='variedades-plantadas';h.maps.refresh(h.state,[feature]);
    assert.equal(h.elements.get('planting-map-summary').innerHTML,'');
    assert.equal(h.elements.get('planting-map-summary').classList.hidden,true);
    assert.match(h.elements.get('planting-map-legend').innerHTML,/área plantada/i);
    h.state.currentSubTab='data-estimada-colheita';
    h.setRecords({});h.maps.refresh(h.state,[feature]);
    assert.equal(h.elements.get('planting-map-summary').innerHTML,'');
    assert.equal(h.elements.get('planting-map-summary').classList.hidden,true);
    assert.match(h.elements.get('planting-map-legend').innerHTML,/Não há plantio executado neste filtro/);
});

test('DAP usa dias do calendário local e rejeita datas futuras ou inválidas',()=>{
    const h=harness();
    assert.equal(h.maps.daysAfterPlanting('2026-01-01',new Date(2026,0,1,23,59)),0);
    assert.equal(h.maps.daysAfterPlanting('2025-12-31',new Date(2026,0,1,0,1)),1);
    assert.equal(h.maps.daysAfterPlanting('2024-12-31',new Date(2025,0,1)),1);
    assert.equal(h.maps.daysAfterPlanting('2026-01-02',new Date(2026,0,1)),null);
    assert.equal(h.maps.daysAfterPlanting('not-a-date',new Date(2026,0,1)),null);
    assert.equal(h.maps.daysAfterPlanting('',new Date(2026,0,1)),null);
});

test('rótulos mostram DAP, plantio e colheita conforme opções independentes e combinadas',()=>{
    const h=harness();
    for(const key of ['dap','planting','harvest']) h.maps.setLabelOption(h.state,key,false);
    h.setRecords({a:{produto:'Plantio',fazenda:'FE',campo:'FE 01',ano:'2026',cultura:'Soja',status:'concluido',areaRealizada:100,variedadeSemente:'Olimpo',dataPlantio:'2026-10-15'}});
    h.maps.refresh(h.state,[feature]);
    const today=new Date(2026,9,15);
    assert.equal(h.maps.label(h.state,feature,today),'');
    h.maps.setLabelOption(h.state,'dap',true);
    assert.match(h.maps.label(h.state,feature,today),/0 DAP/);
    assert.doesNotMatch(h.maps.label(h.state,feature,today),/Plantio:|Colheita:/);
    h.maps.setLabelOption(h.state,'dap',false);h.maps.setLabelOption(h.state,'planting',true);
    assert.match(h.maps.label(h.state,feature,today),/Plantio: 15\/10\/2026/);
    assert.doesNotMatch(h.maps.label(h.state,feature,today),/DAP|Colheita:/);
    h.maps.setLabelOption(h.state,'planting',false);h.maps.setLabelOption(h.state,'harvest',true);
    assert.match(h.maps.label(h.state,feature,today),/Colheita: 06\/02\/2027/);
    h.maps.setLabelOption(h.state,'dap',true);h.maps.setLabelOption(h.state,'planting',true);
    const combined=h.maps.label(h.state,feature,today);
    assert.match(combined,/0 DAP/);assert.match(combined,/Plantio: 15\/10\/2026/);assert.match(combined,/Colheita: 06\/02\/2027/);
    assert.equal(h.maps.label(h.state,{properties:{Fazenda:'FE',Campo:'FE 99',Area:10}},today),'');
    h.setRecords({a:{produto:'Plantio',fazenda:'FE',campo:'FE 01',ano:'2026',cultura:'Soja',status:'em_andamento',areaRealizada:100}});
    h.maps.refresh(h.state,[feature]);
    assert.equal(h.maps.label(h.state,feature,today),'');
});

test('camada de rótulos é separada do tooltip, removida ao trocar de aba e respeita filtros e grupos',()=>{
    const h=harness();
    for(const key of ['dap','planting','harvest']) h.maps.setLabelOption(h.state,key,false);
    h.maps.setLabelOption(h.state,'planting',true);
    h.setRecords({a:{produto:'Plantio',fazenda:'FE',campo:'FE 01',ano:'2026',cultura:'Soja',status:'concluido',areaRealizada:100,variedadeSemente:'Olimpo',dataPlantio:'2026-10-15'},
        b:{produto:'Plantio',fazenda:'FE',campo:'FE 02',ano:'2026',cultura:'Soja',status:'concluido',areaRealizada:100,variedadeSemente:'NEO790',dataPlantio:'2026-10-16'}});
    const second={properties:{Fazenda:'FE',Campo:'FE 02',Area:100}};
    const layers=[feature,second].map(value=>({feature:value,getCenter(){return value===feature?[1,2]:[3,4];},setStyle(){}}));
    const state=h.state;let map={closePopup(){}};state.map=map;state.geojsonLayer={eachLayer(fn){layers.forEach(fn);}};
    h.maps.refresh(state,[feature,second]);
    h.maps.setLabelOption(state,'planting',true);
    assert.equal(h.labelLayers.length,1);assert.equal(h.labelLayers[0].items.length,2);
    assert.equal(h.markers[0].settings.interactive,false);assert.equal(h.markers[0].settings.keyboard,false);
    assert.equal(h.markers[0].settings.pane,'tooltipPane');
    assert.match(h.markers[0].settings.icon.html,/Plantio: 15\/10\/2026/);
    state.currentAno='2027';h.maps.refreshLabels(state);assert.equal(h.labelLayers.at(-1).items.length,0);
    state.currentAno='2026';state.currentCultura='Soja';h.maps.refreshLabels(state);assert.equal(h.labelLayers.at(-1).items.length,2);
    state.currentTab='adubacao';h.maps.refreshLabels(state);assert.equal(h.labelLayers.at(-1).removed,true);
    state.currentTab='plantio';state.currentSubTab='data-estimada-colheita';h.maps.refresh(state,[feature,second]);
    h.maps.selectGroup(state,'2027-02-06');
    assert.equal(h.labelLayers.at(-1).items.length,1);
    assert.equal(h.labelLayers.at(-1).items[0].center[0],1);
    h.maps.clearLabels();assert.equal(h.labelLayers.at(-1).removed,true);
});

test('seleção múltipla de datas soma hectares, desmarca individualmente e limpa destaque e rótulos',()=>{
    const h=harness(), second={properties:{Fazenda:'FE',Campo:'FE 02',Area:100}};
    for(const key of ['dap','planting','harvest']) h.maps.setLabelOption(h.state,key,false);
    h.maps.setLabelOption(h.state,'planting',true);
    h.setRecords({a:{produto:'Plantio',fazenda:'FE',campo:'FE 01',ano:'2026',cultura:'Soja',status:'em_andamento',areaRealizada:40,variedadeSemente:'Olimpo',dataPlantio:'2026-10-15'},
        b:{produto:'Plantio',fazenda:'FE',campo:'FE 02',ano:'2026',cultura:'Soja',status:'em_andamento',areaRealizada:60,variedadeSemente:'Olimpo',dataPlantio:'2026-10-16'}});
    const layers=[feature,second].map(value=>({feature:value,getCenter(){return value===feature?[1,2]:[3,4];},setStyle(){},closeTooltip(){},bringToFront(){}}));
    h.state.map={closePopup(){}};h.state.geojsonLayer={eachLayer(fn){layers.forEach(fn);}};
    h.maps.refresh(h.state,[feature,second]);
    const legend=h.elements.get('planting-map-legend').innerHTML;
    assert.match(legend,/data-planting-group="2027-02-06"[^>]*aria-pressed="false"/);
    assert.match(legend,/data-planting-group="2027-02-07"[^>]*aria-pressed="false"/);
    h.maps.selectGroup(h.state,'2027-02-06');h.maps.selectGroup(h.state,'2027-02-07');
    assert.match(h.elements.get('planting-legend-selection').innerHTML,/100 ha/);
    assert.match(h.elements.get('planting-legend-selection').innerHTML,/2 itens selecionados/);
    assert.equal(h.maps.style(h.state,feature).fillOpacity,1);assert.equal(h.maps.style(h.state,second).fillOpacity,1);
    assert.equal(h.labelLayers.at(-1).items.length,2);
    h.maps.selectGroup(h.state,'2027-02-06');
    assert.match(h.elements.get('planting-legend-selection').innerHTML,/60 ha/);
    assert.match(h.elements.get('planting-legend-selection').innerHTML,/1 item selecionado/);
    assert.equal(h.maps.style(h.state,feature).fillOpacity,.07);assert.equal(h.maps.style(h.state,second).fillOpacity,1);
    assert.equal(h.labelLayers.at(-1).items.length,1);
    h.maps.selectGroup(h.state,null);
    assert.equal(h.elements.get('planting-legend-selection').hidden,true);
    assert.equal(h.elements.get('planting-legend-selection').innerHTML,'');
    assert.equal(h.maps.style(h.state,feature).fillOpacity,.88);assert.equal(h.labelLayers.at(-1).items.length,2);
    for(const key of ['dap','planting','harvest']) h.maps.setLabelOption(h.state,key,false);
});

test('seleção múltipla de variedades respeita área parcial e grupo sem variedade',()=>{
    const h=harness(), second={properties:{Fazenda:'FE',Campo:'FE 02',Area:100}}, ungrouped={properties:{Fazenda:'FE',Campo:'FE 03',Area:100}}, empty={properties:{Fazenda:'FE',Campo:'FE 04',Area:100}};
    h.state.currentSubTab='variedades-plantadas';
    h.setRecords({a:{produto:'Plantio',fazenda:'FE',campo:'FE 01',ano:'2026',cultura:'Soja',status:'em_andamento',areaRealizada:35,variedadeSemente:'Olimpo',dataPlantio:'2026-10-15'},
        b:{produto:'Plantio',fazenda:'FE',campo:'FE 02',ano:'2026',cultura:'Soja',status:'em_andamento',areaRealizada:25,variedadeSemente:'NEO790',dataPlantio:'2026-10-16'},
        c:{produto:'Plantio',fazenda:'FE',campo:'FE 03',ano:'2026',cultura:'Soja',status:'em_andamento',areaRealizada:10,dataPlantio:'2026-10-17'}});
    h.maps.refresh(h.state,[feature,second,ungrouped,empty]);
    const legend=h.elements.get('planting-map-legend').innerHTML;
    assert.match(legend,/data-planting-group="OLIMPO"[^>]*aria-pressed="false"/);
    assert.match(legend,/data-planting-group="NEO790"[^>]*aria-pressed="false"/);
    assert.match(legend,/data-planting-group=""[^>]*><i[^>]*><\/i><span>Sem variedade \/ sem plantio<\/span><b>10 ha<\/b>/);
    h.maps.selectGroup(h.state,'OLIMPO');h.maps.selectGroup(h.state,'NEO790');
    assert.match(h.elements.get('planting-legend-selection').innerHTML,/60 ha/);
    assert.equal(h.maps.style(h.state,feature).fillOpacity,1);assert.equal(h.maps.style(h.state,second).fillOpacity,1);
    assert.equal(h.maps.style(h.state,ungrouped).fillOpacity,.07);assert.equal(h.maps.style(h.state,empty).fillOpacity,.07);
    h.maps.selectGroup(h.state,'');
    assert.match(h.elements.get('planting-legend-selection').innerHTML,/70 ha/);
    assert.match(h.elements.get('planting-legend-selection').innerHTML,/3 itens selecionados/);
    h.maps.selectGroup(h.state,'OLIMPO');
    assert.match(h.elements.get('planting-legend-selection').innerHTML,/35 ha/);
    assert.equal(h.maps.style(h.state,feature).fillOpacity,.07);assert.equal(h.maps.style(h.state,second).fillOpacity,1);assert.equal(h.maps.style(h.state,ungrouped).fillOpacity,1);
    h.maps.selectGroup(h.state,null);
    assert.equal(h.elements.get('planting-legend-selection').hidden,true);
});

test('grupos selecionados sobrevivem ao refresh igual, podam-se os removidos e limpam com filtros ou aba',()=>{
    const h=harness(), second={properties:{Fazenda:'FE',Campo:'FE 02',Area:100}};
    const makeRecords=()=>({a:{produto:'Plantio',fazenda:'FE',campo:'FE 01',ano:'2026',cultura:'Soja',status:'concluido',areaRealizada:40,variedadeSemente:'Olimpo',dataPlantio:'2026-10-15'},
        b:{produto:'Plantio',fazenda:'FE',campo:'FE 02',ano:'2026',cultura:'Soja',status:'concluido',areaRealizada:60,variedadeSemente:'Olimpo',dataPlantio:'2026-10-16'}});
    h.setRecords(makeRecords());h.maps.refresh(h.state,[feature,second]);
    h.maps.selectGroup(h.state,'2027-02-06');h.maps.selectGroup(h.state,'2027-02-07');
    h.setRecords(makeRecords());h.maps.refresh(h.state,[feature,second]);
    assert.match(h.elements.get('planting-legend-selection').innerHTML,/100 ha/);
    assert.match(h.elements.get('planting-map-legend').innerHTML,/data-planting-group="2027-02-06"[^>]*aria-pressed="true"/);
    h.maps.refresh(h.state,[feature]);
    assert.match(h.elements.get('planting-legend-selection').innerHTML,/40 ha/);
    assert.match(h.elements.get('planting-legend-selection').innerHTML,/1 item selecionado/);
    h.state.currentAno='2027';h.maps.refresh(h.state,[feature,second]);
    assert.equal(h.elements.get('planting-legend-selection').hidden,true);
    h.state.currentAno='2026';h.maps.refresh(h.state,[feature,second]);h.maps.selectGroup(h.state,'2027-02-06');
    h.state.currentSubTab='variedades-plantadas';h.maps.refresh(h.state,[feature,second]);
    assert.equal(h.elements.get('planting-legend-selection').hidden,true);
});
