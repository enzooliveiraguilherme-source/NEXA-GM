-- Teste transacional da data de início da execução de pulverização.
-- Somente fixtures sintéticas; execute em ambiente de teste. Todo o conteúdo é revertido.
begin;
set local statement_timeout='20s';
set local lock_timeout='3s';

create temporary table spray_start_test_users(kind text primary key,id uuid not null) on commit drop;
insert into spray_start_test_users values ('editor',gen_random_uuid()),('viewer',gen_random_uuid());
grant select on spray_start_test_users to authenticated;
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,
 raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select id,'authenticated','authenticated','spray-start-test-'||kind||'@example.invalid',
 'TEST_ONLY_SYNTHETIC_HASH',now(),'{"provider":"email","providers":["email"]}'::jsonb,
 jsonb_build_object('full_name','Spray start test '||kind),now(),now()
from spray_start_test_users;
update public.profiles p set role=case u.kind when 'editor' then 'projetista'::public.user_role
 else 'visualizador'::public.user_role end,all_farms=false
from spray_start_test_users u where p.id=u.id;
insert into public.user_farm_access(user_id,farm_code)
select id,'FE' from spray_start_test_users;

create temporary table spray_start_test_record(id uuid primary key) on commit drop;
insert into spray_start_test_record values (gen_random_uuid());
grant select on spray_start_test_record to authenticated;
insert into public.farm_fields(farm_code,campo,feature)
values('FE','SPRAY-START-TEST',
 jsonb_build_object('type','Feature','geometry',null,'properties',
  jsonb_build_object('Fazenda','FE','Campo','SPRAY-START-TEST','Area',100)));
insert into public.operation_records(id,operation_type,fazenda,campo,ano,cultura,produto,status,
 area_total,area_realizada,percentual_realizado,variedade_semente,data_plantio)
select id,'plantio','FE','SPRAY-START-TEST','SPRAY_START_TEST','Teste início',
 'Plantio','concluido',50,50,100,'Semente teste',
 (now() at time zone 'America/Sao_Paulo')::date-30
from spray_start_test_record;

select set_config('request.jwt.claim.sub',(select id::text from spray_start_test_users where kind='editor'),true);
set local role authenticated;
do $$
declare
 planting_id uuid;
 today date := (now() at time zone 'America/Sao_Paulo')::date;
 sched_version integer;
 app public.spray_applications;
 payload jsonb;
 denied boolean;
 before_version integer;
 before_started date;
begin
 select id into planting_id from spray_start_test_record;
 select version into sched_version from public.spray_schedules where planting_record_id=planting_id;

 -- Gravação do início via RPC.
 payload:=jsonb_build_object('fazenda','FE','campo','SPRAY-START-TEST','ano','SPRAY_START_TEST',
  'cultura','Teste início','planting_record_id',planting_id,'stage_id','post1',
  'application_name','Início teste','product','Produto teste','dose',1,'dose_unit','L/ha',
  'area',10,'planned_date',today,'started_date',today);
 app:=public.save_spray_application(payload,null,sched_version);
 if app.started_date is distinct from today then
  raise exception 'save_spray_application não persistiu started_date';
 end if;

 -- Cliente antigo sem a chave started_date mantém o valor existente.
 payload:=(to_jsonb(app)-'started_date')||jsonb_build_object('notes','Atualizado por cliente antigo');
 app:=public.save_spray_application(payload,app.version,sched_version);
 if app.started_date is distinct from today or app.notes<>'Atualizado por cliente antigo' then
  raise exception 'Payload antigo limpou ou não preservou started_date';
 end if;

 -- Payload atual com started_date explícito null limpa o início.
 payload:=to_jsonb(app)||jsonb_build_object('started_date',null);
 app:=public.save_spray_application(payload,app.version,sched_version);
 if app.started_date is not null then raise exception 'started_date:null não limpou a data'; end if;

 -- Início futuro deve ser rejeitado.
 denied:=false;
 begin
  perform public.save_spray_application(to_jsonb(app)||jsonb_build_object('started_date',today+1),app.version,sched_version);
 exception when check_violation then denied:=true;
 end;
 if not denied then raise exception 'Aceitou início de execução futuro'; end if;

 -- Início anterior à data de plantio deve ser rejeitado.
 denied:=false;
 begin
  perform public.save_spray_application(to_jsonb(app)||jsonb_build_object('started_date',today-31),app.version,sched_version);
 exception when check_violation then denied:=true;
 end;
 if not denied then raise exception 'Aceitou início anterior ao plantio'; end if;

 -- Conclusão anterior ao início deve ser rejeitada pela constraint de ordenação.
 denied:=false;
 begin
  perform public.save_spray_application(to_jsonb(app)||jsonb_build_object('started_date',today,'actual_date',today-1),app.version,sched_version);
 exception when check_violation then denied:=true;
 end;
 if not denied then raise exception 'Aceitou conclusão anterior ao início'; end if;

 -- O viewer lê o registro, mas não pode gravar via RPC.
 perform set_config('request.jwt.claim.sub',(select id::text from spray_start_test_users where kind='viewer'),true);
 select version,started_date into before_version,before_started
 from public.spray_applications where id=app.id;
 if not found or before_started is not null then
  raise exception 'Viewer não leu registro ou encontrou estado inesperado';
 end if;
 denied:=false;
 begin
  perform public.save_spray_application(to_jsonb(app)||jsonb_build_object('started_date',today),app.version,sched_version);
 exception when insufficient_privilege then denied:=true;
 end;
 if not denied then raise exception 'Viewer conseguiu gravar started_date'; end if;
 if (select version from public.spray_applications where id=app.id)<>before_version
    or (select started_date from public.spray_applications where id=app.id) is distinct from before_started then
  raise exception 'Tentativa do viewer alterou o registro';
 end if;
end $$;
reset role;
rollback;
select 'started_date persistência, compatibilidade payload antigo, limpeza null, rejeições e viewer somente leitura: OK; fixtures revertidas.' as validation;
 
