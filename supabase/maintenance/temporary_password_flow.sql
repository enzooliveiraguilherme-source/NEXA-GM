-- Aplicar pelo Supabase como migração temporary_password_flow.
-- A senha temporária é o OTP do Auth, nunca uma senha permanente armazenada no perfil.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table private.password_setup (
 user_id uuid primary key references auth.users(id) on delete cascade,
 required boolean not null default true,
 created_at timestamptz not null default now(),
 completed_at timestamptz
);
alter table private.password_setup enable row level security;
revoke all on private.password_setup from public,anon,authenticated;

-- Apenas contas ainda sem senha são cadastradas como pendentes. As duas contas
-- existentes com senha definitiva não recebem pendência nem têm dados alterados.
insert into private.password_setup(user_id)
 select id from auth.users where coalesce(encrypted_password,'')='';

create function private.track_password_setup()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  if coalesce(new.encrypted_password,'')='' then
   insert into private.password_setup(user_id) values(new.id) on conflict do nothing;
  end if;
 elsif old.email_confirmed_at is not null
   and new.encrypted_password is distinct from old.encrypted_password
   and coalesce(new.encrypted_password,'')<>'' then
  -- O Auth pode gerar um hash interno antes de confirmar o convite. Esse hash
  -- não conclui a etapa: só uma troca posterior à confirmação libera os dados.
  update private.password_setup set required=false,completed_at=now()
   where user_id=new.id and required;
 end if;
 return new;
end;
$$;
revoke all on function private.track_password_setup() from public,anon,authenticated;
create trigger portal_password_setup_created after insert on auth.users
 for each row execute function private.track_password_setup();
create trigger portal_password_setup_changed after update of encrypted_password on auth.users
 for each row execute function private.track_password_setup();

create or replace function private.has_permanent_password()
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users u where u.id=auth.uid()
   and u.email_confirmed_at is not null and coalesce(u.encrypted_password,'')<>''
   and not exists(select 1 from private.password_setup s where s.user_id=u.id and s.required));
$$;
revoke all on function private.has_permanent_password() from public,anon,authenticated;
grant execute on function private.has_permanent_password() to authenticated,service_role;

create or replace function public.has_permanent_password()
returns boolean language sql stable security invoker set search_path='' as $$
 select private.has_permanent_password();
$$;
revoke all on function public.has_permanent_password() from public,anon,authenticated;
grant execute on function public.has_permanent_password() to authenticated;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path='' as $$
 select private.has_permanent_password() and exists(
   select 1 from public.profiles p where p.id=auth.uid() and p.role='admin');
$$;
create or replace function public.can_access_farm(code text)
returns boolean language sql stable security definer set search_path='' as $$
 select private.has_permanent_password() and exists(select 1 from public.profiles p
  where p.id=auth.uid() and (p.role='admin' or p.all_farms or exists(
   select 1 from public.user_farm_access a where a.user_id=p.id and a.farm_code=code)));
$$;
create or replace function public.can_access_farm_scope(code text)
returns boolean language sql stable security definer set search_path='' as $$
 select private.has_permanent_password() and case when code='ALL' then exists(
  select 1 from public.profiles p where p.id=auth.uid() and (p.role='admin' or p.all_farms))
 else public.can_access_farm(code) end;
$$;
create or replace function public.can_edit_operations()
returns boolean language sql stable security definer set search_path='' as $$
 select private.has_permanent_password() and exists(
  select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','projetista'));
$$;

-- Somente as cinco políticas que permitem leitura sem can_access_farm/is_admin
-- precisam de uma restrição adicional. Geometrias, operações, colheita e Storage
-- já dependem dos helpers acima e preservam suas políticas atuais.
do $$ declare t text; begin
 for t in select unnest(array['farms','user_farm_access','seed_varieties','seed_variety_cycles','harvest_user_legends'])
 loop
  execute format('create policy permanent_password_required on public.%I as restrictive for all to authenticated using ((select private.has_permanent_password())) with check ((select private.has_permanent_password()))',t);
 end loop;
end $$;
notify pgrst,'reload schema';
