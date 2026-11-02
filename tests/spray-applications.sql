-- Teste transacional de spray_applications e sincronização com spray_schedules.
-- Identidades e operações são sintéticas; execute em projeto de teste e faça ROLLBACK.
begin;
set local statement_timeout='20s';
set local lock_timeout='3s';

create temporary table spray_app_test_users(kind text primary key,id uuid not null) on commit drop;
insert into spray_app_test_users values ('viewer',gen_random_uuid()),('editor',gen_random_uuid());
grant select on spray_app_test_users to authenticated;
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,
 raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select id,'authenticated','authenticated','spray-app-test-'||kind||'@example.invalid',
 'TEST_ONLY_SYNTHETIC_HASH',now(),'{"provider":"email","providers":["email"]}'::jsonb,
 jsonb_build_object('full_name','Spray application test '||kind),now(),now()
from spray_app_test_users;
update public.profiles p set role=case u.kind when 'editor' then 'projetista'::public.user_role
 else 'visualizador'::public.user_role end,all_farms=false
from spray_app_test_users u where p.id=u.id;
insert into public.user_farm_access(user_id,farm_code) select id,'FE' from spray_app_test_users;

create temporary table spray_app_test_records(kind text primary key,id uuid not null) on commit drop;
insert into spray_app_test_records values ('own',gen_random_uuid()),('other',gen_random_uuid());
grant select on spray_app_test_records to authenticated;
insert into public.farm_fields(farm_code,campo,feature)
select case kind when 'other' then 'FE2' else 'FE' end,'SPRAY-APP-TEST-'||kind,
 jsonb_build_object('type','Feature','geometry',null,'properties',
  jsonb_build_object('Fazenda',case kind when 'other' then 'FE2' else 'FE' end,
                     'Campo','SPRAY-APP-TEST-'||kind,'Area',100))
from spray_app_test_records;
insert into public.operation_records(id,operation_type,fazenda,campo,ano,cultura,produto,status,
 area_total,area_realizada,percentual_realizado,variedade_semente,data_plantio)
select id,'plantio',case kind when 'other' then 'FE2' else 'FE' end,'SPRAY-APP-TEST-'||kind,
 'SPRAY_APP_TEST','Teste aplicações','Plantio','concluido',50,50,100,'Semente teste',
 (now() at time zone 'America/Sao_Paulo')::date-30
from spray_app_test_records;

do $$ begin
 if has_table_privilege('anon','public.spray_applications','SELECT') then
  raise exception 'anon recebeu SELECT em spray_applications'; end if;
 if has_function_privilege('anon','public.save_spray_application(jsonb,integer,integer)','EXECUTE') then
  raise exception 'anon recebeu EXECUTE em save_spray_application'; end if;
end $$;

select set_config('request.jwt.claim.sub',(select id::text from spray_app_test_users where kind='editor'),true);
set local role authenticated;
do $$
declare own_id uuid; other_id uuid; today date := (now() at time zone 'America/Sao_Paulo')::date;
        app public.spray_applications; sched_version integer; denied boolean; affected integer;
        payload jsonb;
begin
 select id into own_id from spray_app_test_records where kind='own';
 select id into other_id from spray_app_test_records where kind='other';

 -- Aplicação manual: CRUD de metadata e exclusão reversível.
 payload:=jsonb_build_object('fazenda','FE','campo','SPRAY-APP-TEST-own','ano','SPRAY_APP_TEST',
  'cultura','Teste aplicações','application_name','Aplicação manual','product','Produto teste',
  'dose',1.25,'dose_unit','L/ha','area',10,'planned_date',today,
  'responsible','Operador fictício','notes','Fixture');
 app:=public.save_spray_application(payload,null,null);
 if app.id is null or app.version<>1 or app.planting_record_id is not null or app.deleted then
  raise exception 'Criação de aplicação manual inválida'; end if;
 payload:=to_jsonb(app)||jsonb_build_object('notes','Metadata atualizada');
 app:=public.save_spray_application(payload,app.version,null);
 if app.version<>2 or app.notes<>'Metadata atualizada' then raise exception 'Update metadata falhou'; end if;
 payload:=to_jsonb(app)||jsonb_build_object('deleted',true);
 app:=public.save_spray_application(payload,app.version,null);
 if not app.deleted then raise exception 'Soft-delete não marcou deleted=true'; end if;
 payload:=to_jsonb(app)||jsonb_build_object('deleted',false);
 app:=public.save_spray_application(payload,app.version,null);
 if app.deleted or app.version<>4 then raise exception 'Restauração não preservou registro/versionamento'; end if;

 -- Aplicação associada a plantio e etapa única: actual_date sincroniza a agenda.
 payload:=jsonb_build_object('fazenda','FE','campo','SPRAY-APP-TEST-own','ano','SPRAY_APP_TEST',
  'cultura','Teste aplicações','planting_record_id',own_id,'stage_id','post1',
  'application_name','Pós-emergente','product','Produto teste','dose',1,'dose_unit','L/ha',
  'area',25,'actual_date',today,'responsible','Operador fictício');
 app:=public.save_spray_application(payload,null,null);
 select version into sched_version from public.spray_schedules where planting_record_id=own_id;
 if app.version<>1 or sched_version is null or
    (select post1_date from public.spray_schedules where planting_record_id=own_id)<>today then
  raise exception 'Criação não sincronizou actual_date na agenda'; end if;
 denied:=false;
 begin perform public.save_spray_application(payload,null,sched_version);
 exception when unique_violation then denied:=true; end;
 if not denied then raise exception 'Permitiu duplicar a etapa vinculada ao mesmo plantio'; end if;

 -- Atualização coordena a versão da aplicação e a da agenda; ambas avançam atomicamente.
 payload:=to_jsonb(app)||jsonb_build_object('actual_date',today-1);
 app:=public.save_spray_application(payload,app.version,sched_version);
 if app.version<>2 or (select post1_date from public.spray_schedules where planting_record_id=own_id)<>today-1
    or (select version from public.spray_schedules where planting_record_id=own_id)<>sched_version+1 then
  raise exception 'Update da aplicação não atualizou atomicamente a agenda'; end if;
 sched_version:=sched_version+1;

 -- Soft-delete remove da visão operacional, preservando a realização histórica na agenda;
 -- restaurar reexibe a mesma linha sem duplicar a etapa.
 payload:=to_jsonb(app)||jsonb_build_object('deleted',true);
 app:=public.save_spray_application(payload,app.version,sched_version);
 if not app.deleted or (select post1_date from public.spray_schedules where planting_record_id=own_id)<>today-1 then
  raise exception 'Soft-delete apagou a realização canônica'; end if;
 payload:=to_jsonb(app)||jsonb_build_object('deleted',false);
 app:=public.save_spray_application(payload,app.version,sched_version);
 if app.deleted or (select count(*) from public.spray_applications where planting_record_id=own_id and stage_id='post1')<>1 then
  raise exception 'Restauração não reexibiu a mesma etapa'; end if;

 -- Conflito de versão da aplicação e conflito de versão da agenda devem abortar.
 denied:=false;
 begin perform public.save_spray_application(to_jsonb(app)||jsonb_build_object('notes','stale'),1,sched_version);
 exception when serialization_failure then denied:=true; end;
 if not denied or (select version from public.spray_applications where id=app.id)<>app.version then
  raise exception 'Conflito de versão sobrescreveu a aplicação';
 end if;
 denied:=false;
 begin perform public.save_spray_application(to_jsonb(app)||jsonb_build_object('notes','stale schedule'),app.version,sched_version-1);
 exception when serialization_failure then denied:=true; end;
 if not denied or (select version from public.spray_applications where id=app.id)<>app.version then
  raise exception 'Conflito da agenda sobrescreveu aplicação'; end if;

 -- Contexto incompatível, excesso de área e data futura são rejeitados sem persistência.
 denied:=false;
  begin
  perform public.save_spray_application(jsonb_build_object('fazenda','FE','campo','SPRAY-APP-TEST-own',
   'ano','SPRAY_APP_TEST','cultura','Teste aplicações','planting_record_id',other_id,'stage_id','post2',
   'application_name','Contexto inválido','area',10,'planned_date',today),null,null);
 exception when check_violation then denied:=true; end;
 if not denied then raise exception 'Aceitou plantio com contexto de fazenda/talhão incompatível'; end if;
 denied:=false;
 begin
  perform public.save_spray_application(jsonb_build_object('fazenda','FE','campo','SPRAY-APP-TEST-own',
   'ano','SPRAY_APP_TEST','cultura','Teste aplicações','planting_record_id',own_id,'stage_id','post2',
   'application_name','Área excessiva','area',51,'planned_date',today),null,sched_version);
 exception when check_violation then denied:=true; end;
 if not denied then raise exception 'Aceitou área acima da execução do plantio'; end if;
 denied:=false;
 begin
  perform public.save_spray_application(jsonb_build_object('fazenda','FE','campo','SPRAY-APP-TEST-own',
   'ano','SPRAY_APP_TEST','cultura','Teste aplicações','planting_record_id',own_id,'stage_id','post2',
   'application_name','Data futura','area',10,'actual_date',today+1),null,sched_version);
 exception when check_violation then denied:=true; end;
 if not denied then raise exception 'Aceitou actual_date futura'; end if;

 -- Apenas plantios executados com fazenda, talhão, safra e cultura coincidentes aceitam vínculo.
 denied:=false;
 begin
  perform public.save_spray_application(jsonb_build_object('fazenda','FE','campo','SPRAY-APP-TEST-own',
   'ano','SPRAY_APP_TEST','cultura','Outra cultura','planting_record_id',own_id,'stage_id','post2',
   'application_name','Cultura incompatível','area',10,'planned_date',today),null,sched_version);
 exception when check_violation then denied:=true; end;
 if not denied then raise exception 'Aceitou plantio com cultura incompatível'; end if;
 if (select version from public.spray_schedules where planting_record_id=own_id)<>sched_version
    or (select post1_date from public.spray_schedules where planting_record_id=own_id)<>today-1
    or exists(select 1 from public.spray_applications where planting_record_id=own_id and stage_id='post2') then
  raise exception 'Validação inválida deixou gravação parcial na aplicação ou agenda'; end if;

 -- Viewer lê apenas FE e não grava via RPC; tampouco enxerga FE2.
 perform set_config('request.jwt.claim.sub',(select id::text from spray_app_test_users where kind='viewer'),true);
 if exists(select 1 from public.spray_applications where fazenda='FE2') then raise exception 'Viewer leu FE2'; end if;
 if not exists(select 1 from public.spray_applications where id=app.id) then raise exception 'Viewer não leu aplicação FE'; end if;
 denied:=false;
 begin perform public.save_spray_application(payload,app.version,sched_version);
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Viewer salvou aplicação via RPC'; end if;

 -- Editor não pode criar em fazenda alheia.
 perform set_config('request.jwt.claim.sub',(select id::text from spray_app_test_users where kind='editor'),true);
 denied:=false;
 begin
  perform public.save_spray_application(jsonb_build_object('fazenda','FE2','campo','SPRAY-APP-TEST-other',
   'ano','SPRAY_APP_TEST','cultura','Teste aplicações','application_name','Fora do escopo',
   'area',10,'planned_date',today),null,null);
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Editor gravou em outra fazenda'; end if;
end $$;
reset role;
rollback;
select 'RLS, CRUD/soft-delete/restauração, sincronização, atomicidade, conflitos e validações: OK; fixtures revertidas.' as validation;
