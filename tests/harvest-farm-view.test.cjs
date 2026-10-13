const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function setup(){
    const elements=new Map(),events=new Map(),pyramids=[],chunks=[],removed=[];
    let viewportFarm='FE2',zoom=16;
    const features=['FE2','RM'].map(Fazenda=>({properties:{Fazenda,Gleba:Fazenda==='FE2'?'FE':'RM',Campo:'T1'}}));
    const datasets=['FE2','RM'].map(farm=>({farm,version:farm,source:'storage'}));
    const records=datasets.map(dataset=>({fazenda:dataset.farm,campo:'T1',chunks:['original/field.001.bin.gz'],dataset}));
    const map={getZoom:()=>zoom,getBounds:()=>viewportFarm,stop(){},fitBounds(){},removeLayer(layer){layer.remove?.();},
        on(names,fn){for(const name of names.split(' '))events.set(name,fn);return this;},
        off(names,fn){for(const name of names.split(' '))if(events.get(name)===fn)events.delete(name);return this;}};
    const group=()=>{const listeners=new Map();return {addTo(){return this;},once(name,fn){listeners.set(name,fn);},
        removeLayer(layer){removed.push(layer.farm);},remove(){listeners.get('remove')?.();}};};
    const L={layerGroup:group,geoJSON(data){return {getBounds(){return {intersects(farm){return data.features.some(f=>f.properties.Fazenda===farm);}};}};}};
    const document={getElementById(id){if(!elements.has(id))elements.set(id,{classList:{add(){},remove(){},toggle(name,hidden){this[name]=hidden;}},children:[],appendChild(child){this.children.push(child);},set innerHTML(value){this.children=[];},value:''});return elements.get(id);},createElement(){return {};}};
    let state;
    const root={featureMatchesFilters:f=>(state.currentFazenda==='ALL'||f.properties.Fazenda===state.currentFazenda)&&(state.currentGleba==='ALL'||f.properties.Gleba===state.currentGleba),getFeatureStyle(){},HarvestLegend:{init(){},show(){}},
        refreshMapFilters(){root.HarvestView.refreshFilters(state);},updateFilterTag(){},renderMap(){return root.HarvestView.showAll(state);},
        HarvestPyramid:{async create(rows,fields,dataset){pyramids.push({farm:dataset.farm,rows:rows.map(r=>r.fazenda),fields:fields.map(f=>f.properties.Fazenda)});return {addTo(){}};}},
        HarvestPoints:{create(origin,fields){return {farm:fields[0].properties.Fazenda,addTo(){return this;},addPoints(){}};}},
        HarvestStore:{async loadChunk(dataset){chunks.push(dataset.farm);return {values:new Float64Array(8),stride:8,count:1};}}};
    vm.runInNewContext(fs.readFileSync(require.resolve('../js/harvest-view.js'),'utf8'),{window:root,document,L,AbortController,console});
    state={map,currentTab:'colheita',currentFazenda:'ALL',currentGleba:'ALL',harvestDataset:{datasets,version:'combined'},harvestSummary:{bounds:[0,0,1,1],records},harvestData:{features}};
    root.HarvestView.init(state);
    return {api:root.HarvestView,state,features,events,pyramids,chunks,removed,elements,setViewport(farm){viewportFarm=farm;},setZoom(value){zoom=value;}};
}

test('visão geral separa as fazendas e carrega pontos apenas da área visível',async()=>{
    const s=setup();await s.api.showAll(s.state);await new Promise(setImmediate);
    assert.deepEqual(s.pyramids.map(p=>p.farm),['FE2','RM']);
    assert.deepEqual(s.pyramids.map(p=>Array.from(p.fields)),[['FE2'],['RM']]);
    assert.deepEqual(s.chunks,['FE2']);
    s.setViewport('RM');s.events.get('moveend')();await new Promise(setImmediate);
    assert.deepEqual(s.chunks,['FE2','RM']);assert.deepEqual(s.removed,['FE2']);
    s.setZoom(12);s.events.get('zoomend')();assert.deepEqual(s.removed,['FE2','RM']);
});

test('campo Fazenda consulta a gleba e filtra talhões, contagem e produtividade',async()=>{
    const s=setup();s.setZoom(12);
    const farms=s.elements.get('harvest-gleba-select'),fields=s.elements.get('harvest-field-select');
    assert.equal(s.elements.get('harvest-gleba-filter').classList.hidden,false);
    assert.deepEqual(farms.children.map(o=>o.value),['FE','RM']);
    assert.deepEqual(fields.children.map(o=>o.textContent),['T1','T1']);
    assert.notEqual(fields.children[0].value,fields.children[1].value);
    assert.deepEqual(farms.children.map(o=>o.textContent),['FE','RM']);
    farms.value='RM';farms.onchange();await new Promise(setImmediate);
    assert.deepEqual(fields.children.map(o=>o.value),[s.api.fieldKey(s.features[1])]);
    assert.equal(s.elements.get('harvest-import-status').textContent,'1 talhão · Milho 2026');
    assert.equal(s.elements.get('harvest-farm-title').textContent,'RM');
    assert.deepEqual(s.pyramids.map(p=>p.farm),['RM']);
    await fields.onchange();assert.equal(s.state.harvestSelected,null);
    farms.value='ALL';farms.onchange();await new Promise(setImmediate);
    assert.equal(fields.children.length,2);
    assert.equal(s.elements.get('harvest-import-status').textContent,'2 talhões · Milho 2026');
});

test('uma gleba é automática; sem gleba cadastrada permanece apenas a escolha de talhão',()=>{
    const s=setup();s.state.harvestData.features=[s.features[1]];
    s.api.refreshFilters(s.state);
    assert.equal(s.state.currentGleba,'RM');
    assert.equal(s.state.currentFazenda,'ALL');
    assert.equal(s.elements.get('harvest-gleba-select').value,'RM');
    assert.equal(s.elements.get('harvest-field-select').children[0].textContent,'T1');
    s.state.harvestData.features=[{properties:{Campo:'Avulso'}}];
    s.api.refreshFilters(s.state);
    assert.equal(s.state.currentFazenda,'ALL');
    assert.equal(s.elements.get('harvest-gleba-filter').classList.hidden,true);
    assert.equal(s.elements.get('harvest-field-select').children[0].textContent,'Avulso');
    s.state.harvestData.features=[];s.api.refreshFilters(s.state);
    assert.equal(s.elements.get('harvest-field-select').children.length,0);
});

test('selecionar FE inclui FE e FE2 juntas e voltar de um talhão mantém a gleba',async()=>{
    const s=setup();s.setZoom(12);
    const feature={properties:{Fazenda:'FE',Gleba:'FE',Campo:'T1'}};
    s.state.harvestData.features.push(feature);
    const dataset={farm:'FE',version:'FE',source:'storage'};
    s.state.harvestSummary.records.push({fazenda:'FE',campo:'T1',chunks:[],dataset});
    s.api.refreshFilters(s.state);
    const selector=s.elements.get('harvest-gleba-select');selector.value='FE';selector.onchange();await new Promise(setImmediate);
    assert.equal(s.state.currentGleba,'FE');assert.equal(s.state.currentFazenda,'ALL');
    assert.deepEqual(s.pyramids.map(p=>p.farm),['FE2','FE']);
    assert.equal(s.elements.get('harvest-field-select').children.length,2);
    assert.equal(s.elements.get('harvest-farm-title').textContent,'FE');
    await s.api.select(s.state,feature);await s.elements.get('harvest-all').onclick();
    assert.equal(s.state.currentGleba,'FE');
    assert.equal(s.pyramids.some(p=>p.farm==='RM'),false);
});

test('seleção do T1 de RM não usa o T1 de FE2 nem altera o retorno pelo botão',async()=>{
    const s=setup();s.setZoom(12);await s.api.select(s.state,s.features[1]);
    assert.equal(s.state.harvestSelected,s.api.fieldKey(s.features[1]));
    assert.deepEqual(s.pyramids.map(p=>p.farm),['RM']);
    await s.api.select(s.state,s.features[1]);assert.equal(s.state.harvestSelected,s.api.fieldKey(s.features[1]));
    await s.elements.get('harvest-all').onclick();assert.equal(s.state.harvestSelected,null);
    s.api.clear(s.state);assert.equal(s.events.size,0);
});
