const test = require('node:test');
const assert = require('node:assert/strict');
require('../js/operations/supabase-repository.js');
const { createRepository } = globalThis.GeoOperations;

// Simula somente o transporte Supabase; não substitui validação de SQL/RLS no banco.
function fakeClient(resolve) {
    const calls = [];
    return {
        calls,
        async rpc(name, payload) { const call={method:'rpc',name,payload};calls.push(call);return resolve(call); },
        from(table) {
            const call = { table, filters: [], method: 'select' };
            calls.push(call);
            const builder = {
                select(columns, options) { call.columns = columns; call.options = options; return builder; },
                eq(key, value) { call.filters.push([key, value]); return builder; },
                order(key, options) { call.order = [key, options]; return builder; },
                insert(payload) { call.method = 'insert'; call.payload = payload; return builder; },
                update(payload) { call.method = 'update'; call.payload = payload; return builder; },
                range(start, end) { call.range = [start, end]; return Promise.resolve(resolve(call)); },
                maybeSingle() { return Promise.resolve(resolve(call)); }
            };
            return builder;
        }
    };
}

const filters = { operationType: 'adubacao', ano: '2026', cultura: 'Soja', produto: 'Calcário PRNT 80', fazenda: 'FE' };
const localRecord = {
    fazenda: 'FE', campo: 'FE 02', ano: '2026', cultura: 'Soja', produto: 'Calcário PRNT 80',
    status: 'concluido', areaTotal: 100, areaRealizada: 100, percentualRealizado: 100,
    taxaAplicada: 2.5, variedadeSemente: 'Dado antigo de outro modo', dataPlantio: '2026-10-06',
    usuario: 'Nome fornecido pelo navegador', created_by: 'autor-forjado', version: 99,
    historico: [{ usuario: 'autor-forjado' }]
};

test('lote usa uma transação no banco, preserva versões e não envia autoria fornecida pela tela',async()=>{
    const client=fakeClient(call=>({data:call.payload.records.map(row=>({...row,version:2,area_total:row.area_total,area_realizada:row.area_realizada,percentual_realizado:row.percentual_realizado})),error:null}));
    const saved=await createRepository(client).saveRecords([{...localRecord,id:'existing',version:1},{...localRecord,campo:'FE 03',version:undefined}],'adubacao');
    assert.equal(saved.length,2);assert.equal(client.calls.length,1);assert.equal(client.calls[0].name,'save_operation_batch');
    const payload=client.calls[0].payload.records;assert.equal(payload[0].version,1);assert.equal(payload[1].id,null);
    assert.equal(payload[0].created_by,undefined);assert.equal(payload[0].historico,undefined);
});
test('conflito de lote e confirmação incompleta não são tratados como sucesso',async()=>{
    const conflict=fakeClient(()=>({data:null,error:{code:'40001'}}));
    await assert.rejects(createRepository(conflict).saveRecords([localRecord],'adubacao'),{code:'CONFLICT'});
    const incomplete=fakeClient(()=>({data:[],error:null}));
    await assert.rejects(createRepository(incomplete).saveRecords([localRecord],'adubacao'),{code:'INCOMPLETE_WRITE'});
});

test('consulta todos os registros mesmo quando o servidor reduz o tamanho das páginas', async () => {
    const rows = Array.from({ length: 1205 }, (_, index) => ({ id: `record-${index}`, area_total: 1, area_realizada: 0, percentual_realizado: 0 }));
    const client = fakeClient(call => ({ data: rows.slice(call.range[0], call.range[0] + 200), count: rows.length, error: null }));
    const result = await createRepository(client).listRecords(filters);
    assert.equal(result.length, 1205);
    assert.equal(new Set(result.map(row => row.id)).size, 1205);
    assert.equal(result.at(-1).id, 'record-1204');
    assert.deepEqual(client.calls.map(call => call.range[0]), [0, 200, 400, 600, 800, 1000, 1200]);
    for (const call of client.calls) {
        assert.ok(call.filters.some(([key, value]) => key === 'operation_type' && value === 'adubacao'));
        assert.ok(call.filters.some(([key, value]) => key === 'fazenda' && value === 'FE'));
    }
});

test('recusa consulta incompleta em vez de apresentar totais parciais como completos', async () => {
    let page = 0;
    const client = fakeClient(() => ({ data: page++ === 0 ? [{ id: 'one' }] : [], count: 2, error: null }));
    await assert.rejects(createRepository(client).listRecords(filters), { code: 'INCOMPLETE_READ' });
});

test('edição usa a versão lida e informa conflito sem sobrescrever a edição de outra pessoa', async () => {
    const client = fakeClient(() => ({ data: null, error: null }));
    await assert.rejects(createRepository(client).saveRecord({ ...localRecord, id: 'existing', version: 3 }, 'adubacao'), { code: 'CONFLICT' });
    assert.deepEqual(client.calls[0].filters, [['id', 'existing'], ['version', 3]]);
    assert.equal(client.calls.length, 1);
});

test('novo registro não transmite autor, histórico nem dados de plantio para adubação', async () => {
    const client = fakeClient(call => ({ data: { ...call.payload, id: 'new', version: 1 }, error: null }));
    const result = await createRepository(client).saveRecord(localRecord, 'adubacao');
    const payload = client.calls[0].payload;
    assert.equal(result.version, 1);
    assert.equal(payload.variedade_semente, null);
    assert.equal(payload.data_plantio, null);
    for (const field of ['created_by', 'updated_by', 'version', 'historico', 'usuario']) assert.equal(field in payload, false);
});

test('plantio fica separado do produto de adubação e mantém variedade e data', async () => {
    const client = fakeClient(call => ({ data: { ...call.payload, id: 'planting', version: 1 }, error: null }));
    const result = await createRepository(client).saveRecord(localRecord, 'plantio');
    assert.equal(result.produto, 'Plantio');
    assert.equal(result.operationType, 'plantio');
    assert.equal(result.taxaAplicada, null);
    assert.equal(result.variedadeSemente, localRecord.variedadeSemente);
    assert.equal(result.dataPlantio, localRecord.dataPlantio);
});

test('planejamento ausente e lista explicitamente vazia têm significados distintos', async () => {
    const absent = fakeClient(() => ({ data: null, error: null }));
    assert.equal(await createRepository(absent).getPlan(filters), null);
    const empty = fakeClient(() => ({ data: { id: 'plan', planned_fields: [], version: 1 }, error: null }));
    assert.deepEqual((await createRepository(empty).getPlan(filters)).plannedFields, []);
});

test('falha de permissão não confirma o salvamento', async () => {
    const client = fakeClient(() => ({ data: null, error: { code: '42501' } }));
    await assert.rejects(createRepository(client).saveRecord(localRecord, 'adubacao'), { code: 'FORBIDDEN' });
});

test('registro sem versão ou com área inválida não envia uma atualização', async () => {
    const client = fakeClient(() => { throw new Error('Não deveria consultar o banco'); });
    const repository = createRepository(client);
    await assert.rejects(repository.saveRecord({ ...localRecord, id: 'existing', version: undefined }, 'adubacao'), { code: 'VERSION_MISSING' });
    await assert.rejects(repository.saveRecord({ ...localRecord, areaTotal: 'inválida' }, 'adubacao'), { code: 'VALIDATION' });
    assert.equal(client.calls.length, 0);
});
