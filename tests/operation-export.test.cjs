const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const field=(farm,campo,area)=>({properties:{Fazenda:farm,Campo:campo,Area:area}});
function setup(overrides={}){const root={...overrides};vm.runInNewContext(fs.readFileSync(require.resolve('../js/operation-export.js'),'utf8'),{window:root,document:{getElementById(){return null;},querySelector(){return null;}}});return root.OperationExport;}
test('resumo usa planejamento e progresso parcial, sem somar talhão duplicado',()=>{
    const api=setup(),a=field('FSAL','T1',100),b=field('F3R','T1',200),c=field('FSAL','T2',50),outside=field('FSAL','T3',300);
    const totals=api.summarize([a,b,c,outside,a],f=>f!==outside,f=>f===a?{status:'concluido'}:f===b?{status:'em_andamento',areaRealizada:40}:{status:'nao_iniciado'});
    assert.equal(totals.areaPlanejada,350);assert.equal(totals.areaRealizada,140);assert.equal(totals.progress,40);
    assert.equal(totals.fields.length,3);assert.equal(totals.areaAndamentoTotal,200);assert.equal(totals.areaAndamentoRealizada,40);
    assert.equal(totals.areaNaoIniciado,50);assert.equal(totals.countConcluido,1);
});
test('valores inválidos ou acima da área não fazem o percentual exceder 100%',()=>{
    const api=setup(),a=field('FE','T1',10),b=field('FE','T2',20);
    const totals=api.summarize([a,b],()=>true,f=>({status:'em_andamento',areaRealizada:f===a?99:-5}));
    assert.equal(totals.areaRealizada,10);assert.ok(totals.progress<=100);
    assert.equal(api.summarize([],()=>true,()=>({})).progress,0);
});
test('arquivo recebe operação, fazenda, cultura, ano e data da exportação',()=>{
    const api=setup();
    assert.equal(api.filename({operationName:'Adubação',scope:'FSAL / F3R',culture:'Soja',year:'2026',isoDate:'2026-10-13'}),'resumo-adubacao-fsal-f3r-soja-2026-2026-10-13.png');
});
test('snapshot de Adubação respeita os filtros e usa nome, cultura, ano e produto selecionados',()=>{
    const a=field('FE','T1',100),b=field('FE2','T1',200),other=field('RM','T1',900),calls=[];
    const api=setup({portalAccessRole:'projetista',portalFarms:[{code:'FE',name:'Fazenda Esperança'}],featureMatchesFilters:f=>f!==other,
        getTalhaoRecord(...args){calls.push(args);return {status:'concluido'};}});
    api.init({}, {isTalhaoPlanned:()=>true});
    const data=api.snapshot({currentTab:'adubacao',currentFazenda:'ALL',currentGleba:'FE',currentAno:'2026',currentCultura:'Soja',currentProduto:'Calcário',geojsonData:{features:[a,b,other]}});
    assert.equal(data.scopeName,'Fazenda Esperança');assert.equal(data.areaPlanejada,300);assert.equal(data.areaRealizada,300);
    assert.equal(data.product,'Calcário');assert.equal(data.year,'2026');assert.equal(data.culture,'Soja');
    assert.deepEqual(Array.from(data.farms),['FE','FE2']);assert.equal(calls[0][4],'Calcário');
    assert.throws(()=>api.snapshot({currentTab:'colheita'}),/Plantio e na Adubação/);
});
test('visualizadores e acessos sem perfil não podem gerar o resumo',()=>{
    for(const portalAccessRole of ['visualizador',undefined]){
        const api=setup({portalAccessRole});
        assert.throws(()=>api.snapshot({currentTab:'plantio'}),/Somente Projetistas/);
    }
});
test('administrador e projetista podem gerar o resumo',()=>{
    for(const portalAccessRole of ['admin','projetista']){
        const api=setup({portalAccessRole,featureMatchesFilters:()=>true,getTalhaoRecord:()=>({status:'concluido'})});
        api.init({}, {isTalhaoPlanned:()=>true});
        const data=api.snapshot({currentTab:'plantio',currentFazenda:'FE',currentGleba:'FE',currentAno:'2026',currentCultura:'Soja',currentProduto:'Plantio',geojsonData:{features:[field('FE','T1',100)]}});
        assert.equal(data.areaRealizada,100);
    }
});
