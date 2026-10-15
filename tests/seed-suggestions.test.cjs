const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function harness(){
    const list={children:[],set innerHTML(value){this.children=[];},appendChild(child){this.children.push(child);}};
    const events={};
    const document={addEventListener(){},createElement(){return {dataset:{},setAttribute(){},textContent:''};}};
    const catalog={rows:[{variety_name:'NEO 780',culture:'Soja',archived:false},{variety_name:'TESTE',culture:'Soja',archived:true}],names:['NEO 780'],isExcluded:(name,culture)=>culture==='Soja'&&String(name).replace(/\s/g,'').toUpperCase()==='TESTE'};
    const context=vm.createContext({document,window:{SeedCycleCatalog:catalog,addEventListener:(name,fn)=>{events[name]=fn;}},console});
    vm.runInContext(fs.readFileSync(require.resolve('../app.js'),'utf8'),context);
    const api=vm.runInContext('({state,AdubacaoModal})',context);
    api.state.currentTab='plantio';api.state.currentCultura='Soja';api.state.sharedSeedVarieties=['TESTE','NEO780','Olimpo'];
    api.state.geojsonData={features:[{properties:{Variedade:'teste'}},{properties:{Variedade:'NEO 780'}}]};
    const records={old:{variedadeSemente:'TESTE'},other:{variedadeSemente:'NEO780'}};
    api.state.cloudStore={getRecords:()=>records};api.AdubacaoModal.elements.listaVariedadesSemente=list;
    return {...api,list,records,catalog,events};
}
test('variedade excluída não reaparece pelas fontes compartilhada, mapa ou execução antiga',()=>{
    const h=harness(),before=JSON.stringify(h.records);
    h.AdubacaoModal.populateVariedadeSuggestions();
    assert.deepEqual(h.list.children.map(row=>row.dataset.value),['NEO 780','Olimpo']);
    assert.equal(JSON.stringify(h.records),before);
    h.AdubacaoModal.populateVariedadeSuggestions('teste');
    assert.equal(h.list.children.length,1);assert.equal(h.list.children[0].dataset.value,undefined);
});
test('nomes equivalentes são uma só opção com a grafia do catálogo e pesquisa ignora espaços',()=>{
    const h=harness();h.AdubacaoModal.populateVariedadeSuggestions('NEO780');
    assert.deepEqual(h.list.children.map(row=>row.dataset.value),['NEO 780']);
    h.AdubacaoModal.populateVariedadeSuggestions('neo 780');
    assert.deepEqual(h.list.children.map(row=>row.dataset.value),['NEO 780']);
});
test('restauração devolve a opção sem mexer no registro antigo',()=>{
    const h=harness();h.catalog.isExcluded=()=>false;h.catalog.rows[1].archived=false;
    h.AdubacaoModal.populateVariedadeSuggestions();assert.ok(h.list.children.some(row=>row.dataset.value==='TESTE'));
    assert.equal(h.records.old.variedadeSemente,'TESTE');
});
test('evento de exclusão atualiza sugestões de um formulário já aberto',()=>{
    const h=harness();h.AdubacaoModal.currentFeature={};
    h.events['geoportal:seed-cycles-changed']();
    assert.deepEqual(h.list.children.map(row=>row.dataset.value),['NEO 780','Olimpo']);
});
