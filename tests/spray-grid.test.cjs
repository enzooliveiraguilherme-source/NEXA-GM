const test=require('node:test');
const assert=require('node:assert/strict');
const Schedule=require('../js/spray-schedule.js');
const PlantingForecast=require('../js/planting-forecast.js');
const Operations=require('../js/spray-operations.js');
const Grid=require('../js/spray-grid.js');

function field(farm='FE',name='FE 01',area=100,plantingDate='2026-11-01') { return {farm,field:name,area,plantingDate}; }
function app(plantingId,stage,extra={}) {
    const step=Schedule.steps.find(item=>item.id===stage);
    return {key:plantingId?`${plantingId}:${stage}`:`manual:${extra.name}`,id:plantingId?undefined:`manual:${extra.name}`,
        plantingId:plantingId||null,stage,farm:'FE',field:'FE 01',fieldKey:Operations.fieldKey('FE','FE 01'),name:step?.name||extra.name,
        planned:'2026-11-16',actual:null,autoDate:!!plantingId,area:50,product:'Produto',dose:1,doseUnit:'L/ha',responsible:'Ana',notes:'',
        scheduleVersion:1,...extra};
}
function schedule(id='p1',version=1,actuals={}) { return {plantingId:id,actuals:{...actuals},fourth:false,version}; }
function independent(stage,extra={}) {
    const key=Operations.independentKey('FE','FE 01','2026','Soja',stage);
    return {key,id:key,plantingId:null,stage,independent:true,farm:'FE',field:'FE 01',year:'2026',culture:'Soja',
        name:Operations.independentSteps.find(step=>step.id===stage).name,planned:null,actual:null,unplanned:true,area:100,dose:null,doseUnit:'L/ha',product:'',responsible:'',notes:'',...extra};
}

test('drafts editam campos permitidos, ignoram colunas somente leitura, expõem size/has/rows e limpam',()=>{
    const grid=Grid.create(),row=app('p1','post1'),farmField=field();
    grid.edit(row,farmField,schedule(), 'product','Herbicida X');
    grid.edit(row,farmField,schedule(), 'status','overdue');
    grid.edit(row,farmField,schedule(), 'name','Nome alterado');
    assert.equal(grid.size,1);assert.equal(grid.has(row.key),true);
    assert.equal(grid.rows()[0].product,'Herbicida X');
    assert.equal(grid.rows()[0].name,row.name);assert.equal(grid.rows()[0].status,undefined);
    grid.clear();assert.equal(grid.size,0);assert.equal(grid.has(row.key),false);assert.deepEqual(grid.rows(),[]);
});

test('drafts de várias etapas do talhão recalculam previsões em sequência sem alterar origem',()=>{
    const grid=Grid.create(),farmField=field();
    const post1=app('p1','post1',{planned:'2026-11-16'}),post2=app('p1','post2',{planned:'2026-11-26'});
    const originalSchedule=schedule('p1',7,{}),before=JSON.stringify(originalSchedule);
    grid.edit(post1,farmField,originalSchedule,'actual','2026-11-18');
    grid.edit(post2,farmField,originalSchedule,'actual','2026-11-30');
    assert.equal(grid.size,2);
    const projected=grid.project([originalSchedule],[]);
    assert.deepEqual(projected.schedules[0].actuals,{post1:'2026-11-18',post2:'2026-11-30'});
    const features=[{properties:{Fazenda:'FE',Campo:'FE 01',Area:100}}];
    const records=[{id:'p1',operationType:'plantio',produto:'Plantio',fazenda:'FE',campo:'FE 01',ano:'2026',cultura:'Soja',
        status:'concluido',areaRealizada:50,variedadeSemente:'Olimpo',dataPlantio:'2026-11-01'}];
    const preview=Operations.build(features,records,projected.schedules,projected.saved,{year:'2026',culture:'Soja'},'2026-11-01');
    assert.equal(preview.applications.find(row=>row.stage==='post1').actual,'2026-11-18');
    assert.equal(preview.applications.find(row=>row.stage==='post2').actual,'2026-11-30');
    assert.equal(preview.applications.find(row=>row.stage==='fung1').planned,'2026-12-10');
    assert.equal(originalSchedule.actuals.post1,undefined);assert.equal(JSON.stringify(originalSchedule),before);
});

test('limpar duas realizações de uma vez valida o estado final e rejeita o estado intermediário',()=>{
    const grid=Grid.create(),farmField=field('FE','FE 01',100,'2026-10-01'),savedSchedule=schedule('p1',4,{post1:'2026-10-18',post2:'2026-10-28'});
    const post1=app('p1','post1',{planned:'2026-10-16',actual:'2026-10-18'});
    const post2=app('p1','post2',{planned:'2026-10-28',actual:'2026-10-28'});
    grid.edit(post1,farmField,savedSchedule,'actual','');
    assert.throws(()=>grid.validate(),/registre primeiro a data realizada da aplicação anterior/);
    grid.edit(post2,farmField,savedSchedule,'actual','');
    assert.equal(grid.validate().length,2);
    const projected=grid.project([savedSchedule],[]);
    assert.deepEqual(projected.schedules[0].actuals,{post1:'',post2:''});
    assert.equal(projected.schedules[0].version,4);
});

test('versões base permanecem estáveis após recarregar fonte e drafts de talhões distintos ficam isolados',()=>{
    const grid=Grid.create(),fe1=field('FE','FE 01'),fe2=field('FE','FE 02',80),p1post1=app('p1','post1'),p1post2=app('p1','post2'),p2post1=app('p2','post1',{field:'FE 02',fieldKey:Operations.fieldKey('FE','FE 02')});
    grid.edit(p1post1,fe1,schedule('p1',3),'product','A');
    grid.edit(p1post2,fe1,schedule('p1',99),'dose',2.5);
    grid.edit(p2post1,fe2,schedule('p2',8),'product','B');
    assert.equal(grid.size,3);
    assert.deepEqual(grid.rows().map(row=>[row.plantingId,row.scheduleVersion,row.product,row.dose]),[
        ['p1',3,'A',1],['p1',3,'Produto',2.5],['p2',8,'B',1]
    ]);
    assert.doesNotThrow(()=>grid.validate());
    const next=grid.project([schedule('p1',99),schedule('p2',9)],[]);
    assert.deepEqual(next.schedules.map(item=>[item.plantingId,item.version]),[['p1',99],['p2',9]]);
    assert.equal(next.saved.find(row=>row.plantingId==='p1'&&row.stage==='post2').dose,2.5);
    assert.equal(next.saved.find(row=>row.plantingId==='p2'&&row.stage==='post1').product,'B');
});

test('draft manual valida área e aplica alterações em saved sem tocar no cronograma',()=>{
    const grid=Grid.create(),farmField=field(),row=app(null,'manual',{id:'m1',key:'m1',name:'Inseticida 3',plantingId:null,stage:'manual',area:120,dose:null,actual:null,autoDate:false});
    grid.edit(row,farmField,null,'product','Inseticida X');
    assert.throws(()=>grid.validate(),/FE \/ FE 01 · Inseticida 3: A área deve ser maior que zero e não pode ultrapassar o talhão/);
    grid.edit(row,farmField,null,'area',80);
    assert.equal(grid.validate().length,1);
    const projected=grid.project([],[]);
    assert.equal(projected.schedules.length,0);
    assert.equal(projected.saved[0].id,'m1');assert.equal(projected.saved[0].area,80);assert.equal(projected.saved[0].product,'Inseticida X');
});

test('projetar o 4º fungicida ativa a quarta etapa mesmo com fourth false na fonte original',()=>{
    const grid=Grid.create(),farmField=field(),original=schedule('p1',5,{}),fung4=app('p1','fung4',{optional:true,planned:'2027-02-01',autoDate:false});
    grid.edit(fung4,farmField,original,'product','Fungicida D');
    const projected=grid.project([original],[]);
    assert.equal(original.fourth,false);
    assert.equal(projected.schedules[0].fourth,true);
    const feature={properties:{Fazenda:'FE',Campo:'FE 01',Area:100}};
    const record={id:'p1',operationType:'plantio',produto:'Plantio',fazenda:'FE',campo:'FE 01',ano:'2026',cultura:'Soja',
        status:'concluido',areaRealizada:50,variedadeSemente:'Olimpo',dataPlantio:'2026-11-01'};
    const result=Operations.build([feature],[record],projected.schedules,projected.saved,{year:'2026',culture:'Soja'},'2026-11-01');
    const fourth=result.applications.find(row=>row.stage==='fung4');
    assert.equal(fourth.optional,false);assert.equal(fourth.planned,'2027-02-01');assert.equal(fourth.product,'Fungicida D');
});

test('drafts independentes usam chave por talhão/safra/cultura/etapa e permitem realização pré-plantio sem agenda',()=>{
    const grid=Grid.create(),farmField=field(),pre=independent('pre',{area:40}),boro=independent('boro'),desiccation=independent('desiccation');
    grid.edit(pre,farmField,null,'actual','2026-10-20');
    grid.edit(boro,farmField,null,'planned','2026-10-25');
    grid.edit(desiccation,farmField,null,'actual','2026-10-30');
    assert.equal(grid.size,3);
    assert.deepEqual(grid.rows().map(row=>row.key),[
        Operations.independentKey('FE','FE 01','2026','Soja','pre'),
        Operations.independentKey('FE','FE 01','2026','Soja','boro'),
        Operations.independentKey('FE','FE 01','2026','Soja','desiccation')
    ]);
    assert.equal(grid.validate().length,3);
    const projected=grid.project([],[]);
    assert.deepEqual(projected.schedules,[]);
    assert.equal(projected.saved.length,3);
    assert.equal(projected.saved[0].planned,null);assert.equal(projected.saved[0].actual,'2026-10-20');
    assert.equal(projected.saved[1].planned,'2026-10-25');
    assert.equal(projected.saved[2].planned,null);assert.equal(projected.saved[2].actual,'2026-10-30');
    assert.equal(projected.saved[0].key,Operations.independentKey('FE','FE 01','2026','Soja','pre'));
});
