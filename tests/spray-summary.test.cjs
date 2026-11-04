const test = require('node:test');
const assert = require('node:assert/strict');
require('../js/spray-schedule.js');
const Summary = require('../js/spray-summary.js');
const Operations = require('../js/spray-operations.js');

const today = '2026-11-20';
const row = (stage, values = {}) => ({
    id: `${stage}-1`, farm: 'FE', field: 'FE 01', fieldKey: JSON.stringify(['FE', 'FE 01']),
    stage, name: stage, area: 10, planned: '2026-11-20', actual: null,
    started: null, optional: false, deleted: false, ...values
});
const feature = (field = 'FE 01', values = {}) => ({
    type: 'Feature', properties: { Fazenda: 'FE', Campo: field, ...values }, geometry: null
});

test('classifica conclusão com data ou sem data como aplicada', () => {
    assert.equal(Summary.classify(row('post1', { actual: '2026-11-19' }), today), 'applied');
    assert.equal(Summary.classify(row('post1', { completedWithoutDate: true }), today), 'applied');
});

test('início mantém em andamento mesmo com data planejada vencida', () => {
    assert.equal(Summary.classify(row('post1', { planned: '2026-11-01', started: '2026-11-02' }), today), 'in_progress');
});

test('planejado para hoje ou antes fica não aplicado; data futura fica cinza e sem data fica vazio', () => {
    assert.equal(Summary.classify(row('post1', { planned: today }), today), 'not_applied');
    assert.equal(Summary.classify(row('post1', { planned: '2026-11-19' }), today), 'not_applied');
    assert.equal(Summary.classify(row('post1', { planned: '2026-11-21' }), today), 'future');
    assert.equal(Summary.classify(row('post1', { planned: null }), today), 'empty');
});

test('resumo exclui registros apagados e opcionais, e não conta área sem programação no denominador', () => {
    const totals = Summary.summarize([
        row('post1', { area: 10, actual: today }),
        row('post2', { area: 20, planned: '2026-11-21' }),
        row('fung1', { area: 100, planned: null }),
        row('fung2', { area: 200, deleted: true }),
        row('fung3', { area: 300, optional: true })
    ], today);
    assert.equal(totals.plannedArea, 30);
    assert.equal(totals.appliedArea, 10);
    assert.equal(totals.progress, 100 / 3);
    assert.deepEqual(totals.buckets.empty, { area: 100, count: 1 });
});

test('opções individuais preservam pós e fungicidas, sem agregados gerais', () => {
    const options = Summary.applicationOptions([
        row('post1', { name: '1ª Pós-Emergente' }), row('fung1', { name: '1º Fungicida' })
    ]);
    assert.deepEqual(options.map(option => option.key), ['post1', 'fung1']);
});

test('build filtra o estágio selecionado e não duplica feições do mesmo talhão', () => {
    const features = [feature(), feature()];
    const rows = [row('post1', { name: 'Pós', actual: today }), row('fung1', { name: 'Fungicida' })];
    const before = structuredClone(rows);
    const result = Summary.build(features, rows, 'post1', today);
    assert.equal(result.fields.length, 1);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].stage, 'post1');
    assert.equal(result.totals.plannedArea, 10);
    const fungicide = Summary.build(features, rows, 'fung1', today);
    assert.equal(fungicide.rows.length, 1);
    assert.equal(fungicide.rows[0].stage, 'fung1');
    assert.equal(fungicide.totals.plannedArea, 10);
    assert.deepEqual(rows, before);
});

test('prioridade de status do talhão: em andamento, não aplicado, futuro, vazio; todos concluídos ficam aplicados', () => {
    assert.equal(Summary.fieldStatus([
        row('post1', { actual: today }), row('post2', { started: today, planned: '2026-11-01' })
    ], today), 'in_progress');
    assert.equal(Summary.fieldStatus([
        row('post1', { planned: '2026-11-21' }), row('post2', { planned: today })
    ], today), 'not_applied');
    assert.equal(Summary.fieldStatus([row('post1', { planned: '2026-11-21' })], today), 'future');
    assert.equal(Summary.fieldStatus([row('post1', { planned: null })], today), 'empty');
    assert.equal(Summary.fieldStatus([row('post1', { actual: today })], today), 'applied');
});

test('status de mapa operacional prioriza atraso e considera somente etapas individuais elegíveis', () => {
    const fieldKey = JSON.stringify(['FE', 'FE 01']);
    const rows = [
        row('post1', { status: 'completed', actual: today }),
        row('fung1', { status: 'overdue', planned: '2026-11-01' }),
        row('fung2', { status: 'attention', planned: today }),
        row('fung3', { status: 'overdue', deleted: true }),
        row('fung4', { status: 'overdue', optional: true })
    ];
    assert.equal(Operations.mapStatus(rows, fieldKey), 'pending');
    assert.equal(Operations.mapStatus([rows[0], rows[2]], fieldKey), 'attention');
    assert.equal(Operations.mapStatus([rows[0]], fieldKey), 'completed');
    assert.equal(Operations.mapStatus([rows[3], rows[4]], fieldKey), 'empty');
});
