-- Read-only validation for a finalized ab-blocks-v2 result.
-- Provide map_year, signature, requested_farms (Postgres text[] literal), and
-- assignments_json (the private assignment array) as psql variables. The
-- query returns aggregate checks only; GeoJSON geometries are never emitted.
with result as materialized (
  select public.fertilizer_block_zones(
    :'map_year', :'signature', :'requested_farms'::text[], :'assignments_json'::jsonb
  ) payload
), zones as materialized (
  select row_number() over() id,feature->'properties' properties,
    gis.st_setsrid(gis.st_geomfromgeojson(feature->'geometry'),4326) geom4326
  from result r cross join lateral jsonb_array_elements(r.payload->'zones'->'features') item(feature)
), projected as materialized (
  select id,properties,geom4326,gis.st_transform(geom4326,32722) geom from zones
), masks as materialized (
  select farm_code,gis.st_buffer(gis.st_unaryunion(gis.st_collect(geom)),0.005) buffered_geom
  from gis.fertilizer_service_masks(:'map_year',:'requested_farms'::text[])
  group by farm_code
), old_profile as materialized (
  select public.fertilizer_service_cached_profile(
    :'map_year',:'requested_farms'::text[],'machine-road-v2'
  ) payload
), old_zones as materialized (
  select feature->'properties' properties,
    gis.st_transform(gis.st_setsrid(gis.st_geomfromgeojson(feature->'geometry'),4326),32722) geom
  from old_profile p cross join lateral jsonb_array_elements(
    coalesce(p.payload->'zones'->'features','[]'::jsonb)
  ) item(feature)
), new_outside as (
  select m.farm_code,gis.st_unaryunion(gis.st_collect(gis.st_difference(p.geom,m.buffered_geom))) geom
  from masks m join projected p on p.properties->>'farm_code'=m.farm_code
  group by m.farm_code
), old_outside as (
  select m.farm_code,gis.st_unaryunion(gis.st_collect(gis.st_difference(z.geom,m.buffered_geom))) geom
  from masks m join old_zones z on z.properties->>'farm_code'=m.farm_code
  group by m.farm_code
), outside_delta as (
  select coalesce(sum(gis.st_area(gis.st_symdifference(n.geom,o.geom))),0) area_m2
  from new_outside n join old_outside o using(farm_code)
), overlap_pairs as (
  select max(gis.st_area(gis.st_intersection(a.geom,b.geom))) max_overlap_m2
  from projected a join projected b on a.id<b.id and gis.st_intersects(a.geom,b.geom)
), served_outside as (
  select coalesce(sum(gis.st_area(gis.st_difference(p.geom,m.buffered_geom))),0) area_m2
  from projected p join masks m on m.farm_code=p.properties->>'farm_code'
  where p.properties->>'method' in ('directional','network')
), area_totals as (
  select coalesce(sum(gis.st_area(geom)),0) mask_area_m2 from
    (select farm_code,gis.st_unaryunion(gis.st_collect(geom)) geom
     from gis.fertilizer_service_masks(:'map_year',:'requested_farms'::text[]) group by farm_code) m
), served as (
  select coalesce(sum(gis.st_area(geom)),0) area_m2 from projected
  where properties->>'method' in ('directional','network')
), analysis as (
  select payload->'analysis' analysis,payload->>'signature' signature,
    (payload->'analysis'->>'unserved_area_ha')::double precision*10000 unserved_area_m2
  from result
), oldref as (
  select payload->>'signature' signature,
    payload->'analysis'->>'model_version' model_version,
    payload is not null present from old_profile
), metrics as (
  select
    (select count(*) from projected) feature_count,
    (select count(*) from projected where gis.st_isempty(geom4326) or gis.st_isempty(geom)) empty_geometries,
    (select count(*) from projected where not gis.st_isvalid(geom4326)) invalid_4326,
    (select count(*) from projected where not gis.st_isvalid(geom)) invalid_utm,
    coalesce((select max(max_overlap_m2) from overlap_pairs),0) max_overlap_m2,
    (select area_m2 from served) served_area_m2,
    (select unserved_area_m2 from analysis) unserved_area_m2,
    (select mask_area_m2 from area_totals) mask_area_m2,
    (select area_m2 from served_outside) served_outside_buffer_5mm_m2,
    (select area_m2 from outside_delta) outside_pilot_footprint_delta_m2,
    (select analysis from analysis) analysis,
    (select signature from analysis) signature,
    (select present from oldref) old_reference_present,
    (select model_version from oldref) old_reference_model
)
select jsonb_build_object(
  'signature',signature,
  'feature_count',feature_count,
  'geometry_valid_4326',invalid_4326=0,
  'geometry_valid_utm',invalid_utm=0,
  'empty_geometry_count',empty_geometries,
  'no_empty_geometries',empty_geometries=0,
  'max_overlap_m2',max_overlap_m2,
  'no_overlaps_above_1m2',max_overlap_m2<=1,
  'served_outside_buffer_5mm_m2',served_outside_buffer_5mm_m2,
  'all_served_geometry_within_pilot_buffer',served_outside_buffer_5mm_m2<=0.001,
  'old_reference_present',old_reference_present,
  'old_reference_model',old_reference_model,
  'outside_pilot_footprint_delta_m2',outside_pilot_footprint_delta_m2,
  'outside_pilot_footprint_matches_old_reference',old_reference_present
    and old_reference_model='machine-road-v2' and outside_pilot_footprint_delta_m2<=1,
  'served_area_m2',served_area_m2,
  'unserved_area_m2',unserved_area_m2,
  'mask_area_m2',mask_area_m2,
  'served_plus_unserved_minus_mask_m2',served_area_m2+unserved_area_m2-mask_area_m2,
  'served_plus_unserved_matches_mask',abs(served_area_m2+unserved_area_m2-mask_area_m2)<=3,
  'guided_fields',(analysis->>'guided_fields')::integer,
  'application_blocks',(analysis->>'application_blocks')::integer,
  'strips',(analysis->>'strips')::integer,
  'served_strips',(analysis->>'served_strips')::integer,
  'all_checks_pass',feature_count=74 and invalid_4326=0 and invalid_utm=0 and empty_geometries=0
    and max_overlap_m2<=1 and served_outside_buffer_5mm_m2<=0.001
    and old_reference_present and old_reference_model='machine-road-v2'
    and outside_pilot_footprint_delta_m2<=1
    and abs(served_area_m2+unserved_area_m2-mask_area_m2)<=3
    and (analysis->>'guided_fields')::integer=36
    and (analysis->>'application_blocks')::integer=19
    and (analysis->>'strips')::integer=1525
    and (analysis->>'served_strips')::integer=1510
) summary from metrics;
