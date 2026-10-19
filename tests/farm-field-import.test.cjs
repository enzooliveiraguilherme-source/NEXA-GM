const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {prepareFields,synchronizationSql} = require('../scripts/prepare-farm-fields.cjs');
const geometry = {type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]};
const field = (campo,gleba,farm=null,area=10,geom=geometry) => ({type:'Feature',properties:{Campo:campo,Gleba:gleba,Fazenda:farm,Area:area},geometry:structuredClone(geom)});
const collection = features => ({type:'FeatureCollection',features});
const signature = feature => JSON.stringify([feature.properties.Fazenda,feature.properties.Campo,feature.properties.Gleba,feature.properties.Area,feature.geometry]);

test('recupera fazendas identificáveis e rejeita talhão sem identidade',()=>{
    const result=prepareFields(collection([field('FSTV 05','FSTV'),field('FBG 01','FBAG')]));
    assert.deepEqual(result.rows.map(row=>row.farm_code),['FSTV','FBAG']);
    assert.throws(()=>prepareFields(collection([field('T1','Outra')])),/não identificada/);
});

test('remove somente cópias idênticas e mantém partes distintas com área e geometria originais',()=>{
    const a=field('T1','FE','FE',5), duplicate=structuredClone(a);
    const secondGeometry=structuredClone(geometry); secondGeometry.coordinates[0][1][0]=2;
    const b=field('T1','FE','FE',7.123456,secondGeometry);
    const result=prepareFields(collection([a,b,duplicate]));
    assert.equal(result.rows.length,2);
    assert.equal(result.report.duplicates,1);
    assert.equal(result.report.mergedParts,0);
    assert.ok(Math.abs(result.rows.reduce((sum,row)=>sum+row.feature.properties.Area,0)-12.123456)<1e-12);
    assert.deepEqual(result.rows.map(row=>row.feature.geometry),[a.geometry,b.geometry]);
    assert.deepEqual(result.rows.map(row=>row.feature.properties.CampoOriginal),['T1','T1']);
    assert.notEqual(result.rows[0].campo,result.rows[1].campo);
    assert.ok(result.rows.every(row=>row.campo.startsWith('T1 (')));
});

test('homônimos recebem identificadores estáveis inclusive quando a área também colide',()=>{
    const geom1=structuredClone(geometry), geom2=structuredClone(geometry); geom2.coordinates[0][1][0]=3;
    const source=collection([field('FALG 11','FE','FE',45.786,geom1),field('FALG 11','FE','FE',45.786,geom2)]);
    const first=prepareFields(source), second=prepareFields(source);
    assert.deepEqual(first.rows.map(row=>row.campo),second.rows.map(row=>row.campo));
    assert.equal(new Set(first.rows.map(row=>row.campo)).size,2);
    assert.ok(first.rows.every(row=>row.feature.properties.CampoOriginal==='FALG 11'));
    assert.ok(first.rows.every(row=>row.campo.startsWith('FALG 11 (45,786 ha)')));
    const reimported=prepareFields(collection(first.rows.map(row=>row.feature)));
    assert.deepEqual(reimported.rows.map(row=>row.campo),first.rows.map(row=>row.campo));
    assert.deepEqual(reimported.rows.map(row=>row.feature.geometry),first.rows.map(row=>row.feature.geometry));
    assert.deepEqual(reimported.rows.map(row=>row.feature.properties.Area),first.rows.map(row=>row.feature.properties.Area));
});

test('rejeita coordenadas projetadas e glebas conflitantes',()=>{
    const a=structuredClone(field('T1','FE','FE'));a.geometry.coordinates[0][1][0]=500000;
    assert.throws(()=>prepareFields(collection([a])),/WGS 84/);
    assert.throws(()=>prepareFields(collection([field('T1','FE','FE'),field('T1','Outra','FE')])),/conflitantes/);
});

test('totais preparados correspondem à origem sem cópias idênticas e sincronização preserva dados agrícolas',()=>{
    const source=JSON.parse(fs.readFileSync(require.resolve('../Talhoes.geojson'),'utf8'));
    const result=prepareFields(source);
    const uniqueSource=new Map();
    for(const feature of source.features){const key=signature(feature);if(!uniqueSource.has(key))uniqueSource.set(key,feature);}
    const sourceTotals=new Map();
    for(const feature of uniqueSource.values()){
        const gleba=feature.properties.Gleba;
        sourceTotals.set(gleba,(sourceTotals.get(gleba)||0)+Number(feature.properties.Area));
    }
    for(const [gleba,area] of sourceTotals){
        const total=result.rows.filter(row=>row.feature.properties.Gleba===gleba)
            .reduce((sum,row)=>sum+row.feature.properties.Area,0);
        assert.ok(Math.abs(total-area)<1e-8,`Área total da gleba ${gleba}: ${total} != ${area}`);
    }
    assert.equal(result.rows.length,new Set(result.rows.map(row=>`${row.farm_code}__${row.campo}`)).size);
    assert.equal(result.report.duplicates,source.features.length-uniqueSource.size);
    const sql=synchronizationSql(result);
    assert.match(sql,/on conflict\(farm_code,campo\) do update/);
    assert.match(sql,/Talhão removido ainda possui operações/);
    assert.match(sql,/OperationalArchived/);
    assert.doesNotMatch(sql,/(?:update|delete from|insert into) public\.operation_/i);
});
