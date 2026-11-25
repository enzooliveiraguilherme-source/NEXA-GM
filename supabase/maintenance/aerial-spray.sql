-- New, isolated module. Limits are snapshots of the target talhões for each AP.
-- Uses the existing PostGIS extension in the gis schema.
create table public.aerial_spray_features (
 id uuid primary key default gen_random_uuid(),
 farm_code text not null references public.farms(code),
 gleba text not null,
 ano text not null,
 cultura text not null,
 ap text not null check(length(btrim(ap)) between 1 and 150),
 kind text not null check(kind in ('limite','cobertura','circuito')),
 feature jsonb not null,
 created_at timestamptz not null default now(),
 check((feature->>'type' = 'Feature') is true),
 check((feature->'geometry'->>'type') is not null),
 check(gis.st_srid(gis.st_geomfromgeojson((feature->'geometry')::text)) = 4326),
 check(gis.st_isvalid(gis.st_geomfromgeojson((feature->'geometry')::text))),
 check(case when kind='circuito' then
   feature->'geometry'->>'type' in ('LineString','MultiLineString') and
   feature->'properties'->>'APLICANDO' in ('0','1')
 else feature->'geometry'->>'type' in ('Polygon','MultiPolygon') end is true),
 check(gis.st_coveredby(gis.st_geomfromgeojson((feature->'geometry')::text),gis.st_makeenvelope(-180,-90,180,90,4326))),
 check(feature->'properties'->>'AP' is not distinct from ap)
);
create index aerial_spray_scope on public.aerial_spray_features(ano,cultura,farm_code,gleba,ap);
alter table public.aerial_spray_features enable row level security;
revoke all on public.aerial_spray_features from public, anon;
grant select,insert,update,delete on public.aerial_spray_features to authenticated;
create policy aerial_read on public.aerial_spray_features for select to authenticated
 using(public.can_access_farm(farm_code));
create policy aerial_write on public.aerial_spray_features for all to authenticated
 using(public.is_admin()) with check(public.is_admin() and public.can_access_farm(farm_code));

create function public.aerial_spray_catalog(map_farm text, map_gleba text)
returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(c) order by c.ano,c.cultura,c.ap),'[]'::jsonb)
 from (select distinct ano,cultura,ap from public.aerial_spray_features
 where (map_farm='ALL' or farm_code=map_farm) and (map_gleba='ALL' or gleba=map_gleba)) c;
$$;

create function public.aerial_spray_map(map_year text,map_culture text,map_farm text,map_gleba text,selected_aps text[])
returns jsonb language sql stable security invoker set search_path='' as $$
 with selected as materialized (
  select *, gis.st_geomfromgeojson((feature->'geometry')::text) geom
  from public.aerial_spray_features
  where ano=map_year and cultura=map_culture and ap=any(selected_aps)
   and (map_farm='ALL' or farm_code=map_farm) and (map_gleba='ALL' or gleba=map_gleba)
 ), completeness as (
  select count(*) filter(where not has_limit) missing_limits,
   count(*) filter(where not has_coverage) missing_coverage
  from (select farm_code,ap,bool_or(kind='limite') has_limit,bool_or(kind='cobertura') has_coverage
    from selected group by farm_code,ap) s
 ), shapes as (
  select gis.st_union(geom) filter(where kind='limite') boundary,
   gis.st_union(geom) filter(where kind='cobertura') coverage from selected
 ), clipped as (
  select boundary, case when coverage is not null and boundary is not null
   then gis.st_collectionextract(gis.st_intersection(boundary,coverage),3) end applied
  from shapes
 ), result as (
  select *, case when applied is not null then gis.st_difference(boundary,applied) end gaps
  from clipped
 ) select jsonb_build_object(
  'total',case when missing_limits=0 then gis.st_area(boundary::gis.geography)/10000 end,
  'applied',case when missing_limits=0 and missing_coverage=0 then gis.st_area(applied::gis.geography)/10000 end,
  'unapplied',case when boundary is not null and applied is not null and missing_limits=0 and missing_coverage=0 then greatest(0,(gis.st_area(boundary::gis.geography)-gis.st_area(applied::gis.geography))/10000) end,
  'missingLimits',missing_limits,'missingCoverage',missing_coverage,
  'boundaries',case when boundary is not null then jsonb_build_object('type','Feature','properties','{}'::jsonb,'geometry',gis.st_asgeojson(boundary)::jsonb) end,
  'gaps',case when gaps is not null then jsonb_build_object('type','Feature','properties','{}'::jsonb,'geometry',gis.st_asgeojson(gaps)::jsonb) end,
  'coverage',jsonb_build_object('type','FeatureCollection','features',coalesce((select jsonb_agg(feature) from selected where kind='cobertura'),'[]'::jsonb)),
  'tracks',jsonb_build_object('type','FeatureCollection','features',coalesce((select jsonb_agg(feature) from selected where kind='circuito'),'[]'::jsonb))
 ) from result cross join completeness;
$$;
revoke all on function public.aerial_spray_catalog(text,text), public.aerial_spray_map(text,text,text,text,text[]) from public,anon;
grant execute on function public.aerial_spray_catalog(text,text), public.aerial_spray_map(text,text,text,text,text[]) to authenticated;
