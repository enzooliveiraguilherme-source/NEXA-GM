-- Read-only routing data. Geometry stays behind the same farm access policy.
create table public.fertilizer_roads (
 source_id integer primary key,
 farm_codes text[] not null check (cardinality(farm_codes)>0),
 geom gis.geometry(MultiLineString,32722) not null
);
alter table public.fertilizer_roads enable row level security;
revoke all on public.fertilizer_roads from public,anon,authenticated;
grant select on public.fertilizer_roads to authenticated;
create policy fertilizer_roads_read on public.fertilizer_roads for select to authenticated
 using (not exists(select 1 from unnest(farm_codes) code where public.can_access_farm(code) is not true));

create or replace function public.fertilizer_routing(map_year text, routing_gleba text)
returns jsonb language sql stable security invoker set search_path='' as $function$
with contextual as materialized (
 select f.farm_code,f.campo,coalesce(o.context->'geometry',f.feature->'geometry') geometry
 from public.farm_fields f join public.farms catalog on catalog.code=f.farm_code
 left join lateral (
  select value context from jsonb_array_elements(coalesce(f.feature->'properties'->'MapContexts','[]'::jsonb))
  where value->>'operationType'='adubacao' and value->>'ano'=map_year limit 1
 ) o on true
 where catalog.gleba=routing_gleba
  and coalesce(f.feature->'properties'->>'OperationalArchived','false') <> 'true'
  and coalesce(o.context->>'hidden','false') <> 'true'
  and (not (f.feature->'properties' ? 'MapOnlyContexts') or exists (
   select 1 from jsonb_array_elements(f.feature->'properties'->'MapOnlyContexts') c
   where c->>'operationType'='adubacao' and c->>'ano'=map_year
  ))
), fields as materialized (
 select farm_code,campo,gis.st_collectionextract(gis.st_makevalid(gis.st_transform(
  gis.st_setsrid(gis.st_geomfromgeojson(geometry),4326),32722)),3) geom
 from contextual where geometry->>'type' in ('Polygon','MultiPolygon')
), roads as materialized (
 select gis.st_unaryunion(gis.st_collect(r.geom)) geom
 from public.fertilizer_roads r
 where exists(select 1 from public.farms f where f.code=any(r.farm_codes) and f.gleba=routing_gleba)
), lines as (
 select gis.st_boundary(geom) geom from fields
 union all select geom from roads where geom is not null
), network as (
 -- Node crossings before segmentizing, so crossing roads really connect.
 select gis.st_segmentize((gis.st_dump(gis.st_node(gis.st_unaryunion(gis.st_collect(geom))))).geom,40) geom
 from lines
)
select jsonb_build_object(
 'gleba',routing_gleba,'year',map_year,'shortcut_m',80,
 'fields',jsonb_build_object('type','FeatureCollection','features',coalesce((select jsonb_agg(
  jsonb_build_object('type','Feature','properties',jsonb_build_object('farm_code',farm_code,'campo',campo),
   'geometry',gis.st_asgeojson(gis.st_transform(gis.st_segmentize(geom,40),4326),9)::jsonb)) from fields),'[]'::jsonb)),
 'roads',jsonb_build_object('type','FeatureCollection','features',coalesce((select jsonb_agg(
  jsonb_build_object('type','Feature','properties','{}'::jsonb,'geometry',gis.st_asgeojson(gis.st_transform(geom,4326),9)::jsonb)) from roads where geom is not null),'[]'::jsonb)),
 'network',jsonb_build_object('type','FeatureCollection','features',coalesce((select jsonb_agg(
  jsonb_build_object('type','Feature','properties','{}'::jsonb,'geometry',gis.st_asgeojson(gis.st_transform(geom,4326),9)::jsonb)) from network),'[]'::jsonb))
);
$function$;
revoke all on function public.fertilizer_routing(text,text) from public,anon;
grant execute on function public.fertilizer_routing(text,text) to authenticated;
comment on function public.fertilizer_routing(text,text) is 'Noded roads and field borders for shortest-distance routing. SECURITY INVOKER; canonical gleba and fertilizer map context; no inventory claims.';
