-- Etapas pré-plantio independentes: fixtures sintéticas em transação revertida.
begin;
set local statement_timeout='25s';
set local lock_timeout='3s';

create temporary table spray_pre_users(kind text primary key,id uuid not null) on commit drop;
insert into spray_pre_users values ('viewer',gen_random_uuid()),('editor_fe',gen_random_uuid()),('editor_fe2',gen_random_uuid());
grant select on spray_pre_users to authenticated;
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,
 raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select id,'authenticated','authenticated','spray-pre-'||kind||'@example.invalid',
 'TEST_ONLY_SYNTHETIC_HASH',now(),'{"provider":"email","providers":["email"]}'::jsonb,
 jsonb_build_object('full_name','Spray preplant test '||kind),now(),now()
from spray_pre_users;
update public.profiles p set role=case when u.kind='viewer' then 'visualizador'::public.user_role else 'projetista'::public.user_role end,
 all_farms=false from spray_pre_users u where p.id=u.id;
insert into public.user_farm_access(user_id,farm_code)
select id,case kind when 'editor_fe2' then 'FE2' else 'FE' end from spray_pre_users;

create temporary table spray_pre_plant(id uuid primary key) on commit drop;
insert into spray_pre_plant values(gen_random_uuid());
grant select on spray_pre_plant to authenticated;
insert into public.farm_fields(farm_code,campo,feature) values
 ('FE','PRE-TEST-A',jsonb_build_object('type','Feature','geometry',null,'properties',jsonb_build_object('Fazenda','FE','Campo','PRE-TEST-A','Area',100))),
 ('FE','PRE-TEST-B',jsonb_build_object('type','Feature','geometry',null,'properties',jsonb_build_object('Fazenda','FE','Campo','PRE-TEST-B','Area',100))),
 ('FE2','PRE-TEST-A',jsonb_build_object('type','Feature','geometry',null,'properties',jsonb_build_object('Fazenda','FE2','Campo','PRE-TEST-A','Area',100))),
 ('FE','SPRAY-POST-TEST',jsonb_build_object('type','Feature','geometry',null,'properties',jsonb_build_object('Fazenda','FE','Campo','SPRAY-POST-TEST','Area',100)));
insert into public.operation_records(id,operation_type,fazenda,campo,ano,cultura,produto,status,
 area_total,area_realizada,percentual_realizado,variedade_semente,data_plantio)
select id,'plantio','FE','SPRAY-POST-TEST','SPRAY_PRE_TEST','Milho','Plantio','concluido',
 50,50,100,'Semente teste',(now() at time zone 'America/Sao_Paulo')::date-30 from spray_pre_plant;

select set_config('request.jwt.claim.sub',(select id::text from spray_pre_users where kind='editor_fe'),true);
set local role authenticated;
do $$
declare today date := (now() at time zone 'America/Sao_Paulo')::date;
        pre_app public.spray_applications; pre_stage public.spray_applications; boro_app public.spray_applications;
        des_app public.spray_applications; post1 public.spray_applications; post2 public.spray_applications;
        pid uuid; sv integer; n integer; denied boolean; batch jsonb;
begin
 select id into pid from spray_pre_plant;
 insert into public.spray_schedules(planting_record_id,post1_date,post2_date) values(pid,today-7,today-3);
 select version into sv from public.spray_schedules where planting_record_id=pid;
 post1:=public.save_spray_application(jsonb_build_object('fazenda','FE','campo','SPRAY-POST-TEST',
  'ano','SPRAY_PRE_TEST','cultura','Milho','planting_record_id',pid,'stage_id','post1',
  'application_name','Pós um','area',25,'actual_date',today-7),null,sv);
 post2:=public.save_spray_application(jsonb_build_object('fazenda','FE','campo','SPRAY-POST-TEST',
  'ano','SPRAY_PRE_TEST','cultura','Milho','planting_record_id',pid,'stage_id','post2',
  'application_name','Pós dois','area',25,'actual_date',today-3),null,sv);

 -- Pré-emergente por RPC single; realizado antes do plantio, sem planned_date.
 pre_app:=public.save_spray_application(jsonb_build_object('fazenda','FE','campo','PRE-TEST-A',
  'ano','2026','cultura','Milho','stage_id','pre','application_name','Pré-emergente',
  'product','Produto pré','dose',2.5,'dose_unit','L/ha','area',40,'actual_date',today-35,
  'responsible','Operador fictício','notes','Registro pré-plantio'),null,null);
 if pre_app.planting_record_id is not null or pre_app.planned_date is not null or pre_app.stage_id<>'pre'
    or pre_app.actual_date<>today-35 then raise exception 'Pré-emergente anterior ao plantio não foi aceito'; end if;

 -- Boro e dessecação são criados no mesmo lote, também sem plantio e previsão.
 batch:=jsonb_build_array(
  jsonb_build_object('payload',jsonb_build_object('fazenda','FE','campo','PRE-TEST-A','ano','2026','cultura','Milho',
   'stage_id','boro','application_name','Boro','product','Boro teste','dose',1.2,'dose_unit','kg/ha',
   'area',35,'actual_date',today-34,'responsible','Operador fictício','notes','Dose boro'),
   'expected_version',null,'schedule_version',null),
  jsonb_build_object('payload',jsonb_build_object('fazenda','FE','campo','PRE-TEST-A','ano','2026','cultura','Milho',
   'stage_id','desiccation','application_name','Dessecação pré-plantio','product','Dessecante',
   'dose',1.7,'dose_unit','L/ha','area',30,'actual_date',today-33,'responsible','Operador fictício',
   'notes','Dose dessecação'),'expected_version',null,'schedule_version',null),
  jsonb_build_object('payload',jsonb_build_object('fazenda','FE','campo','SPRAY-POST-TEST','ano','SPRAY_PRE_TEST',
   'cultura','Milho','stage_id','pre','application_name','Pré no talhão de plantio','product','Pré teste',
   'dose',2,'dose_unit','L/ha','area',30,'actual_date',today-36,'responsible','Operador fictício'),
   'expected_version',null,'schedule_version',null));
 select count(*) into n from public.save_spray_application_batch(batch);
 if n<>3 then raise exception 'Três etapas independentes em lote retornaram % linhas',n; end if;
 select * into pre_app from public.spray_applications where id=pre_app.id;
 select * into boro_app from public.spray_applications where stage_id='boro' and fazenda='FE' and campo='PRE-TEST-A' and ano='2026' and cultura='Milho';
 select * into des_app from public.spray_applications where stage_id='desiccation' and fazenda='FE' and campo='PRE-TEST-A' and ano='2026' and cultura='Milho';
 select * into pre_stage from public.spray_applications where stage_id='pre' and fazenda='FE' and campo='SPRAY-POST-TEST' and ano='SPRAY_PRE_TEST' and cultura='Milho';
 if boro_app.planting_record_id is not null or boro_app.planned_date is not null or boro_app.actual_date<>today-34
    or des_app.planting_record_id is not null or des_app.planned_date is not null or des_app.actual_date<>today-33
    or boro_app.dose<>1.2 or des_app.dose<>1.7 or pre_stage.id is null or pre_stage.planned_date is not null
    or pre_stage.actual_date<>today-36 then
  raise exception 'Metadados independentes não persistiram'; end if;

 -- Reload confirma que texto, produto, dose, unidade e responsável foram persistidos.
 if (select product from public.spray_applications where id=pre_app.id)<>'Produto pré'
    or (select dose from public.spray_applications where id=pre_app.id)<>2.5
    or (select notes from public.spray_applications where id=pre_app.id)<>'Registro pré-plantio'
    or (select responsible from public.spray_applications where id=pre_app.id)<>'Operador fictício' then
  raise exception 'Metadata da aplicação pré não recarregou'; end if;

 -- A combinação escopo/cultura/safra participa da unicidade parcial.
 denied:=false;
 begin perform public.save_spray_application(jsonb_build_object('fazenda','FE','campo','PRE-TEST-A','ano','2026',
  'cultura','Milho','stage_id','pre','application_name','Pré duplicado','area',10,'actual_date',today-6),null,null);
 exception when unique_violation then denied:=true; end;
 if not denied then raise exception 'Aceitou etapa pré duplicada no mesmo escopo'; end if;
 perform public.save_spray_application(jsonb_build_object('fazenda','FE','campo','PRE-TEST-B','ano','2026',
  'cultura','Milho','stage_id','pre','application_name','Outro talhão','area',10,'actual_date',today-6),null,null);
 perform public.save_spray_application(jsonb_build_object('fazenda','FE','campo','PRE-TEST-A','ano','2027',
  'cultura','Milho','stage_id','pre','application_name','Outra safra','area',10,'actual_date',today-6),null,null);
 perform public.save_spray_application(jsonb_build_object('fazenda','FE','campo','PRE-TEST-A','ano','2026',
  'cultura','Soja','stage_id','pre','application_name','Outra cultura','area',10,'actual_date',today-6),null,null);

 -- Manual genérica ainda exige previsão; etapas nomeadas podem ser só realizadas.
 denied:=false;
 begin perform public.save_spray_application(jsonb_build_object('fazenda','FE','campo','PRE-TEST-A','ano','2026',
  'cultura','Milho','application_name','Manual sem previsão','area',10,'actual_date',today-6),null,null);
 exception when check_violation then denied:=true; end;
 if not denied then raise exception 'Aceitou aplicação genérica sem planned_date'; end if;
 denied:=false;
 begin perform public.save_spray_application(jsonb_build_object('fazenda','FE','campo','SPRAY-POST-TEST',
  'ano','SPRAY_PRE_TEST','cultura','Milho','planting_record_id',pid,'application_name','Vínculo sem etapa',
  'area',10,'planned_date',today),null,sv);
 exception when check_violation then denied:=true; end;
 if not denied then raise exception 'Aceitou aplicação vinculada sem stage_id'; end if;
 denied:=false;
 begin perform public.save_spray_application(jsonb_build_object('fazenda','FE','campo','SPRAY-POST-TEST',
  'ano','SPRAY_PRE_TEST','cultura','Milho','planting_record_id',pid,'stage_id','pre',
  'application_name','Pré-emergente vinculado','area',10,'planned_date',today),null,sv);
 exception when check_violation then denied:=true; end;
 if not denied then raise exception 'Aceitou etapa pré-plantio vinculada ao plantio'; end if;

 -- Future remains invalid even for a pre-plant stage.
 denied:=false;
 begin perform public.save_spray_application(jsonb_build_object('fazenda','FE','campo','PRE-TEST-A','ano','2026',
  'cultura','Milho','stage_id','pre','application_name','Futura','area',10,'actual_date',today+1),null,null);
 exception when check_violation then denied:=true; end;
 if not denied then raise exception 'Aceitou actual_date futura em etapa independente'; end if;

 -- Mixed batch: updating a named stage and a canonical post stage is accepted.
 select version into sv from public.spray_schedules where planting_record_id=pid;
 pre_stage:=public.save_spray_application(to_jsonb(pre_stage)||jsonb_build_object('notes','Antes do lote'),pre_stage.version,null);
 batch:=jsonb_build_array(
  jsonb_build_object('payload',to_jsonb(pre_stage)||jsonb_build_object('notes','Metadata em lote'),
   'expected_version',pre_stage.version,'schedule_version',null),
  jsonb_build_object('payload',to_jsonb(post2)||jsonb_build_object('actual_date',today-2),
   'expected_version',post2.version,'schedule_version',sv));
 select count(*) into n from public.save_spray_application_batch(batch);
 if n<>2 then raise exception 'Lote misto retornou % linhas',n; end if;
 select * into pre_stage from public.spray_applications where id=pre_stage.id;
 select * into post2 from public.spray_applications where id=post2.id;
 select version into sv from public.spray_schedules where planting_record_id=pid;
 if pre_stage.notes<>'Metadata em lote' or (select post2_date from public.spray_schedules where planting_record_id=pid)<>today-2 then
  raise exception 'Lote misto não salvou etapa e cronograma'; end if;

 -- Limpando só post1 cria estado final inválido. A metadata independente deve reverter junto.
 denied:=false;
 begin
  perform public.save_spray_application_batch(jsonb_build_array(
   jsonb_build_object('payload',to_jsonb(pre_stage)||jsonb_build_object('notes','Não deve persistir'),
    'expected_version',pre_stage.version,'schedule_version',null),
   jsonb_build_object('payload',to_jsonb(post1)||jsonb_build_object('actual_date',null),
    'expected_version',post1.version,'schedule_version',sv)));
 exception when check_violation then denied:=true; end;
 if not denied then raise exception 'Aceitou lote misto que deixa post2 sem post1'; end if;
 if (select notes from public.spray_applications where id=pre_stage.id)<>'Metadata em lote'
    or (select version from public.spray_applications where id=post1.id)<>post1.version
    or (select post1_date from public.spray_schedules where planting_record_id=pid)<>today-7
    or (select post2_date from public.spray_schedules where planting_record_id=pid)<>today-2 then
  raise exception 'Erro em item canônico não reverteu metadata independente'; end if;

 -- Outra fazenda pode usar a mesma chave de etapa, mas usuário sem escopo não vê nem grava.
 perform set_config('request.jwt.claim.sub',(select id::text from spray_pre_users where kind='editor_fe2'),true);
 perform public.save_spray_application(jsonb_build_object('fazenda','FE2','campo','PRE-TEST-A','ano','2026',
  'cultura','Milho','stage_id','pre','application_name','Mesmo stage em outra fazenda',
  'area',10,'actual_date',today-6),null,null);
 perform set_config('request.jwt.claim.sub',(select id::text from spray_pre_users where kind='viewer'),true);
 if exists(select 1 from public.spray_applications where fazenda='FE2') then raise exception 'Viewer leu aplicação FE2'; end if;
 if not exists(select 1 from public.spray_applications where id=pre_app.id) then raise exception 'Viewer não leu aplicação FE'; end if;
 denied:=false;
 begin perform public.save_spray_application_batch('[]'::jsonb);
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Viewer executou batch RPC'; end if;
end $$;
reset role;
rollback;
select 'Etapas pré-plantio, unicidade por escopo, integração batch, rollback, RLS e validações: OK; fixtures revertidas.' as validation;
