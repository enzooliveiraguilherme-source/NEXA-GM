const test=require('node:test');
const assert=require('node:assert/strict');
require('../js/operations/supabase-repository.js');

test('cadastro antigo arquivado não participa da seleção das novas partes',async()=>{
    const rows=['FE 01','FE 01.1','FE 01.2','FE 01.3'].map((campo,index)=>({feature:{properties:{Fazenda:'FE',Campo:campo,...(index===0?{OperationalArchived:true}:{})}}}));
    const client={from(){const builder={select(){return builder;},eq(){return builder;},order(){return builder;},async range(start,end){return {data:rows.slice(start,end+1),count:rows.length,error:null};}};return builder;}};
    const fields=await globalThis.GeoOperations.createRepository(client).listFields('FE');
    assert.deepEqual(fields.map(f=>f.properties.Campo),['FE 01.1','FE 01.2','FE 01.3']);
    assert.equal(rows[0].feature.properties.Campo,'FE 01');
});
