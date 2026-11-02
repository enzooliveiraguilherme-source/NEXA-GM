const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const SpraySchedule = require('../js/spray-schedule.js');
const PlantingForecast = require('../js/planting-forecast.js');
const SprayOperations = require('../js/spray-operations.js');
const source = fs.readFileSync(require.resolve('../js/spray-control.js'), 'utf8');

function harness({ role = 'editor', accessRole = 'admin', saveFailure = null, scheduleActuals = { post1: '2026-10-16' } } = {}) {
    const elements = new Map();
    class Element {
        constructor(id) {
            this.id = id; this.dataset = {}; this.classList = { toggle() {}, add() {}, remove() {} };
            this.value = ''; this.textContent = ''; this.innerHTML = ''; this.hidden = false; this.disabled = false;
            this.checked = false; this.readOnly = false; this.onchange = null; this.oninput = null; this.onclick = null; this.onsubmit = null;
        }
        scrollIntoView() {}
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
            name: '1ª Pós-Emergente', product: 'Herbicida B', dose: 1.5, doseUnit: 'L/ha', area: 40, planned: '2026-10-18', actual: null,
            responsible: 'Operador', notes: '', deleted: false, version: 1 }
    ];
    const calls = { list: [], schedules: [], save: [] };
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
        }
    };
    const scheduleRepo = {
        async list(ids) {
            calls.schedules.push([...ids]);
            return [{ plantingId: 'plant-1', fourth: false, actuals: { ...scheduleActuals }, version: 4 },
                { plantingId: 'plant-3', fourth: false, actuals: {}, version: 1 }].filter(row => ids.includes(row.plantingId));
        }
    };
    const window = {
        SpraySchedule, PlantingForecast, SprayOperations,
        SprayApplications: { create: () => appsRepo }, SprayRepository: { create: () => scheduleRepo },
        portalAccessRole: accessRole, confirm() { return true; }, setInterval() { return 1; }
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
    const layers = features.map(item => ({ feature: item, styles: [], setStyle(value) { this.styles.push(value); }, bindPopup(value) { this.popupHtml = value; return this; }, openPopup() { this.opened = true; return this; } }));
    const state = {
        currentTab: 'pulverizacao', currentAno: '2026', currentCultura: 'Soja', currentFazenda: 'ALL', currentGleba: 'ALL', userRole: role,
        cloudStore: { getRecords: () => records }, geojsonLayer: { eachLayer(fn) { layers.forEach(fn); } }, map: { fitBounds() {} }
    };
    const tick = () => new Promise(resolve => setImmediate(resolve));
    const el = name => document.getElementById('spray-op-' + name);
    el('form').hidden = true;
    return { api: window.SprayControl, state, features, layers, calls, el, tick, saved };
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

test('editing preserves the form after rejection and closes then reloads after success', async t => {
    const editRow = () => ({ dataset: { sprayAction: 'edit', sprayKey: 'plant-1:post1' } });
    await t.test('rejected save keeps form values', async () => {
        const h = harness({ saveFailure: Error('Conflito de versão') });
        h.api.refresh(h.state, h.features); await h.tick();
        h.el('table').onclick({ target: { closest: selector => selector === '[data-spray-sort]' ? null : editRow() } });
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
        h.el('table').onclick({ target: { closest: selector => selector === '[data-spray-sort]' ? null : editRow() } });
        const before = h.calls.list.length;
        await h.el('form').onsubmit({ preventDefault() {} });
        await h.tick();
        assert.equal(h.el('form').hidden, true);
        assert.match(h.el('message').textContent, /salva e confirmada/);
        assert.ok(h.calls.list.length > before);
    });
});

test('linked planting date edit immediately recalculates following dates without saving', async () => {
    const h = harness();
    h.api.refresh(h.state, h.features); await h.tick();
    h.el('table').onclick({ target: { closest: selector => selector === '[data-spray-sort]' ? null : { dataset: { sprayAction: 'edit', sprayKey: 'plant-1:post1' } } } });
    h.el('input-actual').value = '2026-10-20';
    h.el('input-actual').onchange();
    assert.match(h.el('preview').innerHTML, /2ª Pós-Emergente: 30\/10\/2026/);
    assert.match(h.el('preview').innerHTML, /1º Fungicida: 09\/11\/2026/);
    assert.match(h.el('preview').innerHTML, /ainda não salva/);
    assert.equal(h.calls.save.length, 0);
});

test('clearing a prior realization while a later one exists blocks save before request', async () => {
    const h = harness({ scheduleActuals: { post1: '2026-10-16', post2: '2026-10-26' } });
    h.api.refresh(h.state, h.features); await h.tick();
    h.el('table').onclick({ target: { closest: selector => selector === '[data-spray-sort]' ? null : { dataset: { sprayAction: 'edit', sprayKey: 'plant-1:post1' } } } });
    h.el('input-actual').value = '';
    h.el('input-actual').onchange();
    assert.match(h.el('form-error').textContent, /registre primeiro a data realizada da aplicação anterior/);
    await h.el('form').onsubmit({ preventDefault() {} });
    assert.equal(h.calls.save.length, 0);
});

test('delete and restore preserve reversible CRUD state in the repository', async () => {
    const h = harness();
    h.api.refresh(h.state, h.features); await h.tick();
    const clickAction = (action, key) => h.el('table').onclick({ target: { closest: selector => selector === '[data-spray-sort]' ? null : { dataset: { sprayAction: action, sprayKey: key } } } });
    clickAction('delete', 'plant-1:post1'); await h.tick();
    assert.equal(h.calls.save.length, 1);
    assert.equal(h.calls.save[0].row.deleted, true);
    h.el('status').value = 'deleted'; h.el('status').onchange();
    assert.match(h.el('table').innerHTML, /Excluída/);
    clickAction('restore', 'plant-1:post1'); await h.tick();
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

test('map selection turns the field blue and popup escapes field and application content', async () => {
    const h = harness();
    h.api.refresh(h.state, h.features); await h.tick();
    h.api.selectFeature(h.features[0]);
    assert.equal(h.api.style(h.features[0]).fillColor, '#1673d1');
    const malicious = { properties: { Fazenda: 'FE <svg onload="x">', Campo: 'Talhão <img src=x onerror=alert(1)>', Area: 12 } };
    const popup = h.api.popup(malicious);
    assert.match(popup, /&lt;svg onload=&quot;x&quot;&gt;/);
    assert.match(popup, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(popup, /<svg|<img/);
    assert.match(h.api.popup(h.features[0]), /Herbicida A/);
});

test('viewer is read only and cannot open or submit the application form', async () => {
    const h = harness({ role: 'viewer' });
    h.api.refresh(h.state, h.features); await h.tick();
    assert.equal(h.el('add').disabled, true);
    assert.match(h.el('table').innerHTML, /data-spray-action="map"/);
    assert.doesNotMatch(h.el('table').innerHTML, /data-spray-action="edit"|data-spray-action="delete"/);
    h.el('add').onclick();
    assert.equal(h.el('form').hidden, true);
    await h.el('form').onsubmit({ preventDefault() {} });
    assert.equal(h.calls.save.length, 0);
});
