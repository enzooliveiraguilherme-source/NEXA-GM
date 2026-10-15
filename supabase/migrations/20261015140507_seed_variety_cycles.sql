-- Shared cycles: authenticated users read; only confirmed administrators write.
create function public.seed_cycle_key(value text)
returns text language sql immutable strict security invoker set search_path = ''
as $$ select regexp_replace(translate(upper(btrim(value)), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC'), '\s+', '', 'g') $$;

create table public.seed_variety_cycles (
  id bigint generated always as identity primary key,
  variety_name text not null check (char_length(btrim(variety_name)) between 1 and 80),
  culture text not null default 'Soja' check (char_length(btrim(culture)) between 1 and 40),
  variety_key text generated always as (public.seed_cycle_key(variety_name)) stored,
  culture_key text generated always as (public.seed_cycle_key(culture)) stored,
  cycle_days integer check (cycle_days between 1 and 730),
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  unique (variety_key, culture_key)
);
alter table public.seed_variety_cycles enable row level security;
revoke all on public.seed_variety_cycles from anon, authenticated;
grant select, insert, update on public.seed_variety_cycles to authenticated;
grant usage, select on sequence public.seed_variety_cycles_id_seq to authenticated;
create index seed_variety_cycles_updated_by_idx on public.seed_variety_cycles(updated_by);

create policy seed_cycles_read on public.seed_variety_cycles for select to authenticated using (true);
create policy seed_cycles_admin_insert on public.seed_variety_cycles for insert to authenticated
  with check ((select public.is_admin()));
create policy seed_cycles_admin_update on public.seed_variety_cycles for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create function public.stamp_seed_variety_cycle()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.variety_name := regexp_replace(btrim(new.variety_name), '\s+', ' ', 'g');
  new.culture := regexp_replace(btrim(new.culture), '\s+', ' ', 'g');
  new.version := case when tg_op = 'UPDATE' then old.version + 1 else 1 end;
  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end;
$$;
create trigger seed_variety_cycles_stamp before insert or update on public.seed_variety_cycles
  for each row execute function public.stamp_seed_variety_cycle();
revoke execute on function public.stamp_seed_variety_cycle() from public, anon, authenticated;

insert into public.seed_variety_cycles(variety_name,culture,cycle_days)
values ('Olimpo','Soja',114), ('NEO 790','Soja',114);
