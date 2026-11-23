-- Integração: conclusões antecipadas de pulverização com fixtures sintéticas.
-- Executar somente após aplicação da migração correspondente. Tudo é revertido.
begin;
set local statement_timeout='25s';
set local lock_timeout='3s';

create temporary table spray_early_users(kind text primary key,id uuid not null) on commit drop;
insert into spray_early_users values ('editor',gen_random_uuid());
grant select on spray_early_users to authenticated;
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,
 raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select id,'authenticated','authenticated','spray-early-'||kind||'@example.invalid',
 'TEST_ONLY_SYNTHETIC_HASH',now(),'{"provider":"email","providers":["email"]}'::jsonb,
 jsonb_build_object('full_name','Spray early test '||kind),now(),now() from spray_early_users;
update public.profiles p set role='projetista'::public.user_role,all_farms=false
from spray_early_users u where p.id=u.id;
insert into public.user_farm_access(user_id,farm_code)
select id,'FE' from spray_early_users;

create temporary table spray_early_plants(id uuid primary key, label text) on commit drop;
insert into spray_early_plants values(gen_random_uuid(),'SINGLE'),(gen_random_uuid(),'BATCH');
grant select on spray_early_plants to authenticated;
insert into public.farm_fields(farm_code,campo,feature) values
 ('FE','SPRAY-EARLY-SINGLE',jsonb_build_object('type','Feature','geometry',null,'properties',jsonb_build_object('Fazenda','FE','Campo','SPRAY-EARLY-SINGLE','Area',100))),
 ('FE','SPRAY-EARLY-BATCH',jsonb_build_object('type','Feature','geometry',null,'properties',jsonb_build_object('Fazenda','FE','Campo','SPRAY-EARLY-BATCH','Area',100)));
insert into public.operation_records(id,operation_type,fazenda,campo,ano,cultura,produto,status,
 area_total,area_realizada,percentual_realizado,variedade_semente,data_plantio)
select p.id,'plantio','FE',case p.label when 'SINGLE' then 'SPRAY-EARLY-SINGLE' else 'SPRAY-EARLY-BATCH' end,
 'SPRAY_EARLY_TEST','Teste antecipado','Plantio','concluido',50,50,100,'Semente teste',(now() at time zone 'America/Sao_Paulo')::date-60 from spray_early_plants p;

select set_config('request.jwt.claim.sub',(select id::text from spray_early_users where kind='editor'),true);
set local role authenticated;
do $$
declare
 today date := (now() at time zone 'America/Sao_Paulo')::date;
 pid_single uuid; pid_batch uuid; sv_single int; sv_batch int; n int; denied boolean;
 stages text[]:=array['post1','post2','fung1','fung2','fung3','fung4'];
 dates date[]; plans date[]; apps public.spray_applications[];
 approw public.spray_applications; payload jsonb; records jsonb;
 i int; j int; manual_row public.spray_applications; f_single text:='SPRAY-EARLY-SINGLE'; f_batch text:='SPRAY-EARLY-BATCH';
begin
 select id into pid_single from spray_early_plants where label='SINGLE';
 select id into pid_batch from spray_early_plants where label='BATCH';
 dates:=array[today-50,today-45,today-40,today-35,today-30,today-25];
 plans:=array[today-20,today-18,today-16,today-14,today-12,today-10];
 insert into public.spray_schedules(planting_record_id,post1_date,post2_date)
 values(pid_single,plans[1],plans[2]),(pid_batch,plans[1],plans[2]);
 select version into sv_single from public.spray_schedules where planting_record_id=pid_single;
 select version into sv_batch from public.spray_schedules where planting_record_id=pid_batch;

 -- Single RPC: seis estágios concluídos antes das datas previstas.
 for i in 1..6 loop
  apps[i]:=public.save_spray_application(jsonb_build_object('fazenda','FE','campo',f_single,
   'ano','SPRAY_EARLY_TEST','cultura','Teste antecipado','planting_record_id',pid_single,
   'stage_id',stages[i],'application_name','Etapa '||stages[i],'area',20,
   'planned_date',plans[i],'actual_date',dates[i]),null,sv_single);
  select version into sv_single from public.spray_schedules where planting_record_id=pid_single;
 end loop;
 for i in 1..6 loop
  select * into approw from public.spray_applications where id=apps[i].id;
  if approw.actual_date<>dates[i] or approw.planned_date<>plans[i] then
   raise exception 'Single % não manteve datas/status de conclusão',stages[i]; end if;
 end loop;
 select version into sv_single from public.spray_schedules where planting_record_id=pid_single;
 if (select post1_date from public.spray_schedules where planting_record_id=pid_single)<>dates[1]
    or (select post2_date from public.spray_schedules where planting_record_id=pid_single)<>dates[2] then
  raise exception 'Single não sincronizou post1/post2 com datas reais'; end if;

 -- Batch RPC com claims/authenticated: cria todos os estágios no segundo plantio.
 records:='[]'::jsonb;
 for i in 1..6 loop
  payload:=jsonb_build_object('fazenda','FE','campo',f_batch,'ano','SPRAY_EARLY_TEST',
   'cultura','Teste antecipado','planting_record_id',pid_batch,'stage_id',stages[i],
   'application_name','Etapa batch '||stages[i],'area',20,'planned_date',plans[i],'actual_date',dates[i]);
  records:=records||jsonb_build_array(jsonb_build_object('payload',payload,'expected_version',null,'schedule_version',sv_batch));
 end loop;
 select count(*) into n from public.save_spray_application_batch(records);
 if n<>6 then raise exception 'Batch retornou % linhas, esperado 6',n; end if;
 select version into sv_batch from public.spray_schedules where planting_record_id=pid_batch;
 for i in 1..6 loop
  select * into approw from public.spray_applications where planting_record_id=pid_batch and stage_id=stages[i];
  if approw.id is null or approw.actual_date<>dates[i] or approw.planned_date<>plans[i]
     then
   raise exception 'Batch % não manteve datas/status de conclusão',stages[i]; end if;
 end loop;
 if (select post1_date from public.spray_schedules where planting_record_id=pid_batch)<>dates[1]
    or (select post2_date from public.spray_schedules where planting_record_id=pid_batch)<>dates[2] then
  raise exception 'Batch não sincronizou cronograma com datas reais'; end if;

 -- Manual planejada no futuro e concluída antecipadamente; planned_date permanece intacta.
 manual_row:=public.save_spray_application(jsonb_build_object('fazenda','FE','campo',f_single,
  'ano','SPRAY_EARLY_TEST','cultura','Teste antecipado','application_name','Manual planejada futura',
  'area',10,'planned_date',today+10,'actual_date',today-5),null,null);
 if manual_row.actual_date<>today-5 or manual_row.planned_date<>today+10 then
  raise exception 'Manual planejada futura não preservou conclusão e previsão'; end if;

 -- Pré, boro e dessecação independentes podem ser concluídas antes da previsão.
 foreach payload in array array[
  jsonb_build_object('stage_id','pre','application_name','Pré independente','actual_date',today-40,'planned_date',today-20),
  jsonb_build_object('stage_id','boro','application_name','Boro independente','actual_date',today-39,'planned_date',today-19),
  jsonb_build_object('stage_id','desiccation','application_name','Dessecação independente','actual_date',today-38,'planned_date',today-18)] loop
  approw:=public.save_spray_application(payload||jsonb_build_object('fazenda','FE','campo',f_single,
   'ano','SPRAY_EARLY_TEST','cultura','Teste antecipado','area',10),null,null);
  if approw.actual_date is null or approw.planned_date is null
     or approw.actual_date>=approw.planned_date then
   raise exception 'Etapa independente % não aceitou conclusão antecipada',approw.stage_id; end if;
 end loop;

 -- Nova regra: aplicação manual concluída sem planned_date.
 manual_row:=public.save_spray_application(jsonb_build_object('fazenda','FE','campo',f_single,
  'ano','SPRAY_EARLY_TEST','cultura','Teste antecipado','application_name','Manual sem previsão',
  'area',10,'actual_date',today-4),null,null);
 if manual_row.actual_date<>today-4 or manual_row.planned_date is not null then
  raise exception 'Manual concluída sem planned_date não foi aceita'; end if;

 -- Datas futuras, anteriores ao plantio e sequência real invertida devem falhar.
 denied:=false;
 begin perform public.save_spray_application(jsonb_build_object('fazenda','FE','campo',f_single,
  'ano','SPRAY_EARLY_TEST','cultura','Teste antecipado','application_name','Actual futuro','area',5,
  'actual_date',today+1),null,null);
 exception when check_violation then denied:=true; end;
 if not denied then raise exception 'Aceitou actual_date futura'; end if;
 denied:=false;
 begin perform public.save_spray_application(jsonb_build_object('fazenda','FE','campo',f_single,
  'ano','SPRAY_EARLY_TEST','cultura','Teste antecipado','planting_record_id',pid_single,
  'stage_id','fung1','application_name','Antes do plantio','area',5,'actual_date',today-61,
  'planned_date',today-20),null,sv_single);
 exception when check_violation then denied:=true; end;
 if not denied then raise exception 'Aceitou actual anterior à data de plantio'; end if;
 denied:=false;
 begin perform public.save_spray_application(to_jsonb(apps[2])||jsonb_build_object('actual_date',today-51),
   apps[2].version,sv_single);
 exception when check_violation then denied:=true; end;
 if not denied then raise exception 'Aceitou sequência real post2 anterior a post1'; end if;
end $$;
reset role;
rollback;
select 'Conclusão antecipada single/batch, previsões preservadas, etapas independentes, regras temporais e rollback: OK; fixtures revertidas.' as validation;





