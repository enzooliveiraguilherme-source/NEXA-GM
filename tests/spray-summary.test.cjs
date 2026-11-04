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

test('datas vencidas, futuras ou ausentes ficam não aplicadas no resumo', () => {
    assert.equal(Summary.classify(row('post1', { planned: today }), today), 'not_applied');
    assert.equal(Summary.classify(row('post1', { planned: '2026-11-19' }), today), 'not_applied');
    assert.equal(Summary.classify(row('post1', { planned: '2026-11-21' }), today), 'not_applied');
    assert.equal(Summary.classify(row('post1', { planned: null }), today), 'not_applied');
});

test('resumo exclui apagados e opcionais e inclui áreas futuras ou sem data nos três totais', () => {
    const totals = Summary.summarize([
        row('post1', { area: 10, actual: today }),
        row('post2', { area: 20, planned: '2026-11-21' }),
        row('fung1', { area: 100, planned: null }),
        row('fung2', { area: 200, deleted: true }),
        row('fung3', { area: 300, optional: true })
    ], today);
    assert.equal(totals.plannedArea, 130);
    assert.equal(totals.appliedArea, 10);
    assert.equal(totals.progress, 100 * 10 / 130);
    assert.deepEqual(totals.buckets, {
        applied: { area: 10, count: 1 },
        in_progress: { area: 0, count: 0 },
        not_applied: { area: 120, count: 2 }
    });
    assert.deepEqual(Object.keys(totals.buckets), ['applied', 'in_progress', 'not_applied']);
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

test('status do talhão prioriza em andamento; sem registro ou só status vermelhos fica não aplicado', () => {
    assert.equal(Summary.fieldStatus([
        row('post1', { actual: today }), row('post2', { started: today, planned: '2026-11-01' })
    ], today), 'in_progress');
    assert.equal(Summary.fieldStatus([
        row('post1', { planned: '2026-11-21' }), row('post2', { planned: today })
    ], today), 'not_applied');
    assert.equal(Summary.fieldStatus([row('post1', { planned: '2026-11-21' })], today), 'not_applied');
    assert.equal(Summary.fieldStatus([row('post1', { planned: null })], today), 'not_applied');
    assert.equal(Summary.fieldStatus([], today), 'not_applied');
    assert.equal(Summary.fieldStatus([row('post1', { deleted: true }), row('fung1', { optional: true })], today), 'not_applied');
    assert.equal(Summary.fieldStatus([row('post1', { actual: today })], today), 'applied');
});

test('nomes de exibição cobrem os oito prefixos e não alteram o cadastro', () => {
    const names = {
        FE: 'Fazenda Esperança', FBLA: 'Fazenda Beleza', FBAG: 'Fazenda Barra Grande',
        FSTV: 'Fazenda Santa Vitória', FPAR: 'Fazenda Paraiso', FEAR: 'Fazenda Encanto do Araguaia',
        FPER: 'Fazenda Perdizes', FSAL: 'Fazenda São Luis'
    };
    const farms = Object.entries(names).map(([code, name]) => ({ code, name: `Cadastro ${code}` }));
    const before = structuredClone(farms);
    for (const [code, expected] of Object.entries(names)) {
        assert.deepEqual(Summary.scopeDetails({ currentFazenda: code, currentGleba: 'ALL' }, farms),
            { scope: code, scopeName: expected });
    }
    assert.deepEqual(farms, before);
});

test('fazenda tem prioridade sobre gleba; gleba FE mostra Fazenda Esperança e ALL mostra escopo geral', () => {
    const farms = [{ code: 'FE', name: 'Nome cadastrado' }];
    assert.deepEqual(Summary.scopeDetails({ currentFazenda: 'FBLA', currentGleba: 'FE' }, farms),
        { scope: 'FBLA', scopeName: 'Fazenda Beleza' });
    assert.deepEqual(Summary.scopeDetails({ currentFazenda: 'ALL', currentGleba: 'FE' }, farms),
        { scope: 'FE', scopeName: 'Fazenda Esperança' });
    assert.deepEqual(Summary.scopeDetails({ currentFazenda: 'ALL', currentGleba: 'ALL' }, farms),
        { scope: 'Todas as fazendas', scopeName: 'Todas as fazendas' });
    assert.deepEqual(farms, [{ code: 'FE', name: 'Nome cadastrado' }]);
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
