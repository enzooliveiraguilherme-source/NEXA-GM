const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function setup(){
    const elements=new Map(),events=new Map(),pyramids=[],chunks=[],removed=[];
    let viewportFarm='FE2',zoom=16;
    const features=['FE2','RM'].map(Fazenda=>({properties:{Fazenda,Campo:'T1'}}));
    const datasets=['FE2','RM'].map(farm=>({farm,version:farm,source:'storage'}));
    const records=datasets.map(dataset=>({fazenda:dataset.farm,campo:'T1',chunks:['original/field.001.bin.gz'],dataset}));
    const map={getZoom:()=>zoom,getBounds:()=>viewportFarm,stop(){},fitBounds(){},removeLayer(layer){layer.remove?.();},
        on(names,fn){for(const name of names.split(' '))events.set(name,fn);return this;},
        off(names,fn){for(const name of names.split(' '))if(events.get(name)===fn)events.delete(name);return this;}};
    const group=()=>{const listeners=new Map();return {addTo(){return this;},once(name,fn){listeners.set(name,fn);},
        removeLayer(layer){removed.push(layer.farm);},remove(){listeners.get('remove')?.();}};};
    const L={layerGroup:group,geoJSON(data){return {getBounds(){return {intersects(farm){return data.features.some(f=>f.properties.Fazenda===farm);}};}};}};
    const document={getElementById(id){if(!elements.has(id))elements.set(id,{classList:{add(){},remove(){}},appendChild(){},value:''});return elements.get(id);},createElement(){return {};}};
    const root={featureMatchesFilters:()=>true,getFeatureStyle(){},HarvestLegend:{init(){},show(){}},
        HarvestPyramid:{async create(rows,fields,dataset){pyramids.push({farm:dataset.farm,rows:rows.map(r=>r.fazenda),fields:fields.map(f=>f.properties.Fazenda)});return {addTo(){}};}},
        HarvestPoints:{create(origin,fields){return {farm:fields[0].properties.Fazenda,addTo(){return this;},addPoints(){}};}},
        HarvestStore:{async loadChunk(dataset){chunks.push(dataset.farm);return {values:new Float64Array(8),stride:8,count:1};}}};
    vm.runInNewContext(fs.readFileSync(require.resolve('../js/harvest-view.js'),'utf8'),{window:root,document,L,AbortController,console});
    const state={map,currentTab:'colheita',harvestDataset:{datasets,version:'combined'},harvestSummary:{bounds:[0,0,1,1],records},harvestData:{features}};
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

test('seleção do T1 de RM não usa o T1 de FE2 nem altera o retorno pelo botão',async()=>{
    const s=setup();s.setZoom(12);await s.api.select(s.state,s.features[1]);
    assert.equal(s.state.harvestSelected,s.api.fieldKey(s.features[1]));
    assert.deepEqual(s.pyramids.map(p=>p.farm),['RM']);
    await s.api.select(s.state,s.features[1]);assert.equal(s.state.harvestSelected,s.api.fieldKey(s.features[1]));
    await s.elements.get('harvest-all').onclick();assert.equal(s.state.harvestSelected,null);
    s.api.clear(s.state);assert.equal(s.events.size,0);
});
