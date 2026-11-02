const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const SpraySchedule = require('../js/spray-schedule.js');
const PlantingForecast = require('../js/planting-forecast.js');
const sprayViewSource = fs.readFileSync(require.resolve('../js/spray-view.js'), 'utf8');

function harness({ role = 'editor', accessRole = 'admin', loadRows = [], loadError = null, saveError = null } = {}) {
    const elements = new Map();
    class Element {
        constructor(id) {
            this.id = id; this.dataset = {}; this.classList = { toggle() {}, add() {}, remove() {} };
            this.hidden = false; this.disabled = false; this.checked = false; this.value = '';
            this.textContent = ''; this.innerHTML = ''; this.onchange = null; this.onclick = null;
        }
        focus() {}
        scrollIntoView() {}
    }
    const document = { getElementById(id) {
        if (!elements.has(id)) elements.set(id, new Element(id));
        return elements.get(id);
    } };
    const calls = { list: [], save: [] };
    const repository = {
        async list(ids) { calls.list.push([...ids]); if (loadError) throw loadError; return loadRows.filter(row => ids.includes(row.plantingId)); },
        async save(input, plantingDate) {
            calls.save.push({ input: structuredClone(input), plantingDate });
            if (saveError) throw saveError;
            return { ...structuredClone(input), version: input.version || 1, updatedAt: '2026-11-10T12:00:00Z' };
        }
    };
    const window = {
        SpraySchedule, PlantingForecast, SprayRepository: { create: () => repository },
        portalAccessRole: accessRole, setInterval() { return 1; }
    };
    const context = vm.createContext({ window, document, console, Intl, Date, Map, Set, Object, String, Number, Math, JSON });
    vm.runInContext(sprayViewSource, context);
    const api = window.SprayView;
    const record = {
        id: 'plant-1', operationType: 'plantio', fazenda: 'FE', campo: 'FE 01', ano: '2026', cultura: 'Soja',
        produto: 'Plantio', status: 'em_andamento', areaRealizada: 30, variedadeSemente: 'Olimpo', dataPlantio: '2026-10-01'
    };
    const second = {
        id: 'plant-2', operationType: 'plantio', fazenda: 'FE', campo: 'FE 02', ano: '2026', cultura: 'Soja',
        produto: 'Plantio', status: 'concluido', areaRealizada: 50, variedadeSemente: 'Olimpo', dataPlantio: '2026-10-03'
    };
    const state = {
        currentTab: 'pulverizacao', currentAno: '2026', currentCultura: 'Soja', userRole: role,
        cloudStore: { getRecords: () => ({ first: record, second }) }
    };
    const feature = (field, area) => ({ properties: { Fazenda: 'FE', Campo: field, Area: area } });
    const features = [feature('FE 01', 100), feature('FE 02', 60)];
    const tick = () => new Promise(resolve => setImmediate(resolve));
    const el = name => document.getElementById('spray-' + name);
    return { api, state, features, calls, el, tick, document };
}

test('loads only planted field IDs from filtered features and renders five or six steps', async () => {
    const h = harness();
    h.api.refresh(h.state, h.features.slice(0, 1));
    await h.tick();
    assert.deepEqual(h.calls.list, [['plant-1']]);
    assert.match(h.el('scope').textContent, /1 talhões com plantio/);
    assert.equal((h.el('rows').innerHTML.match(/data-spray-date=/g) || []).length, 5);
    assert.match(h.el('field').innerHTML, /plant-1/);

    h.el('fourth').checked = true;
    h.el('panel').onchange({ target: h.el('fourth') });
    assert.equal((h.el('rows').innerHTML.match(/data-spray-date=/g) || []).length, 6);
    assert.equal(h.calls.save.length, 0);
});

test('editing a realized date updates the preview immediately without saving', async () => {
    const h = harness();
    h.api.refresh(h.state, h.features.slice(0, 1));
    await h.tick();
    h.el('panel').onchange({ target: { dataset: { sprayDate: 'post1' }, value: '2026-10-16' } });
    assert.match(h.el('status').textContent, /Prévia com alterações não salvas/);
    assert.match(h.el('overview').innerHTML, /16\/10\/2026/);
    assert.match(h.el('rows').innerHTML, /post1/);
    assert.equal(h.calls.save.length, 0);
});

test('confirmed save clears the draft; a rejected save keeps it and reports no confirmation', async t => {
    await t.test('confirmed', async () => {
        const h = harness();
        h.api.refresh(h.state, h.features.slice(0, 1)); await h.tick();
        h.el('panel').onchange({ target: { dataset: { sprayDate: 'post1' }, value: '2026-10-16' } });
        await h.el('save').onclick();
        assert.equal(h.calls.save.length, 1);
        assert.match(h.el('status').textContent, /salvas e confirmadas no banco/);
        assert.equal(h.el('save').disabled, true);
        assert.doesNotMatch(h.el('overview').innerHTML, /Não salvo/);
    });
    await t.test('rejected', async () => {
        const h = harness({ saveError: Error('Acesso negado') });
        h.api.refresh(h.state, h.features.slice(0, 1)); await h.tick();
        h.el('panel').onchange({ target: { dataset: { sprayDate: 'post1' }, value: '2026-10-16' } });
        await h.el('save').onclick();
        assert.equal(h.calls.save.length, 1);
        assert.match(h.el('status').textContent, /Acesso negado/);
        assert.doesNotMatch(h.el('status').textContent, /confirmadas no banco/);
        assert.equal(h.el('save').disabled, false);
        assert.match(h.el('overview').innerHTML, /Não salvo/);
        assert.match(h.el('rows').innerHTML, /value="2026-10-16"/);
    });
});

test('viewer cannot change dates or save even when a change event is dispatched', async () => {
    const h = harness({ role: 'viewer' });
    h.api.refresh(h.state, h.features.slice(0, 1)); await h.tick();
    assert.match(h.el('rows').innerHTML, /disabled/);
    assert.equal(h.el('save').disabled, true);
    h.el('panel').onchange({ target: { dataset: { sprayDate: 'post1' }, value: '2026-10-16' } });
    await h.el('save').onclick();
    assert.equal(h.calls.save.length, 0);
    assert.match(h.el('permission').textContent, /Modo de consulta/);
});

test('failed schedule load does not show KPIs, overview or an editable panel', async () => {
    const h = harness({ loadError: Error('Consulta indisponível') });
    h.api.refresh(h.state, h.features.slice(0, 1));
    await h.tick();
    assert.match(h.el('status').textContent, /Consulta indisponível/);
    assert.equal(h.el('summary').innerHTML, '');
    assert.equal(h.el('overview').innerHTML, '');
    assert.equal(h.el('editor').hidden, true);
    assert.match(h.el('next').textContent, /Cronograma indisponível/);
});
