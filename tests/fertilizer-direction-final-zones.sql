-- Read-only final-zone regression summary. Run with psql variables supplied
-- from the private local assignments file; do not commit that file or its data.
-- Required variables: map_year, signature, requested_farms (Postgres text[] literal),
-- assignments_json (JSON array). Example invocation is intentionally omitted so
-- no guide or mound identifiers are stored in the repository.
with result as materialized (
 select public.fertilizer_direction_zones(
   :'map_year', :'signature', :'requested_farms'::text[], :'assignments_json'::jsonb
 ) payload
), zones as materialized (
 select row_number() over() id,feature->'properties' properties,
   gis.st_setsrid(gis.st_geomfromgeojson(feature->'geometry'),4326) geom4326
 from result r cross join lateral jsonb_array_elements(r.payload->'zones'->'features') as item(feature)
), projected as materialized (
 select id,properties,geom4326,gis.st_transform(geom4326,32722) geom
 from zones
), by_farm as (
 select properties->>'farm_code' farm_code,
   sum(gis.st_area(geom)) summed_area,
   gis.st_area(gis.st_unaryunion(gis.st_collect(geom))) union_area
 from projected group by properties->>'farm_code'
), masks as materialized (
 select farm_code,gis.st_unaryunion(gis.st_collect(geom)) geom
 from gis.fertilizer_service_masks(:'map_year',:'requested_farms'::text[])
 group by farm_code
), outside_masks as (
 select coalesce(sum(gis.st_area(gis.st_difference(p.geom,m.geom))),0) area_m2
 from projected p join masks m on m.farm_code=p.properties->>'farm_code'
 where p.properties->>'method'='directional'
), strip_area as (
 select coalesce(sum(gis.st_area(geom)),0) area_m2
 from gis.fertilizer_direction_strips(:'map_year',:'requested_farms'::text[])
), served_area as (
 select coalesce(sum(gis.st_area(geom)),0) area_m2
 from projected where properties->>'method'='directional'
), unserved as (
 select (payload->'analysis'->>'unserved_area_ha')::double precision*10000 area_m2,
   payload->'analysis' analysis from result
), field_counts as (
 select count(*) guided_fields from gis.fertilizer_direction_fields(:'map_year',:'requested_farms'::text[])
 where guide_id is not null
)
select jsonb_build_object(
 'feature_count',(select count(*) from projected),
 'directional_features',(select count(*) from projected where properties->>'method'='directional'),
 'network_features',(select count(*) from projected where properties->>'method'='network'),
 'empty_geometries',(select count(*) from projected where gis.st_isempty(geom4326)),
 'invalid_4326',(select count(*) from projected where not gis.st_isvalid(geom4326)),
 'invalid_32722',(select count(*) from projected where not gis.st_isvalid(geom)),
 'max_overlap_excess_m2',(select max(summed_area-union_area) from by_farm),
 'mask_external_area_m2',(select area_m2 from outside_masks),
 'guided_fields',(select guided_fields from field_counts),
 'pilot_area_m2',(select sum(gis.st_area(geom)) from masks),
 'served_area_m2',(select area_m2 from served_area),
 'unserved_area_m2',(select area_m2 from unserved),
 'served_plus_unserved_minus_mask_m2',
   (select area_m2 from served_area)+(select area_m2 from unserved)-(select sum(gis.st_area(geom)) from masks),
 'served_plus_unserved_minus_strip_sum_m2',
   (select area_m2 from served_area)+(select area_m2 from unserved)-(select area_m2 from strip_area),
 'max_area_property_delta_m2',(select max(abs(
   (properties->>'area_ha')::double precision*10000-gis.st_area(geom))) from projected),
 'analysis',(select analysis from unserved)
) as validation;
