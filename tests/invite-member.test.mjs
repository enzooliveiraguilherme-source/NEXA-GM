import test from 'node:test';
import assert from 'node:assert/strict';
import { makeInviteHandler } from '../supabase/functions/invite-member/handler.mjs';
function setup({admin=true,permissionError,expired=false,existing=false,members,inviteError,inviteThrow,resendError,resendThrow,accessError}={}) {
 const calls={invites:[],resends:[],access:[]};
 const client={auth:{getUser:async()=>({data:{user:expired?null:{id:'admin',email_confirmed_at:'yes'}},error:null})},
 rpc:async(name,args)=>name==='is_admin'?{data:admin,error:permissionError}:name==='admin_list_access'?{data:members??(existing?[{email:'person@example.test',email_confirmed:false}]:[])}:(calls.access.push(args),{error:accessError}),
 from:()=>({select:async()=>({data:[{code:'FE'},{code:'FS'}]})})};
 const handler=makeInviteHandler({userClient:()=>client,adminClient:{auth:{resetPasswordForEmail:async(email,options)=>{
 calls.resends.push({email,options});if(resendThrow)throw resendThrow;return {data:null,error:resendError};
 },admin:{inviteUserByEmail:async(email,options)=>{
 calls.invites.push({email,options});if(inviteThrow)throw inviteThrow;return inviteError?{data:null,error:inviteError}:{data:{user:{id:'invited'}},error:null};}}}}});
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

test('erro SMTP 500 é traduzido e não concede acesso',async()=>{
 const h=setup({inviteError:{status:500,message:'SMTP 500'}});const r=await h.send(valid);const body=await r.json();
 assert.equal(r.status,503);assert.match(body.error,/Não foi possível enviar/);assert.equal(h.calls.access.length,0);
});

test('email_address_not_authorized explica a configuração de envio',async()=>{
 const h=setup({inviteError:{code:'email_address_not_authorized'}});const r=await h.send(valid);const body=await r.json();
 assert.equal(r.status,400);assert.match(body.error,/não permite enviar/);assert.equal(h.calls.access.length,0);
});

test('exceção de rede depois de registrar o envio retorna resultado incerto sem salvar acesso',async()=>{
 const h=setup({inviteThrow:Error('connection reset after provider accepted message')});const r=await h.send(valid);const body=await r.json();
 assert.equal(r.status,503);assert.match(body.error,/lista de membros/);assert.equal(h.calls.invites.length,1);assert.equal(h.calls.access.length,0);
});

test('membro existente pendente bloqueia novo envio',async()=>{
 const h=setup({existing:true});const r=await h.send(valid);const body=await r.json();
 assert.equal(r.status,409);assert.match(body.error,/já está cadastrado/);assert.equal(h.calls.invites.length,0);assert.equal(h.calls.access.length,0);
});

test('erro de permissão ao verificar administrador bloqueia convite',async()=>{
 const h=setup({permissionError:Error('permission check failed')});const r=await h.send(valid);const body=await r.json();
 assert.equal(r.status,403);assert.match(body.error,/Somente administradores/);assert.equal(h.calls.invites.length,0);assert.equal(h.calls.access.length,0);
});

test('reenvio pendente usa recovery OTP, sem reenviar convite ou alterar permissões',async()=>{
 const h=setup({existing:true});const r=await h.send({email:' Person@example.test ',resend_existing:true});
 assert.equal(r.status,200);assert.equal(h.calls.resends.length,1);assert.equal(h.calls.resends[0].email,'person@example.test');
 assert.equal(h.calls.resends[0].options.redirectTo,'https://nexa-gm.vercel.app/index.html');
 assert.equal(h.calls.invites.length,0);assert.equal(h.calls.access.length,0);
});

test('reenvio é restrito a membros pendentes e não a contas confirmadas',async()=>{
 for(const members of [[],[{email:'person@example.test',email_confirmed:true}]]){
  const h=setup({members});const r=await h.send({email:'person@example.test',resend_existing:true});
  assert.equal(r.status,409);assert.equal(h.calls.resends.length,0);assert.equal(h.calls.invites.length,0);assert.equal(h.calls.access.length,0);
 }
});

test('reenvio exige administrador e não aceita campos de permissão ou convite',async()=>{
 for(const params of [{admin:false},{permissionError:Error('permission check failed')}]){
  const h=setup({...params,existing:true});const r=await h.send({email:'person@example.test',resend_existing:true});
  assert.equal(r.status,403);assert.equal(h.calls.resends.length,0);assert.equal(h.calls.invites.length,0);assert.equal(h.calls.access.length,0);
 }
 for(const extra of [{resend_existing:true},{email:'person@example.test',resend_existing:false},{email:'person@example.test',resend_existing:true,role:'admin'},{email:'person@example.test',resend_existing:true,farms:['FS']}]){
  const h=setup({existing:true});const r=await h.send(extra);
  assert.equal(r.status,400);assert.equal(h.calls.resends.length,0);assert.equal(h.calls.invites.length,0);assert.equal(h.calls.access.length,0);
 }
});

test('falha no reenvio não envia convite nem grava permissões',async()=>{
 for(const [resendError,status] of [[{status:429},429],[Error('SMTP rejected'),503]]){
  const h=setup({existing:true,resendError});const r=await h.send({email:'person@example.test',resend_existing:true});
  assert.equal(r.status,status);assert.equal(h.calls.resends.length,1);assert.equal(h.calls.invites.length,0);assert.equal(h.calls.access.length,0);
 }
});

test('convite inicial não persiste senha temporária ou OTP em user data',async()=>{
 const h=setup();const r=await h.send(valid);assert.equal(r.status,200);
 assert.deepEqual(h.calls.invites[0].options.data,{full_name:'Person'});
 assert.equal(Object.hasOwn(h.calls.invites[0].options,'password'),false);
 assert.equal(Object.hasOwn(h.calls.invites[0].options,'token'),false);
});
