const test = require('node:test');
const assert = require('node:assert/strict');
require('../js/spray-schedule.js');
require('../js/spray-repository.js');

const { create } = globalThis.SprayRepository;
const plantingDate = '2026-10-01';
const current = '2026-11-10';
const actuals = { post1: '2026-10-16', post2: '2026-10-26', fung1: '2026-11-05', fung2: '', fung3: '', fung4: '' };

function fakeClient(resolve) {
    const calls = [];
    return {
        calls,
        from(table) {
            const call = { table, filters: [], method: 'select' };
            calls.push(call);
            const builder = {
                select(columns, options) { call.columns = columns; call.options = options; return builder; },
                in(column, values) { call.in = [column, [...values]]; return builder; },
                order(column) { call.order = column; return builder; },
                eq(column, value) { call.filters.push([column, value]); return builder; },
                insert(payload) { call.method = 'insert'; call.payload = payload; return builder; },
                update(payload) { call.method = 'update'; call.payload = payload; return builder; },
                range(start, end) { call.range = [start, end]; return Promise.resolve(resolve(call)); },
                maybeSingle() { return Promise.resolve(resolve(call)); }
            };
            return builder;
        }
    };
}

function dbRow(overrides = {}) {
    return {
        planting_record_id: 'plant-1', fourth_enabled: false,
        post1_date: actuals.post1, post2_date: actuals.post2, fung1_date: actuals.fung1,
        fung2_date: null, fung3_date: null, fung4_date: null,
        version: 1, updated_at: '2026-11-10T12:00:00Z', updated_by: 'user-1', ...overrides
    };
}

test('save normalizes empty application dates and maps the confirmed database row', async () => {
    const client = fakeClient(call => ({ data: dbRow(), error: null }));
    const saved = await create(client).save({ plantingId: 'plant-1', fourth: false, actuals }, plantingDate, current);
    assert.deepEqual(saved, {
        plantingId: 'plant-1', fourth: false,
        actuals: { post1: '2026-10-16', post2: '2026-10-26', fung1: '2026-11-05', fung2: '', fung3: '', fung4: '' },
        version: 1, updatedAt: '2026-11-10T12:00:00Z'
    });
    assert.equal(client.calls.length, 1);
    assert.equal(client.calls[0].table, 'spray_schedules');
    assert.equal(client.calls[0].method, 'insert');
    assert.deepEqual(client.calls[0].payload, {
        planting_record_id: 'plant-1', fourth_enabled: false,
        post1_date: '2026-10-16', post2_date: '2026-10-26', fung1_date: '2026-11-05',
        fung2_date: null, fung3_date: null, fung4_date: null
    });
});

test('existing schedule update is optimistic and a missing returned row is a conflict', async () => {
    const client = fakeClient(() => ({ data: null, error: null }));
    await assert.rejects(create(client).save({ plantingId: 'plant-1', fourth: false, actuals, version: 7 }, plantingDate, current), /mudou|Recarregue/);
    assert.equal(client.calls[0].method, 'update');
    assert.deepEqual(client.calls[0].filters, [['planting_record_id', 'plant-1'], ['version', 7]]);
    assert.equal(client.calls[0].payload.planting_record_id, 'plant-1');
    assert.equal(client.calls[0].payload.version, undefined);
});

test('database conflict, permission, and unavailable schema errors are surfaced', async t => {
    for (const [code, expected] of [
        ['23505', /alterado por outra pessoa/],
        ['42501', /não permite alterar/],
        ['PGRST205', /ainda não foi disponibilizado/],
        ['42P01', /ainda não foi disponibilizado/]
    ]) {
        await t.test(code, async () => {
            const client = fakeClient(() => ({ data: null, error: { code } }));
            await assert.rejects(create(client).save({ plantingId: 'plant-1', fourth: false, actuals }, plantingDate, current), expected);
        });
    }
});

test('invalid schedule is rejected before any database request', async () => {
    const client = fakeClient(() => { throw Error('unexpected request'); });
    await assert.rejects(create(client).save({
        plantingId: 'plant-1', fourth: false,
        actuals: { ...actuals, post2: '' , fung1: '2026-11-05' }
    }, plantingDate, current), /registre primeiro/);
    assert.equal(client.calls.length, 0);
});

test('list deduplicates IDs, chunks them by 100, and follows server-shortened pages', async () => {
    const ids = Array.from({ length: 205 }, (_, index) => `plant-${index}`);
    const input = [...ids, ...ids.slice(0, 12)];
    const client = fakeClient(call => {
        const [column, batch] = call.in;
        assert.equal(column, 'planting_record_id');
        const pageRows = batch.slice(call.range[0], call.range[0] + 37).map((id, index) => dbRow({ planting_record_id: id, version: call.range[0] + index + 1 }));
        return { data: pageRows, count: batch.length, error: null };
    });
    const result = await create(client).list(input);
    assert.equal(result.length, ids.length);
    assert.deepEqual(result.map(row => row.plantingId), ids);
    assert.deepEqual([...new Set(client.calls.map(call => call.in[1].length))], [100, 5]);
    assert.deepEqual(client.calls.filter(call => call.in[1].length === 100).map(call => call.range[0]), [0, 37, 74, 0, 37, 74]);
    assert.deepEqual(client.calls.filter(call => call.in[1].length === 5).map(call => call.range[0]), [0]);
    assert.ok(client.calls.every(call => call.options.count === 'exact' && call.range[1] - call.range[0] === 499));
});

test('list rejects missing exact count and an incomplete empty page', async t => {
    await t.test('count missing', async () => {
        const client = fakeClient(() => ({ data: [], error: null }));
        await assert.rejects(create(client).list(['plant-1']), /não confirmou a consulta completa/);
    });
    await t.test('empty page before count reached', async () => {
        let page = 0;
        const client = fakeClient(() => ({ data: page++ === 0 ? [dbRow()] : [], count: 2, error: null }));
        await assert.rejects(create(client).list(['plant-1']), /ficou incompleta/);
    });
});
