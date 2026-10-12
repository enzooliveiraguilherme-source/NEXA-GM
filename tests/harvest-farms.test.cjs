const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const zlib=require('node:zlib');
const crypto=require('node:crypto');

function version(farm,id){
    const raw=Buffer.alloc(64);[1,2,140,1,500000,8800000,130,2].forEach((n,i)=>raw.writeDoubleLE(n,i*8));
    const file={path:'original/field.001.bin.gz',kind:'original',count:1,sha256:crypto.createHash('sha256').update(raw).digest('hex')};
    const columns=['longitude','latitude','prod_corig','No','X','Y','Predicted','SE_Pred'];
    return {id,farm_code:farm,gleba:'FE',manifest:{farm,version:id,
        index:{representation:'original-points-v1',fazenda:farm,ano:2026,cultura:'Milho',unit:'sc/ha',columns,bounds:[1,2,1,2],
            records:[{campo:'T1',fazenda:farm,chunks:[file.path]}],features:[]},
        rasters:{records:[]},files:[file]},compressed:zlib.gzipSync(raw)};
}

function store(allowed,versions){
    const calls=[];
    const root={portalFarms:allowed.map(code=>({code})),supabaseClient:{
        from(table){
            const data=table==='harvest_farm_datasets'?versions.map(v=>({farm_code:v.farm_code,active_version:v.id})):versions;
            const query={select(){return this;},in(key,value){calls.push([table,key,Array.from(value)]);return this;},eq(){return this;},then(resolve,reject){return Promise.resolve({data,error:null}).then(resolve,reject);}};
            return query;
        },
        storage:{from(bucket){assert.equal(bucket,'harvest-kriged');return {async download(path){calls.push(['download',path]);return {data:new Blob([versions.find(v=>path.includes(v.id)).compressed]),error:null};}};}}
    }};
    vm.runInNewContext(fs.readFileSync(require.resolve('../js/harvest-store.js'),'utf8'),{window:root,Blob,Response,DecompressionStream,crypto:crypto.webcrypto,Float64Array});
    return {api:root.HarvestStore,root,calls};
}

test('fazendas liberadas carregam versões separadas; pontos originais são descompactados e validados',async()=>{
    const v=version('FE2','00000000-0000-4000-8000-000000000001');
    const {api,calls}=store(['FE2'],[v]);const data=await api.load();
    assert.equal(data.datasets.length,1);assert.equal(data.index.records[0].dataset.farm,'FE2');
    const chunk=await api.loadChunk(data.datasets[0],v.manifest.files[0].path);
    assert.equal(chunk.count,1);assert.equal(chunk.stride,8);
    assert.deepEqual(Array.from(chunk.values),[1,2,140,1,500000,8800000,130,2]);
    assert.deepEqual(calls[0],['harvest_farm_datasets','farm_code',['FE2']]);
    assert.match(calls.at(-1)[1],/^FE\/FE2\//);
});

test('acesso a todas as fazendas mantém o talhão T1 de cada fazenda distinto',async()=>{
    const a=version('FE2','00000000-0000-4000-8000-000000000001'),b=version('RM','00000000-0000-4000-8000-000000000002');
    const {api}=store(['FE2','RM'],[a,b]);const data=await api.load();
    assert.equal(data.index.records.length,2);
    assert.notEqual(api.fieldKey('FE2','T1'),api.fieldKey('RM','T1'));
    assert.deepEqual(Array.from(data.index.records,r=>r.dataset.farm),['FE2','RM']);
});

test('resposta de outra fazenda e arquivos fora do manifesto são recusados antes do download',async()=>{
    const v=version('RM','00000000-0000-4000-8000-000000000001');
    const {api,calls}=store(['FE2'],[v]);
    await assert.rejects(api.load(),/autorizadas/);
    assert.equal(calls.filter(c=>c[0]==='download').length,0);
    const valid=version('FE2','00000000-0000-4000-8000-000000000002');const s=store(['FE2'],[valid]);
    const data=await s.api.load();await assert.rejects(s.api.loadChunk(data.datasets[0],'../secret.bin.gz'),/inválido/);
    assert.equal(s.calls.filter(c=>c[0]==='download').length,0);
});

test('checksum inválido não é apresentado como produtividade válida',async()=>{
    const v=version('FE2','00000000-0000-4000-8000-000000000001');v.manifest.files[0].sha256='wrong';
    const {api}=store(['FE2'],[v]);const data=await api.load();
    await assert.rejects(api.loadChunk(data.datasets[0],v.manifest.files[0].path),/integridade/);
});
