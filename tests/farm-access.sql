-- Teste real de RLS e gravação atômica. Todas as contas e operações são revertidas.
begin;
create temporary table access_test_users(id uuid,kind text) on commit drop;
insert into access_test_users values(gen_random_uuid(),'editor'),(gen_random_uuid(),'viewer'),(gen_random_uuid(),'unconfirmed'),(gen_random_uuid(),'all'),(gen_random_uuid(),'other');
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
select id,id::text||'@example.invalid',case when kind='unconfirmed' then null else now() end,'{"full_name":"Teste temporário"}'::jsonb from access_test_users;
update public.profiles p set role=case when t.kind='editor' then 'projetista'::public.user_role else 'visualizador'::public.user_role end,all_farms=t.kind='all'
from access_test_users t where p.id=t.id;
insert into public.user_farm_access(user_id,farm_code) select id,case when kind='other' then 'FE2' else 'FE' end from access_test_users where kind<>'all';
grant select on access_test_users to authenticated;
select set_config('request.jwt.claim.sub',(select id::text from access_test_users where kind='editor'),true);
set local role authenticated;
do $$
declare first_field text; second_field text; saved public.operation_records; saved2 public.operation_records; denied boolean:=false;
begin
 if not public.can_access_farm('FE') or public.can_access_farm('FE2') then raise exception 'Falhou isolamento por fazenda'; end if;
 if exists(select 1 from public.farm_fields where farm_code<>'FE') then raise exception 'Geometria de outra fazenda visível'; end if;
 if (select count(*) from public.list_accessible_farms())<>1 then raise exception 'Lista de fazendas incorreta'; end if;
 if not exists(select 1 from public.harvest_test_datasets where slug='fe-milho-2026') or not exists(select 1 from public.harvest_test_files) then raise exception 'Colheita da fazenda não compartilhada'; end if;
 select campo into first_field from public.farm_fields order by campo limit 1;
 select campo into second_field from public.farm_fields where campo<>first_field order by campo limit 1;
 begin
  perform public.save_operation_batch(jsonb_build_array(
   jsonb_build_object('operation_type','adubacao','fazenda','FE','campo',first_field,'ano','TESTE','cultura','Teste','produto','Teste','status','concluido','area_total',10,'area_realizada',10,'percentual_realizado',100,'taxa_aplicada',2,'tipo_progresso','percentual'),
   jsonb_build_object('operation_type','adubacao','fazenda','FE2','campo','Talhão proibido','ano','TESTE','cultura','Teste','produto','Teste','status','nao_iniciado','area_total',10,'area_realizada',0,'percentual_realizado',0,'tipo_progresso','percentual')));
 exception when insufficient_privilege then denied:=true;
 end;
 if not denied or exists(select 1 from public.operation_records where ano='TESTE') then raise exception 'Lote não foi revertido por completo'; end if;
 select * into saved from public.save_operation_batch(jsonb_build_array(jsonb_build_object('operation_type','plantio','fazenda','FE','campo',first_field,'ano','TESTE','cultura','Teste','produto','Plantio','status','concluido','area_total',10,'area_realizada',10,'percentual_realizado',100,'variedade_semente','Teste','data_plantio','2026-10-08','tipo_progresso','percentual')));
 select * into saved2 from public.save_operation_batch(jsonb_build_array(jsonb_build_object('operation_type','plantio','fazenda','FE','campo',second_field,'ano','TESTE','cultura','Teste','produto','Plantio','status','concluido','area_total',10,'area_realizada',10,'percentual_realizado',100,'variedade_semente','Teste','data_plantio','2026-10-08','tipo_progresso','percentual')));
 if saved.created_by<>auth.uid() or saved.version<>1 then raise exception 'Autor ou versão incorretos'; end if;
 denied:=false;
 begin
  perform public.save_operation_batch(jsonb_build_array(to_jsonb(saved)||'{"status":"nao_iniciado","area_realizada":0,"percentual_realizado":0}',to_jsonb(saved2)||'{"version":0}'));
 exception when serialization_failure then denied:=true;
 end;
 if not denied or (select version from public.operation_records where id=saved.id)<>1 then raise exception 'Conflito sobrescreveu parte do lote'; end if;
 if (select count(*) from public.operation_history where record_id in(saved.id,saved2.id))<>2 then raise exception 'Histórico incorreto'; end if;
 begin
  perform public.admin_set_access(auth.uid(),'admin',true,'{}');
  raise exception 'Editor conseguiu administrar acessos';
 exception when insufficient_privilege then null;
 end;
 perform set_config('request.jwt.claim.sub',(select id::text from access_test_users where kind='viewer'),true);
 if public.can_edit_operations() or not public.can_access_farm('FE') then raise exception 'Permissão de visualizador incorreta'; end if;
 if not exists(select 1 from public.harvest_test_datasets where slug='fe-milho-2026') then raise exception 'Segundo usuário da mesma fazenda não viu a colheita'; end if;
 begin
  perform public.save_operation_batch(jsonb_build_array(to_jsonb(saved)));
  raise exception 'Visualizador conseguiu salvar';
 exception when insufficient_privilege then null;
 end;
 perform set_config('request.jwt.claim.sub',(select id::text from access_test_users where kind='unconfirmed'),true);
 if public.can_access_farm('FE') or exists(select 1 from public.farm_fields) or exists(select 1 from public.operation_records) then raise exception 'E-mail não confirmado conseguiu ler'; end if;
 perform set_config('request.jwt.claim.sub',(select id::text from access_test_users where kind='all'),true);
 if (select count(*) from public.list_accessible_farms())<>16 then raise exception 'Acesso a todas as fazendas incorreto'; end if;
 perform set_config('request.jwt.claim.sub',(select id::text from access_test_users where kind='other'),true);
 if exists(select 1 from public.harvest_test_datasets) or exists(select 1 from public.harvest_test_files) then raise exception 'Colheita visível a usuário de outra fazenda'; end if;
end;
$$;
reset role;
rollback;
select 'Isolamento, colheita compartilhada por fazenda, visualizador, e-mail, lote atômico, conflito e histórico: OK; testes revertidos.' as validation;
