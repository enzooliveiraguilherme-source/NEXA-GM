-- Limpeza pontual da versão simplificada de 25 m, após confirmação.
-- Nunca seleciona automaticamente versões futuras ou a base ativa.
begin;
lock table public.harvest_test_datasets in share mode;
lock table public.harvest_test_files in share row exclusive mode;
do $$
declare
    old_version constant uuid := 'ab0b24e2-c9cf-4e2a-9568-11f715d718cd';
    main_version constant uuid := '8dbf65f1-35cd-4ea0-9efe-027351a85f00';
    main_index jsonb;
    removed integer;
begin
    if not exists (select 1 from public.harvest_test_datasets where slug = 'fe-milho-2026' and active_version = main_version) then
        raise exception 'A versão ativa mudou; refazer a auditoria.';
    end if;
    if exists (select 1 from public.harvest_test_datasets where active_version = old_version) then
        raise exception 'A versão candidata ainda está ativa.';
    end if;
    select contents into main_index from public.harvest_test_files where version_id = main_version and path = 'index.json';
    if main_index->>'representation' is distinct from 'original-points-v1'
       or (main_index->>'points')::bigint is distinct from 2619944
       or jsonb_array_length(main_index->'records') is distinct from 21
       or (select count(*) from public.harvest_test_files where version_id = main_version) <> 64 then
        raise exception 'A base principal não corresponde à referência aprovada.';
    end if;
    if exists (
        select 1 from jsonb_array_elements(main_index->'records') r,
        lateral jsonb_array_elements_text(r->'chunks') c(path)
        where not exists (select 1 from public.harvest_test_files f where f.version_id = main_version and f.path = c.path)
    ) then
        raise exception 'Há blocos ausentes na base principal.';
    end if;
    if (select count(*) from public.harvest_test_files where version_id = old_version) <> 22
       or not exists (select 1 from public.harvest_test_files where version_id = old_version and path = 'index.json' and contents->>'source' = 'FE.geojson') then
        raise exception 'A importação antiga mudou; refazer a auditoria.';
    end if;
    delete from public.harvest_test_files where version_id = old_version;
    get diagnostics removed = row_count;
    if removed <> 22 then raise exception 'Contagem de remoção inesperada.'; end if;
end $$;
commit;

select version_id, count(*) as files,
       bool_or(version_id in (select active_version from public.harvest_test_datasets)) as active
from public.harvest_test_files group by version_id;
