create table if not exists public.harvest_raster_files (
    version_id uuid not null,
    path text not null check (path = 'index.json' or path ~ '^fe-[0-9.]+-[0-5]\.json$'),
    contents jsonb not null check (jsonb_typeof(contents) = 'object'),
    primary key (version_id, path)
);
alter table public.harvest_raster_files enable row level security;
grant select, insert, update, delete on public.harvest_raster_files to authenticated;
revoke all on public.harvest_raster_files from anon;
create policy harvest_raster_read on public.harvest_raster_files for select to authenticated
    using (public.can_access_farm('FE'));
create policy harvest_raster_admin on public.harvest_raster_files for all to authenticated
    using (public.is_admin()) with check (public.is_admin());
