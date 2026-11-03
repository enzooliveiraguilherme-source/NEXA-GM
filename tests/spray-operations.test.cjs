const test = require('node:test');
const assert = require('node:assert/strict');
const SpraySchedule = require('../js/spray-schedule.js');
const PlantingForecast = require('../js/planting-forecast.js');
const Spray = require('../js/spray-operations.js');

function feature(farm, field, area) { return { properties: { Fazenda:farm, Campo:field, Area:area } }; }
function planting(id, farm, field, year='2026', culture='Soja', extra={}) {
    return { id, operationType:'plantio', produto:'Plantio', fazenda:farm, campo:field, ano:year, cultura:culture,
        status:'em_andamento', areaRealizada:60, variedadeSemente:'Olimpo', dataPlantio:'2026-11-01', ...extra };
}

test('build inclui talhões sem execução, deduplica geometrias e gera aplicações automáticas pelo contexto',()=>{
    const features=[feature('FE','FE 01',100),feature('FE','FE 01',90),feature('FE','FE 02',80),feature('FE','FE 03',50)];
    const records=[planting('p1','FE','FE 01'),planting('p2','FE','FE 02','2026','Soja',{dataPlantio:'',status:'concluido'}),
        planting('old','FE','FE 03','2025','Soja')];
    const result=Spray.build(features,records,[{plantingId:'p1',version:4,fourth:false,actuals:{post1:'2026-11-18'}}],[],
        {year:'2026',culture:'Soja'},'2026-11-01');
    assert.equal(result.fields.length,3);
    assert.deepEqual(result.fields.map(field=>[field.field,field.plantingId,field.plantedArea]),[['FE 01','p1',60],['FE 02','p2',60],['FE 03',null,0]]);
    assert.equal(result.applications.length,15);
    const independent=result.applications.filter(row=>row.independent);
    assert.equal(independent.length,9);
    assert.deepEqual(independent.filter(row=>row.field==='FE 01').map(row=>row.stage),['pre','boro','desiccation']);
    assert.deepEqual(independent.filter(row=>row.field==='FE 02').map(row=>row.stage),['pre','boro','desiccation']);
    assert.deepEqual(independent.filter(row=>row.field==='FE 03').map(row=>row.stage),['pre','boro','desiccation']);
    assert.equal(independent.find(row=>row.field==='FE 01'&&row.stage==='pre').plantingId,null);
    assert.equal(independent.find(row=>row.field==='FE 01'&&row.stage==='pre').unplanned,true);
    assert.equal(independent.find(row=>row.field==='FE 01'&&row.stage==='pre').status,'unplanned');
    assert.equal(independent.find(row=>row.field==='FE 02'&&row.stage==='boro').plantingId,null);
    assert.equal(independent.find(row=>row.field==='FE 02'&&row.stage==='boro').unplanned,true);
    const linked=result.applications.filter(row=>row.plantingId==='p1');
    assert.equal(linked.length,6);
    assert.deepEqual(linked.map(row=>row.stage),['post1','post2','fung1','fung2','fung3','fung4']);
    assert.equal(linked[0].planned,'2026-11-16');assert.equal(linked[0].actual,'2026-11-18');assert.equal(linked[0].status,'completed');
    assert.equal(linked[1].planned,'2026-11-28');assert.equal(linked[2].planned,'2026-12-08');assert.equal(linked[2].provisional,true);
    assert.ok(linked.every(row=>row.field==='FE 01'&&row.area===60));
    assert.equal(linked[5].optional,true);assert.equal(linked[5].status,'optional');
    assert.ok(Spray.applicationOptions(result.applications).some(option=>option.key==='fung4'));
    assert.ok(Spray.matrix(result.applications).columns.some(column=>column.key==='fung4'));
    assert.deepEqual(Spray.summarize(result.applications),{total:5,completed:1,pending:4,overdue:0,attention:0,scheduled:4,plannedArea:300,appliedArea:60});
});

test('build aplica metadados manuais e override de data, área, produto e dose sem ignorar a realização anterior',()=>{
    const features=[feature('FE','FE 01',100)];
    const records=[planting('p1','FE','FE 01')];
    const schedules=[{plantingId:'p1',version:7,fourth:false,actuals:{post1:'2026-11-18'}}];
    const saved=[
        {plantingId:'p1',stage:'post1',planned:'2026-11-20',area:25,product:'Herbicida A',dose:1.5,doseUnit:'L/ha',responsible:'Ana',notes:'Ajuste manual'},
        {plantingId:'p1',stage:'fung1',planned:'2026-12-20',product:'Fungicida B',dose:0.8,doseUnit:'kg/ha'},
        {id:'manual-1',farm:'FE',field:'FE 01',year:'2026',culture:'Soja',stage:'manual',name:'Dessecação',planned:'2026-11-10',area:100,actual:null,product:'Produto C',dose:2,doseUnit:'L/ha'}
    ];
    const result=Spray.build(features,records,schedules,saved,{year:'2026',culture:'Soja'},'2026-11-01');
    const post1=result.applications.find(row=>row.stage==='post1');
    const post2=result.applications.find(row=>row.stage==='post2');
    const fung1=result.applications.find(row=>row.stage==='fung1');
    const manual=result.applications.find(row=>row.id==='manual-1');
    assert.equal(post1.planned,'2026-11-20');assert.equal(post1.actual,'2026-11-18');assert.equal(post1.autoDate,false);
    assert.equal(post1.area,25);assert.equal(post1.product,'Herbicida A');assert.equal(post1.dose,1.5);
    assert.equal(post1.doseUnit,'L/ha');assert.equal(post1.responsible,'Ana');assert.equal(post1.notes,'Ajuste manual');
    assert.equal(post1.scheduleVersion,7);
    assert.equal(post2.planned,'2026-11-28');assert.equal(post2.autoDate,true);
    assert.equal(fung1.planned,'2026-12-20');assert.equal(fung1.autoDate,false);assert.equal(fung1.provisional,true);
    assert.equal(fung1.product,'Fungicida B');assert.equal(fung1.doseUnit,'kg/ha');
    assert.equal(manual.key,'manual-1');assert.equal(manual.status,'scheduled');assert.equal(manual.fieldKey,JSON.stringify(['FE','FE 01']));
});

test('build inclui a quarta aplicação por schedule ou metadado salvo e restringe cultura e safra',()=>{
    const features=[feature('FE','FE 01',100),feature('FE','FE 02',80)];
    const records=[planting('p1','FE','FE 01'),planting('p2','FE','FE 02','2026','Soja')];
    const schedules=[{plantingId:'p1',fourth:true,actuals:{}},{plantingId:'p2',fourth:false,actuals:{}}];
    const saved=[{plantingId:'p2',stage:'fung4',planned:'2027-02-01',product:'Fungicida D'}];
    const result=Spray.build(features,records,schedules,saved,{year:'2026',culture:'Soja'},'2026-11-01');
    assert.equal(result.applications.filter(row=>row.plantingId==='p1').length,6);
    assert.equal(result.applications.filter(row=>row.plantingId==='p2').length,6);
    assert.equal(result.applications.find(row=>row.plantingId==='p2'&&row.stage==='fung4').planned,'2027-02-01');
    assert.equal(result.applications.find(row=>row.plantingId==='p1'&&row.stage==='fung4').optional,false);
    assert.equal(result.applications.find(row=>row.plantingId==='p2'&&row.stage==='fung4').optional,false);
    const wrongContext=Spray.build(features,records,schedules,saved,{year:'2027',culture:'Milho'},'2026-11-01');
    assert.equal(wrongContext.fields.length,2);assert.equal(wrongContext.fields.every(field=>!field.plantingId),true);
    assert.equal(wrongContext.applications.length,6);
    assert.ok(wrongContext.applications.every(row=>row.independent&&!row.plantingId&&row.unplanned));
});

test('build considera aplicações manuais apenas dentro do contexto e nos talhões presentes',()=>{
    const features=[feature('FE','FE 01',100)];
    const saved=[
        {id:'m1',farm:'FE',field:'FE 01',year:'2026',culture:'Soja',name:'Aplicação livre',planned:'2026-11-20',area:40},
        {id:'m2',farm:'FE',field:'FE 01',year:'2025',culture:'Soja',name:'Safra antiga',planned:'2026-11-20',area:40},
        {id:'m3',farm:'FE',field:'FE 02',year:'2026',culture:'Soja',name:'Talhão fora',planned:'2026-11-20',area:40}
    ];
    const result=Spray.build(features,[],[],saved,{year:'2026',culture:'Soja'},'2026-11-01');
    assert.equal(result.applications.filter(row=>row.independent).length,3);
    assert.deepEqual(result.applications.filter(row=>row.id).map(row=>row.id),['m1']);
});

test('independentes são três por talhão, reconciliadas sem duplicar e persistem antes e depois do plantio',()=>{
    const features=[feature('FE','FE 01',100),feature('FE','FE 01',95)];
    const saved=[{farm:'FE',field:'FE 01',year:'2026',culture:'Soja',stage:'pre',planned:null,actual:'2026-10-20',area:40,product:'Pré herbicida'}];
    const beforePlanting=Spray.build(features,[],[],saved,{year:'2026',culture:'Soja'},'2026-11-01');
    assert.equal(beforePlanting.fields.length,1);assert.equal(beforePlanting.applications.length,3);
    const pre=beforePlanting.applications.find(row=>row.stage==='pre');
    assert.equal(pre.key, Spray.independentKey('FE','FE 01','2026','Soja','pre'));
    assert.equal(pre.plantingId,null);assert.equal(pre.actual,'2026-10-20');assert.equal(pre.planned,null);
    assert.equal(pre.unplanned,false);assert.equal(pre.status,'completed');assert.equal(pre.product,'Pré herbicida');
    assert.equal(Spray.summarize(beforePlanting.applications).total,1);
    assert.equal(Spray.summarize(beforePlanting.applications).appliedArea,40);
    const afterPlanting=Spray.build(features,[planting('p1','FE','FE 01')],[],saved,{year:'2026',culture:'Soja'},'2026-11-01');
    assert.equal(afterPlanting.fields.length,1);assert.equal(afterPlanting.applications.filter(row=>row.stage==='pre').length,1);
    assert.equal(afterPlanting.applications.length,9);
    const loaded=afterPlanting.applications.find(row=>row.stage==='pre');
    assert.equal(loaded.key,pre.key);assert.equal(loaded.actual,'2026-10-20');assert.equal(loaded.plantingId,null);
    assert.equal(afterPlanting.applications.find(row=>row.stage==='post1').planned,'2026-11-16');
});

test('independente com início informado sem previsão ou conclusão está em execução, não sem planejamento',()=>{
    const result=Spray.build([feature('FE','FE 01',100)],[],[],[
        {farm:'FE',field:'FE 01',year:'2026',culture:'Soja',stage:'pre',planned:null,actual:null,started:'2026-10-20'}
    ],{year:'2026',culture:'Soja'},'2026-11-01');
    const row=result.applications.find(item=>item.stage==='pre');
    assert.equal(row.started,'2026-10-20');
    assert.equal(row.unplanned,false);
    assert.equal(Spray.tableStatus(row,'2026-11-01'),'in_progress');
});

test('OK sem data conclui pré sem previsão, soma área aplicada e pinta o talhão concluído',()=>{
    const features=[feature('FE','FE 01',100)];
    const saved=[{farm:'FE',field:'FE 01',year:'2026',culture:'Soja',stage:'pre',planned:null,actual:null,
        completedWithoutDate:true,area:40,product:'Pré herbicida'}];
    const result=Spray.build(features,[],[],saved,{year:'2026',culture:'Soja'},'2026-11-01');
    const pre=result.applications.find(row=>row.stage==='pre');
    assert.equal(pre.planned,null);assert.equal(pre.actual,null);assert.equal(pre.completedWithoutDate,true);
    assert.equal(pre.unplanned,false);assert.equal(pre.status,'completed');assert.equal(Spray.isCompleted(pre),true);
    assert.deepEqual(Spray.summarize(result.applications),{total:1,completed:1,pending:0,overdue:0,attention:0,scheduled:0,plannedArea:40,appliedArea:40});
    assert.equal(Spray.mapStatus(result.applications,pre.fieldKey),'completed');
});

test('OK sem data conta como concluído mas não altera a base prevista das etapas seguintes',()=>{
    const features=[feature('FE','FE 01',100)],records=[planting('p1','FE','FE 01')];
    const saved=[{plantingId:'p1',stage:'post1',planned:null,actual:null,completedWithoutDate:true,area:40}];
    const result=Spray.build(features,records,[{plantingId:'p1',fourth:false,actuals:{},version:4}],saved,
        {year:'2026',culture:'Soja'},'2026-11-01');
    const post1=result.applications.find(row=>row.stage==='post1'),post2=result.applications.find(row=>row.stage==='post2');
    assert.equal(post1.status,'completed');assert.equal(post1.actual,null);assert.equal(post1.completedWithoutDate,true);
    assert.equal(post1.planned,'2026-11-16');
    assert.equal(post2.planned,'2026-11-26');assert.equal(post2.provisional,true);
    assert.equal(Spray.summarize(result.applications).completed,1);
    assert.equal(Spray.summarize(result.applications).appliedArea,40);
    assert.equal(Spray.mapStatus([post1],post1.fieldKey),'completed');
});

test('filter pesquisa sem acentos em fazenda, talhão e metadados, com filtros exatos e período inclusivo',()=>{
    const rows=[
        {farm:'São José',field:'Talhão 2',fieldKey:'f2',culture:'Soja',name:'Pós-emergente',product:'Herbicida Ágil',responsible:'José',notes:'Área norte',planned:'2026-11-10',status:'attention'},
        {farm:'São José',field:'Talhão 10',fieldKey:'f10',culture:'Milho',name:'Fungicida',product:'Produto B',responsible:'Ana',notes:'Sul',planned:'2026-11-20',status:'overdue'},
        {farm:'Outra',field:'Talhão 1',fieldKey:'o1',culture:'Soja',name:'Pós-emergente',product:'Produto C',responsible:'João',notes:'Leste',planned:'2026-12-01',status:'scheduled'},
        {farm:'FE',field:'Excluído',fieldKey:'del',culture:'Soja',name:'Pós',product:'X',responsible:'X',notes:'',planned:'2026-11-10',status:'completed',deleted:true}
    ];
    assert.deepEqual(Spray.filter(rows,{search:'jose'}).map(row=>row.field),['Talhão 2','Talhão 10']);
    assert.deepEqual(Spray.filter(rows,{search:'agil'}).map(row=>row.field),['Talhão 2']);
    assert.deepEqual(Spray.filter(rows,{farm:'São José',field:'f2',status:'attention',from:'2026-11-10',to:'2026-11-10'}).map(row=>row.field),['Talhão 2']);
    assert.deepEqual(Spray.filter(rows,{status:'overdue',from:'2026-11-20',to:'2026-11-20'}).map(row=>row.field),['Talhão 10']);
    assert.deepEqual(Spray.filter(rows,{deleted:true}).map(row=>row.field),['Excluído']);
    assert.equal(Spray.filter(rows).some(row=>row.deleted),false);
});

test('sort ordena datas, números e desempates sem alterar a lista de origem',()=>{
    const rows=[{key:'c',planned:'2026-11-02',area:5,dose:2,field:'FE 10'},{key:'b',planned:'2026-11-01',area:15,dose:1,field:'FE 2'},
        {key:'a',planned:'2026-11-01',area:8,dose:3,field:'FE 1'}];
    const original=[...rows];
    assert.deepEqual(Spray.sort(rows,'planned').map(row=>row.key),['a','b','c']);
    assert.deepEqual(Spray.sort(rows,'area',-1).map(row=>row.key),['b','a','c']);
    assert.deepEqual(Spray.sort(rows,'field').map(row=>row.field),['FE 1','FE 2','FE 10']);
    assert.deepEqual(rows,original);
});

test('summarize exclui removidas e soma área planejada e aplicada por aplicação',()=>{
    const rows=[
        {area:25,actual:'2026-11-18',status:'completed'},
        {area:25,actual:null,status:'overdue'},
        {area:40,actual:null,status:'attention'},
        {area:10,actual:null,status:'scheduled'},
        {area:200,actual:null,status:'unplanned',unplanned:true},
        {area:100,actual:'2026-11-18',status:'completed',deleted:true}
    ];
    assert.deepEqual(Spray.summarize(rows),{total:4,completed:1,pending:3,overdue:1,attention:1,scheduled:1,plannedArea:100,appliedArea:25});
});

test('mapStatus ignora aplicações opcionais, prioriza atraso/atenção e mantém verde para concluídas ou no prazo',()=>{
    const rows=[
        {fieldKey:'late',status:'overdue',actual:null},
        {fieldKey:'late',status:'attention',actual:null},
        {fieldKey:'attn',status:'attention',actual:null},
        {fieldKey:'attn',status:'completed',actual:'2026-11-10'},
        {fieldKey:'done',status:'completed',actual:'2026-11-10'},
        {fieldKey:'pending',status:'scheduled',actual:null},
        {fieldKey:'optional-only',status:'optional',actual:null,optional:true},
        {fieldKey:'pending',status:'overdue',actual:null,optional:true},
        {fieldKey:'empty',status:'overdue',actual:null,deleted:true}
    ];
    assert.equal(Spray.mapStatus(rows,'late',null),'pending');
    assert.equal(Spray.mapStatus(rows,'attn',null),'attention');
    assert.equal(Spray.mapStatus(rows,'done',null),'completed');
    assert.equal(Spray.mapStatus(rows,'pending',null),'scheduled');
    assert.equal(Spray.mapStatus([{fieldKey:'scheduled',status:'scheduled',actual:null}],'scheduled'),'scheduled');
    assert.equal(Spray.mapStatus([{fieldKey:'optional-only',status:'optional',actual:null,optional:true}],'optional-only'),'empty');
    assert.equal(Spray.mapStatus([{fieldKey:'unplanned-only',status:'unplanned',actual:null,unplanned:true}],'unplanned-only'),'empty');
    assert.equal(Spray.mapStatus(rows,'empty',null),'empty');
    assert.equal(Spray.mapStatus(rows,'late','late'),'pending');
    assert.equal(Spray.mapStatus(rows,'done','done'),'completed');
});

test('applicationKey e matchesApplication agrupam etapas e tipos manuais sem acentos',()=>{
    assert.equal(Spray.applicationKey({stage:'fung2',name:'Fungicida'}),'fung2');
    assert.equal(Spray.applicationKey({name:'  Aplicação   Manual  '}),'manual:APLICACAO MANUAL');
    assert.equal(Spray.matchesApplication({stage:'post1',name:'Pós-Emergente'},'post1'),true);
    assert.equal(Spray.matchesApplication({stage:'fung4',name:'4ª Aplicação'},'fungicide'),true);
    assert.equal(Spray.matchesApplication({stage:'manual',name:'Fungicida foliar'},'fungicide'),true);
    assert.equal(Spray.matchesApplication({stage:'manual',name:'Inseticida para soja'},'insecticide'),true);
    assert.equal(Spray.matchesApplication({stage:'manual',name:'Insecticide mix'},'insecticide'),true);
    assert.equal(Spray.matchesApplication({stage:'manual',name:'Aplicação adicional'},'fungicide'),false);
    assert.equal(Spray.matchesApplication({stage:'fung1',name:'Fungicida'},'all'),true);
    assert.equal(Spray.matchesApplication({stage:'fung1',name:'Fungicida'},''),true);
});

test('applicationOptions gera filtros dinâmicos únicos e mantém aplicações excluídas disponíveis para restauração',()=>{
    const rows=[
        {stage:'post1',name:'1ª Pós-Emergente',deleted:false},
        {stage:'fung1',name:'1º Fungicida',deleted:false},
        {stage:'fung4',name:'4º Fungicida',optional:true,deleted:false},
        {stage:'fung1',name:'Outro rótulo da mesma etapa',deleted:false},
        {name:'Inseticida',deleted:false},
        {name:'Fungicida foliar',deleted:false},
        {name:'Inseticida removido',deleted:true}
    ];
    const options=Spray.applicationOptions(rows);
    assert.deepEqual(options.slice(0,3),[
        {key:'all',label:'Todas'},{key:'fungicide',label:'Fungicidas'},{key:'insecticide',label:'Inseticidas'}
    ]);
    assert.equal(options.filter(option=>option.key==='fung1').length,1);
    assert.ok(options.some(option=>option.key==='fung4'&&option.label==='4º Fungicida'));
    assert.equal(options.some(option=>option.key==='manual:INSETICIDA REMOVIDO'),true);
    assert.ok(options.some(option=>option.key==='post1'&&option.label==='1ª Pós-Emergente'));
    assert.ok(options.some(option=>option.key==='manual:FUNGICIDA FOLIAR'));
});

test('matrix mantém aplicações duplicadas do mesmo tipo no mesmo talhão e remove filtros genéricos das colunas',()=>{
    const rows=[
        {key:'p1:post1',fieldKey:'FE01',farm:'FE',field:'FE 01',stage:'post1',name:'1ª Pós-Emergente'},
        {key:'p1:fung4',fieldKey:'FE01',farm:'FE',field:'FE 01',stage:'fung4',name:'4º Fungicida',optional:true},
        {key:'manual:a',fieldKey:'FE01',farm:'FE',field:'FE 01',name:'Fungicida foliar'},
        {key:'manual:b',fieldKey:'FE01',farm:'FE',field:'FE 01',name:'Fungicida foliar'},
        {key:'p2:fung1',fieldKey:'FE02',farm:'FE',field:'FE 02',stage:'fung1',name:'1º Fungicida'}
    ];
    const result=Spray.matrix(rows);
    assert.equal(result.columns.some(column=>['all','fungicide','insecticide'].includes(column.key)),false);
    assert.ok(result.columns.some(column=>column.key==='post1'));
    assert.ok(result.columns.some(column=>column.key==='fung4'));
    assert.ok(result.columns.some(column=>column.key==='manual:FUNGICIDA FOLIAR'));
    const fe01=result.rows.find(row=>row.key==='FE01');
    assert.equal(fe01.cells.get('manual:FUNGICIDA FOLIAR').length,2);
    assert.deepEqual(fe01.cells.get('manual:FUNGICIDA FOLIAR').map(row=>row.key),['manual:a','manual:b']);
    assert.equal(result.rows.find(row=>row.key==='FE02').cells.get('fung1').length,1);
});

test('tableStatus distingue conclusão, início, previsão manual, atraso e etapas sem plano',()=>{
    const current='2026-11-10';
    assert.equal(Spray.tableStatus({actual:'2026-11-09',started:'2026-11-08',planned:'2026-11-01'},current),'completed');
    assert.equal(Spray.tableStatus({completedWithoutDate:true},current),'completed');
    assert.equal(Spray.tableStatus({started:'2026-11-09',planned:'2026-11-01'},current),'in_progress');
    assert.equal(Spray.tableStatus({planned:'2026-11-09',autoDate:false},current),'overdue');
    assert.equal(Spray.tableStatus({planned:'2026-11-10',autoDate:false},current),'planned');
    assert.equal(Spray.tableStatus({planned:'2026-11-20',autoDate:true},current),'unplanned');
    assert.equal(Spray.tableStatus({planned:'2026-11-20',autoDate:false},current),'planned');
    assert.equal(Spray.tableStatus({optional:true,planned:'2026-11-01'},current),'unplanned');
});

test('filter combina funções fungicida/inseticida, etapas e aplicação manual definida pelo nome',()=>{
    const rows=[
        {key:'p1:post1',stage:'post1',field:'FE 01',farm:'FE',fieldKey:'FE01',name:'1ª Pós-Emergente',planned:'2026-11-10',status:'scheduled'},
        {key:'p1:fung1',stage:'fung1',field:'FE 01',farm:'FE',fieldKey:'FE01',name:'1º Fungicida',planned:'2026-11-20',status:'attention'},
        {key:'m1',field:'FE 01',farm:'FE',fieldKey:'FE01',name:'Inseticida foliar',planned:'2026-11-15',status:'scheduled'},
        {key:'m2',field:'FE 02',farm:'FE',fieldKey:'FE02',name:'Fungicida de resgate',planned:'2026-11-15',status:'overdue'},
        {key:'deleted',stage:'fung2',field:'FE 01',farm:'FE',fieldKey:'FE01',name:'2º Fungicida',planned:'2026-11-25',status:'scheduled',deleted:true}
    ];
    assert.deepEqual(Spray.filter(rows,{application:'fungicide'}).map(row=>row.key),['p1:fung1','m2']);
    assert.deepEqual(Spray.filter(rows,{application:'insecticide'}).map(row=>row.key),['m1']);
    assert.deepEqual(Spray.filter(rows,{application:'post1'}).map(row=>row.key),['p1:post1']);
    assert.deepEqual(Spray.filter(rows,{application:'manual:INSETICIDA FOLIAR'}).map(row=>row.key),['m1']);
    assert.deepEqual(Spray.filter(rows,{application:'fungicide',deleted:true}).map(row=>row.key),['deleted']);
    assert.deepEqual(Spray.filter(rows,{application:'fungicide',field:'FE01',from:'2026-11-15',to:'2026-11-20'}).map(row=>row.key),['p1:fung1']);
});

test('validate confere talhão, aplicação, datas, área, dose e limites dos metadados',()=>{
    const field={farm:'FE',field:'FE 01',area:100};
    const base={farm:'FE',field:'FE 01',name:'Pós-emergente',planned:'2026-11-20',actual:null,area:60,dose:0,product:'Herbicida',responsible:'Ana',notes:'OK'};
    assert.equal(Spray.validate(base,field,'2026-11-19'),true);
    assert.throws(()=>Spray.validate(base,null,'2026-11-19'),/talhão cadastrado/);
    assert.throws(()=>Spray.validate({...base,field:'FE 02'},field,'2026-11-19'),/talhão cadastrado/);
    assert.throws(()=>Spray.validate({...base,name:' '},field,'2026-11-19'),/Informe a aplicação/);
    assert.throws(()=>Spray.validate({...base,planned:'2026-02-30'},field,'2026-11-19'),/data programada válida/);
    assert.throws(()=>Spray.validate({...base,actual:'2026-02-30'},field,'2026-11-19'),/data realizada deve ser válida/);
    assert.throws(()=>Spray.validate({...base,actual:'2026-11-20'},field,'2026-11-19'),/não pode estar no futuro/);
    assert.throws(()=>Spray.validate({...base,area:0},field,'2026-11-19'),/área deve ser maior que zero/);
    assert.throws(()=>Spray.validate({...base,area:101},field,'2026-11-19'),/ultrapassar o talhão/);
    assert.throws(()=>Spray.validate({...base,area:NaN},field,'2026-11-19'),/área deve ser maior que zero/);
    assert.throws(()=>Spray.validate({...base,dose:-0.1},field,'2026-11-19'),/dose válida/);
    assert.throws(()=>Spray.validate({...base,dose:'abc'},field,'2026-11-19'),/dose válida/);
    assert.throws(()=>Spray.validate({...base,product:'x'.repeat(151)},field,'2026-11-19'),/tamanho dos textos/);
    assert.throws(()=>Spray.validate({...base,responsible:'x'.repeat(151)},field,'2026-11-19'),/tamanho dos textos/);
    assert.throws(()=>Spray.validate({...base,notes:'x'.repeat(2001)},field,'2026-11-19'),/tamanho dos textos/);
});

test('areaSummary partitions planned hectares, includes undated completion, and excludes inactive rows',()=>{
    const rows=[
        {area:10,status:'completed',actual:'2026-10-10'},
        {area:5,status:'completed',completedWithoutDate:true},
        {area:20,status:'attention'},
        {area:25,status:'scheduled'},
        {area:30,status:'overdue'},
        {area:100,status:'completed',actual:'2026-10-10',deleted:true},
        {area:200,status:'optional',optional:true},
        {area:300,status:'unplanned',unplanned:true}
    ];
    const result=Spray.areaSummary(rows);
    assert.equal(result.plannedArea,90);assert.equal(result.appliedArea,15);
    assert.equal(result.completed,2);assert.equal(result.overdueArea,30);
    assert.equal(result.onTimeArea,45);assert.equal(result.attentionArea,20);
    assert.equal(result.onTimeCount,2);assert.equal(result.overdue,1);
    assert.equal(result.appliedArea+result.overdueArea+result.onTimeArea,result.plannedArea);
    assert.ok(Math.abs(result.progress-100*15/90)<1e-9);
});

test('areaSummary returns zero-valued categories for an empty selection',()=>{
    const result=Spray.areaSummary([]);
    assert.equal(result.plannedArea,0);assert.equal(result.appliedArea,0);
    assert.equal(result.overdueArea,0);assert.equal(result.onTimeArea,0);
    assert.equal(result.attentionArea,0);assert.equal(result.progress,0);
});
