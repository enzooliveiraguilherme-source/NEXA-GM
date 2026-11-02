const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const operationsSource=fs.readFileSync(require.resolve('../js/spray-operations.js'),'utf8'),source=fs.readFileSync(require.resolve('../js/spray-report.js'),'utf8');
const SpraySchedule=require('../js/spray-schedule.js'),PlantingForecast=require('../js/planting-forecast.js');
function setup({role='admin',userRole='editor',application='all',rows:inputRows}={}){
    const els=new Map(),downloads=[];let onProgress;
    class Element{constructor(id){this.id=id;this.hidden=false;this.disabled=false;this.href='';this.download='';this._text='';}
        set textContent(v){this._text=v;if(this.id==='spray-report-status'&&String(v).startsWith('Preparando página'))onProgress?.();}
        get textContent(){return this._text;}click(){downloads.push(this.download);}remove(){}}
    const ctx={font:'',fillStyle:'',strokeStyle:'',lineWidth:1,textAlign:'left',measureText:s=>({width:String(s).length*10}),fillText(){},beginPath(){},roundRect(){},fill(){},stroke(){},rect(){},clip(){},save(){},restore(){},moveTo(){},lineTo(){},closePath(){},fillRect(){},drawImage(){}};
    const document={fonts:{ready:Promise.resolve()},body:{appendChild(){}},getElementById(id){if(!els.has(id))els.set(id,new Element(id));return els.get(id);},createElement(tag){if(tag==='canvas')return {width:0,height:0,getContext:()=>ctx,toBlob:fn=>fn({arrayBuffer:async()=>new ArrayBuffer(4)})};return new Element(tag);}};
    class Image{set src(_){this.onerror?.();}}
    const features=[{properties:{Fazenda:'FE',Campo:'FE 01'},geometry:{type:'Polygon',coordinates:[]}}];
    const rows=inputRows||[
        {key:'a',farm:'FE',field:'FE 01',fieldKey:JSON.stringify(['FE','FE 01']),name:'1ª Pós-Emergente',stage:'post1',planned:'2026-10-10',actual:'2026-10-10',completedWithoutDate:false,area:10,status:'completed',deleted:false,optional:false,unplanned:false},
        {key:'b',farm:'FE',field:'FE 01',fieldKey:JSON.stringify(['FE','FE 01']),name:'1º Fungicida',stage:'fung1',planned:'2026-10-12',actual:null,area:10,status:'scheduled',deleted:false,optional:false,unplanned:false},
        {key:'deleted',farm:'FE',field:'FE 01',fieldKey:'f',name:'Excluída',stage:'x',planned:'2026-10-13',area:5,status:'scheduled',deleted:true},
        {key:'optional',farm:'FE',field:'FE 01',fieldKey:'f',name:'Opcional',stage:'fung4',planned:'2026-10-14',area:5,status:'optional',optional:true},
        {key:'unplanned',farm:'FE',field:'FE 01',fieldKey:'f',name:'Sem plano',stage:'pre',planned:null,area:5,status:'unplanned',unplanned:true}
    ];
    const state={currentTab:'pulverizacao',currentSubTab:'tabela-pulverizacao',currentAno:'2026',currentCultura:'Soja',currentFazenda:'ALL',currentGleba:'ALL',userRole};
    const window={SpraySchedule,PlantingForecast,portalAccessRole:role,portalFarms:[{code:'FE',name:'Fazenda Esperança'}],PlantingReport:{pdfFromImages:()=>new Blob(['pdf'],{type:'application/pdf'})},setTimeout,clearTimeout,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},addEventListener(){}};
    vm.runInNewContext(operationsSource,{window,Intl,Map,Set,Object,String,Number,Math,JSON});const O=window.SprayOperations;
    const SprayControl={reportData(){return {rows:rows.filter(r=>application==='all'||O.matchesApplication(r,application)),features,application,applicationLabel:application==='all'?'Todas':rows.find(r=>r.stage===application)?.name||application,filterLabels:['Status: No prazo']};},mapColors:{completed:'#1673d1',scheduled:'#169447',attention:'#ad8c00',overdue:'#bb2020',pending:'#bb2020',empty:'#ddd'}};window.SprayControl=SprayControl;
    vm.runInNewContext(source,{window,document,Image,Date,Intl,Map,Set,Blob,Uint8Array,Number,String,Math,JSON,setTimeout,clearTimeout});
    return {api:window.SprayReport,state,els,downloads,document,setProgressHook(fn){onProgress=fn;}};
}
test('snapshot scopes rows, excludes deleted optional and unplanned, sums actual area and labels title',()=>{
    const h=setup({application:'post1'}),d=h.api.snapshot(h.state);
    assert.equal(d.title,'Andamento da 1ª Pós-Emergente');assert.equal(d.rows.length,1);assert.equal(d.totals.completed,1);
    assert.equal(d.totals.appliedArea,10);assert.deepEqual(Array.from(d.filterLabels),['Status: No prazo']);
    assert.equal(h.api.filename(d),'andamento-da-1-pos-emergente-todas-as-glebas-soja-2026-'+d.isoDate+'.pdf');
});
test('fungicide and all applications use their requested report titles',()=>{
    const f=setup({application:'fungicide'});assert.equal(f.api.snapshot(f.state).title,'Andamento dos fungicidas');
    const h=setup();assert.equal(h.api.snapshot(h.state).title,'Andamento da pulverização');
});
test('snapshot blocks viewer, non-editor, and non-spraying tab',()=>{
    for(const [role,userRole,tab] of [['visualizador','editor','pulverizacao'],['admin','viewer','pulverizacao'],['admin','editor','plantio']]){
        const h=setup({role,userRole});h.state.currentTab=tab;assert.throws(()=>h.api.snapshot(h.state));
    }
});
test('revocation during PDF generation prevents download',async()=>{
    const h=setup();h.setProgressHook(()=>{h.state.userRole='viewer';});
    await h.api.download(h.state);
    assert.equal(h.downloads.length,0);assert.match(h.els.get('spray-report-status').textContent,/não permite exportar/i);
});
