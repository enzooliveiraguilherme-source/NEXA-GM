-- Executar após supabase/schema.sql. Base de teste autenticada da FE.
begin;
create table public.harvest_test_files (
    version_id uuid not null,
    path text not null check (path = 'index.json' or path ~ '^fe-[0-9.]+\.geojson$'),
    contents jsonb not null check (jsonb_typeof(contents) = 'object'),
    created_at timestamptz not null default now(),
    primary key (version_id, path)
);
create table public.harvest_test_datasets (
    slug text primary key check (slug = 'fe-milho-2026'),
    active_version uuid not null,
    index_path text not null default 'index.json' check (index_path = 'index.json'),
    foreign key (active_version, index_path) references public.harvest_test_files(version_id, path)
);
alter table public.harvest_test_files enable row level security;
alter table public.harvest_test_datasets enable row level security;
revoke all on public.harvest_test_files, public.harvest_test_datasets from public, anon, authenticated;
grant select, insert on public.harvest_test_files to authenticated;
grant select, insert, update on public.harvest_test_datasets to authenticated;
create policy harvest_files_read on public.harvest_test_files for select to authenticated using (true);
create policy harvest_files_create on public.harvest_test_files for insert to authenticated with check (public.is_admin());
create policy harvest_datasets_read on public.harvest_test_datasets for select to authenticated using (true);
create policy harvest_datasets_create on public.harvest_test_datasets for insert to authenticated with check (public.is_admin());
create policy harvest_datasets_edit on public.harvest_test_datasets for update to authenticated using (public.is_admin()) with check (public.is_admin());
comment on table public.harvest_test_files is 'Grades de produtividade de teste por talhão; detalhes carregados somente após seleção.';
commit;
