-- In-transaction checks for fertilizer-directional-strips.sql.
-- Run after its private guide import; always finish with ROLLBACK.
with fields as materialized (
  select * from gis.fertilizer_direction_fields('2026',array['FE','PA','RM'])
), strips as materialized (
  select * from gis.fertilizer_direction_strips('2026',array['FE','PA','RM'])
), field_counts as (
  select count(*) total_fields,count(*) filter (where guide_id is not null) guided_fields
  from fields
), guided as materialized (
  select f.farm_code,f.campo,f.geom,
    coalesce(sum(gis.st_area(s.geom)) filter (where s.layout='ab_strips'),0) strip_area,
    coalesce(gis.st_area(gis.st_unaryunion(gis.st_collect(s.geom)
      filter (where s.layout='ab_strips'))),0) union_area,
    coalesce(gis.st_area(gis.st_symdifference(f.geom,
      gis.st_unaryunion(gis.st_collect(s.geom) filter (where s.layout='ab_strips')))),0) diff_area
  from fields f left join strips s using(farm_code,campo)
  where f.guide_id is not null
  group by f.farm_code,f.campo,f.geom
), angle_checks as (
  select farm_code,campo,count(distinct angle) angle_count,
    max(abs(angle - mod((atan2(
      gis.st_y(gis.st_startpoint(g.geom))-gis.st_y(gis.st_endpoint(g.geom)),
      gis.st_x(gis.st_startpoint(g.geom))-gis.st_x(gis.st_endpoint(g.geom)))+2*pi())::numeric,
      pi()::numeric)::double precision)) reversal_delta
  from strips s join public.fertilizer_application_guides g
    using(farm_code,campo)
  where s.layout='ab_strips'
  group by farm_code,campo
), inheritance as (
  select count(*) filter (where g.inherited_from is not null) inherited_count,
    count(*) filter (where g.inherited_from is not null and not exists (
      select 1 from public.farm_fields p
      where p.farm_code=g.farm_code and p.campo=g.inherited_from
        and p.feature->'properties'->'ReplacedBy' ? g.campo
    )) invalid_parent_count
  from public.fertilizer_application_guides g where g.map_year='2026'
)
select jsonb_build_object(
 'target_fields',fc.total_fields,
 'guided_fields',fc.guided_fields,
 'fields_without_guide',fc.total_fields-fc.guided_fields,
 'guided_field_count_matches_catalog',fc.guided_fields=fc.total_fields,
 'area_preservation_ok',coalesce(bool_and(abs(strip_area-union_area)<0.001
   and diff_area/greatest(gis.st_area(geom),1)<1e-8),false),
 'max_relative_symmetric_difference',max(diff_area/greatest(gis.st_area(geom),1)),
 'overlap_ok',coalesce(bool_and(abs(strip_area-union_area)<0.001),false),
 'parallel_axes_ok',not exists(select 1 from angle_checks where angle_count<>1),
 'reverse_ab_invariant_ok',not exists(select 1 from angle_checks where reversal_delta>1e-12),
 'inherited_guides',i.inherited_count,
 'parent_inheritance_ok',i.invalid_parent_count=0,
 'anon_cannot_read_guides',not has_table_privilege('anon','public.fertilizer_application_guides','select'),
 'authenticated_can_read_guides',has_table_privilege('authenticated','public.fertilizer_application_guides','select'),
 'functions_invoker_ok',(select count(*)=6 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where (n.nspname,p.proname) in (('gis','fertilizer_direction_signature'),('gis','fertilizer_direction_fields'),
    ('gis','fertilizer_direction_strips'),('gis','fertilizer_direction_samples'),
    ('public','fertilizer_direction_grid'),('public','fertilizer_direction_zones')) and not p.prosecdef)
) result
from guided g cross join inheritance i
cross join field_counts fc
group by i.inherited_count,i.invalid_parent_count,fc.total_fields,fc.guided_fields;
