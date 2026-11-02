-- Teste transacional de acesso, validação e concorrência do cronograma de pulverização.
-- Identidades e operações são sintéticas; execute em projeto de teste e faça ROLLBACK.
begin;
set local statement_timeout = '20s';
set local lock_timeout = '3s';

create temporary table spray_test_users(kind text primary key, id uuid not null) on commit drop;
insert into spray_test_users values
 ('viewer',gen_random_uuid()), ('editor',gen_random_uuid());
grant select on spray_test_users to authenticated;

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,
 raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select id,'authenticated','authenticated','spray-test-'||kind||'@example.invalid',
 'TEST_ONLY_SYNTHETIC_HASH',now(),'{"provider":"email","providers":["email"]}'::jsonb,
 jsonb_build_object('full_name','Spray schedule test '||kind),now(),now()
from spray_test_users;
update public.profiles p set role=case u.kind when 'editor' then 'projetista'::public.user_role
 else 'visualizador'::public.user_role end,all_farms=false
from spray_test_users u where p.id=u.id;
insert into public.user_farm_access(user_id,farm_code)
select id,'FE' from spray_test_users;

create temporary table spray_test_records(kind text primary key,id uuid not null) on commit drop;
insert into spray_test_records values ('own',gen_random_uuid()),('other',gen_random_uuid()),('fertilizer',gen_random_uuid());
grant select on spray_test_records to authenticated;
insert into public.farm_fields(farm_code,campo,feature)
select case kind when 'other' then 'FE2' else 'FE' end,'SPRAY-TEST-'||kind,
 jsonb_build_object('type','Feature','geometry',null,'properties',
   jsonb_build_object('Fazenda',case kind when 'other' then 'FE2' else 'FE' end,'Campo','SPRAY-TEST-'||kind))
from spray_test_records;
insert into public.operation_records(id,operation_type,fazenda,campo,ano,cultura,produto,
 status,area_total,area_realizada,percentual_realizado,variedade_semente,data_plantio)
select id,'plantio',case kind when 'other' then 'FE2' else 'FE' end,
 'SPRAY-TEST-'||kind,'SPRAY_TEST','Teste cronograma','Plantio','concluido',1,1,100,'Semente teste',
 (now() at time zone 'America/Sao_Paulo')::date-45
from spray_test_records where kind in ('own','other');
insert into public.operation_records(id,operation_type,fazenda,campo,ano,cultura,produto,area_total)
select id,'adubacao','FE','SPRAY-TEST-fertilizer','SPRAY_TEST','Teste cronograma','Fertilizante teste',1
from spray_test_records where kind='fertilizer';

-- A tabela não é acessível a anon por ACL; authenticated é limitado por RLS.
do $$ begin
 if has_table_privilege('anon','public.spray_schedules','SELECT') then
  raise exception 'anon recebeu SELECT em spray_schedules';
 end if;
 if not has_table_privilege('authenticated','public.spray_schedules','SELECT') then
  raise exception 'authenticated não recebeu SELECT em spray_schedules';
 end if;
end $$;

select set_config('request.jwt.claim.sub',(select id::text from spray_test_users where kind='editor'),true);
set local role authenticated;
insert into public.spray_schedules(planting_record_id,post1_date,post2_date,fung1_date,fung2_date,fung3_date)
select id,(now() at time zone 'America/Sao_Paulo')::date-20,
 (now() at time zone 'America/Sao_Paulo')::date-15,
 (now() at time zone 'America/Sao_Paulo')::date-10,
 (now() at time zone 'America/Sao_Paulo')::date-5,
 (now() at time zone 'America/Sao_Paulo')::date-1
from spray_test_records where kind='own';

do $$
declare own_id uuid; other_id uuid; fertilizer_id uuid; affected integer; denied boolean; base_version integer;
        today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
 select id into own_id from spray_test_records where kind='own';
 select id into other_id from spray_test_records where kind='other';
 select id into fertilizer_id from spray_test_records where kind='fertilizer';
 if (select count(*) from public.spray_schedules)<>1 then
  raise exception 'Editor não vê exatamente o cronograma da própria fazenda';
 end if;
 if (select version from public.spray_schedules where planting_record_id=own_id)<>1 then
  raise exception 'Versão inicial diferente de 1';
 end if;
 -- Visualizador pode ler seu escopo, mas não escrever.
 perform set_config('request.jwt.claim.sub',(select id::text from spray_test_users where kind='viewer'),true);
 if (select count(*) from public.spray_schedules)<>1 then raise exception 'Visualizador não leu sua fazenda'; end if;
 update public.spray_schedules set post1_date=today where planting_record_id=own_id;
 get diagnostics affected=row_count;
 if affected<>0 then raise exception 'Visualizador alterou cronograma'; end if;
 denied:=false;
 begin
  insert into public.spray_schedules(planting_record_id) values(own_id);
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Visualizador inseriu cronograma'; end if;

 -- Editor lê e altera FE, mas não lê nem altera FE2.
 perform set_config('request.jwt.claim.sub',(select id::text from spray_test_users where kind='editor'),true);
 if exists(select 1 from public.spray_schedules where planting_record_id=other_id) then
  raise exception 'Editor leu cronograma de outra fazenda'; end if;
 update public.spray_schedules set post1_date=post1_date where planting_record_id=other_id;
 get diagnostics affected=row_count;
 if affected<>0 then raise exception 'Editor alterou cronograma de outra fazenda'; end if;

 -- Ordem cronológica, datas futuras e lacunas são rejeitadas.
 denied:=false;
 begin update public.spray_schedules set post2_date=post1_date-1 where planting_record_id=own_id;
 exception when check_violation then denied:=true; end;
 if not denied then raise exception 'Aceitou datas fora de ordem'; end if;
 denied:=false;
 begin update public.spray_schedules set post1_date=today+1 where planting_record_id=own_id;
 exception when check_violation then denied:=true; end;
 if not denied then raise exception 'Aceitou data futura'; end if;
 denied:=false;
 begin update public.spray_schedules set post1_date=null where planting_record_id=own_id;
 exception when check_violation then denied:=true; end;
 if not denied then raise exception 'Aceitou lacuna antes de aplicações posteriores'; end if;

 -- O quarto fungicida pode permanecer sem data; quando informado deve obedecer à sequência.
 update public.spray_schedules set fourth_enabled=true,fung4_date=today where planting_record_id=own_id;
 if (select fung4_date from public.spray_schedules where planting_record_id=own_id)<>today then
  raise exception 'Quarto fungicida opcional informado não foi salvo'; end if;
 update public.spray_schedules set fourth_enabled=false,fung4_date=null where planting_record_id=own_id;
 if (select fung4_date from public.spray_schedules where planting_record_id=own_id) is not null then
  raise exception 'Quarto fungicida opcional não pôde ficar sem data'; end if;
 denied:=false;
 begin update public.spray_schedules set fourth_enabled=true,fung4_date=today-2 where planting_record_id=own_id;
 exception when check_violation then denied:=true; end;
 if not denied then raise exception 'Aceitou quarto fungicida fora de ordem'; end if;

 -- O trigger incrementa a versão; um update com versão-base antiga afeta zero linhas.
 select version into base_version from public.spray_schedules where planting_record_id=own_id;
 update public.spray_schedules set post1_date=post1_date where planting_record_id=own_id and version=base_version;
 get diagnostics affected=row_count;
 if affected<>1 or (select version from public.spray_schedules where planting_record_id=own_id)<>base_version+1 then
  raise exception 'Update não incrementou a versão'; end if;
 update public.spray_schedules set post1_date=today where planting_record_id=own_id and version=base_version;
 get diagnostics affected=row_count;
 if affected<>0 then raise exception 'Update com versão antiga sobrescreveu cronograma'; end if;

 -- A tabela declara FK para operação; o trigger também rejeita IDs sem plantio válido.
 if not exists(select 1 from pg_constraint where conrelid='public.spray_schedules'::regclass
    and contype='f' and confrelid='public.operation_records'::regclass) then
  raise exception 'FK para operation_records ausente'; end if;
 denied:=false;
 begin insert into public.spray_schedules(planting_record_id) values(gen_random_uuid());
 exception when check_violation then denied:=true; end;
 if not denied then raise exception 'Aceitou referência inexistente'; end if;
 denied:=false;
 begin insert into public.spray_schedules(planting_record_id) values(fertilizer_id);
 exception when check_violation then denied:=true; end;
 if not denied then raise exception 'Aceitou referência a uma operação que não é plantio'; end if;
end $$;
reset role;
rollback;
select 'RLS, validação temporal, quarto fungicida opcional, versionamento otimista e referência ao plantio: OK; fixtures revertidas.' as validation;
