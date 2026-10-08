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
        async saveRecords(input,type) {calls.push(['save',input,type]);if(delay) await delay;if(fail) throw Error('conflict');return input.map(row=>({...row,version:(row.version||0)+1}));},
        async savePlan(plan) {calls.push(['planSave',plan]);return {...plan,id:'plan',version:1};},
        async listHistory() {return [];}
    };
    const window={GeoOperations:{createRepository:()=>repository},portalFarm:{code:farm}};
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

test('recupera registro antigo do Operador Inicial sem apagar a cópia ou substituir dados do banco',async()=>{
    const h=harness({rows:[]}); const features=await h.store.load();
    const old={...record,status:'concluido',usuario:'Operador Inicial'};
    const state={geojsonData:features,cloudStore:h.store};
    assert.equal(await h.legacy.restore(state,{a:old}),1);
    assert.equal(Object.values(h.store.getRecords())[0].status,'concluido');
    assert.equal(old.id,'record'); assert.equal(old.version,1);
    assert.equal(await h.legacy.restore(state,{a:{...old,status:'nao_iniciado'}}),0);
    assert.equal(Object.values(h.store.getRecords())[0].status,'concluido');
});

test('falha de recuperação preserva registro antigo e não apresenta gravação falsa',async()=>{
    const h=harness({rows:[],fail:true}); const features=await h.store.load();
    const old={...record,status:'concluido',usuario:'Operador Inicial'};
    await assert.rejects(h.legacy.restore({geojsonData:features,cloudStore:h.store},{a:old}),/conflict/);
    assert.equal(Object.keys(h.store.getRecords()).length,0);
    assert.equal(old.status,'concluido');
});
