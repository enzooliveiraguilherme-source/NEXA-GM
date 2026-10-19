const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('novas partes operacionais não entram na colheita e seus limites anteriores continuam disponíveis', async () => {
    const field = (campo, marker) => ({properties:{Fazenda:'FE',Gleba:'FE',Campo:campo,Area:10},geometry:{type:'MultiPolygon',coordinates:[marker]}});
    const original1=field('FE 01','original-01'), original10=field('FE 10','original-10');
    const records=['FE 01','FE 10','FE 02'].map(campo=>({fazenda:'FE',campo,mean:150}));
    const operational=[field('FE 01.1','part-1'),field('FE 01.2','part-2'),field('FE 01.3','part-3'),field('FE 10','changed-10'),field('FE 10.1','part-10'),field('FE 02','original-02')];
    const warnings=[];
    const context=vm.createContext({window:{portalFarms:[{code:'FE',gleba:'FE'}]},document:{addEventListener(){},getElementById(){return null;}},console:{warn(...args){warnings.push(args);}},
        HarvestStore:{async load(){return {index:{records},datasets:[{farm:'FE',index:{features:[original1,original10]}}]};},fieldKey:(farm,campo)=>JSON.stringify([farm,campo])},HarvestView:{init(){}}});
    vm.runInContext(fs.readFileSync(require.resolve('../app.js'),'utf8'),context);
    const api=vm.runInContext('({state,loadHarvestTest,TalhaoSelection})',context);
    api.state.geojsonData={type:'FeatureCollection',features:operational};
    await api.loadHarvestTest();
    assert.deepEqual(warnings,[]);
    const displayed=Array.from(api.state.harvestData.features);
    assert.deepEqual(displayed.map(f=>f.properties.Campo).sort(),['FE 01','FE 02','FE 10']);
    assert.equal(displayed.find(f=>f.properties.Campo==='FE 01').geometry,original1.geometry);
    assert.equal(displayed.find(f=>f.properties.Campo==='FE 10').geometry,original10.geometry);
    assert.equal(new Set(operational.map(f=>api.TalhaoSelection.key(f))).size,6);
    assert.equal(operational[0].properties.Campo,'FE 01.1');
});

test('colheita usa o pai arquivado FE11 quando o índice não tem geometria e ignora o filho homônimo', async () => {
    const parent={properties:{Fazenda:'FE',Gleba:'FE',Campo:'FE11',Area:167.44,OperationalArchived:true},geometry:{type:'MultiPolygon',coordinates:['parent-FE11']}};
    const child={properties:{Fazenda:'FE',Gleba:'FE',Campo:'FE 11 (167,44 ha)',Area:167.44},geometry:{type:'MultiPolygon',coordinates:['child-FE11']}};
    const records=[{fazenda:'FE',campo:'FE11',mean:142}];
    const warnings=[];
    const context=vm.createContext({window:{portalFarms:[{code:'FE',gleba:'FE'}]},document:{addEventListener(){},getElementById(){return null;}},console:{warn(...args){warnings.push(args);}},
        HarvestStore:{async load(){return {index:{records},datasets:[{farm:'FE',index:{features:[]}}]};},fieldKey:(farm,campo)=>JSON.stringify([farm,campo])},HarvestView:{init(){}}});
    vm.runInContext(fs.readFileSync(require.resolve('../app.js'),'utf8'),context);
    const api=vm.runInContext('({state,loadHarvestTest})',context);
    api.state.geojsonData={type:'FeatureCollection',features:[child]};
    api.state.cloudStore={getArchivedFields:()=>[parent]};
    await api.loadHarvestTest();
    assert.deepEqual(warnings,[]);
    const displayed=Array.from(api.state.harvestData.features);
    assert.equal(displayed.length,1);
    assert.equal(displayed[0].properties.Campo,'FE11');
    assert.equal(displayed[0].geometry,parent.geometry);
    assert.equal(displayed[0].properties.produtividade,142);
    assert.equal(displayed.some(feature=>feature.properties.Campo==='FE 11 (167,44 ha)'),false);
});
