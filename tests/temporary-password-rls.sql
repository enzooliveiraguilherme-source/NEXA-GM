-- Verificação transacional do gate de senha definitiva.
-- Executar apenas depois da migration do gate no SQL Editor Supabase, como postgres.
-- Todas as contas, perfis, linhas de fazenda/operação e objeto abaixo sofrem rollback.
-- encrypted_password é um marcador não autenticável: este teste avalia RLS, não login.
begin;

do $$
begin
  if to_regprocedure('private.has_permanent_password()') is null
     or to_regprocedure('public.has_permanent_password()') is null then
    raise exception 'Aplique primeiro a migration do gate de senha definitiva.';
  end if;
  if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null
     or to_regclass('public.harvest_farm_versions') is null then
    raise exception 'Este teste requer o schema Storage e a migration harvest-kriged.';
  end if;
  if exists(select 1 from auth.users where id in (
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000005'
  )) then
    raise exception 'UUIDs de fixture já usados; remova a colisão ou ajuste os UUIDs do teste.';
  end if;
  if not exists(select 1 from storage.buckets where id='harvest-kriged') then
    raise exception 'Bucket harvest-kriged ausente; aplique primeiro a migration de Storage.';
  end if;
  if exists(select 1 from public.harvest_farm_versions where id='20000000-0000-4000-8000-000000000001')
     or exists(select 1 from storage.objects where bucket_id='harvest-kriged'
       and name='GATE-TEST/FE/20000000-0000-4000-8000-000000000001/gate-fixture.tif')
     or exists(select 1 from public.farm_fields where campo='GATE-TEST')
     or exists(select 1 from public.operation_records where ano='GATE_TEST' and cultura='Gate fixture') then
    raise exception 'UUID/caminho da fixture de Storage já existe; ajuste os identificadores do teste.';
  end if;
end;
$$;

create temporary table password_gate_test_users (
  id uuid primary key,
  fixture_name text unique not null
) on commit drop;
insert into password_gate_test_users values
 ('10000000-0000-4000-8000-000000000001','invite_fake_admin'),
 ('10000000-0000-4000-8000-000000000002','unconfirmed'),
 ('10000000-0000-4000-8000-000000000003','admin_password'),
 ('10000000-0000-4000-8000-000000000004','editor_password'),
 ('10000000-0000-4000-8000-000000000005','viewer_password');
grant select on password_gate_test_users to authenticated;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select id, 'authenticated', 'authenticated', fixture_name || '@temporary-password.invalid',
       case when fixture_name in ('admin_password','editor_password','viewer_password')
            then 'TEST_ONLY_NOT_A_VALID_PASSWORD_HASH' else '' end,
       case when fixture_name in ('unconfirmed','invite_fake_admin') then null else now() end,
       '{"provider":"email","providers":["email"]}'::jsonb,
       case when fixture_name='invite_fake_admin'
            then '{"role":"admin","all_farms":true,"farm_codes":["FE"],"full_name":"Metadata forged"}'::jsonb
            else jsonb_build_object('full_name','Gate fixture ' || fixture_name) end,
       now(), now()
from password_gate_test_users;

-- O Auth pode gravar um hash interno enquanto o convite ainda não foi confirmado.
-- A confirmação do e-mail, sozinha, também não conclui a troca de senha.
update auth.users set encrypted_password='AUTH_INTERNAL_PRE_CONFIRMATION_HASH'
where id='10000000-0000-4000-8000-000000000001';
update auth.users set email_confirmed_at=now()
where id='10000000-0000-4000-8000-000000000001';
do $$
begin
  if not exists(select 1 from private.password_setup
    where user_id='10000000-0000-4000-8000-000000000001' and required and completed_at is null) then
    raise exception 'Hash interno antes da confirmação removeu indevidamente a pendência.';
  end if;
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
  if private.has_permanent_password() or public.has_permanent_password() then
    raise exception 'Hash interno mais confirmação liberou indevidamente o gate.';
  end if;
end;
$$;

-- A conta de convite tem metadados deliberadamente falsos, mas o perfil autoritativo
-- continua sendo visualizador e tem acesso somente à FE.
update public.profiles p set role = case u.fixture_name
    when 'admin_password' then 'admin'::public.user_role
    when 'editor_password' then 'projetista'::public.user_role
    else 'visualizador'::public.user_role end,
  all_farms = false
from password_gate_test_users u where p.id=u.id;
insert into public.user_farm_access(user_id,farm_code)
select id,'FE' from password_gate_test_users;

insert into public.farm_fields(farm_code,campo,feature) values
 ('FE','GATE-TEST','{"type":"Feature","geometry":null,"properties":{"Fazenda":"FE","Campo":"GATE-TEST"}}'::jsonb),
 ('FE2','GATE-TEST','{"type":"Feature","geometry":null,"properties":{"Fazenda":"FE2","Campo":"GATE-TEST"}}'::jsonb);
insert into public.operation_records(operation_type,fazenda,campo,ano,cultura,produto,area_total)
values ('adubacao','FE','GATE-TEST','GATE_TEST','Gate fixture','Gate fixture',1),
       ('adubacao','FE2','GATE-TEST','GATE_TEST','Gate fixture','Gate fixture',1);

-- O caminho atende à policy de leitura já existente para a Fazenda FE. O teste
-- verifica que can_access_farm mantém Storage fechado antes da senha e o libera
-- somente dentro do escopo FE depois da troca.
insert into public.harvest_farm_versions(id,farm_code,gleba,ano,cultura,manifest,ready)
values ('20000000-0000-4000-8000-000000000001','FE','GATE-TEST',2026,'Milho','{"files":[]}'::jsonb,true);
insert into storage.objects(bucket_id,name,metadata)
values ('harvest-kriged','GATE-TEST/FE/20000000-0000-4000-8000-000000000001/gate-fixture.tif',
        '{"mimetype":"application/octet-stream"}'::jsonb);

-- Confirma a implementação privada (SECURITY DEFINER) e a RPC pública (invoker).
do $$
declare
  private_is_definer boolean;
  private_is_stable boolean;
  public_is_definer boolean;
begin
  select p.prosecdef, p.provolatile='s' into private_is_definer, private_is_stable
  from pg_proc p where p.oid='private.has_permanent_password()'::regprocedure;
  select p.prosecdef into public_is_definer
  from pg_proc p where p.oid='public.has_permanent_password()'::regprocedure;
  if private_is_definer is distinct from true or private_is_stable is distinct from true then
    raise exception 'A função privada precisa ser SECURITY DEFINER STABLE.';
  end if;
  if public_is_definer is distinct from false then
    raise exception 'A RPC pública precisa ser SECURITY INVOKER.';
  end if;
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
  if private.has_permanent_password() then raise exception 'Gate privado aceitou o convite sem senha.'; end if;
  if public.has_permanent_password() then raise exception 'RPC pública aceitou o convite sem senha.'; end if;
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
  if private.has_permanent_password() or public.has_permanent_password() then
    raise exception 'Gate aceitou usuário ainda não confirmado.';
  end if;
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
  if not private.has_permanent_password() or not public.has_permanent_password() then
    raise exception 'Gate recusou usuário confirmado que já possui senha.';
  end if;
end;
$$;

-- Authenticated representa a sessão real do usuário: tentativa sem senha,
-- inclusive contra perfil/RPC privilegiados e metadados adulterados.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$
declare
  fake_admin uuid;
  denied boolean;
begin
  select id into fake_admin from password_gate_test_users where fixture_name='invite_fake_admin';
  if public.has_permanent_password() then raise exception 'RPC pública liberou conta de convite sem senha.'; end if;
  if public.is_admin() or public.can_edit_operations() or public.can_access_farm('FE')
     or public.can_access_farm_scope('ALL') then
    raise exception 'Helper privilegiado liberou conta de convite sem senha.';
  end if;
  if exists(select 1 from public.farms)
     or exists(select 1 from public.farm_fields)
     or exists(select 1 from public.operation_records)
     or exists(select 1 from public.operation_plans)
     or exists(select 1 from public.operation_history)
     or exists(select 1 from public.harvest_test_files)
     or exists(select 1 from public.harvest_test_datasets)
     or exists(select 1 from public.harvest_raster_files)
     or exists(select 1 from public.harvest_user_legends where user_id=auth.uid())
     or exists(select 1 from public.seed_varieties)
     or exists(select 1 from public.seed_variety_cycles)
     or exists(select 1 from storage.objects where bucket_id='harvest-kriged'
       and name='GATE-TEST/FE/20000000-0000-4000-8000-000000000001/gate-fixture.tif') then
    raise exception 'Conta sem senha conseguiu ler dados protegidos (catálogos, operações, fazendas, colheita, legenda ou Storage).';
  end if;
  if exists(select 1 from public.profiles where id<>auth.uid()) then
    raise exception 'Conta sem senha conseguiu ler perfis de outros usuários.';
  end if;
  denied := false;
  begin
    perform * from public.admin_list_access();
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'RPC admin_list_access aceitou conta sem senha com metadata forjada.'; end if;
  denied := false;
  begin
    perform public.admin_set_access(fake_admin,'admin',true,array['FE']);
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'RPC admin_set_access aceitou conta sem senha com metadata forjada.'; end if;
end;
$$;

-- Simula uma troca de hash posterior à confirmação, como Auth.updateUser({password}).
-- Nenhuma senha real é criada, armazenada ou usada para autenticar.
reset role;
update auth.users set encrypted_password='TEST_ONLY_POST_CONFIRMATION_PASSWORD_HASH',updated_at=now()
where id='10000000-0000-4000-8000-000000000001';
do $$
begin
  if exists(select 1 from private.password_setup
    where user_id='10000000-0000-4000-8000-000000000001' and required)
     or not exists(select 1 from private.password_setup
       where user_id='10000000-0000-4000-8000-000000000001' and not required and completed_at is not null) then
    raise exception 'Troca de hash após confirmação não limpou a pendência corretamente.';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$
declare
  denied boolean := false;
begin
  if not public.has_permanent_password() then raise exception 'Gate não liberou após encrypted_password ficar preenchido.'; end if;
  -- A liberação do gate respeita o perfil e a concessão de fazenda existentes;
  -- os metadados falsos não mudam papel, escopo nem acesso administrativo.
  if public.is_admin() or public.can_edit_operations() then raise exception 'Metadata transformou visualizador em editor/admin.'; end if;
  if not public.can_access_farm('FE') or public.can_access_farm('FE2')
     or public.can_access_farm_scope('ALL') then
    raise exception 'A liberação do gate alterou os limites de fazenda.';
  end if;
  if not exists(select 1 from public.farms where code='FE')
     or not exists(select 1 from public.farms where code='FE2') then
    raise exception 'O catálogo público de fazendas mudou após a senha definitiva.';
  end if;
  if not exists(select 1 from public.farm_fields where farm_code='FE' and campo='GATE-TEST')
     or exists(select 1 from public.farm_fields where farm_code='FE2' and campo='GATE-TEST') then
    raise exception 'RLS não isolou as geometrias pela fazenda autorizada.';
  end if;
  if not exists(select 1 from public.operation_records where fazenda='FE' and ano='GATE_TEST' and cultura='Gate fixture')
     or exists(select 1 from public.operation_records where fazenda='FE2' and ano='GATE_TEST' and cultura='Gate fixture') then
    raise exception 'RLS não isolou operações pela fazenda autorizada.';
  end if;
  if not exists(select 1 from storage.objects where bucket_id='harvest-kriged'
       and name='GATE-TEST/FE/20000000-0000-4000-8000-000000000001/gate-fixture.tif') then
    raise exception 'Storage não liberou o objeto da fazenda autorizada após a senha.';
  end if;
  denied := false;
  begin
    perform public.admin_set_access(auth.uid(),'admin',true,array['FE']);
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Visualizador alterou acesso após definir senha.'; end if;
end;
$$;

-- Usuários confirmados com senha retêm seus papéis e seu escopo normal.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
do $$
begin
  if not public.has_permanent_password() or not public.is_admin() or not public.can_edit_operations()
     or not public.can_access_farm('FE') then
    raise exception 'Administrador confirmado com senha perdeu suas permissões existentes.';
  end if;
  if not exists(select 1 from public.admin_list_access()) then
    raise exception 'RPC administrativa rejeitou administrador confirmado com senha.';
  end if;
end;
$$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
do $$
begin
  if not public.has_permanent_password() or public.is_admin() or not public.can_edit_operations()
     or not public.can_access_farm('FE') or public.can_access_farm('FE2') then
    raise exception 'Editor confirmado com senha perdeu ou ampliou suas permissões existentes.';
  end if;
end;
$$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000005',true);
do $$
begin
  if not public.has_permanent_password() or public.is_admin() or public.can_edit_operations()
     or not public.can_access_farm('FE') or public.can_access_farm('FE2') then
    raise exception 'Visualizador confirmado com senha perdeu ou ampliou suas permissões existentes.';
  end if;
end;
$$;

reset role;
rollback;
select 'Gate privado e RPC pública, RLS autenticada, Storage, metadados forjados, mudança para senha presente e limites de papel/fazenda: OK; fixtures revertidas.' as validation;
