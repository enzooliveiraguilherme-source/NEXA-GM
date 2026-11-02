const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const operationsSource=fs.readFileSync(require.resolve('../js/spray-operations.js'),'utf8'),source=fs.readFileSync(require.resolve('../js/spray-report.js'),'utf8');
const SpraySchedule=require('../js/spray-schedule.js'),PlantingForecast=require('../js/planting-forecast.js');
function setup({role='admin',userRole='editor',application='all',rows:inputRows,features:inputFeatures}={}){
    const els=new Map(),downloads=[],drawCalls=[],pdfCalls=[],texts=[],canvases=[],fillCalls=[];let onProgress;
    class Element{constructor(id){this.id=id;this.hidden=false;this.disabled=false;this.href='';this.download='';this._text='';}
        set textContent(v){this._text=v;if(this.id==='spray-report-status'&&String(v).startsWith('Preparando página'))onProgress?.();}
        get textContent(){return this._text;}click(){downloads.push(this.download);}remove(){}}
    const ctx={font:'',fillStyle:'',strokeStyle:'',lineWidth:1,textAlign:'left',measureText:s=>({width:String(s).length*10}),fillText(s){texts.push(String(s));},beginPath(){},roundRect(){},fill(){},stroke(){},rect(){},clip(){},save(){},restore(){},moveTo(){},lineTo(){},closePath(){},fillRect(x,y,w,h){fillCalls.push({x,y,w,h,color:this.fillStyle});},drawImage(){}};
    const document={fonts:{ready:Promise.resolve()},body:{appendChild(){}},querySelector(){return null;},getElementById(id){if(!els.has(id))els.set(id,new Element(id));return els.get(id);},createElement(tag){if(tag==='canvas'){const canvas={width:0,height:0,getContext:()=>ctx,toBlob:fn=>fn({arrayBuffer:async()=>new ArrayBuffer(4)})};canvases.push(canvas);return canvas;}return new Element(tag);}};
    class Image{set src(_){this.onerror?.();}}
    const features=inputFeatures||[{properties:{Fazenda:'FE',Campo:'FE 01'},geometry:{type:'Polygon',coordinates:[]}}];
    const rows=inputRows||[
        {key:'a',farm:'FE',field:'FE 01',fieldKey:JSON.stringify(['FE','FE 01']),name:'1ª Pós-Emergente',stage:'post1',planned:'2026-10-10',actual:'2026-10-10',completedWithoutDate:false,area:10,status:'completed',deleted:false,optional:false,unplanned:false},
        {key:'b',farm:'FE',field:'FE 01',fieldKey:JSON.stringify(['FE','FE 01']),name:'1º Fungicida',stage:'fung1',planned:'2026-10-12',actual:null,area:10,status:'scheduled',deleted:false,optional:false,unplanned:false},
        {key:'deleted',farm:'FE',field:'FE 01',fieldKey:'f',name:'Excluída',stage:'x',planned:'2026-10-13',area:5,status:'scheduled',deleted:true},
        {key:'optional',farm:'FE',field:'FE 01',fieldKey:'f',name:'Opcional',stage:'fung4',planned:'2026-10-14',area:5,status:'optional',optional:true},
        {key:'unplanned',farm:'FE',field:'FE 01',fieldKey:'f',name:'Sem plano',stage:'pre',planned:null,area:5,status:'unplanned',unplanned:true}
    ];
    const state={currentTab:'pulverizacao',currentSubTab:'tabela-pulverizacao',currentAno:'2026',currentCultura:'Soja',currentFazenda:'ALL',currentGleba:'ALL',userRole};
    const window={SpraySchedule,PlantingForecast,portalAccessRole:role,portalFarms:[...new Set(features.map(f=>f.properties.Fazenda))].map(code=>({code,name:code==='FE'?'Fazenda Esperança':`Fazenda ${code}`})),PlantingReport:{pdfFromImages:images=>{pdfCalls.push(images);return new Blob(['pdf'],{type:'application/pdf'});}},OperationExport:{async drawMap(_ctx,config){drawCalls.push(config);return false;}},setTimeout,clearTimeout,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},addEventListener(){}};
    vm.runInNewContext(operationsSource,{window,Intl,Map,Set,Object,String,Number,Math,JSON});const O=window.SprayOperations;
    const SprayControl={reportData(){return {rows:rows.filter(r=>application==='all'||O.matchesApplication(r,application)),features,application,applicationLabel:application==='all'?'Todas':rows.find(r=>r.stage===application)?.name||application,filterLabels:['Status: No prazo']};},mapColors:{completed:'#1673d1',scheduled:'#169447',attention:'#f5c542',overdue:'#df3838',pending:'#df3838',empty:'#94a3b8'}};window.SprayControl=SprayControl;
    vm.runInNewContext(source,{window,document,Image,Date,Intl,Map,Set,Blob,Uint8Array,Number,String,Math,JSON,setTimeout,clearTimeout});
    return {api:window.SprayReport,state,els,downloads,document,drawCalls,pdfCalls,texts,canvases,fillCalls,setProgressHook(fn){onProgress=fn;}};
}
test('snapshot scopes rows, excludes deleted optional and unplanned, sums actual area and labels title',()=>{
    const h=setup({application:'post1'}),d=h.api.snapshot(h.state);
    assert.equal(d.title,'Resumo de aplicação - 1ª Pós-Emergente');assert.equal(d.rows.length,1);assert.equal(d.totals.completed,1);
    assert.equal(d.totals.appliedArea,10);assert.deepEqual(Array.from(d.filterLabels),['Status: No prazo']);
    assert.equal(h.api.filename(d),'resumo-de-aplicacao-1-pos-emergente-todas-as-glebas-soja-2026-'+d.isoDate+'.pdf');
});
test('fungicide and all applications use the application summary title',()=>{
    const f=setup({application:'fungicide'});assert.equal(f.api.snapshot(f.state).title,'Resumo de aplicação - Fungicidas');
    const h=setup();assert.equal(h.api.snapshot(h.state).title,'Resumo de aplicação - Pulverização');
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
test('render encodes one page for many farms and partitions planned hectares across four categories',async()=>{
    const features=[],rows=[];
    for(let i=1;i<=80;i++){
        const farm=`F${String(i).padStart(3,'0')}`,field=`Talhão ${i}`;features.push({properties:{Fazenda:farm,Campo:field},geometry:{type:'Polygon',coordinates:[]}});
        const statuses=['completed','attention','overdue','scheduled'];
        for(let j=0;j<statuses.length;j++)rows.push({key:`${farm}-${j}`,farm,field,fieldKey:JSON.stringify([farm,field]),name:`Aplicação com observação longa ${'texto '.repeat(35)}`,stage:`manual-${j}`,planned:'2026-10-10',actual:j===0?'2026-10-10':null,area:12,status:statuses[j],deleted:false,optional:false,unplanned:false,notes:'detalhe '.repeat(100)});
    }
    const h=setup({rows,features}),data=h.api.snapshot(h.state),result=await h.api.render(data);
    assert.equal(result.pageCount,1);assert.equal(h.canvases.length,1);assert.equal(h.pdfCalls.length,1);assert.equal(h.pdfCalls[0].length,1);
    assert.equal(h.drawCalls.length,1);assert.equal(h.drawCalls[0].fields.length,80);
    assert.equal(data.totals.total,320);assert.equal(data.totals.completed,80);assert.equal(data.totals.attention,80);
    assert.equal(data.totals.appliedArea+data.totals.overdueArea+data.totals.onTimeArea,data.totals.plannedArea);
    assert.equal(data.totals.appliedArea,960);assert.equal(data.totals.overdueArea,960);assert.equal(data.totals.onTimeArea,1920);
    assert.ok(h.texts.includes('Realizadas')&&h.texts.includes('No prazo')&&h.texts.includes('Próximas da data')&&h.texts.includes('Atrasadas'));
    assert.ok(h.texts.filter(text=>text==='960,00 ha').length>=4);
});

test('render preserves blue, green, yellow, red, and empty gray map colors with legend hectares',async()=>{
    const statuses=[['blue','completed','2026-10-10'],['green','scheduled',null],['yellow','attention',null],['red','overdue',null]];
    const features=statuses.map(([field])=>({properties:{Fazenda:'FE',Campo:field},geometry:{type:'Polygon',coordinates:[]}}));
    features.push({properties:{Fazenda:'FE',Campo:'empty'},geometry:{type:'Polygon',coordinates:[]}});
    const rows=statuses.map(([field,status,actual],i)=>({key:String(i),farm:'FE',field,fieldKey:JSON.stringify(['FE',field]),name:'Aplicação',stage:`stage-${i}`,planned:'2026-10-10',actual,area:[10,20,30,40][i],status,deleted:false,optional:false,unplanned:false}));
    rows.push({key:'ok-sem-data',farm:'FE',field:'blue',fieldKey:JSON.stringify(['FE','blue']),name:'Aplicação',stage:'pre',planned:null,actual:null,completedWithoutDate:true,area:5,status:'completed',deleted:false,optional:false,unplanned:false});
    const h=setup({rows,features}),data=h.api.snapshot(h.state),result=await h.api.render(data),fields=h.drawCalls[0].fields;
    assert.equal(result.pageCount,1);assert.equal(h.pdfCalls[0].length,1);
    assert.deepEqual(Array.from(fields,item=>item.color),['#1673d1','#169447','#f5c542','#df3838','#94a3b8']);
    assert.equal(data.totals.plannedArea,105);assert.equal(data.totals.appliedArea,15);
    assert.equal(data.totals.onTimeArea,50);assert.equal(data.totals.attentionArea,30);assert.equal(data.totals.overdueArea,40);
    assert.equal(data.totals.appliedArea+data.totals.onTimeArea+data.totals.overdueArea,data.totals.plannedArea);
    assert.ok(h.texts.includes('Realizadas')&&h.texts.includes('No prazo')&&h.texts.includes('Próximas da data')&&h.texts.includes('Atrasadas'));
    assert.ok(h.texts.includes('15,00 ha')&&h.texts.includes('20,00 ha')&&h.texts.includes('30,00 ha')&&h.texts.includes('40,00 ha'));
    const segments=h.fillCalls.filter(call=>call.y===445);
    assert.equal(segments.length,4);assert.ok(Math.abs(segments.reduce((sum,segment)=>sum+segment.w,0)-1112)<1e-9);
    assert.equal(segments[0].color,'#1673d1');assert.ok(Math.abs(segments[0].w-1112*15/105)<1e-9);
    assert.ok(Math.abs(segments[0].w-1112*data.totals.completed/data.totals.total)>100,'blue width follows hectares, not completed row count');
    assert.deepEqual(segments.map(segment=>segment.color),['#1673d1','#169447','#f5c542','#df3838']);
});

test('zero planned area renders one valid page without NaN or infinity',async()=>{
    const rows=[{key:'zero',farm:'FE',field:'FE 01',fieldKey:JSON.stringify(['FE','FE 01']),name:'Aplicação',stage:'post1',planned:'2026-10-10',actual:null,area:0,status:'scheduled',deleted:false,optional:false,unplanned:false}];
    const h=setup({rows}),data=h.api.snapshot(h.state),result=await h.api.render(data);
    assert.equal(data.totals.plannedArea,0);assert.equal(data.totals.progress,0);assert.equal(result.pageCount,1);assert.equal(h.pdfCalls[0].length,1);
    assert.ok(h.texts.includes('0,0%'));assert.ok(h.texts.every(text=>!/(?:NaN|Infinity)/.test(text)));
});
