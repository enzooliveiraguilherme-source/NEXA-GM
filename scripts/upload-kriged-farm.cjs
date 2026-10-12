const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
async function main(){
    const folder=path.resolve(process.argv[2]||'');
    const allowed=path.join(root,'.publish','kriged-milho-2026')+path.sep;
    if(!folder.startsWith(allowed))throw Error('Destino fora da preparação de colheita.');
    const dataset=JSON.parse(await fs.readFile(path.join(folder,'dataset.json'),'utf8'));
    const credential=JSON.parse(await fs.readFile(path.join(root,'.publish','kriged-upload.secret.json'),'utf8'));
    if(Date.now()/1000>credential.expires)throw Error('Credencial de envio expirada.');
    let done=0;
    const complete=new Set();
    const marker=path.join(folder,'uploaded.json');
    try{for(const file of JSON.parse(await fs.readFile(marker,'utf8')).files)complete.add(file);}catch(error){if(error.code!=='ENOENT')throw error;}
    for(let at=0;at<dataset.files.length;at+=2){
        await Promise.all(dataset.files.slice(at,at+2).map(async file=>{
            if(complete.has(file.path)){done++;return;}
            const bytes=await fs.readFile(path.join(folder,file.path));
            if(bytes.length!==file.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==file.compressed_sha256)throw Error('Arquivo local alterado: '+file.path);
            const url=new URL(credential.url);url.searchParams.set('version',dataset.version);url.searchParams.set('path',file.path);
            let last;
            for(let attempt=0;attempt<3;attempt++){
                try{
                    const response=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+credential.token,'Content-Type':'application/octet-stream'},body:bytes,signal:AbortSignal.timeout(120000)});
                    if(!response.ok)throw Error('Envio recusado ('+response.status+'): '+(await response.text()).slice(0,180));
                    const result=await response.json();if(!result.ok||result.bytes!==file.bytes)throw Error('Envio sem confirmação.');
                    complete.add(file.path);done++;last=null;break;
                }catch(error){last=error;if(attempt<2)await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));}
            }
            if(last)throw last;
        }));
        await fs.writeFile(marker,JSON.stringify({version:dataset.version,files:[...complete]}));
        if(done%10===0||done===dataset.files.length)console.log(`${dataset.farm}: ${done}/${dataset.files.length} arquivos enviados.`);
    }
    console.log(JSON.stringify({farm:dataset.farm,version:dataset.version,files:complete.size,bytes:dataset.upload_bytes}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
