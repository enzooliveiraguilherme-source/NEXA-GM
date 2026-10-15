const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const F=require('../js/planting-forecast.js');
const feature=(farm,field,area)=>({properties:{Fazenda:farm,Campo:field,Area:area,Gleba:'FE'}});
function setup(role='admin'){
    const root={PlantingForecast:F,portalAccessRole:role,portalFarms:[{code:'RM',name:'Fazenda RM'},{code:'PA',name:'Fazenda PA'}],
        PlantingMaps:{active:s=>s.currentTab==='plantio'&&['data-estimada-colheita','variedades-plantadas'].includes(s.currentSubTab),palette:['#009640','#005eea']},
        featureMatchesFilters:f=>f.properties.Fazenda!=='OUT',SeedCycleCatalog:{available:true}};
    vm.runInNewContext(fs.readFileSync(require.resolve('../js/planting-report.js'),'utf8'),{window:root,Intl,Date,Map,Set,Blob,TextEncoder,Uint8Array,setTimeout,document:{}});
    const base={operationType:'plantio',produto:'Plantio',ano:'2026',cultura:'Soja',status:'concluido',variedadeSemente:'Olimpo',dataPlantio:'2026-10-09'};
    const features=[feature('RM','RM 01',100),feature('RM','RM 02',80),feature('PA','PA 01',40),feature('OUT','O1',900)];
    const records={a:{...base,fazenda:'RM',campo:'RM 01',areaRealizada:100},b:{...base,fazenda:'RM',campo:'RM 02',status:'em_andamento',areaRealizada:30},
        c:{...base,fazenda:'PA',campo:'PA 01',areaRealizada:40,variedadeSemente:'Sem ciclo'},
        wrongYear:{...base,ano:'2027',fazenda:'RM',campo:'RM 01',areaRealizada:1},wrongCulture:{...base,cultura:'Milho',fazenda:'RM',campo:'RM 02',areaRealizada:1}};
    const state={currentTab:'plantio',currentSubTab:'data-estimada-colheita',currentAno:'2026',currentCultura:'Soja',currentFazenda:'ALL',currentGleba:'FE',geojsonData:{features:[...features,features[0]]},cloudStore:{getRecords:()=>records}};
    return {api:root.PlantingReport,state,records,root};
}
test('relatório soma talhões por dia, variedade e fazenda usando somente execução filtrada',()=>{
    const {api,state,records}=setup(),before=JSON.stringify(records),data=api.snapshot(state);
    assert.equal(data.rows.length,3);assert.equal(data.totals.plantedArea,170);assert.equal(data.totals.estimatedArea,130);assert.equal(data.totals.withoutForecast,40);
    assert.equal(data.totals.days.length,1);assert.equal(data.totals.days[0].key,'2027-01-31');assert.equal(data.totals.days[0].area,130);assert.equal(data.totals.days[0].fields,2);
    assert.equal(data.totals.varieties.find(v=>v.key==='OLIMPO').area,130);
    assert.equal(data.farms.find(f=>f.code==='PA').totals.withoutForecast,40);assert.equal(data.farms.find(f=>f.code==='RM').totals.plantedArea,130);
    assert.equal(JSON.stringify(records),before);
});
test('previsões ordenadas têm área acumulada e mantêm pendências sem data/ciclo',()=>{
    const {api,state,records}=setup();records.b.dataPlantio='2026-10-10';records.c.dataPlantio='';
    const data=api.snapshot(state);assert.deepEqual(Array.from(data.totals.days,d=>d.accumulated),[100,130]);
    assert.equal(data.rows.find(r=>r.farm==='PA').reason,'Data de plantio não informada');
    records.a.status='nao_iniciado';assert.equal(api.snapshot(state).totals.plantedArea,70);
});
test('as duas abas geram os mesmos dados e visualizadores não exportam',()=>{
    const {api,state}=setup();const a=api.snapshot(state);state.currentSubTab='variedades-plantadas';
    assert.equal(api.snapshot(state).totals.plantedArea,a.totals.plantedArea);
    for(const role of ['visualizador',undefined]){const fixture=setup(role);fixture.root.portalAccessRole=role;assert.throws(()=>fixture.api.snapshot(fixture.state),/Somente Projetistas/);}
    state.currentTab='adubacao';assert.throws(()=>api.snapshot(state),/Abra Data/);
});
test('sem execução ou sem talhões gera aviso, nunca PDF vazio ou dados de planejamento',()=>{
    const {api,state}=setup();state.cloudStore.getRecords=()=>({});assert.throws(()=>api.snapshot(state),/Não há plantio executado/);
    state.geojsonData.features=[];assert.throws(()=>api.snapshot(state),/Não há talhões/);
});
test('nome do PDF identifica escopo, cultura, safra e emissão',()=>{
    const {api}=setup();assert.equal(api.filename({scope:'Gleba FE',culture:'Soja',year:'2026',isoDate:'2026-10-15'}),'plantio-variedades-colheita-gleba-fe-soja-2026-2026-10-15.pdf');
});
test('PDF multipágina contém catálogo, páginas e offsets válidos para cada objeto',async()=>{
    const {api}=setup(),blob=api.pdfFromImages([new Uint8Array([255,216,255,217]),new Uint8Array([255,216,255,217])]);
    assert.equal(blob.type,'application/pdf');const bytes=Buffer.from(await blob.arrayBuffer()),source=bytes.toString('latin1');
    assert.match(source,/\/Count 2/);assert.equal((source.match(/\/Type \/Page\b/g)||[]).length,2);
    const offset=Number(source.match(/startxref\n(\d+)/)[1]);assert.equal(source.slice(offset,offset+4),'xref');
    const entries=source.slice(offset).split('\n').slice(3,11);entries.forEach((line,i)=>assert.equal(source.slice(Number(line.slice(0,10)),Number(line.slice(0,10))+String(i+1).length+6),`${i+1} 0 obj`));
});
