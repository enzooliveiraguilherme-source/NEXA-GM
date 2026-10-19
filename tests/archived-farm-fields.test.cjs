const test=require('node:test');
const assert=require('node:assert/strict');
require('../js/operations/supabase-repository.js');

test('cadastro antigo arquivado não participa da seleção das novas partes',async()=>{
    const rows=['FE 01','FE 01.1','FE 01.2','FE 01.3'].map((campo,index)=>({feature:{properties:{Fazenda:'FE',Campo:campo,...(index===0?{OperationalArchived:true}:{})}}}));
    const client={from(){const builder={select(){return builder;},eq(){return builder;},order(){return builder;},async range(start,end){return {data:rows.slice(start,end+1),count:rows.length,error:null};}};return builder;}};
    const repository=globalThis.GeoOperations.createRepository(client);
    const fields=await repository.listFields('FE');
    assert.deepEqual(fields.map(f=>f.properties.Campo),['FE 01.1','FE 01.2','FE 01.3']);
    const includingArchived=await repository.listFields('FE',{includeArchived:true});
    assert.deepEqual(includingArchived.map(f=>f.properties.Campo),['FE 01','FE 01.1','FE 01.2','FE 01.3']);
    assert.equal(rows[0].feature.properties.Campo,'FE 01');
});

test('cloud store conserva arquivadas para consulta e entrega apenas campos ativos em load',async()=>{
    require('../js/operations/cloud-store.js');
    const active={properties:{Fazenda:'FE',Campo:'FE 11'}};
    const archived={properties:{Fazenda:'FE',Campo:'FE 10',OperationalArchived:true}};
    const calls=[];
    const rows=[active,archived].map(feature=>({feature}));
    const client={from(table){
        calls.push(table);
        const builder={select(){return builder;},eq(){return builder;},order(){return builder;},async range(){
            const data=table==='farm_fields'?rows:[];
            return {data,count:data.length,error:null};
        }};
        return builder;
    }};
    const store=globalThis.GeoCloudStore.create(client,'FE');
    const loaded=await store.load();
    assert.deepEqual(loaded.features.map(feature=>feature.properties.Campo),['FE 11']);
    assert.deepEqual(store.getArchivedFields().map(feature=>feature.properties.Campo),['FE 10']);
    assert.deepEqual(calls.sort(), ['farm_fields','operation_plans','operation_records']);
});
