-- Read-only regression checks for fertilizer application blocks (ab-blocks-v2).
-- Run against the deployed 2026 pilot. This query returns booleans and counts
-- only; it does not expose guide identifiers, geometries, or other private data.
-- No temporary objects or mutations are created.
with fields as materialized (
  select * from gis.fertilizer_direction_fields('2026',array['FE','PA','RM'])
  where guide_id is not null
), blocks as materialized (
  select * from gis.fertilizer_block_fields('2026',array['FE','PA','RM'])
  where guide_id is not null
), field_union as (
  select gis.st_unaryunion(gis.st_collect(geom)) geom from fields
), block_stats as (
  select sum(gis.st_area(geom)) summed_area,
    gis.st_unaryunion(gis.st_collect(geom)) geom from blocks
), targeted as (
  select
    (select count(distinct (coalesce(nullif(btrim(g.source_name),''),'field:'||f.campo),
      round(degrees(f.angle)::numeric,2)))
     from fields f join public.fertilizer_application_guides g using(farm_code,campo)
     where f.farm_code='FE' and f.campo in ('FE 02','FE 05','FE 06','FE 07')) fe_shared_groups,
    (select count(distinct (coalesce(nullif(btrim(g.source_name),''),'field:'||f.campo),
      round(degrees(f.angle)::numeric,2)))
     from fields f join public.fertilizer_application_guides g using(farm_code,campo)
     where f.farm_code='FE' and f.campo like 'FE 10%') fe10_groups,
    (select count(distinct (coalesce(nullif(btrim(g.source_name),''),'field:'||f.campo),
      round(degrees(f.angle)::numeric,2)))
     from fields f join public.fertilizer_application_guides g using(farm_code,campo)
     where f.farm_code='PA' and (f.campo='PA 01' or f.campo like 'PA 02%' or f.campo like 'PA 03%')) pa_010203_groups
), function_privileges as (
  select
    count(*) filter (where (n.nspname,p.proname) in
      (('public','fertilizer_direction_grid'),('public','fertilizer_direction_zones'),
       ('public','fertilizer_service_grid'),('public','fertilizer_service_zones'))) v1_count,
    coalesce(bool_and(not p.prosecdef and has_function_privilege('authenticated',p.oid,'execute'))
      filter (where (n.nspname,p.proname) in
      (('public','fertilizer_direction_grid'),('public','fertilizer_direction_zones'),
       ('public','fertilizer_service_grid'),('public','fertilizer_service_zones'))),false) v1_safe,
    count(*) filter (where (n.nspname,p.proname) in
      (('gis','fertilizer_block_signature'),('gis','fertilizer_block_fields'),
       ('gis','fertilizer_block_strips'),('gis','fertilizer_block_samples'),
       ('public','fertilizer_block_grid'),('public','fertilizer_block_zones'))) block_count,
    coalesce(bool_and(not p.prosecdef
      and has_function_privilege('authenticated',p.oid,'execute')
      and not has_function_privilege('anon',p.oid,'execute'))
      filter (where (n.nspname,p.proname) in
      (('gis','fertilizer_block_signature'),('gis','fertilizer_block_fields'),
       ('gis','fertilizer_block_strips'),('gis','fertilizer_block_samples'),
       ('public','fertilizer_block_grid'),('public','fertilizer_block_zones'))),false) block_safe
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
), measurements as (
  select (select count(*) from fields) guided_fields,
    (select count(*) from blocks) application_blocks,
    gis.st_area(gis.st_symdifference(f.geom,b.geom)) relative_diff_area_m2,
    gis.st_area(f.geom) source_area_m2,
    b.summed_area-gis.st_area(b.geom) overlap_area_m2,
    gis.st_area(b.geom) block_union_area_m2
  from field_union f cross join block_stats b
), grid as materialized (
  select public.fertilizer_block_grid('2026',array['FE','PA','RM']) payload
), permissions as (
  select not has_table_privilege('anon','public.fertilizer_application_guides','select') anon_cannot_read_guides,
    has_table_privilege('authenticated','public.fertilizer_application_guides','select') auth_can_read_guides,
    not has_table_privilege('authenticated','public.fertilizer_application_guides','insert')
      and not has_table_privilege('authenticated','public.fertilizer_application_guides','update')
      and not has_table_privilege('authenticated','public.fertilizer_application_guides','delete') auth_cannot_write_guides,
    not has_table_privilege('authenticated','public.fertilizer_service_area_cache','insert')
      and not has_table_privilege('authenticated','public.fertilizer_service_area_cache','update')
      and not has_table_privilege('authenticated','public.fertilizer_service_area_cache','delete') auth_cannot_write_cache
)
select jsonb_build_object(
  'model_version','ab-blocks-v2',
  'guided_fields',m.guided_fields,
  'guided_fields_ok',m.guided_fields=36,
  'application_blocks',m.application_blocks,
  'application_blocks_ok',m.application_blocks=19,
  'grid_model_version',g.payload->>'model_version',
  'grid_samples',jsonb_array_length(g.payload->'cells'),
  'grid_matches_local_reference',g.payload->>'model_version'='ab-blocks-v2'
    and jsonb_array_length(g.payload->'cells')=18659,
  'relative_symmetric_difference',m.relative_diff_area_m2/greatest(m.source_area_m2,1),
  'block_union_matches_guided_masks',m.relative_diff_area_m2/greatest(m.source_area_m2,1)<=1e-7,
  'relative_overlap_excess',(m.overlap_area_m2/greatest(m.block_union_area_m2,1)),
  'overlap_quasineutral',m.overlap_area_m2/greatest(m.block_union_area_m2,1)<=1e-7,
  'fe_10_direction_groups',t.fe10_groups,
  'fe_10_directions_separate',t.fe10_groups=2,
  'pa_01_02_03_groups',t.pa_010203_groups,
  'pa_01_02_03_share_one_block',t.pa_010203_groups=1,
  'fe_02_05_06_07_groups',t.fe_shared_groups,
  'fe_02_05_06_07_share_one_block',t.fe_shared_groups=1,
  'v1_rpc_count',fp.v1_count,
  'v1_rpcs_preserved_and_invoker',fp.v1_count=4 and fp.v1_safe,
  'block_rpc_count',fp.block_count,
  'block_rpcs_invoker_auth_only',fp.block_count=6 and fp.block_safe,
  'anon_cannot_read_guides',pr.anon_cannot_read_guides,
  'authenticated_can_read_guides',pr.auth_can_read_guides,
  'authenticated_cannot_write_guides',pr.auth_cannot_write_guides,
  'authenticated_cannot_write_cache',pr.auth_cannot_write_cache,
  'all_checks_pass',m.guided_fields=36 and m.application_blocks=19
    and m.relative_diff_area_m2/greatest(m.source_area_m2,1)<=1e-7
    and m.overlap_area_m2/greatest(m.block_union_area_m2,1)<=1e-7
    and g.payload->>'model_version'='ab-blocks-v2'
    and jsonb_array_length(g.payload->'cells')=18659
    and t.fe10_groups=2 and t.pa_010203_groups=1 and t.fe_shared_groups=1
    and fp.v1_count=4 and fp.v1_safe and fp.block_count=6 and fp.block_safe
    and pr.anon_cannot_read_guides and pr.auth_can_read_guides
    and pr.auth_cannot_write_guides and pr.auth_cannot_write_cache
) result
from measurements m cross join targeted t cross join function_privileges fp cross join permissions pr cross join grid g;
