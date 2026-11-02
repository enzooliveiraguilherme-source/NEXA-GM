const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const SpraySchedule = require('../js/spray-schedule.js');
const PlantingForecast = require('../js/planting-forecast.js');
const SprayOperations = require('../js/spray-operations.js');
const SprayGrid = require('../js/spray-grid.js');
const source = fs.readFileSync(require.resolve('../js/spray-control.js'), 'utf8');

function harness({ role = 'editor', accessRole = 'admin', saveFailure = null, batchFailure = null, batchDelay = false, scheduleActuals = { post1: '2026-10-16' }, fourth = false, secondPlanned = '2026-10-18' } = {}) {
    const elements = new Map();
    class Element {
        constructor(id) {
            this.id = id; this.dataset = {}; this.classList = { toggle() {}, add() {}, remove() {} };
            this.value = ''; this.textContent = ''; this.innerHTML = ''; this.hidden = false; this.disabled = false;
            this.checked = false; this.readOnly = false; this.onchange = null; this.oninput = null; this.onclick = null; this.onsubmit = null;
            this.attributes = {};
        }
        scrollIntoView() {}
        setAttribute(name, value) { this.attributes[name] = value; }
    }
    const document = { getElementById(id) {
        if (!elements.has(id)) elements.set(id, new Element(id));
        return elements.get(id);
    } };
    const saved = [
        { id: 'app-1', farm: 'FE', field: 'FE 01', year: '2026', culture: 'Soja', plantingId: 'plant-1', stage: 'post1',
            name: '1ª Pós-Emergente', product: 'Herbicida A', dose: 2.5, doseUnit: 'L/ha', area: 30, planned: '2026-10-16', actual: '2026-10-16',
            responsible: 'Enzo', notes: 'Observação', deleted: false, version: 2 },
        { id: 'app-2', farm: 'FE', field: 'FE 03', year: '2026', culture: 'Soja', plantingId: 'plant-3', stage: 'post1',
            name: '1ª Pós-Emergente', product: 'Herbicida B', dose: 1.5, doseUnit: 'L/ha', area: 40, planned: secondPlanned, actual: null,
            responsible: 'Operador', notes: '', deleted: false, version: 1 }
    ];
    const calls = { list: [], schedules: [], save: [], batch: [] };
    let batchReject = batchFailure, releaseBatch;
    const scheduleRows = [
        { plantingId: 'plant-1', fourth, actuals: { ...scheduleActuals }, version: 4 },
        { plantingId: 'plant-3', fourth: false, actuals: {}, version: 1 }
    ];
    const appsRepo = {
        async list(farms, year, culture) {
            calls.list.push({ farms: [...farms], year, culture });
            return saved.filter(row => farms.includes(row.farm) && row.year === year && row.culture === culture).map(row => ({ ...row }));
        },
        async save(row, field) {
            calls.save.push({ row: { ...row }, field: { ...field } });
            if (saveFailure) throw saveFailure;
            const result = { ...row, version: (row.version || 0) + 1 };
            const index = saved.findIndex(item => item.id === row.id || item.key === row.key);
            if (index >= 0) saved[index] = result;
            else saved.push(result);
            return result;
        },
        async saveBatch(rows, fields) {
            calls.batch.push({ rows: rows.map(row => ({ ...row })), fields: fields.map(field => ({ ...field })) });
            if (batchDelay) await new Promise(resolve => { releaseBatch = resolve; });
            if (batchReject) throw batchReject;
            const result = rows.map(row => ({ ...row, version: (row.version || 0) + 1 }));
            for (const row of result) {
                const index = saved.findIndex(item => (row.id && item.id === row.id) || SprayOperations.rowKey(item) === SprayOperations.rowKey(row));
                if (index >= 0) saved[index] = row;
                else saved.push(row);
                if (row.plantingId) {
                    const schedule = scheduleRows.find(item => item.plantingId === row.plantingId);
                    if (schedule) { schedule.actuals[row.stage] = row.actual || ''; if (row.stage === 'fung4') schedule.fourth = true; }
                }
            }
            return result;
        }
    };
    const scheduleRepo = {
        async list(ids) {
            calls.schedules.push([...ids]);
            return scheduleRows.filter(row => ids.includes(row.plantingId)).map(row => ({ ...row, actuals: { ...row.actuals } }));
        }
    };
    const window = {
        SpraySchedule, PlantingForecast, SprayOperations, SprayGrid,
        SprayApplications: { create: () => appsRepo }, SprayRepository: { create: () => scheduleRepo },
        portalAccessRole: accessRole, confirm() { return true; }, setInterval() { return 1; }, addEventListener() {}
    };
    const context = vm.createContext({ window, document, console, Date, Intl, Map, Set, Object, String, Number, Math, JSON });
    vm.runInContext(source, context);
    const records = {
        one: { id: 'plant-1', operationType: 'plantio', fazenda: 'FE', campo: 'FE 01', ano: '2026', cultura: 'Soja',
            status: 'em_andamento', areaRealizada: 30, variedadeSemente: 'Olimpo', dataPlantio: '2026-10-01' },
        three: { id: 'plant-3', operationType: 'plantio', fazenda: 'FE', campo: 'FE 03', ano: '2026', cultura: 'Soja',
            status: 'concluido', areaRealizada: 40, variedadeSemente: 'Olimpo', dataPlantio: '2026-10-03' }
    };
    const feature = (field, area, farm = 'FE') => ({ properties: { Fazenda: farm, Campo: field, Area: area } });
    const features = [feature('FE 01', 100), feature('FE 02', 80), feature('FE 03', 60)];
    const domRows = features.map(item => ({ dataset: { sprayFieldKey: JSON.stringify([item.properties.Fazenda, item.properties.Campo]) },
        scrollCount: 0, scrollIntoView() { this.scrollCount++; }, classList: { toggle() {} } }));
    document.querySelectorAll = selector => selector === '#spray-op-table [data-spray-field-key]' ? domRows : [];
    const layers = features.map(item => ({ feature: item, styles: [], setStyle(value) { this.styles.push(value); }, bindPopup(value) { this.popupHtml = value; return this; }, openPopup() { this.opened = true; return this; } }));
    const state = {
        currentTab: 'pulverizacao', currentAno: '2026', currentCultura: 'Soja', currentFazenda: 'ALL', currentGleba: 'ALL', userRole: role,
        cloudStore: { getRecords: () => records }, geojsonLayer: { eachLayer(fn) { layers.forEach(fn); } }, map: { fitBounds() {} }
    };
    const tick = () => new Promise(resolve => setImmediate(resolve));
    const el = name => document.getElementById('spray-op-' + name);
    el('form').hidden = true;
    return { api: window.SprayControl, state, features, layers, calls, el, tick, saved, domRows, scheduleRows,
        releaseBatch() { releaseBatch?.(); }, setBatchFailure(value) { batchReject = value; } };
}

function listMode(h) { h.el('list-mode').onclick(); }
function clickAction(h, action, key) {
    const button = { dataset: { sprayAction: action, sprayKey: key } };
    h.el('table').onclick({ target: { closest: selector => selector === '[data-spray-action]' ? button : null } });
}

test('confirmed load renders generated applications, summary, and a gray field without planting', async () => {
    const h = harness();
    h.api.refresh(h.state, h.features);
    await h.tick();
    assert.deepEqual(h.calls.list, [{ farms: ['FE'], year: '2026', culture: 'Soja' }]);
    assert.deepEqual(h.calls.schedules, [['plant-1', 'plant-3']]);
    assert.match(h.el('summary').innerHTML, /Programadas/);
    assert.match(h.el('summary').innerHTML, /Área programada/);
    assert.match(h.el('table').innerHTML, /FE 01/);
    assert.match(h.el('table').innerHTML, /FE 03/);
    assert.equal(h.api.style(h.features[1]).fillColor, '#94a3b8');
    assert.equal(h.api.style(h.features[1]).fillOpacity, .18);
});

test('independent pre-planting rows appear first and never alter the linked post/fungicide schedule', async () => {
    const h = harness();
    h.api.refresh(h.state, h.features); await h.tick();
    let html = h.el('table').innerHTML;
    const pre = html.indexOf('Pré-emergente'), boro = html.indexOf('Boro'), desiccation = html.indexOf('Dessecação pré-plantio');
    const firstPost = html.indexOf('1ª Pós');
    assert.ok(pre >= 0 && boro > pre && desiccation > boro && firstPost > desiccation);
    assert.match(html, /data-spray-cell="planned" data-spray-key="independent:/);
    assert.match(h.el('summary').innerHTML, /<strong>10<\/strong>/); // only the two planted five-step schedules count
    assert.equal(h.api.style(h.features[1]).fillColor, '#94a3b8'); // unplanned independent rows do not color the map

    const beforeSchedule = structuredClone(h.scheduleRows[0].actuals);
    const preKey = SprayOperations.independentKey('FE', 'FE 01', '2026', 'Soja', 'pre');
    const boroKey = SprayOperations.independentKey('FE', 'FE 01', '2026', 'Soja', 'boro');
    const desKey = SprayOperations.independentKey('FE', 'FE 01', '2026', 'Soja', 'desiccation');
    await h.el('table').onchange({ target: { dataset: { sprayKey: preKey, sprayCell: 'actual' }, value: '2026-09-20' } });
    assert.equal(h.calls.batch[0].rows[0].stage, 'pre');
    assert.equal(h.calls.batch[0].rows[0].plantingId, null);
    assert.equal(h.calls.batch[0].rows[0].planned, null);
    assert.equal(h.calls.batch[0].rows[0].actual, '2026-09-20');
    assert.equal(h.calls.batch[0].rows[0].scheduleVersion, null);
    assert.deepEqual(h.scheduleRows[0].actuals, beforeSchedule);

    await h.el('table').onchange({ target: { dataset: { sprayKey: boroKey, sprayCell: 'dose' }, value: '3.5' } });
    assert.equal(h.calls.batch[1].rows[0].stage, 'boro');
    assert.equal(h.calls.batch[1].rows[0].dose, '3.5');
    await h.el('table').onchange({ target: { dataset: { sprayKey: boroKey, sprayCell: 'actual' }, value: '2026-09-22' } });
    assert.equal(h.calls.batch[2].rows[0].stage, 'boro');
    assert.equal(h.calls.batch[2].rows[0].actual, '2026-09-22');

    await h.el('table').onchange({ target: { dataset: { sprayKey: desKey, sprayCell: 'planned' }, value: '2026-09-23' } });
    assert.equal(h.calls.batch[3].rows[0].stage, 'desiccation');
    assert.equal(h.calls.batch[3].rows[0].planned, '2026-09-23');
    await h.el('table').onchange({ target: { dataset: { sprayKey: desKey, sprayCell: 'actual' }, value: '2026-09-24' } });
    assert.equal(h.calls.batch[4].rows[0].stage, 'desiccation');
    assert.equal(h.calls.batch[4].rows[0].actual, '2026-09-24');
    assert.deepEqual(h.scheduleRows[0].actuals, beforeSchedule);
    html = h.el('table').innerHTML;
    assert.match(html, /data-spray-cell="actual" data-spray-key="plant-1:post1"[^>]*value="2026-10-16"/);
    assert.match(html, /data-spray-cell="actual" data-spray-key="plant-1:post2"[^>]*value=""/);
});

test('editing preserves the form after rejection and closes then reloads after success', async t => {
    await t.test('rejected save keeps form values', async () => {
        const h = harness({ saveFailure: Error('Conflito de versão') });
        h.api.refresh(h.state, h.features); await h.tick();
        listMode(h);
        clickAction(h, 'edit', 'plant-1:post1');
        assert.equal(h.el('form').hidden, false);
        h.el('input-product').value = 'Alteração local';
        await h.el('form').onsubmit({ preventDefault() {} });
        await h.tick();
        assert.equal(h.el('form').hidden, false);
        assert.equal(h.el('input-product').value, 'Alteração local');
        assert.match(h.el('form-error').textContent, /Conflito de versão/);
    });
    await t.test('success closes form and reloads confirmed applications', async () => {
        const h = harness();
        h.api.refresh(h.state, h.features); await h.tick();
        listMode(h);
        clickAction(h, 'edit', 'plant-1:post1');
        const before = h.calls.list.length;
        await h.el('form').onsubmit({ preventDefault() {} });
        await h.tick();
        assert.equal(h.el('form').hidden, true);
        assert.match(h.el('message').textContent, /salva e confirmada/);
        assert.ok(h.calls.list.length > before);
    });
});

test('one inline date edit autosaves once and recalculates following dates', async () => {
    const h = harness();
    h.api.refresh(h.state, h.features); await h.tick();
    assert.equal(h.el('batch-save').hidden, true);
    await h.el('table').onchange({ target: { dataset: { sprayKey: 'plant-1:post1', sprayCell: 'actual' }, value: '2026-10-20' } });
    await h.tick();
    assert.equal(h.calls.batch.length, 1);
    assert.equal(h.calls.batch[0].rows.length, 1);
    assert.equal(h.calls.batch[0].rows[0].actual, '2026-10-20');
    assert.equal(h.calls.save.length, 0);
    assert.match(h.el('message').textContent, /Salvo/);
    assert.match(h.el('table').innerHTML, /data-spray-cell="planned" data-spray-key="plant-1:post2"[^>]*value="2026-10-30"/);
    assert.match(h.el('table').innerHTML, /data-spray-cell="actual" data-spray-key="plant-1:post1"[^>]*value="2026-10-20"/);
});

test('autosave failure preserves the draft and exposes an explicit retry', async () => {
        const h = harness({ batchFailure: Error('Conflito do lote') });
        h.api.refresh(h.state, h.features); await h.tick();
        await h.el('table').onchange({ target: { dataset: { sprayKey: 'plant-1:post1', sprayCell: 'product' }, value: 'Herbicida revisado' } });
        assert.equal(h.calls.batch.length, 1);
        assert.equal(h.calls.batch[0].rows.length, 1);
        assert.match(h.el('message').textContent, /Conflito do lote/);
        assert.equal(h.el('save-status').textContent, 'Não salvo');
        assert.match(h.el('batch-message').textContent, /1 aplicaç(?:ão|ões) com alterações não salvas/);
        assert.equal(h.el('batch-save').hidden, false);
        assert.equal(h.el('batch-discard').hidden, false);
        assert.match(h.el('table').innerHTML, /spray-cell-draft/);
        h.setBatchFailure(null);
        const before = h.calls.list.length;
        await h.el('batch-save').onclick();
        await h.tick();
        assert.equal(h.calls.batch.length, 2);
        assert.equal(h.el('save-status').textContent, 'Salvo');
        assert.equal(h.saved.find(row => row.id === 'app-1').product, 'Herbicida revisado');
        assert.doesNotMatch(h.el('table').innerHTML, /spray-cell-draft/);
        assert.equal(h.el('batch-save').hidden, true);
        assert.ok(h.calls.list.length > before);
});

test('busy autosave locks cells and ignores reentrant edits until confirmed and reloaded', async () => {
    const h = harness({ batchDelay: true });
    h.api.refresh(h.state, h.features); await h.tick();
    const save = h.el('table').onchange({ target: { dataset: { sprayKey: 'plant-1:post1', sprayCell: 'actual' }, value: '2026-10-20' } });
    assert.equal(h.calls.batch.length, 1);
    assert.equal(h.el('save-status').textContent, 'Salvando…');
    assert.doesNotMatch(h.el('table').innerHTML, /data-spray-cell=/);
    await h.el('table').onchange({ target: { dataset: { sprayKey: 'plant-3:post1', sprayCell: 'actual' }, value: '2026-10-22' } });
    assert.equal(h.calls.batch.length, 1);
    h.releaseBatch();
    await save; await h.tick();
    assert.equal(h.el('save-status').textContent, 'Salvo');
    assert.match(h.el('table').innerHTML, /data-spray-cell="actual" data-spray-key="plant-1:post1"[^>]*value="2026-10-20"/);
    assert.doesNotMatch(h.el('table').innerHTML, /value="2026-10-22"/);
});

test('selecting visible applications applies a bulk value only to selected rows', async () => {
    const h = harness();
    h.api.refresh(h.state, h.features); await h.tick();
    h.el('check-visible').checked = true; h.el('check-visible').onchange();
    h.el('bulk-field').value = 'responsible'; h.el('bulk-field').onchange();
    h.el('bulk-value').value = 'Equipe de pulverização';
    await h.el('bulk-apply').onclick();
    await h.tick();
    assert.equal(h.calls.batch.length, 1);
    assert.equal(h.calls.batch[0].rows.length, 19);
    assert.ok(h.calls.batch[0].rows.every(row => row.responsible === 'Equipe de pulverização'));
    assert.equal(h.el('save-status').textContent, 'Salvo');
});

test('compact matrix has planned and actual columns without repeated status chips or selectors', async () => {
    const h = harness();
    h.api.refresh(h.state, h.features); await h.tick();
    const html = h.el('table').innerHTML;
    assert.match(html, /spray-compact-table/);
    assert.match(html, /Prevista/);
    assert.match(html, /Realizada/);
    assert.doesNotMatch(html, /spray-status|data-spray-check|type="checkbox"/);
    assert.doesNotMatch(html, /spray-kpi/);
});

test('application table filter and independent map filter can show different scopes', async () => {
    const h = harness();
    h.api.refresh(h.state, h.features); await h.tick();
    listMode(h);
    h.el('application').value = 'post1'; h.el('application').onchange();
    assert.match(h.el('table').innerHTML, /Herbicida A/);
    assert.doesNotMatch(h.el('table').innerHTML, /Fungicida/);
    h.el('map-application').value = 'fungicide'; h.el('map-application').onchange();
    assert.match(h.el('table').innerHTML, /Herbicida A/);
    assert.doesNotMatch(h.el('table').innerHTML, /Fungicida/);
    const popup = h.api.popup(h.features[0]);
    assert.match(popup, /Fungicida/);
    assert.doesNotMatch(popup, /Herbicida A/);
});

test('map selection clears incompatible table filters, scrolls to the field, and highlights it', async () => {
    const h = harness();
    h.api.refresh(h.state, h.features); await h.tick();
    h.el('application').value = 'fungicide'; h.el('application').onchange();
    h.el('search').value = 'Herbicida B'; h.el('search').oninput();
    assert.doesNotMatch(h.el('table').innerHTML, /FE 01/);
    h.api.selectFeature(h.features[0]);
    assert.match(h.el('message').textContent, /Filtros da tabela ajustados/);
    assert.match(h.el('table').innerHTML, /FE 01/);
    assert.equal(h.domRows[0].scrollCount, 1);
});

test('linked planting date edit immediately recalculates following dates without saving', async () => {
    const h = harness();
    h.api.refresh(h.state, h.features); await h.tick();
    clickAction(h, 'edit', 'plant-1:post1');
    h.el('input-actual').value = '2026-10-20';
    h.el('input-actual').onchange();
    assert.match(h.el('preview').innerHTML, /2ª Pós-Emergente: 30\/10\/2026/);
    assert.match(h.el('preview').innerHTML, /1º Fungicida: 09\/11\/2026/);
    assert.match(h.el('preview').innerHTML, /ainda não salva/);
    assert.equal(h.calls.save.length, 0);
});

test('clearing a prior realization while a later one exists blocks autosave before request', async () => {
    const h = harness({ scheduleActuals: { post1: '2026-10-16', post2: '2026-10-26' } });
    h.api.refresh(h.state, h.features); await h.tick();
    await h.el('table').onchange({ target: { dataset: { sprayKey: 'plant-1:post1', sprayCell: 'actual' }, value: '' } });
    assert.match(h.el('save-status').textContent, /Não salvo/);
    assert.match(h.el('message').textContent, /registre primeiro a data realizada da aplicação anterior/);
    assert.equal(h.calls.batch.length, 0);
    assert.equal(h.calls.save.length, 0);
});

test('delete and restore preserve reversible CRUD state in the repository', async () => {
    const h = harness();
    h.api.refresh(h.state, h.features); await h.tick();
    listMode(h);
    clickAction(h, 'delete', 'plant-1:post1'); await h.tick();
    assert.equal(h.calls.save.length, 1);
    assert.equal(h.calls.save[0].row.deleted, true);
    h.el('status').value = 'deleted'; h.el('status').onchange();
    assert.match(h.el('table').innerHTML, /Excluída/);
    clickAction(h, 'restore', 'plant-1:post1'); await h.tick();
    assert.equal(h.calls.save.length, 2);
    assert.equal(h.calls.save[1].row.deleted, false);
    assert.doesNotMatch(h.el('table').innerHTML, /plant-1:post1/);
});

test('adding a manual application sends entered dose, field area, and responsible', async () => {
    const h = harness();
    h.api.refresh(h.state, h.features); await h.tick();
    h.el('add').onclick();
    h.el('input-field').value = JSON.stringify(['FE', 'FE 01']);
    h.el('input-field').onchange();
    h.el('input-name').value = 'Pulverização adicional';
    h.el('input-product').value = 'Fungicida C';
    h.el('input-dose').value = '3.25';
    h.el('input-area').value = '42';
    h.el('input-planned').value = '2026-11-02';
    h.el('input-responsible').value = 'Equipe 2';
    await h.el('form').onsubmit({ preventDefault() {} });
    assert.equal(h.calls.save.length, 1);
    const { row, field } = h.calls.save[0];
    assert.equal(row.name, 'Pulverização adicional');
    assert.equal(row.dose, '3.25');
    assert.equal(Number(row.area), 42);
    assert.equal(row.responsible, 'Equipe 2');
    assert.equal(field.area, 100);
});

test('search, status, and sort controls update the visible application table', async () => {
    const h = harness();
    h.api.refresh(h.state, h.features); await h.tick();
    listMode(h);
    h.el('search').value = 'Herbicida B'; h.el('search').oninput();
    assert.match(h.el('table').innerHTML, /FE 03/);
    assert.doesNotMatch(h.el('table').innerHTML, /FE 01/);
    h.el('search').value = ''; h.el('search').oninput();
    h.el('status').value = 'completed'; h.el('status').onchange();
    assert.match(h.el('table').innerHTML, /Realizada/);
    h.el('status').value = ''; h.el('status').onchange();
    const before = h.el('table').innerHTML;
    h.el('table').onclick({ target: { closest: selector => selector === '[data-spray-sort]' ? { dataset: { spraySort: 'planned' } } : null } });
    assert.notEqual(h.el('table').innerHTML, before);
    assert.match(h.el('table').innerHTML, /aria-sort="descending"/);
});

test('map selection preserves confirmed field color and popup escapes field and application content', async () => {
    const h = harness();
    h.api.refresh(h.state, h.features); await h.tick();
    const colorBeforeSelection = h.api.style(h.features[0]).fillColor;
    h.api.selectFeature(h.features[0]);
    assert.equal(h.api.style(h.features[0]).fillColor, colorBeforeSelection);
    const malicious = { properties: { Fazenda: 'FE <svg onload="x">', Campo: 'Talhão <img src=x onerror=alert(1)>', Area: 12 } };
    const popup = h.api.popup(malicious);
    assert.match(popup, /&lt;svg onload=&quot;x&quot;&gt;/);
    assert.match(popup, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(popup, /<svg|<img/);
    assert.match(h.api.popup(h.features[0]), /Herbicida A/);
});

test('map selection is only a visual focus and keeps confirmed application colors', async () => {
    const h = harness({ secondPlanned: '2026-11-20' });
    h.api.refresh(h.state, h.features); await h.tick();
    h.el('map-application').value = 'post1'; h.el('map-application').onchange();
    assert.equal(h.api.style(h.features[0]).fillColor, '#1673d1');
    assert.equal(h.api.style(h.features[0]).fillOpacity, .95);
    assert.equal(h.api.style(h.features[2]).fillColor, '#169447');
    assert.equal(h.api.style(h.features[2]).fillOpacity, .95);
    h.api.selectFeature(h.features[0]);
    h.api.selectFeature(h.features[0]);
    assert.equal(h.api.style(h.features[0]).fillColor, '#1673d1');
    assert.equal(h.api.style(h.features[0]).fillOpacity, .95);
    assert.equal(h.api.style(h.features[2]).fillColor, '#169447');
    assert.equal(h.api.style(h.features[2]).fillOpacity, .95);
    assert.doesNotMatch(h.el('table').innerHTML, /class="selected"/);
});

test('attention and overdue application colors keep the stronger map opacity', async () => {
    for (const [planned,color] of [['2026-11-03','#f5c542'],['2026-10-18','#df3838']]) {
        const h = harness({ secondPlanned: planned });
        h.api.refresh(h.state, h.features); await h.tick();
        h.el('map-application').value = 'post1'; h.el('map-application').onchange();
        assert.equal(h.api.style(h.features[2]).fillColor,color);
        assert.equal(h.api.style(h.features[2]).fillOpacity,.95);
    }
});

test('failed draft does not recolor the map from an unconfirmed realization', async () => {
    const h = harness({ batchFailure: Error('Conflito'), secondPlanned: '2026-11-20' });
    h.api.refresh(h.state, h.features); await h.tick();
    h.el('map-application').value = 'post1'; h.el('map-application').onchange();
    assert.equal(h.api.style(h.features[2]).fillColor, '#169447');
    await h.el('table').onchange({ target: { dataset: { sprayKey: 'plant-3:post1', sprayCell: 'actual' }, value: '2026-10-20' } });
    assert.equal(h.el('save-status').textContent, 'Não salvo');
    assert.equal(h.api.style(h.features[2]).fillColor, '#169447');
});

test('optional fourth step is visible, autosaves with schedule version, and stays out of bulk selection', async () => {
    const h = harness({ fourth: true, scheduleActuals: {
        post1: '2026-10-16', post2: '2026-10-26', fung1: '2026-10-27', fung2: '2026-10-28', fung3: '2026-10-29'
    } });
    h.api.refresh(h.state, h.features); await h.tick();
    assert.match(h.el('table').innerHTML, /4º Fungicida \(opcional\)/);
    assert.match(h.el('table').innerHTML, /data-spray-cell="planned" data-spray-key="plant-3:fung4"[^>]*value=""/);
    await h.el('table').onchange({ target: { dataset: { sprayKey: 'plant-1:fung4', sprayCell: 'actual' }, value: '2026-11-01' } });
    assert.equal(h.calls.batch.length, 1);
    assert.equal(h.calls.batch[0].rows.length, 1);
    assert.equal(h.calls.batch[0].rows[0].stage, 'fung4');
    assert.equal(h.calls.batch[0].rows[0].actual, '2026-11-01');
    assert.equal(h.calls.batch[0].rows[0].scheduleVersion, 4);
    assert.equal(h.scheduleRows[0].fourth, true);
    listMode(h);
    assert.match(h.el('table').innerHTML, /data-spray-check="plant-3:fung4"/);
    h.el('check-visible').checked = true; h.el('check-visible').onchange();
    assert.equal(h.el('bulk-apply').disabled, false);
    h.el('bulk-field').value = 'responsible'; h.el('bulk-field').onchange();
    h.el('bulk-value').value = 'Equipe';
    await h.el('bulk-apply').onclick(); await h.tick();
    assert.equal(h.calls.batch[1].rows.length, 20);
    assert.ok(h.calls.batch[1].rows.some(row => row.key === 'plant-1:fung4'));
    assert.ok(h.calls.batch[1].rows.every(row => row.key !== 'plant-3:fung4'));
    h.el('table').onchange({ target: { dataset: { sprayCheck: 'plant-3:fung4' }, checked: true } });
    h.el('bulk-field').value = 'responsible'; h.el('bulk-field').onchange();
    h.el('bulk-value').value = 'Planejamento explícito';
    await h.el('bulk-apply').onclick(); await h.tick();
    assert.equal(h.calls.batch.length, 3);
    assert.equal(h.calls.batch[2].rows.length, 1);
    assert.equal(h.calls.batch[2].rows[0].key, 'plant-3:fung4');
    assert.equal(h.calls.batch[2].rows[0].responsible, 'Planejamento explícito');
});

test('viewer is read only and cannot open or submit the application form', async () => {
    const h = harness({ role: 'viewer' });
    h.api.refresh(h.state, h.features); await h.tick();
    assert.equal(h.el('add').disabled, true);
    assert.doesNotMatch(h.el('table').innerHTML, /data-spray-cell=|data-spray-check=/);
    assert.equal(h.el('batch-save').disabled, true);
    listMode(h);
    assert.match(h.el('table').innerHTML, /data-spray-action="map"/);
    assert.doesNotMatch(h.el('table').innerHTML, /data-spray-action="edit"|data-spray-action="delete"/);
    h.el('add').onclick();
    assert.equal(h.el('form').hidden, true);
    await h.el('form').onsubmit({ preventDefault() {} });
    h.el('table').onchange({ target: { dataset: { sprayKey: 'plant-1:post1', sprayCell: 'actual' }, value: '2026-10-20' } });
    await h.el('batch-save').onclick();
    assert.equal(h.el('batch-save').disabled, true);
    assert.equal(h.calls.save.length, 0);
    assert.equal(h.calls.batch.length, 0);
});
