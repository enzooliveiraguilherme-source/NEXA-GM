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
        actual_date: '2026-10-18', completed_without_date: false, responsible: 'Operador de teste', notes: 'Observação de teste',
        deleted: false, version: 4, ...overrides
    };
}

function manualApplication(index, overrides = {}) {
    return application({ id: `manual-${index}`, plantingId: null, stage: null, autoDate: false,
        name: 'Aplicação adicional', planned: '2026-10-20', actual: '', dose: '', area: 1,
        version: null, scheduleVersion: null, ...overrides });
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
        actual_date: '2026-10-18', completed_without_date: false, responsible: 'Operador de teste', notes: 'Observação de teste', deleted: false
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

test('independent pre-planting applications keep null source and accept actual-only dates', async () => {
    const cases = [
        { stage: 'pre', name: 'Pré-emergente', actual: '2026-09-20', dose: '' },
        { stage: 'boro', name: 'Boro', actual: '2026-09-22', dose: '1.25' },
        { stage: 'desiccation', name: 'Dessecação pré-plantio', planned: '2026-09-25', actual: '2026-09-28', dose: '' }
    ];
    for (const item of cases) {
        const client = fakeClient({ rpc: call => ({ data: dbRow({
            id: `independent-${item.stage}`, planting_record_id: null, stage_id: item.stage,
            application_name: item.name, product: 'Produto', dose: item.dose ? Number(item.dose) : null,
            planned_date: item.planned || null, actual_date: item.actual
        }), error: null }) });
        await create(client).save(application({
            id: `independent-${item.stage}`, plantingId: null, stage: item.stage, name: item.name,
            planned: item.planned || null, actual: item.actual, autoDate: false,
            dose: item.dose, version: null, scheduleVersion: null
        }), field());
        const rpc = client.calls[0];
        assert.equal(rpc.name, 'save_spray_application');
        assert.equal(rpc.payload.p_payload.planting_record_id, null);
        assert.equal(rpc.payload.p_payload.stage_id, item.stage);
        assert.equal(rpc.payload.p_payload.planned_date, item.planned || null);
        assert.equal(rpc.payload.p_payload.actual_date, item.actual);
        assert.equal(rpc.payload.p_schedule_version, null);
        assert.equal(rpc.payload.p_payload.dose, item.dose ? Number(item.dose) : null);
    }
});

test('completed without date round-trips; adding an actual date clears the persisted flag', async () => {
    const client = fakeClient({ rpc: call => {
        const payload = call.payload.p_payload;
        return { data: dbRow({ actual_date: payload.actual_date, completed_without_date: payload.completed_without_date,
            planned_date: payload.planned_date }), error: null };
    } });
    const repository=create(client),withoutDate=application({actual:'',completedWithoutDate:true});
    const saved=await repository.save(withoutDate,field());
    assert.equal(client.calls[0].payload.p_payload.actual_date,null);
    assert.equal(client.calls[0].payload.p_payload.completed_without_date,true);
    assert.equal(saved.completedWithoutDate,true);
    const dated=await repository.save({...withoutDate,actual:'2026-10-20',version:saved.version},field());
    assert.equal(client.calls[1].payload.p_payload.actual_date,'2026-10-20');
    assert.equal(client.calls[1].payload.p_payload.completed_without_date,false);
    assert.equal(dated.completedWithoutDate,false);
});

test('list selects and maps completed_without_date from the repository row', async () => {
    const client=fakeClient({query:()=>({data:[dbRow({completed_without_date:true})],count:1,error:null})});
    const rows=await create(client).list(['FE'],'2026','Soja');
    assert.match(client.calls[0].columns,/completed_without_date/);
    assert.equal(rows[0].completedWithoutDate,true);
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

test('saveBatch sends one RPC with normalized records and both optimistic versions', async () => {
    const rows = [application(), application({ id: 'application-2', stage: 'post2', version: 5,
        autoDate: false, planned: '2026-10-26', dose: '', scheduleVersion: 11 })];
    const client = fakeClient({ rpc: () => ({ data: [
        dbRow(), dbRow({ id: 'application-2', stage_id: 'post2', planned_date: '2026-10-26', dose: null, version: 6 })
    ], error: null }) });
    const saved = await create(client).saveBatch(rows, [field()]);
    assert.equal(client.calls.length, 1);
    const call = client.calls[0];
    assert.equal(call.name, 'save_spray_application_batch');
    assert.equal(call.payload.p_records.length, 2);
    assert.deepEqual(call.payload.p_records.map(item => [item.expected_version, item.schedule_version]), [[3, 9], [5, 11]]);
    assert.equal(call.payload.p_records[0].payload.planned_date, null);
    assert.equal(call.payload.p_records[0].payload.actual_date, '2026-10-18');
    assert.equal(call.payload.p_records[0].payload.dose, 2.5);
    assert.equal(call.payload.p_records[1].payload.planned_date, '2026-10-26');
    assert.equal(call.payload.p_records[1].payload.dose, null);
    assert.deepEqual(saved.map(row => row.id), ['application-1', 'application-2']);
    assert.deepEqual(saved.map(row => row.version), [4, 6]);
});

test('saveBatch rejects out-of-range, duplicate, or invalid rows before requesting the RPC', async t => {
    await t.test('empty batch and over 1000 rows', async () => {
        const client = fakeClient({ rpc: () => { throw Error('unexpected RPC'); } });
        const repository = create(client);
        await assert.rejects(repository.saveBatch([], [field()]), /entre 1 e 1000/);
        await assert.rejects(repository.saveBatch(Array.from({ length: 1001 }, (_, index) => manualApplication(index)), [field()]), /entre 1 e 1000/);
        assert.equal(client.calls.length, 0);
    });
    await t.test('duplicate planting stage', async () => {
        const client = fakeClient({ rpc: () => { throw Error('unexpected RPC'); } });
        await assert.rejects(create(client).saveBatch([application(), application({ id: 'duplicate-id' })], [field()]), /mais de uma vez/);
        assert.equal(client.calls.length, 0);
    });
    await t.test('every row validates before request', async () => {
        const client = fakeClient({ rpc: () => { throw Error('unexpected RPC'); } });
        await assert.rejects(create(client).saveBatch([manualApplication(1), manualApplication(2, { area: 101 })], [field()]), /não pode ultrapassar/);
        assert.equal(client.calls.length, 0);
    });
});

test('saveBatch accepts exactly 1000 unique rows', async () => {
    const rows = Array.from({ length: 1000 }, (_, index) => manualApplication(index));
    const client = fakeClient({ rpc: () => ({ data: rows.map((row, index) => dbRow({
        id: row.id, fazenda: row.farm, campo: row.field, planting_record_id: null, stage_id: null,
        application_name: row.name, product: '', dose: null, area: 1, planned_date: row.planned,
        actual_date: null, responsible: '', notes: '', version: index + 1
    })), error: null }) });
    const saved = await create(client).saveBatch(rows, [field()]);
    assert.equal(saved.length, 1000);
    assert.equal(client.calls.length, 1);
    assert.equal(client.calls[0].payload.p_records.length, 1000);
});

test('saveBatch requires a complete array of uniquely identified confirmed rows', async t => {
    await t.test('short response', async () => {
        const client = fakeClient({ rpc: () => ({ data: [dbRow()], error: null }) });
        await assert.rejects(create(client).saveBatch([application(), application({ id: 'application-2', stage: 'post2' })], [field()]), /não confirmou todo o lote/);
    });
    await t.test('duplicate returned IDs', async () => {
        const client = fakeClient({ rpc: () => ({ data: [dbRow(), dbRow({ version: 6 })], error: null }) });
        await assert.rejects(create(client).saveBatch([application(), application({ id: 'application-2', stage: 'post2' })], [field()]), /não confirmou todo o lote/);
    });
    await t.test('empty response', async () => {
        const client = fakeClient({ rpc: () => ({ data: [], error: null }) });
        await assert.rejects(create(client).saveBatch([application()], [field()]), /não confirmou todo o lote/);
    });
});

test('saveBatch reports an optimistic conflict without claiming success', async () => {
    const client = fakeClient({ rpc: () => ({ data: null, error: { code: '40001' } }) });
    await assert.rejects(create(client).saveBatch([application(), application({ id: 'application-2', stage: 'post2' })], [field()]), /registro mudou/);
    assert.equal(client.calls.length, 1);
    assert.equal(client.calls[0].name, 'save_spray_application_batch');
});
