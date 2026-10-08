const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const field = (farm, gleba) => ({properties:{Fazenda:farm, Gleba:gleba, Campo:'T1', Area:10}});

test('gleba FE mostra FE e FE2; filtro de fazenda restringe sem ocultar outras glebas', () => {
    const elements = new Map();
    const document = {addEventListener(){}, getElementById(id) {
        if (!elements.has(id)) elements.set(id,{value:'',children:[], appendChild(child){this.children.push(child);}, set innerHTML(text){this.children=[];}});
        return elements.get(id);
    }, createElement(){return {};}};
    const context = vm.createContext({window:{},document,console, Option:function(text,value){this.textContent=text;this.value=value;}});
    vm.runInContext(fs.readFileSync(require.resolve('../app.js'),'utf8'),context);
    const api = vm.runInContext('({state,populateFazendaFilter,populateGlebaFilter,featureMatchesFilters,PlanningManager})',context);
    api.state.geojsonData = {features:[field('FE','FE'),field('FE2','FE'),field('FPAR','FPAR')]};
    api.state.currentGleba='FE'; api.state.currentFazenda='ALL';
    api.populateFazendaFilter(api.state.geojsonData); api.populateGlebaFilter(api.state.geojsonData);
    assert.deepEqual(elements.get('fazenda-filter').children.map(item=>item.value),['ALL','FE','FE2']);
    assert.equal(api.state.geojsonData.features.filter(api.featureMatchesFilters).length,2);
    api.state.currentFazenda='FE2'; api.populateGlebaFilter(api.state.geojsonData);
    assert.equal(api.state.geojsonData.features.filter(api.featureMatchesFilters).length,1);
    assert.deepEqual(elements.get('gleba-filter').children.map(item=>item.value),['FE','FPAR']);
    api.state.currentTab='plantio';
    api.state.cloudStore={getPlanning:()=>({PLANTIO__FE__ALL__2026__SOJA__PLANTIO:['T1'],PLANTIO__FE2__ALL__2026__SOJA__PLANTIO:[]})};
    api.state.currentFazenda='ALL';
    assert.equal(api.PlanningManager.isTalhaoPlanned('FE','T1','2026','Soja','Plantio'),true);
    assert.equal(api.PlanningManager.isTalhaoPlanned('FE2','T1','2026','Soja','Plantio'),false);
});

test('carrega fazendas autorizadas separadas e preserva identidade em gravações e planos', async () => {
    const saved = [];
    const repository = {
        async listFields(farm){return [field(farm,'FE')];},
        async listFarmRecords(farm){return [{fazenda:farm,campo:'T1',ano:'2026',cultura:'Soja',produto:'Plantio'}];},
        async listFarmPlans(){return [];},
        async saveRecords(rows){saved.push(...rows); return rows;},
        async savePlan(plan){saved.push(plan); return plan;}
    };
    const context=vm.createContext({GeoOperations:{createRepository:()=>repository}});
    vm.runInContext(fs.readFileSync(require.resolve('../js/operations/cloud-store.js'),'utf8'),context);
    const store=context.GeoCloudStore.create({},['FE','FE2']);
    assert.equal((await store.load()).features.length,2);
    assert.equal(Object.keys(store.getRecords()).length,2);
    await store.saveRecords([{fazenda:'FE',campo:'T1'},{fazenda:'FE2',campo:'T1'}],'plantio');
    await assert.rejects(store.saveRecords([{fazenda:'FPAR',campo:'T1'}],'plantio'),/liberadas/);
    await store.savePlan({operationType:'plantio',fazenda:'FE2',ano:'2026',cultura:'Soja',produto:'Plantio'},['T1']);
    assert.equal(saved.at(-1).plannedFields[0].fazenda,'FE2');
});
