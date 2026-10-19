const test=require('node:test');
const assert=require('node:assert/strict');
const {prepareFields}=require('../scripts/prepare-farm-fields.cjs');
const {prepareSeparation,separationSql}=require('../scripts/prepare-field-parts.cjs');

const polygon=x=>({type:'Polygon',coordinates:[[[x,0],[x+1,0],[x+1,1],[x,0]]]});
const part=(x,area=5)=>({type:'Feature',properties:{Fazenda:'FE',Gleba:'FE',Campo:'FALG 11',Area:area},geometry:polygon(x)});
function fixture({areas=[5,7],parentPresent=true,archived=false,parentGeometry=null,parentArea=null,existingDestination=false}={}){
    const source={type:'FeatureCollection',features:areas.map((area,index)=>part(index*2,area))};
    const children=prepareFields(source).rows;
    const union=parentGeometry||{type:'MultiPolygon',coordinates:children.flatMap(row=>row.feature.geometry.type==='Polygon'?[row.feature.geometry.coordinates]:row.feature.geometry.coordinates)};
    const parent={farm_code:'FE',campo:'FALG 11',feature:{type:'Feature',properties:{Fazenda:'FE',Gleba:'FE',Campo:'FALG 11',Area:parentArea??areas.reduce((sum,value)=>sum+value,0),...(archived?{OperationalArchived:true}:{})},geometry:union}};
    const fields=parentPresent?[parent]:[];
    if(existingDestination)fields.push({farm_code:children[0].farm_code,campo:children[0].campo,feature:children[0].feature});
    const snapshot={fields,records:[{id:'r1',fazenda:'FE',campo:'FALG 11'}],plans:[{id:'p1'}],history:[{id:'h1'}]};
    return {source,snapshot,children};
}

test('planeja a separação de duas partes contra o snapshot da união e retém registros do pai',()=>{
    const {source,snapshot,children}=fixture();
    const plan=prepareSeparation(source,snapshot);
    assert.equal(plan.targets.length,1); assert.equal(plan.skipped.length,0);
    assert.equal(plan.targets[0].children.length,2);
    assert.equal(plan.targets[0].parent.campo,'FALG 11');
    assert.deepEqual(plan.targets[0].records,snapshot.records);
    assert.deepEqual(plan.targets[0].children.map(row=>row.campo),children.map(row=>row.campo));
});

test('ignora separações sem área positiva ou com geometria/área divergentes da união',()=>{
    for(const options of [
        {areas:[0,7]},
        {parentGeometry:polygon(100)},
        {parentArea:99}
    ]){
        const {source,snapshot}=fixture(options);
        const plan=prepareSeparation(source,snapshot);
        assert.equal(plan.targets.length,0);
        assert.equal(plan.skipped.length,1);
        assert.match(plan.skipped[0].reason,/área positiva|Geometria atual|Área atual/);
    }
});

test('ignora pai ausente, pai arquivado ou destino já cadastrado',()=>{
    for(const options of [{parentPresent:false},{archived:true},{existingDestination:true}]){
        const {source,snapshot}=fixture(options);
        const plan=prepareSeparation(source,snapshot);
        assert.equal(plan.targets.length,0);
        assert.equal(plan.skipped.length,1);
        assert.match(plan.skipped[0].reason,/ausente|arquivado|destino.*cadastrad/i);
    }
});

test('SQL verifica snapshots, protege operações/planos/histórico e arquiva o pai sem apagar operações',()=>{
    const {source,snapshot}=fixture();
    const sql=separationSql(prepareSeparation(source,snapshot));
    assert.match(sql,/create temporary table parents_before/);
    assert.match(sql,/create temporary table records_before/);
    assert.match(sql,/create temporary table plans_before/);
    assert.match(sql,/create temporary table history_before/);
    assert.match(sql,/Cadastro original mudou desde a preparação/);
    assert.match(sql,/Destino já cadastrado/);
    assert.match(sql,/except select \* from records_before/);
    assert.match(sql,/except select \* from plans_before/);
    assert.match(sql,/except select \* from history_before/);
    assert.match(sql,/update public\.farm_fields f set feature=jsonb_set/);
    assert.match(sql,/OperationalArchived/);
    assert.doesNotMatch(sql,/delete\s+from\s+public\.operation_(?:records|plans|history)/i);
});
