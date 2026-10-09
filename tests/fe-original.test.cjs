const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const assert=require('node:assert/strict');
const readline=require('node:readline');
const vm=require('node:vm');
const folder=path.resolve(__dirname,'../dados/colheita/2026/milho/fe-original');
const index=JSON.parse(fs.readFileSync(path.join(folder,'index.json')));
async function main(){
    const hashes=new Map(), counts=new Map();
    const row=Buffer.alloc(64);
    for await(const line of readline.createInterface({input:fs.createReadStream(path.join(folder,'../FE.geojson')),crlfDelay:Infinity})){
        if(!line.trim().startsWith('{ "type": "Feature"')) continue;
        const feature=JSON.parse(line.trim().replace(/,$/,''));
        const campo=feature.properties.layer.replace(/_Kriged$/,'');
        if(!hashes.has(campo)) hashes.set(campo,crypto.createHash('sha256'));
        const fields=[...feature.geometry.coordinates.slice(0,2),...index.columns.slice(2).map(key=>feature.properties[key])];
        fields.forEach((value,i)=>row.writeDoubleLE(value,i*8));
        hashes.get(campo).update(row); counts.set(campo,(counts.get(campo)||0)+1);
    }
    let total=0;
    for(const record of index.records){
        const hash=crypto.createHash('sha256'); let count=0;
        for(const name of record.chunks){
            const part=JSON.parse(fs.readFileSync(path.join(folder,name)));
            const bytes=zlib.gunzipSync(Buffer.from(part.gzip_base64,'base64'));
            assert.equal(bytes.length,part.count*64);
            assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),part.sha256);
            hash.update(bytes); count+=part.count;
        }
        assert.equal(count,record.points); assert.equal(count,counts.get(record.campo));
        assert.equal(hash.digest('hex'),hashes.get(record.campo).digest('hex'),'Todos os valores devem coincidir bit a bit com o GeoJSON de origem');
        total+=count;
    }
    assert.equal(total,2619944);
    const context=vm.createContext({window:{},document:{addEventListener(){}},console,Blob,Response,DecompressionStream,atob,crypto:crypto.webcrypto});
    context.window=context;
    context.portalFarms=[{code:'FE'}];
    context.supabaseClient={from(table){
        const filters={};
        return {select(){return this;},eq(key,value){filters[key]=value;return this;},
            async maybeSingle(){assert.equal(table,'harvest_test_datasets');return {data:{active_version:'test-version'},error:null};},
            async single(){assert.equal(table,'harvest_test_files');assert.equal(filters.version_id,'test-version');return {data:{contents:JSON.parse(fs.readFileSync(path.join(folder,filters.path)))},error:null};}
        };
    }};
    context.fetch=async url=>({ok:true,json:async()=>JSON.parse(fs.readFileSync(path.join(folder,path.basename(url))))});
    vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../js/harvest-store.js'),'utf8'),context);
    const dataset=await context.HarvestStore.load();
    const decoded=await context.HarvestStore.loadChunk(dataset,index.records[0].chunks[0]);
    const raw=zlib.gunzipSync(Buffer.from(JSON.parse(fs.readFileSync(path.join(folder,index.records[0].chunks[0]))).gzip_base64,'base64'));
    assert.equal(decoded.values[0],raw.readDoubleLE(0));
    assert.equal(decoded.values[2],raw.readDoubleLE(16));
    vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../app.js'),'utf8'),context);
    assert.equal(vm.runInContext("state.currentTab='colheita'; getFeatureStyle({properties:{Campo:'FE 01'}}).fillOpacity",context),0);
    console.log('2.619.944 pontos originais verificados bit a bit; coordenadas e 6 atributos preservados; decodificação no navegador e polígonos transparentes verificados.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
