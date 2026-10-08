const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../js/operations/cloud-store.js'),'utf8');
const legacySource = fs.readFileSync(require.resolve('../js/operations/legacy-import.js'),'utf8');
const record = {id:'record',version:1,operationType:'plantio',fazenda:'FE',campo:'T1',ano:'2026',cultura:'Soja',produto:'Plantio',status:'nao_iniciado'};
function harness({farm='FE',rows=[record],fail=false,delay=null}={}) {
    const calls=[];
    const repository={
        async listFields(f) {calls.push(['fields',f]); return [{properties:{Fazenda:f,Campo:'T1'}}];},
        async listFarmRecords(f) {calls.push(['records',f]);return rows;},
        async listFarmPlans(f) {calls.push(['plans',f]);return [{operationType:'plantio',fazenda:f,gleba:'ALL',ano:'2026',cultura:'Soja',produto:'Plantio',plannedFields:[]}];},
        async saveRecords(input,type) {calls.push(['save',input,type]);if(delay) await delay;if(fail) throw Error('conflict');return input.map(row=>({...row,version:row.version+1}));},
        async savePlan(plan) {calls.push(['planSave',plan]);return {...plan,id:'plan',version:1};},
        async listHistory() {return [];}
    };
    const window={GeoOperations:{createRepository:()=>repository}};
    vm.runInNewContext(source,{window});vm.runInNewContext(legacySource,{window});
    return {store:window.GeoCloudStore.create({},farm),calls,legacy:window.GeoLegacyImport};
}
test('carrega somente a fazenda ativa e distingue planejamento vazio',async()=>{
    const h=harness();await h.store.load();assert.deepEqual(h.calls,[['fields','FE'],['records','FE'],['plans','FE']]);
    assert.equal(h.store.getRecords().FE__T1__2026__SOJA__PLANTIO.id,'record');
    assert.equal(h.store.getPlanning().PLANTIO__FE__ALL__2026__SOJA__PLANTIO.length,0);
});
test('falha de gravação mantém cache anterior, sucesso usa versão do banco',async()=>{
    const failed=harness({fail:true});await failed.store.load();await assert.rejects(failed.store.saveRecords([{...record,status:'concluido'}],'plantio'));
    assert.equal(Object.values(failed.store.getRecords())[0].status,'nao_iniciado');
    const good=harness();await good.store.load();await good.store.saveRecords([{...record,status:'concluido'}],'plantio');
    assert.equal(Object.values(good.store.getRecords())[0].version,2);
});
test('bloqueia fazenda diferente e evita dois salvamentos concorrentes',async()=>{
    let release;const delay=new Promise(resolve=>release=resolve);const h=harness({delay});await h.store.load();
    await assert.rejects(h.store.saveRecords([{...record,fazenda:'FE2'}],'plantio'));
    const first=h.store.saveRecords([record],'plantio');
    await assert.rejects(h.store.saveRecords([record],'plantio'),/Aguarde/);release();await first;
    assert.equal(h.calls.filter(call=>call[0]==='save').length,1);
});
test('recusa dados de outra fazenda mesmo se o transporte retornar esses dados',async()=>{
    const h=harness({rows:[{...record,fazenda:'FE2'}]});await assert.rejects(h.store.load(),/fazenda diferente/);
});
test('importação antiga ignora demonstrações, fazendas não liberadas e registros existentes',()=>{
    const h=harness();const features=[{properties:{Fazenda:'FE',Campo:'T1'}},{properties:{Fazenda:'FE',Campo:'T2'}}];
    const preview=h.legacy.prepare({a:{...record,usuario:'Operador Inicial'},b:{...record,usuario:'Pessoa'},c:{...record,fazenda:'FE2',usuario:'Pessoa'},d:{...record,campo:'T2',usuario:'Pessoa'}},features,{FE__T1__2026__SOJA__PLANTIO:record},'FE');
    assert.equal(preview.skipped,3);assert.equal(preview.records.length,1);assert.equal(preview.records[0].campo,'T2');assert.equal(preview.records[0].id,undefined);assert.equal(preview.records[0].version,undefined);
});
