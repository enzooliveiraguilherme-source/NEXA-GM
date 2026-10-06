begin;
create table public.harvest_user_legends (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 name text not null check(length(btrim(name)) between 1 and 80),
 palette text not null check(palette in ('harvest','viridis_inverted')),
 breaks double precision[] not null check(array_ndims(breaks)=1 and array_lower(breaks,1)=1 and array_length(breaks,1)=5 and array_position(breaks,null) is null and breaks[1]>0 and breaks[1]<breaks[2] and breaks[2]<breaks[3] and breaks[3]<breaks[4] and breaks[4]<breaks[5] and breaks[5]<1000000),
 colors text[] not null check(array_ndims(colors)=1 and array_lower(colors,1)=1 and array_length(colors,1)=6 and array_position(colors,null) is null and array_to_string(colors,',') ~ '^#[0-9a-fA-F]{6}(,#[0-9a-fA-F]{6}){5}$'),
 updated_at timestamptz not null default now(),
 unique(user_id,name)
);
alter table public.harvest_user_legends enable row level security;
create policy own_legends_read on public.harvest_user_legends for select to authenticated using (user_id=auth.uid());
create policy own_legends_create on public.harvest_user_legends for insert to authenticated with check (user_id=auth.uid());
create policy own_legends_edit on public.harvest_user_legends for update to authenticated using (user_id=auth.uid()) with check(user_id=auth.uid());
revoke all on public.harvest_user_legends from anon;
grant select,insert,update on public.harvest_user_legends to authenticated;
commit;
