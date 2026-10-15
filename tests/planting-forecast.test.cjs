const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../js/planting-forecast.js');
const field = { properties: { Fazenda: 'FE', Campo: 'FE 01', Area: 100, Variedade: 'Olimpo' } };
const record = { status: 'concluido', areaRealizada: 100, variedadeSemente: 'Olimpo', dataPlantio: '2026-10-01' };

test('114 dias apenas para Olimpo e NEO 790 na soja, sem confundir NEO780', () => {
    for (const name of ['Olimpo', 'OLIMPO', '  olimpo  ', 'NEO 790', 'neo790', 'NEO  790']) assert.equal(F.cycleDays(name), 114);
    for (const name of ['NEO780', 'NEO 780', 'Olimpo teste', '', null]) assert.equal(F.cycleDays(name), null);
    assert.equal(F.cycleDays('Olimpo', 'Milho'), null);
});
test('adição de dias corridos funciona na mudança de ano e no ano bissexto', () => {
    assert.equal(F.harvestDate('2026-10-01', 114), '2027-01-23');
    assert.equal(F.harvestDate('2024-02-28', 2), '2024-03-01');
    assert.equal(F.harvestDate('2026-10-15', 114), '2027-02-06');
    for (const input of ['2026-02-30', '2026-13-01', '01/10/2026', '', null]) assert.equal(F.harvestDate(input, 114), null);
    assert.equal(F.harvestDate('2026-10-01', null), null);
});
test('planejamento e variedade no polígono não são considerados plantio executado', () => {
    assert.equal(F.project(field, null, 'Soja').planted, false);
    const row = F.project(field, { ...record, status: 'nao_iniciado' }, 'Soja');
    assert.equal(row.plantedArea, 0); assert.equal(row.estimatedDate, null); assert.equal(row.variety, '');
    assert.equal(F.project(field, { ...record, areaRealizada: 0 }, 'Soja').estimatedDate, null);
});
test('plantio parcial conta apenas a área executada e informa ausência de ciclo/data', () => {
    const row = F.project(field, { ...record, status: 'em_andamento', areaRealizada: 30 }, 'Soja');
    assert.equal(row.plantedArea, 30); assert.equal(row.partial, true); assert.equal(row.estimatedDate, '2027-01-23');
    assert.equal(F.project(field, { ...record, variedadeSemente: 'NEO780' }, 'Soja').reason, 'Ciclo da variedade não definido');
    assert.equal(F.project(field, { ...record, dataPlantio: '' }, 'Soja').estimatedDate, null);
    assert.equal(F.project(field, { ...record, areaRealizada: 150 }, 'Soja').plantedArea, 100);
});
test('plantio concluído não fica parcial quando a área do desenho difere da registrada', () => {
    const feature = { properties: { Fazenda: 'FE', Campo: 'FE 05.1', Area: 64.8 } };
    const completed = { ...record, areaRealizada: 62.51, areaTotal: 62.51, percentualRealizado: 100, dataPlantio: '2026-10-09' };
    const before = JSON.stringify(completed);
    const row = F.project(feature, completed, 'Soja');
    assert.equal(row.partial, false);
    assert.equal(row.plantedArea, 62.51);
    assert.equal(row.estimatedDate, '2027-01-31');
    assert.equal(F.project(feature, { ...completed, status: 'em_andamento' }, 'Soja').partial, true);
    assert.equal(JSON.stringify(completed), before);
});
test('semanas começam na segunda e o total não inclui talhões sem previsão', () => {
    const rows = [F.project(field, record, 'Soja'), F.project(field, { ...record, variedadeSemente: 'Outra' }, 'Soja')];
    const total = F.summarize(rows);
    assert.equal(total.plantedArea, 200); assert.equal(total.estimatedArea, 100);
    assert.deepEqual(total.weeks, [['2027-01-18', 100]]);
    assert.equal(F.weekStart('2027-01-24'), '2027-01-18');
    assert.equal(F.weekStart('2027-01-25'), '2027-01-25');
});
test('simulações ficam isoladas por fazenda, talhão, safra e cultura e não alteram a origem', () => {
    const session = F.createSession();
    const before = JSON.stringify(record);
    session.set(field, '2026', 'Soja', record);
    assert.equal(session.get(field, '2026', 'Soja').simulated, true);
    assert.equal(session.get(field, '2027', 'Soja'), undefined);
    assert.equal(session.get(field, '2026', 'Milho'), undefined);
    assert.equal(session.get({ properties: { ...field.properties, Fazenda: 'FE2' } }, '2026', 'Soja'), undefined);
    const copy = session.get(field, '2026', 'Soja'); copy.areaRealizada = 1;
    assert.equal(session.get(field, '2026', 'Soja').areaRealizada, 100);
    assert.equal(JSON.stringify(record), before);
    session.remove(field, '2026', 'Soja'); assert.equal(session.size, 0);
    session.set(field, '2026', 'Soja', record); session.clear(); assert.equal(session.size, 0);
    assert.equal(F.createSession().size, 0);
});
test('simulação rejeita área excessiva, vazia, zero, data inválida e variedade vazia', () => {
    const session = F.createSession();
    for (const areaRealizada of [0, -1, 101, '', 'abc']) assert.throws(() => session.set(field, '2026', 'Soja', { ...record, areaRealizada }));
    assert.throws(() => session.set(field, '2026', 'Soja', { ...record, dataPlantio: '2026-02-31' }));
    assert.throws(() => session.set(field, '2026', 'Soja', { ...record, variedadeSemente: '' }));
});
test('página de teste não contém gravação, RPC de escrita ou armazenamento persistente', () => {
    const fs = require('node:fs');
    const source = fs.readFileSync(require.resolve('../js/forecast-preview.js'), 'utf8');
    assert.doesNotMatch(source, /\.(?:insert|upsert|update|delete|saveRecords|savePlan|rpc)\s*\(/);
    assert.doesNotMatch(source, /(?:localStorage|sessionStorage|indexedDB)/);
});
