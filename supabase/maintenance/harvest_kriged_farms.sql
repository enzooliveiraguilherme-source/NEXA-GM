begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('harvest-kriged','harvest-kriged',false,8388608,array['application/octet-stream'])
on conflict(id) do nothing;

create table public.harvest_farm_versions (
 id uuid primary key,
 farm_code text not null references public.farms(code),
 gleba text not null,
 ano integer not null check(ano=2026),
 cultura text not null check(cultura='Milho'),
 manifest jsonb not null check(jsonb_typeof(manifest)='object' and jsonb_typeof(manifest->'files')='array'),
 ready boolean not null default false,
 created_at timestamptz not null default now(),
 unique(id,farm_code,ano,cultura)
);
create table public.harvest_farm_datasets (
 farm_code text not null references public.farms(code),
 ano integer not null,
 cultura text not null,
 active_version uuid not null,
 primary key(farm_code,ano,cultura),
 foreign key(active_version,farm_code,ano,cultura) references public.harvest_farm_versions(id,farm_code,ano,cultura)
);
alter table public.harvest_farm_versions enable row level security;
alter table public.harvest_farm_datasets enable row level security;
revoke all on public.harvest_farm_versions,public.harvest_farm_datasets from public,anon,authenticated;
grant select on public.harvest_farm_versions,public.harvest_farm_datasets to authenticated;
grant select on public.harvest_farm_versions to service_role;
create policy harvest_farm_versions_read on public.harvest_farm_versions for select to authenticated
 using(ready and public.can_access_farm(farm_code));
create policy harvest_farm_datasets_read on public.harvest_farm_datasets for select to authenticated
 using(public.can_access_farm(farm_code));
create policy harvest_kriged_objects_read on storage.objects for select to authenticated
 using(bucket_id='harvest-kriged' and exists(
  select 1 from public.harvest_farm_versions v
  where v.id::text=(storage.foldername(name))[3] and v.farm_code=(storage.foldername(name))[2]
   and v.gleba=(storage.foldername(name))[1] and v.ready and public.can_access_farm(v.farm_code)
 ));
notify pgrst,'reload schema';
commit;
