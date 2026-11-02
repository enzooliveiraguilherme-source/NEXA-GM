-- Teste transacional da gravação em lote de aplicações e da agenda legada.
-- Identidades e operações são sintéticas; execute em projeto de teste e faça ROLLBACK.
begin;
set local statement_timeout='25s';
set local lock_timeout='3s';

create temporary table spray_batch_users(kind text primary key,id uuid not null) on commit drop;
insert into spray_batch_users values ('viewer',gen_random_uuid()),('editor',gen_random_uuid());
grant select on spray_batch_users to authenticated;
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,
 raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select id,'authenticated','authenticated','spray-batch-'||kind||'@example.invalid',
 'TEST_ONLY_SYNTHETIC_HASH',now(),'{"provider":"email","providers":["email"]}'::jsonb,
 jsonb_build_object('full_name','Spray batch test '||kind),now(),now()
from spray_batch_users;
update public.profiles p set role=case u.kind when 'editor' then 'projetista'::public.user_role
 else 'visualizador'::public.user_role end,all_farms=false
from spray_batch_users u where p.id=u.id;
insert into public.user_farm_access(user_id,farm_code) select id,'FE' from spray_batch_users;

create temporary table spray_batch_plant(id uuid primary key) on commit drop;
insert into spray_batch_plant values(gen_random_uuid());
grant select on spray_batch_plant to authenticated;
insert into public.farm_fields(farm_code,campo,feature) values
 ('FE','SPRAY-BATCH-TEST',jsonb_build_object('type','Feature','geometry',null,'properties',
  jsonb_build_object('Fazenda','FE','Campo','SPRAY-BATCH-TEST','Area',100))),
 ('FE2','SPRAY-BATCH-OTHER',jsonb_build_object('type','Feature','geometry',null,'properties',
  jsonb_build_object('Fazenda','FE2','Campo','SPRAY-BATCH-OTHER','Area',100)));
insert into public.operation_records(id,operation_type,fazenda,campo,ano,cultura,produto,status,
 area_total,area_realizada,percentual_realizado,variedade_semente,data_plantio)
select id,'plantio','FE','SPRAY-BATCH-TEST','SPRAY_BATCH_TEST','Teste lote','Plantio','concluido',
 50,50,100,'Semente teste',(now() at time zone 'America/Sao_Paulo')::date-30 from spray_batch_plant;

select set_config('request.jwt.claim.sub',(select id::text from spray_batch_users where kind='editor'),true);
set local role authenticated;
do $$
declare pid uuid; today date := (now() at time zone 'America/Sao_Paulo')::date;
        d1 date:=today-8; d2 date:=today-4; sv integer; n integer;
        post1 public.spray_applications; post2 public.spray_applications;
        payload1 jsonb; payload2 jsonb; records jsonb; denied boolean;
begin
 select id into pid from spray_batch_plant;
 insert into public.spray_schedules(planting_record_id,post1_date,post2_date)
 values(pid,d1,d2);
 select version into sv from public.spray_schedules where planting_record_id=pid;
 post1:=public.save_spray_application(jsonb_build_object('fazenda','FE','campo','SPRAY-BATCH-TEST',
  'ano','SPRAY_BATCH_TEST','cultura','Teste lote','planting_record_id',pid,'stage_id','post1',
  'application_name','Pós um','area',25,'actual_date',d1),null,sv);
 post2:=public.save_spray_application(jsonb_build_object('fazenda','FE','campo','SPRAY-BATCH-TEST',
  'ano','SPRAY_BATCH_TEST','cultura','Teste lote','planting_record_id',pid,'stage_id','post2',
  'application_name','Pós dois','area',25,'actual_date',d2),null,sv);

 -- Duas etapas salvas juntas retornam as duas linhas e sincronizam a agenda uma vez.
 payload1:=to_jsonb(post1)||jsonb_build_object('actual_date',today-7);
 payload2:=to_jsonb(post2)||jsonb_build_object('actual_date',today-3);
 records:=jsonb_build_array(jsonb_build_object('payload',payload1,'expected_version',post1.version,'schedule_version',sv),
  jsonb_build_object('payload',payload2,'expected_version',post2.version,'schedule_version',sv));
 select count(*) into n from public.save_spray_application_batch(records);
 if n<>2 then raise exception 'Lote de duas etapas retornou % linhas, esperado 2',n; end if;
 select * into post1 from public.spray_applications where id=post1.id;
 select * into post2 from public.spray_applications where id=post2.id;
 if post1.version<>2 or post2.version<>2 then raise exception 'Versões das duas linhas não avançaram'; end if;
 select version into sv from public.spray_schedules where planting_record_id=pid;
 if sv<>2 or (select post1_date from public.spray_schedules where planting_record_id=pid)<>today-7
    or (select post2_date from public.spray_schedules where planting_record_id=pid)<>today-3 then
  raise exception 'Agenda não sincronizou o lote de duas etapas'; end if;

 -- Limpar somente post1 enquanto post2 está realizada deixa estado final inválido e reverte tudo.
 denied:=false;
 begin
  perform public.save_spray_application_batch(jsonb_build_array(
   jsonb_build_object('payload',to_jsonb(post1)||jsonb_build_object('actual_date',null),
     'expected_version',post1.version,'schedule_version',sv)));
 exception when check_violation then denied:=true; end;
 if not denied then raise exception 'Aceitou limpar post1 deixando post2 realizada'; end if;
 if (select version from public.spray_schedules where planting_record_id=pid)<>sv
    or (select post1_date from public.spray_schedules where planting_record_id=pid)<>today-7
    or (select version from public.spray_applications where id=post1.id)<>post1.version then
  raise exception 'Falha da validação final deixou gravação parcial'; end if;

 -- Limpar post1 e post2 no mesmo lote é válido; agenda e metadata ficam consistentes.
 records:=jsonb_build_array(
  jsonb_build_object('payload',to_jsonb(post1)||jsonb_build_object('actual_date',null),
   'expected_version',post1.version,'schedule_version',sv),
  jsonb_build_object('payload',to_jsonb(post2)||jsonb_build_object('actual_date',null),
   'expected_version',post2.version,'schedule_version',sv));
 select count(*) into n from public.save_spray_application_batch(records);
 if n<>2 then raise exception 'Lote que limpa duas etapas não retornou duas linhas'; end if;
 select version into sv from public.spray_schedules where planting_record_id=pid;
 if (select post1_date from public.spray_schedules where planting_record_id=pid) is not null
    or (select post2_date from public.spray_schedules where planting_record_id=pid) is not null then
  raise exception 'Limpeza conjunta não limpou datas canônicas'; end if;
 select * into post1 from public.spray_applications where id=post1.id;
 select * into post2 from public.spray_applications where id=post2.id;

 -- Todas as linhas da mesma origem precisam usar a mesma versão de agenda.
 denied:=false;
 begin
  perform public.save_spray_application_batch(jsonb_build_array(
   jsonb_build_object('payload',to_jsonb(post1)||jsonb_build_object('actual_date',today-6),
     'expected_version',post1.version,'schedule_version',sv),
   jsonb_build_object('payload',to_jsonb(post2),'expected_version',post2.version,'schedule_version',sv-1)));
 exception when serialization_failure then denied:=true; end;
 if not denied or (select version from public.spray_schedules where planting_record_id=pid)<>sv
    or (select post1_date from public.spray_schedules where planting_record_id=pid) is not null then
  raise exception 'Aceitou versão de agenda divergente entre itens ou deixou efeito parcial'; end if;

 -- Versão obsoleta de qualquer item reverte também a mutação já calculada para a agenda.
 denied:=false;
 begin
  perform public.save_spray_application_batch(jsonb_build_array(
   jsonb_build_object('payload',to_jsonb(post1)||jsonb_build_object('actual_date',today-6),
     'expected_version',post1.version,'schedule_version',sv),
   jsonb_build_object('payload',to_jsonb(post2)||jsonb_build_object('notes','stale item'),
     'expected_version',post2.version-1,'schedule_version',sv)));
 exception when serialization_failure then denied:=true; end;
 if not denied then raise exception 'Aceitou versão obsoleta em um item do lote'; end if;
 if (select version from public.spray_schedules where planting_record_id=pid)<>sv
    or (select post1_date from public.spray_schedules where planting_record_id=pid) is not null
    or (select version from public.spray_applications where id=post1.id)<>post1.version
    or (select version from public.spray_applications where id=post2.id)<>post2.version then
  raise exception 'Conflito de uma linha não reverteu todas as linhas e agenda'; end if;

 -- Um item manual em outra fazenda falha depois da preparação da agenda; tudo deve reverter.
 denied:=false;
 begin
  perform public.save_spray_application_batch(jsonb_build_array(
   jsonb_build_object('payload',to_jsonb(post1)||jsonb_build_object('actual_date',today-6),
     'expected_version',post1.version,'schedule_version',sv),
   jsonb_build_object('payload',jsonb_build_object('fazenda','FE2','campo','SPRAY-BATCH-OTHER',
     'ano','SPRAY_BATCH_TEST','cultura','Teste lote','application_name','Manual fora do escopo',
     'area',10,'planned_date',today),'expected_version',null,'schedule_version',null)));
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Lote aceitou aplicação manual de outra fazenda'; end if;
 if (select version from public.spray_schedules where planting_record_id=pid)<>sv
    or (select post1_date from public.spray_schedules where planting_record_id=pid) is not null
    or (select version from public.spray_applications where id=post1.id)<>post1.version then
  raise exception 'Falha de escopo não reverteu a agenda e registros'; end if;

 -- Duplicatas, lote vazio e limite superior são recusados.
 denied:=false;
 begin perform public.save_spray_application_batch(jsonb_build_array(
   jsonb_build_object('payload',to_jsonb(post1),'expected_version',post1.version,'schedule_version',sv),
   jsonb_build_object('payload',to_jsonb(post1),'expected_version',post1.version,'schedule_version',sv)));
 exception when check_violation then denied:=true; end;
 if not denied then raise exception 'Aceitou aplicação duplicada no mesmo lote'; end if;
 denied:=false;
 begin perform public.save_spray_application_batch('[]'::jsonb);
 exception when check_violation then denied:=true; end;
 if not denied then raise exception 'Aceitou lote vazio'; end if;
 denied:=false;
 begin perform public.save_spray_application_batch((select jsonb_agg(jsonb_build_object('payload','{}'::jsonb)) from generate_series(1,1001)));
 exception when check_violation then denied:=true; end;
 if not denied then raise exception 'Aceitou lote acima do limite 1000'; end if;

 -- Visualizador não pode usar a RPC de lote.
 perform set_config('request.jwt.claim.sub',(select id::text from spray_batch_users where kind='viewer'),true);
 denied:=false;
 begin perform public.save_spray_application_batch('[]'::jsonb);
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Visualizador executou RPC de lote'; end if;
end $$;
reset role;
rollback;
select 'Lote, contagem, estado final, conflitos, RLS, rollback, duplicados e limites: OK; fixtures revertidas.' as validation;
