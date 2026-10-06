begin;
alter table public.harvest_test_files drop constraint harvest_test_files_path_check;
alter table public.harvest_test_files add constraint harvest_test_files_path_check
    check (path = 'index.json' or path ~ '^fe-[0-9.]+\.(geojson|json)$');
comment on table public.harvest_test_files is 'Base de teste por versão: pontos originais float64 compactados sem perdas, carregados em blocos.';
commit;
