-- Execute este arquivo no SQL Editor do Supabase antes do primeiro acesso.

-- 1. Tipo de perfil
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('admin', 'projetista', 'visualizador');
  end if;
end$$;

-- 2. Tabela de perfis vinculada ao auth.users
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role public.user_role not null default 'visualizador',
  created_at timestamptz not null default now()
);

-- 3. Habilita RLS (Row Level Security)
alter table public.profiles enable row level security;

-- 4. Permissões essenciais aos roles do Supabase
grant usage on schema public to anon, authenticated;
grant all on table public.profiles to anon, authenticated;

-- 5. Função para checar se o usuário atual é admin
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- 6. Políticas de segurança
drop policy if exists "Usuários leem o próprio perfil ou administrador lê todos" on public.profiles;
create policy "Usuários leem o próprio perfil ou administrador lê todos"
on public.profiles for select to authenticated
using (id = auth.uid() or public.is_admin());

drop policy if exists "Administrador atualiza perfis" on public.profiles;
create policy "Administrador atualiza perfis"
on public.profiles for update to authenticated
using (public.is_admin()) with check (public.is_admin());

-- 7. Trigger para criação automática de perfil em novos cadastros
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute procedure public.handle_new_user();

-- 8. Atribuir papel de ADMIN ao usuário Enzo Oliveira
insert into public.profiles (id, full_name, role)
values (
  '3b893202-1862-469c-9831-e35934dd5ad9',
  'Enzo Oliveira',
  'admin'
)
on conflict (id) do update
set role = 'admin', full_name = 'Enzo Oliveira';
