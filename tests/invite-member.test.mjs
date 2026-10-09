import test from 'node:test';
import assert from 'node:assert/strict';
import { makeInviteHandler } from '../supabase/functions/invite-member/handler.mjs';
function setup({admin=true,expired=false,existing=false,inviteError,accessError}={}) {
 const calls={invites:[],access:[]};
 const client={auth:{getUser:async()=>({data:{user:expired?null:{id:'admin',email_confirmed_at:'yes'}},error:null})},
 rpc:async(name,args)=>name==='is_admin'?{data:admin}:name==='admin_list_access'?{data:existing?[{email:'person@example.test'}]:[]}:(calls.access.push(args),{error:accessError}),
 from:()=>({select:async()=>({data:[{code:'FE'},{code:'FS'}]})})};
 const handler=makeInviteHandler({userClient:()=>client,adminClient:{auth:{admin:{inviteUserByEmail:async(email,options)=>{
 calls.invites.push({email,options});return {data:{user:{id:'invited'}},error:inviteError};}}}}});
 const send=(body,auth='Bearer test')=>handler(new Request('https://test/invite',{method:'POST',headers:{Authorization:auth,'Content-Type':'application/json',Origin:'https://nexa-gm.vercel.app'},body:JSON.stringify(body)}));
 return {calls,send};
}
const valid={email:'person@example.test',name:'Person',role:'visualizador',all_farms:false,farms:['FE']};
test('somente administrador confirmado pode enviar convites',async()=>{
 for(const params of [{admin:false},{expired:true}]){const h=setup(params);const r=await h.send(valid);assert.ok([401,403].includes(r.status));assert.equal(h.calls.invites.length,0);}
 const h=setup();assert.equal((await h.send(valid,'')).status,401);assert.equal(h.calls.invites.length,0);
});
test('cargo e fazendas inválidos são rejeitados antes do envio',async()=>{
 for(const extra of [{role:'owner'},{farms:[]},{farms:['NO']},{all_farms:'true'},{role:'admin',all_farms:false},{email:'invalid'}]){
 const h=setup();assert.equal((await h.send({...valid,...extra})).status,400);assert.equal(h.calls.invites.length,0);}
});
test('convite usa destino oficial e concede só as fazendas selecionadas',async()=>{
 const h=setup();const r=await h.send({...valid,email:' Person@example.test ',farms:['FE','FE']});
 assert.equal(r.status,200);assert.equal((await r.json()).access_saved,true);
 assert.equal(h.calls.invites[0].email,'person@example.test');assert.equal(h.calls.invites[0].options.redirectTo,'https://nexa-gm.vercel.app/index.html');
 assert.deepEqual(h.calls.access[0],{target:'invited',new_role:'visualizador',all_access:false,farm_codes:['FE']});
});
test('acesso a todas não se limita às fazendas atuais',async()=>{
 const h=setup();assert.equal((await h.send({...valid,all_farms:true,role:'projetista',farms:[]})).status,200);
 assert.equal(h.calls.access[0].all_access,true);assert.deepEqual(h.calls.access[0].farm_codes,[]);
});
test('conta existente não recebe convite nem permissões sobrescritas',async()=>{
 const h=setup({existing:true});assert.equal((await h.send(valid)).status,409);assert.equal(h.calls.invites.length,0);assert.equal(h.calls.access.length,0);
});
test('erro de envio não concede acesso e falha de permissões comunica resultado parcial',async()=>{
 const h=setup({inviteError:{status:429}});assert.equal((await h.send(valid)).status,429);assert.equal(h.calls.access.length,0);
 const partial=setup({accessError:Error('denied')});const result=await (await partial.send(valid)).json();
 assert.equal(result.invited,true);assert.equal(result.access_saved,false);assert.match(result.message,/sem fazendas/);
});
