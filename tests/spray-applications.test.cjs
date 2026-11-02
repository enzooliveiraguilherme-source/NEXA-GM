const test = require('node:test');
const assert = require('node:assert/strict');
const SpraySchedule = require('../js/spray-schedule.js');
const PlantingForecast = require('../js/planting-forecast.js');
const SprayOperations = require('../js/spray-operations.js');
const { create } = require('../js/spray-applications.js');

function fakeClient({ query = () => ({ data: [], count: 0, error: null }), rpc = () => ({ data: null, error: null }) } = {}) {
    const calls = [];
    return {
        calls,
        from(table) {
            const call = { kind: 'query', table, filters: [] };
            calls.push(call);
            const builder = {
                select(columns, options) { call.columns = columns; call.options = options; return builder; },
                in(column, values) { call.in = [column, [...values]]; return builder; },
                eq(column, value) { call.filters.push([column, value]); return builder; },
                order(column) { call.order = column; return builder; },
                range(start, end) { call.range = [start, end]; return Promise.resolve(query(call)); }
            };
            return builder;
        },
        async rpc(name, payload) {
            const call = { kind: 'rpc', name, payload };
            calls.push(call);
            return rpc(call);
        }
    };
}

function application(overrides = {}) {
    return {
        id: 'application-1', farm: 'FE', field: 'FE 01', year: '2026', culture: 'Soja', plantingId: 'plant-1',
        stage: 'post1', name: '1ª Pós-Emergente', product: 'Produto de teste', dose: '2.5', doseUnit: 'L/ha',
        area: 30, planned: '2026-10-16', actual: '2026-10-18', autoDate: true, scheduleVersion: 9,
        responsible: 'Operador de teste', notes: 'Observação de teste', deleted: false, version: 3, ...overrides
    };
}

function field(overrides = {}) { return { farm: 'FE', field: 'FE 01', area: 100, ...overrides }; }

function dbRow(overrides = {}) {
    return {
        id: 'application-1', fazenda: 'FE', campo: 'FE 01', ano: '2026', cultura: 'Soja',
        planting_record_id: 'plant-1', stage_id: 'post1', application_name: '1ª Pós-Emergente',
        product: 'Produto de teste', dose: 2.5, dose_unit: 'L/ha', area: 30, planned_date: null,
        actual_date: '2026-10-18', responsible: 'Operador de teste', notes: 'Observação de teste',
        deleted: false, version: 4, ...overrides
    };
}

test('list deduplicates farms, chunks by 100, pages short responses, and filters exact year and culture', async () => {
    const farms = Array.from({ length: 205 }, (_, index) => `FE-${index}`);
    const client = fakeClient({ query: call => {
        const batch = call.in[1];
        const rows = batch.slice(call.range[0], call.range[0] + 23).map((farmCode, index) => dbRow({
            id: `${farmCode}-${call.range[0] + index}`, fazenda: farmCode, campo: 'T1', planting_record_id: null,
            stage_id: null, planned_date: '2026-10-16', actual_date: null
        }));
        return { data: rows, count: batch.length, error: null };
    } });
    const result = await create(client).list([...farms, ...farms.slice(0, 8)], '2026', 'Soja');
    assert.equal(result.length, farms.length);
    assert.deepEqual(result.map(row => row.farm), farms);
    assert.deepEqual([...new Set(client.calls.map(call => call.in[1].length))], [100, 5]);
    assert.deepEqual(client.calls.map(call => call.range[0]), [0, 23, 46, 69, 92, 0, 23, 46, 69, 92, 0]);
    assert.ok(client.calls.every(call => call.table === 'spray_applications' && call.options.count === 'exact'));
    assert.ok(client.calls.every(call => call.filters.some(([key, value]) => key === 'ano' && value === '2026')));
    assert.ok(client.calls.every(call => call.filters.some(([key, value]) => key === 'cultura' && value === 'Soja')));
    assert.equal(client.calls[0].range[1] - client.calls[0].range[0], 499);
});

test('save converts numeric dose, preserves actual date, versions, and linked automatic planned date', async () => {
    const client = fakeClient({ rpc: () => ({ data: [dbRow()], error: null }) });
    const saved = await create(client).save(application(), field());
    const rpc = client.calls[0];
    assert.equal(rpc.name, 'save_spray_application');
    assert.equal(rpc.payload.p_expected_version, 3);
    assert.equal(rpc.payload.p_schedule_version, 9);
    assert.deepEqual(rpc.payload.p_payload, {
        id: 'application-1', fazenda: 'FE', campo: 'FE 01', ano: '2026', cultura: 'Soja',
        planting_record_id: 'plant-1', stage_id: 'post1', application_name: '1ª Pós-Emergente',
        product: 'Produto de teste', dose: 2.5, dose_unit: 'L/ha', area: 30, planned_date: null,
        actual_date: '2026-10-18', responsible: 'Operador de teste', notes: 'Observação de teste', deleted: false
    });
    assert.equal(saved.dose, 2.5);
    assert.equal(saved.actual, '2026-10-18');
    assert.equal(saved.planned, null);
    assert.equal(saved.version, 4);
});

test('manual planned date and empty dose are normalized while actual date is retained', async () => {
    const client = fakeClient({ rpc: () => ({ data: dbRow({ dose: null, planned_date: '2026-10-20' }), error: null }) });
    await create(client).save(application({ dose: '', autoDate: false, planned: '2026-10-20', plantingId: null, stage: null }), field());
    const payload = client.calls[0].payload.p_payload;
    assert.equal(payload.dose, null);
    assert.equal(payload.planned_date, '2026-10-20');
    assert.equal(payload.actual_date, '2026-10-18');
    assert.equal(payload.planting_record_id, null);
});

test('invalid application date or field area is rejected before RPC', async t => {
    await t.test('invalid planned date', async () => {
        const client = fakeClient({ rpc: () => { throw Error('unexpected RPC'); } });
        await assert.rejects(create(client).save(application({ planned: '2026-02-30' }), field()), /data programada válida/);
        assert.equal(client.calls.length, 0);
    });
    await t.test('area exceeds field', async () => {
        const client = fakeClient({ rpc: () => { throw Error('unexpected RPC'); } });
        await assert.rejects(create(client).save(application({ area: 101 }), field()), /não pode ultrapassar/);
        assert.equal(client.calls.length, 0);
    });
});

test('optimistic conflicts and permission failure are surfaced without false confirmation', async t => {
    for (const [code, message] of [
        ['40001', /registro mudou/], ['23505', /registro mudou/], ['42501', /não permite alterar/]
    ]) {
        await t.test(code, async () => {
            const client = fakeClient({ rpc: () => ({ data: null, error: { code } }) });
            await assert.rejects(create(client).save(application(), field()), message);
        });
    }
    await t.test('RPC returns no confirmed row', async () => {
        const client = fakeClient({ rpc: () => ({ data: null, error: null }) });
        await assert.rejects(create(client).save(application(), field()), /não foi confirmada/);
    });
});
