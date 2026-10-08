const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness() {
    const elements = new Map(), storage = new Map();
    let writes = 0, failStorage = false;
    function element() {
        const classes = new Set();
        return { value: '', textContent: '', style: {}, dataset: {}, children: [],
            classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c),
                toggle(c, on) { if (on ?? !classes.has(c)) classes.add(c); else classes.delete(c); } },
            appendChild(child) { this.children.push(child); }, append(...children) { this.children.push(...children); }, setAttribute() {}, addEventListener() {}, reset() {} };
    }
    const document = {
        addEventListener() {}, querySelectorAll: () => [], createElement: element, createTextNode: text => ({ textContent: text }),
        getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }
    };
    const context = vm.createContext({ document, window: {}, console, Date,
        L: { DomEvent: { stopPropagation() {}, preventDefault() {} } },
        localStorage: { getItem: key => storage.get(key) || null,
            setItem(key, value) { if (failStorage) throw Error('Quota'); writes++; storage.set(key, value); } }
    });
    vm.runInContext(fs.readFileSync(require.resolve('../app.js'), 'utf8'), context);
    const api = vm.runInContext('({ state, AdubacaoModal, TalhaoSelection, onEachFeature, getAllRecords, getFeatureStyle, getRecordKey, renderMap })', context);
    return { ...api, elements, storage, document, writes: () => writes, failStorage: () => { failStorage = true; } };
}
const feature = (campo, area, fazenda = 'FE') => ({ properties: { Fazenda: fazenda, Campo: campo, Area: area, Gleba: 'A' } });
const fields = [feature('T1', 100), feature('T2', 40)];
function fill(h, status = 'concluido') {
    h.AdubacaoModal.open(fields);
    h.AdubacaoModal.setStatus(status);
    h.document.getElementById('input-variedade-semente').value = 'Soja A';
    h.document.getElementById('input-data-plantio').value = '2026-10-08';
    h.document.getElementById('input-taxa-adubacao').value = '2.5';
}

test('Shift e clique comum selecionam sem abrir formulário; botão direito edita o grupo', () => {
    const h = harness(), handlers = {};
    h.onEachFeature(fields[0], { bindTooltip() {}, getTooltip() { return null; }, on(event, fn) { handlers[event] = fn; } });
    handlers.click({ originalEvent: { shiftKey: true } });
    assert.equal(h.state.selectedFeatures.size, 1);
    assert.equal(h.AdubacaoModal.currentFeature, null);
    assert.equal(h.getFeatureStyle(fields[0]).color, '#facc15');
    h.TalhaoSelection.toggle(fields[1]);
    handlers.click({ originalEvent: { shiftKey: false } });
    assert.equal(h.AdubacaoModal.currentFeature, null);
    assert.equal(h.state.selectedFeatures.size, 1);
    handlers.click({ originalEvent: { shiftKey: false } });
    handlers.contextmenu({ originalEvent: {} });
    assert.equal(h.AdubacaoModal.currentFeatures.length, 2);
    h.AdubacaoModal.close();
    handlers.click({ originalEvent: { shiftKey: true } });
    assert.equal(h.state.selectedFeatures.size, 1);
});

test('Shift registrado pelo teclado seleciona mesmo se o evento do mapa omitir o modificador', () => {
    const h = harness(), handlers = {};
    h.onEachFeature(fields[0], { bindTooltip() {}, getTooltip() { return null; }, on(event, fn) { handlers[event] = fn; } });
    h.state.shiftPressed = true;
    handlers.click({});
    assert.equal(h.state.selectedFeatures.size, 1);
    assert.equal(h.AdubacaoModal.currentFeature, null);
    h.state.shiftPressed = false;
    handlers.contextmenu({ originalEvent: {} });
    assert.equal(h.AdubacaoModal.currentFeatures.length, 1);
});

test('botão direito em talhão fora da seleção abre somente esse talhão', () => {
    const h = harness(), handlers = {};
    h.TalhaoSelection.toggle(fields[0]);
    h.onEachFeature(fields[1], { bindTooltip() {}, getTooltip() { return null; }, on(event, fn) { handlers[event] = fn; } });
    handlers.contextmenu({ originalEvent: {} });
    assert.equal(h.AdubacaoModal.currentFeatures.length, 1);
    assert.equal(h.AdubacaoModal.currentFeature.properties.Campo, 'T2');
});

test('plantio em conjunto salva data e variedade, áreas individuais e históricos separados', () => {
    const h = harness();
    h.state.currentTab = 'plantio'; h.state.currentProduto = 'Plantio';
    fill(h);
    h.AdubacaoModal.save();
    const records = Object.values(h.getAllRecords());
    assert.equal(h.writes(), 1);
    assert.deepEqual(records.map(r => r.areaRealizada), [100, 40]);
    for (const record of records) {
        assert.equal(record.percentualRealizado, 100);
        assert.equal(record.dataPlantio, '2026-10-08');
        assert.equal(record.variedadeSemente, 'Soja A');
        assert.equal(record.historico.length, 1);
    }
    assert.equal(h.state.selectedFeatures.size, 0);
    h.AdubacaoModal.open(fields[0]); h.AdubacaoModal.save();
    assert.equal(Object.values(h.getAllRecords())[0].historico.length, 2);
    assert.equal(Object.values(h.getAllRecords())[1].historico.length, 1);
});

test('adubação parcial aplica percentual sobre cada área e não altera outra operação', () => {
    const h = harness();
    const untouched = { fazenda: 'FE', campo: 'T1', ano: '2026', cultura: 'Soja', produto: 'Plantio', dataPlantio: '2026-10-01' };
    const key = h.getRecordKey('FE', 'T1', '2026', 'Soja', 'Plantio');
    h.storage.set('geoportal_calcario_records_v1', JSON.stringify({ [key]: untouched }));
    fill(h, 'em_andamento');
    h.document.getElementById('input-pct-adubacao').value = '25';
    h.AdubacaoModal.save();
    const records = h.getAllRecords();
    assert.deepEqual(JSON.parse(JSON.stringify(records[key])), untouched);
    assert.deepEqual(Object.values(records).filter(r => r.produto !== 'Plantio').map(r => r.areaRealizada), [25, 10]);
});

test('adubação concluída exige taxa e aplica a mesma taxa a cada talhão', () => {
    const h = harness(); fill(h);
    h.document.getElementById('input-taxa-adubacao').value = '';
    h.AdubacaoModal.save(); assert.equal(h.writes(), 0);
    h.document.getElementById('input-taxa-adubacao').value = '2.5';
    h.AdubacaoModal.save();
    assert.deepEqual(Object.values(h.getAllRecords()).map(r => [r.taxaAplicada, r.areaRealizada]), [[2.5, 100], [2.5, 40]]);
});

test('hectares são validados para todos antes de salvar qualquer registro', () => {
    const h = harness(); fill(h, 'em_andamento');
    h.AdubacaoModal.setProgressMode('hectares');
    h.document.getElementById('input-ha-adubacao').value = '50';
    h.AdubacaoModal.save(); assert.equal(h.writes(), 0);
    assert.match(h.document.getElementById('adubacao-error-text').textContent, /T2/);
    h.document.getElementById('input-ha-adubacao').value = '20';
    h.AdubacaoModal.save();
    assert.deepEqual(Object.values(h.getAllRecords()).map(r => [r.areaRealizada, r.percentualRealizado]), [[20, 20], [20, 50]]);
});

test('falha de armazenamento mantém formulário e registros anteriores intactos', () => {
    const h = harness(); fill(h);
    h.failStorage(); h.AdubacaoModal.save();
    assert.equal(h.writes(), 0);
    assert.equal(Object.keys(h.getAllRecords()).length, 0);
    assert.equal(h.AdubacaoModal.currentFeatures.length, 2);
    assert.match(h.document.getElementById('adubacao-error-text').textContent, /Não foi possível salvar/);
});

test('valores divergentes não copiam silenciosamente o primeiro talhão', () => {
    const h = harness(); fill(h); h.AdubacaoModal.save();
    h.AdubacaoModal.open(fields[0]); h.AdubacaoModal.setStatus('nao_iniciado'); h.AdubacaoModal.save();
    h.AdubacaoModal.open(fields);
    assert.equal(h.AdubacaoModal.currentStatus, '');
    const writes = h.writes(); h.AdubacaoModal.save(); assert.equal(h.writes(), writes);
});

test('visualizador e planejamento não permitem seleção para atualização', () => {
    const h = harness(); h.state.userRole = 'viewer'; h.TalhaoSelection.toggle(fields[0]);
    assert.equal(h.state.selectedFeatures.size, 0);
    h.state.userRole = 'editor'; h.state.operationalMode = 'planejamento'; h.TalhaoSelection.toggle(fields[0]);
    assert.equal(h.state.selectedFeatures.size, 0);
});

test('mudança de safra, cultura ou produto limpa a seleção do contexto anterior', () => {
    for (const [key, value] of [['currentAno', '2027'], ['currentCultura', 'Milho'], ['currentProduto', 'Outro produto']]) {
        const h = harness(); h.TalhaoSelection.toggle(fields[0]);
        h.state[key] = value; h.TalhaoSelection.updateUI();
        assert.equal(h.state.selectedFeatures.size, 0);
        assert.equal(h.document.getElementById('btn-edit-selected-talhoes').disabled, true);
    }
});
