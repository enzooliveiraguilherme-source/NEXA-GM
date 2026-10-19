const test=require('node:test');
const assert=require('node:assert/strict');
const {distributeRecords}=require('../scripts/prepare-field-parts.cjs');

function plan({areas=[5,7],records=[record()]}={}){
    const children=areas.map((area,index)=>({farm_code:'FE',campo:`FALG 11 (${index?'7':'5'} ha)`,feature:{type:'Feature',properties:{Fazenda:'FE',Gleba:'FE',Campo:`FALG 11 (${index?'7':'5'} ha)`,Area:area},geometry:{type:'Polygon',coordinates:[]}}}));
    return {targets:[{parent:{farm_code:'FE',campo:'FALG 11'},children,records}]};
}
function record(overrides={}){
    return {id:'parent-record',operation_type:'plantio',fazenda:'FE',campo:'FALG 11',gleba:'FE',ano:'2026',cultura:'Soja',produto:'Plantio',status:'em_andamento',area_total:12,area_realizada:3.1234,percentual_realizado:26.03,taxa_aplicada:0.4,variedade_semente:'Olimpo',data_plantio:'2026-10-01',tipo_progresso:'hectares',created_at:'2026-10-01T12:00:00Z',updated_at:'2026-10-02T12:00:00Z',version:4,...overrides};
}

test('distribui hectares parciais proporcionalmente e conserva a soma com quatro casas',()=>{
    const rows=distributeRecords(plan());
    assert.equal(rows.length,2);
    assert.deepEqual(rows.map(row=>row.record.campo),['FALG 11 (5 ha)','FALG 11 (7 ha)']);
    assert.deepEqual(rows.map(row=>row.record.area_total),[5,7]);
    assert.deepEqual(rows.map(row=>row.record.area_realizada),[1.3014,1.822]);
    assert.equal(rows.reduce((sum,row)=>sum+row.record.area_realizada,0),3.1234);
    assert.deepEqual(rows.map(row=>row.record.percentual_realizado),[26.03,26.03]);
    assert.ok(rows.every(row=>row.source_record_id==='parent-record'));
});

test('reparte operação concluída e não iniciada segundo as regras de estado',()=>{
    const completed=record({id:'done',status:'concluido',area_total:12,area_realizada:12,percentual_realizado:100});
    const notStarted=record({id:'new',status:'nao_iniciado',area_total:12,area_realizada:0,percentual_realizado:0});
    const rows=distributeRecords(plan({records:[completed,notStarted]}));
    assert.equal(rows.length,4);
    const done=rows.filter(row=>row.source_record_id==='done').map(row=>row.record);
    const fresh=rows.filter(row=>row.source_record_id==='new').map(row=>row.record);
    assert.deepEqual(done.map(row=>[row.status,row.area_realizada,row.percentual_realizado]),[['concluido',5,100],['concluido',7,100]]);
    assert.deepEqual(fresh.map(row=>[row.status,row.area_realizada,row.percentual_realizado]),[['nao_iniciado',0,0],['nao_iniciado',0,0]]);
});

test('preserva dimensões e dados de plantio, sem copiar identidade nem auditoria',()=>{
    const rows=distributeRecords(plan());
    for(const {record:child} of rows){
        for(const key of ['operation_type','fazenda','gleba','ano','cultura','produto','status','taxa_aplicada','variedade_semente','data_plantio','tipo_progresso']) assert.equal(child[key],record()[key]);
        for(const key of ['id','created_at','updated_at','version','created_by','updated_by']) assert.equal(Object.hasOwn(child,key),false,`não deve herdar ${key}`);
    }
    assert.equal(new Set(rows.map(row=>row.record.campo)).size,2);
});

test('maiores restos resolve empate de arredondamento de forma determinística por Campo',()=>{
    const source=record({area_total:2,area_realizada:0.0001,percentual_realizado:0.01});
    const tied=plan({areas:[1,1],records:[source]});
    tied.targets[0].children.reverse();
    const first=distributeRecords(tied);
    const second=distributeRecords(tied);
    assert.deepEqual(first.map(row=>[row.record.campo,row.record.area_realizada]),second.map(row=>[row.record.campo,row.record.area_realizada]));
    assert.deepEqual(first.map(row=>[row.record.campo,row.record.area_realizada]),[['FALG 11 (5 ha)',0.0001],['FALG 11 (7 ha)',0]]);
    assert.equal(first.reduce((sum,row)=>sum+row.record.area_realizada,0),source.area_realizada);
});

test('rejeita área parcial maior que a soma dos filhos e campos inválidos',()=>{
    assert.throws(()=>distributeRecords(plan({records:[record({area_realizada:12.0001})]})),/área|Área|excede|maior/i);
    assert.throws(()=>distributeRecords(plan({records:[record({area_realizada:-0.1})]})),/área|Área|inválid/i);
    assert.throws(()=>distributeRecords(plan({records:[record({area_realizada:NaN})]})),/área|Área|inválid/i);
});
