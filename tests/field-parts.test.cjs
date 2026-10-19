const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {prepareFields} = require('../scripts/prepare-farm-fields.cjs');
const Forecast = require('../js/planting-forecast.js');

const appSource=fs.readFileSync(require.resolve('../app.js'),'utf8');
const keyFunction=appSource.match(/function getRecordKey\(fazenda, campo, ano, cultura, produto\)\s*\{[\s\S]*?\n\}/)?.[0];
assert.ok(keyFunction,'getRecordKey precisa continuar disponível no app');
const getRecordKey=Function(`${keyFunction}; return getRecordKey;`)();
const cloudSource=fs.readFileSync(require.resolve('../js/operations/cloud-store.js'),'utf8');
const window={}; vm.runInNewContext(cloudSource,{window});
const recordKey=window.GeoCloudStore.recordKey;

function preparedPair(){
    const ring=(x)=>[[x,0],[x+1,0],[x+1,1],[x,0]];
    const features=[1,3].map(x=>({type:'Feature',properties:{Fazenda:'FE',Gleba:'FE',Campo:'FALG 11',Area:45.786},geometry:{type:'Polygon',coordinates:[ring(x)]}}));
    return prepareFields({type:'FeatureCollection',features}).rows.map(row=>row.feature);
}

test('chaves de operação distinguem campos preparados e ignoram variedade e data',()=>{
    const [first,second]=preparedPair();
    const records=[first,second].map((feature,index)=>({fazenda:feature.properties.Fazenda,campo:feature.properties.Campo,ano:'2026',cultura:'Soja',produto:'Plantio',variedadeSemente:index?'NEO 790':'Olimpo',dataPlantio:index?'2026-10-02':'2026-10-01'}));
    assert.notEqual(records[0].campo,records[1].campo);
    assert.notEqual(getRecordKey(records[0].fazenda,records[0].campo,records[0].ano,records[0].cultura,records[0].produto),getRecordKey(records[1].fazenda,records[1].campo,records[1].ano,records[1].cultura,records[1].produto));
    assert.notEqual(recordKey(records[0]),recordKey(records[1]));
    const base={fazenda:records[0].fazenda,campo:records[0].campo,ano:records[0].ano,cultura:records[0].cultura,produto:records[0].produto};
    assert.equal(getRecordKey(base.fazenda,base.campo,base.ano,base.cultura,base.produto),getRecordKey(base.fazenda,base.campo,base.ano,base.cultura,base.produto));
    assert.equal(recordKey(records[0]),recordKey({...records[0],variedadeSemente:'Outra',dataPlantio:'2027-01-20'}));
});

test('previsões isolam partes preparadas e projetam variedade e data de cada registro',()=>{
    const [first,second]=preparedPair();
    const records=[
        {status:'concluido',areaRealizada:45.786,variedadeSemente:'Olimpo',dataPlantio:'2026-10-01'},
        {status:'concluido',areaRealizada:45.786,variedadeSemente:'NEO 790',dataPlantio:'2026-10-02'}
    ];
    const keys=[first,second].map(feature=>Forecast.key(feature.properties.Fazenda,feature.properties.Campo,'2026','Soja'));
    assert.notEqual(keys[0],keys[1]);
    const rows=[Forecast.project(first,records[0],'Soja'),Forecast.project(second,records[1],'Soja')];
    assert.equal(rows[0].field,first.properties.Campo);
    assert.equal(rows[0].variety,'Olimpo'); assert.equal(rows[0].plantingDate,'2026-10-01'); assert.equal(rows[0].estimatedDate,'2027-01-23');
    assert.equal(rows[1].field,second.properties.Campo);
    assert.equal(rows[1].variety,'NEO 790'); assert.equal(rows[1].plantingDate,'2026-10-02'); assert.equal(rows[1].estimatedDate,'2027-01-24');
});

test('campos preparados permanecem selecionáveis e podem coexistir no planejamento',async()=>{
    const features=preparedPair();
    const planned=[];
    const repository={
        async listFields(){return features;}, async listFarmRecords(){return [];}, async listFarmPlans(){return [];},
        async savePlan(plan){planned.push(plan);return {...plan,id:'plan'};}
    };
    const scopedWindow={GeoOperations:{createRepository:()=>repository}};
    const scopedContext={window:scopedWindow}; vm.runInNewContext(cloudSource,scopedContext);
    const store=scopedWindow.GeoCloudStore.create({},'FE');
    const loaded=await store.load();
    const choices=loaded.features.map(feature=>feature.properties.Campo);
    assert.equal(new Set(choices).size,2);
    assert.deepEqual(Array.from(choices),features.map(feature=>feature.properties.Campo));
    const context={operationType:'plantio',fazenda:'FE',gleba:'FE',ano:'2026',cultura:'Soja',produto:'Plantio'};
    await store.savePlan(context,choices);
    assert.deepEqual(Array.from(planned[0].plannedFields,field=>field.campo),Array.from(choices));
    assert.deepEqual(Array.from(store.getPlanning().PLANTIO__FE__FE__2026__SOJA__PLANTIO),Array.from(choices));
});
