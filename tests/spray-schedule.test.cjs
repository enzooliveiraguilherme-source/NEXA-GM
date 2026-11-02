const test = require('node:test');
const assert = require('node:assert/strict');
const Spray = require('../js/spray-schedule.js');

test('calcula a sequência prevista e usa a data realizada como base para as etapas seguintes',()=>{
    const schedule=Spray.calculate('2026-11-01',{post1:'2026-11-18'},false,'2026-11-01');
    assert.deepEqual(schedule.map(({id,expected,actual,provisional,canRecord})=>({id,expected,actual,provisional,canRecord})),[
        {id:'post1',expected:'2026-11-16',actual:'2026-11-18',provisional:false,canRecord:true},
        {id:'post2',expected:'2026-11-28',actual:null,provisional:false,canRecord:true},
        {id:'fung1',expected:'2026-12-08',actual:null,provisional:true,canRecord:false},
        {id:'fung2',expected:'2026-12-23',actual:null,provisional:true,canRecord:false},
        {id:'fung3',expected:'2027-01-07',actual:null,provisional:true,canRecord:false}
    ]);
});

test('corrigir uma aplicação recalcula previsões em cascata e preserva as datas realizadas salvas',()=>{
    const saved={post1:'2026-11-18',post2:'2026-11-29',fung1:'2026-12-10'};
    const before=Spray.calculate('2026-11-01',saved,false,'2026-12-01');
    assert.equal(before.find(item=>item.id==='fung2').expected,'2026-12-25');
    saved.post1='2026-11-19';
    const after=Spray.calculate('2026-11-01',saved,false,'2026-12-01');
    assert.equal(after.find(item=>item.id==='post2').expected,'2026-11-29');
    assert.equal(after.find(item=>item.id==='post2').actual,'2026-11-29');
    assert.equal(after.find(item=>item.id==='fung1').expected,'2026-12-09');
    assert.equal(after.find(item=>item.id==='fung1').actual,'2026-12-10');
    assert.equal(after.find(item=>item.id==='fung2').expected,'2026-12-25');
    assert.deepEqual(saved,{post1:'2026-11-19',post2:'2026-11-29',fung1:'2026-12-10'});
});

test('classifica corretamente os limites de atraso, atenção e agenda',()=>{
    const cases=[
        {offset:-1,current:'2026-11-17',status:'overdue',daysLeft:-1},
        {offset:0,current:'2026-11-16',status:'attention',daysLeft:0},
        {offset:1,current:'2026-11-15',status:'attention',daysLeft:1},
        {offset:2,current:'2026-11-14',status:'attention',daysLeft:2},
        {offset:3,current:'2026-11-13',status:'scheduled',daysLeft:3}
    ];
    for(const item of cases){
        const first=Spray.calculate('2026-11-01',{},false,item.current)[0];
        assert.equal(first.status,item.status,`status para ${item.offset} dias`);
        assert.equal(first.daysLeft,item.daysLeft,`dias restantes para ${item.offset} dias`);
    }
});

test('quarta aplicação é opcional e altera a quantidade e o resumo das aplicações',()=>{
    const regular=Spray.calculate('2026-11-01',{},false,'2026-11-01');
    const fourth=Spray.calculate('2026-11-01',{},true,'2026-11-01');
    assert.equal(regular.length,5);assert.equal(fourth.length,6);
    assert.equal(fourth[5].id,'fung4');assert.equal(fourth[5].expected,'2027-01-20');
    const summary=Spray.summarize([{farm:'FE',field:'FE 01',plantingId:'p1',schedule:fourth}]);
    assert.equal(summary.total,6);assert.equal(summary.completed,0);assert.equal(summary.pending,6);
    assert.equal(summary.percent,0);assert.equal(summary.next.expected,'2026-11-16');
    assert.equal(summary.next.farm,'FE');assert.equal(summary.next.field,'FE 01');assert.equal(summary.next.plantingId,'p1');
});

test('datas atravessam fim do mês, ano e 29 de fevereiro por dias corridos',()=>{
    assert.equal(Spray.addDays('2026-11-01',15),'2026-11-16');
    assert.equal(Spray.addDays('2026-12-20',15),'2027-01-04');
    assert.equal(Spray.addDays('2024-02-20',10),'2024-03-01');
    assert.equal(Spray.calculate('2024-02-20',{},false,'2024-02-20')[0].expected,'2024-03-06');
});

test('a data de hoje usa o calendário de São Paulo, inclusive na virada UTC',()=>{
    assert.equal(Spray.today(new Date('2026-11-02T02:59:00.000Z')),'2026-11-01');
    assert.equal(Spray.today(new Date('2026-11-02T03:00:00.000Z')),'2026-11-02');
});

test('validate aceita lacunas com datas conhecidas ordenadas e rejeita limites inválidos',()=>{
    const current='2026-12-31';
    assert.throws(()=>Spray.validate('2026-02-30',{},false,current),/plantio válida/);
    assert.throws(()=>Spray.validate('2026-11-01',{},false,'invalid'),/referência inválida/);
    assert.throws(()=>Spray.validate('2026-11-01',{post1:'2026-11-18'},false,'2026-11-17'),/não pode estar no futuro/);
    assert.equal(Spray.validate('2026-11-01',{post2:'2026-11-10',fung1:'2026-11-20'},false,current),true);
    assert.throws(()=>Spray.validate('2026-11-01',{post2:'2026-11-20',fung1:'2026-11-19'},false,current),/anterior ao plantio ou à aplicação anterior/);
    assert.throws(()=>Spray.validate('2026-11-01',{post2:'2026-10-31'},false,current),/anterior ao plantio/);
    assert.throws(()=>Spray.validate('2026-11-01',{post2:'2026-11-20',fung1:'2027-01-01'},false,current),/não pode estar no futuro/);
    assert.throws(()=>Spray.validate('2026-11-01',{post1:'2026-11-18',post2:'2026-11-17'},false,current),/anterior ao plantio ou à aplicação anterior/);
    assert.throws(()=>Spray.validate('2026-11-01',{post1:'2026-10-31'},false,current),/anterior ao plantio/);
    assert.throws(()=>Spray.validate('2026-11-01',{post1:'2026-11-18',post2:'2026-11-28',fung4:'2026-12-30'},false,current),/Remova a data realizada do 4º fungicida/);
    assert.equal(Spray.validate('2026-11-01',{post1:'2026-11-18',post2:'2026-11-28',fung1:'2026-12-08'},false,current),true);
    assert.equal(Spray.validate('2026-11-01',{post1:'2026-11-18',post2:'2026-11-28',fung1:'2026-12-08',fung2:'2026-12-23',fung3:'2026-12-30',fung4:'2026-12-31'},true,current),true);
});

test('resumo agrega contagens e escolhe a próxima aplicação por data e talhão',()=>{
    const field1=Spray.calculate('2026-11-01',{post1:'2026-11-18'},false,'2026-11-19');
    const field2=Spray.calculate('2026-11-05',{},false,'2026-12-01');
    const result=Spray.summarize([
        {farm:'FE',field:'FE 02',plantingId:'p2',schedule:field2},
        {farm:'FE',field:'FE 01',plantingId:'p1',schedule:field1}
    ]);
    assert.equal(result.total,10);assert.equal(result.completed,1);assert.equal(result.pending,9);
    assert.equal(result.percent,10);assert.equal(result.next.expected,'2026-11-20');
    assert.equal(result.next.field,'FE 02');
});
