const test = require('node:test');
const assert = require('node:assert/strict');
const Schedule = require('../js/spray-schedule.js');
const Operations = require('../js/spray-operations.js');
const Grid = require('../js/spray-grid.js');

const planted = '2026-11-01';
const current = '2026-12-01';
const field = { farm:'FE', field:'FE 01', area:100, plantingDate:planted };
const schedule = actuals => ({ plantingId:'p1', actuals:{...actuals}, fourth:false, version:1, plantingDate:planted });
const app = stage => ({ key:`p1:${stage}`, plantingId:'p1', stage, farm:'FE', field:'FE 01', name:Schedule.steps.find(s=>s.id===stage).name,
    planned:stage==='post1'?'2026-11-16':'2026-11-16', actual:null, autoDate:true, area:50, dose:1, doseUnit:'L/ha', product:'Produto', responsible:'Ana', notes:'' });

test('todas as etapas aceitam conclusão anterior à previsão automática ou manual', () => {
    const reference='2026-11-23',actual='2026-11-06',planned='2026-12-01';
    for(const stage of ['post1','post2','fung1','fung2','fung3','fung4','pre','boro','desiccation',null]) {
        for(const autoDate of [false,true]) {
            const linked=Schedule.steps.some(step=>step.id===stage);
            const row={...app('post1'),key:stage||'manual',stage,plantingId:linked?'p1':null,
                name:stage||'Aplicação adicional',planned,actual,autoDate};
            assert.equal(Operations.validate(row,field,reference),true,`${stage}/${autoDate}`);
            const completed=Operations.quickUpdate({...row,actual:null},'completed',actual,field,reference);
            assert.equal(completed.actual,actual);
            assert.equal(completed.planned,planned);
            assert.equal(Operations.tableStatus(completed,reference),'completed');
        }
    }
});

test('concluir aplicação adicional não exige inventar uma data prevista', () => {
    const row={...app('post1'),plantingId:null,stage:null,key:'manual',planned:null,autoDate:false,actual:'2026-11-06'};
    assert.equal(Operations.validate(row,field,'2026-11-23'),true);
    assert.equal(Operations.validate({...row,actual:null,completedWithoutDate:true},field,'2026-11-23'),true);
    assert.throws(()=>Operations.validate({...row,actual:null},field,'2026-11-23'),/data programada válida/);
});

test('aceita pós 1 realizado antes da previsão pela grade e calculate', () => {
    const grid=Grid.create(); grid.edit(app('post1'),field,schedule({}),'actual','2026-11-06');
    assert.doesNotThrow(()=>grid.validate());
    assert.equal(Schedule.validate(planted,{post1:'2026-11-06'},false,current),true);
    const post1=Schedule.calculate(planted,{post1:'2026-11-06'},false,current)[0];
    assert.equal(post1.expected,'2026-11-16'); assert.equal(post1.actual,'2026-11-06');
});

test('aceita pós 2 cinco dias após pós 1, antes da previsão derivada, pela grade e calculate', () => {
    const grid=Grid.create(), dates=schedule({post1:'2026-11-06'});
    grid.edit(app('post2'),field,dates,'actual','2026-11-11');
    assert.doesNotThrow(()=>grid.validate());
    assert.equal(Schedule.validate(planted,{post1:'2026-11-06',post2:'2026-11-11'},false,current),true);
    const result=Schedule.calculate(planted,{post1:'2026-11-06',post2:'2026-11-11'},false,current);
    assert.equal(result[1].expected,'2026-11-16'); assert.equal(result[1].actual,'2026-11-11');
});

test('bloqueia data realizada anterior ao plantio e sequência decrescente de realizações conhecidas', () => {
    assert.throws(()=>Schedule.validate(planted,{post1:'2026-10-31'},false,current),/anterior ao plantio ou à aplicação anterior/);
    assert.throws(()=>Schedule.validate(planted,{post1:'2026-11-10',post2:'2026-11-09'},false,current),/anterior ao plantio ou à aplicação anterior/);
    assert.throws(()=>Operations.validate({...app('post1'),started:'2026-10-31'},field,current),/início não pode ser anterior ao plantio/);
});
