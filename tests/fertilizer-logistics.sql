-- Read-only smoke and geometry checks for fertilizer_logistics.
-- Re-run against the target Supabase project after migration changes.
with r as (
  select public.fertilizer_logistics('2026') as result
), zones_wgs84 as (
  select
    feature -> 'properties' as properties,
    gis.st_setsrid(
      gis.st_geomfromgeojson((feature -> 'geometry')::text),
      4326
    ) as geom_wgs84
  from r
  cross join lateral jsonb_array_elements(result -> 'zones' -> 'features') as item(feature)
), zones as (
  select
    properties,
    geom_wgs84,
    gis.st_transform(geom_wgs84, 32722) as geom_utm,
    row_number() over () as row_num
  from zones_wgs84
)
select
  count(*) as zone_count,
  count(*) filter (where gis.st_isvalid(geom_wgs84) and not gis.st_isempty(geom_wgs84)) as valid_wgs84,
  count(*) filter (where gis.st_isvalid(geom_utm) and not gis.st_isempty(geom_utm)) as valid_utm,
  count(*) filter (where gis.st_area(geom_utm) <= 0) as nonpositive_area,
  count(*) filter (where (properties ->> 'area_ha')::double precision > 0) as positive_reported_area,
  (
    select count(*)
    from zones a
    join zones b
      on a.properties ->> 'farm_code' = b.properties ->> 'farm_code'
     and a.row_num < b.row_num
     and gis.st_area(gis.st_intersection(a.geom_utm, b.geom_utm)) > 0.01
  ) as overlap_pairs_over_0_01_m2,
  round(sum((properties ->> 'area_ha')::numeric), 4) as reported_area_ha,
  round(sum(gis.st_area(geom_utm) / 10000)::numeric, 4) as roundtrip_area_ha
from zones;
