const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
async function main(){
 const cache=new Map(),stored=[];let account='user-05';
 const client={auth:{getUser:async()=>({data:{user:{id:account}}})},from(){return {upsert:async row=>{stored.push(row);return {error:null};},select(){return {order:async()=>({data:stored.filter(r=>r.user_id===account),error:null})};}};}};
 const storage={getItem:k=>cache.get(k)||null,setItem:(k,v)=>cache.set(k,v)};
 const context=vm.createContext({window:{localStorage:storage,supabaseClient:client}});vm.runInContext(fs.readFileSync('js/harvest-legend.js','utf8'),context);vm.runInContext(fs.readFileSync('js/harvest-pyramid.js','utf8'),context);
 const style=context.window.HarvestStyle,legend=context.window.HarvestLegend;
 assert.deepEqual(Array.from(style.get().colors),['#fde725','#7ad151','#22a884','#2a788e','#414487','#440154']);assert.equal(style.color(120),'#7ad151');assert.equal(style.color(180),'#414487');
 await legend.listSaved();let calls=0;const unsubscribe=style.subscribe(()=>calls++),next=style.get();next.breaks=[100,120,160,180,220];next.colors[0]='#123456';style.apply(next);assert.equal(calls,1);assert.equal(style.category(150),2);assert.equal(style.get().labels[2],'120 a menos de 160 sc/ha');unsubscribe();
 assert.throws(()=>style.apply({...next,breaks:[100,90,160,180,220]}));assert.throws(()=>style.apply({...next,palette:'viridis'}));
 const rgba=context.window.HarvestPyramid.valuesPixels(new Float64Array([NaN,150,221]),next);assert.deepEqual([...rgba],[0,0,0,0,34,168,132,255,68,1,84,255]);
 await legend.save('Milho 2026',next);assert.equal(stored[0].user_id,'user-05');assert.equal(stored[0].name,'Milho 2026');assert.equal((await legend.listSaved()).length,1);
 account='user-06';assert.equal((await legend.listSaved()).length,0);assert.equal(style.color(50),'#fde725','Outra conta não deve herdar preferências do colaborador 05');
 account='user-05';await legend.listSaved();assert.equal(style.color(50),'#123456');assert.ok(cache.has('harvest-legend-v2:user-05'));
 console.log('Limites numéricos, textos automáticos, duas rampas, classificação do mapa e persistência separada por conta verificados.');
}main().catch(e=>{console.error(e);process.exitCode=1;});
