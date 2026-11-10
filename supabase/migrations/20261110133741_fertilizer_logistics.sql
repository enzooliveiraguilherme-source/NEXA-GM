-- Logistics is read-only in this first stage. Inventory will be a separate ledger.
create schema if not exists gis;
create extension if not exists postgis with schema gis;
grant usage on schema gis to authenticated;

create table public.fertilizer_mounds (
 id uuid primary key default gen_random_uuid(),
 farm_code text not null references public.farms(code),
 name text not null check (length(trim(name)) > 0),
 source_gleba text not null,
 longitude double precision not null check (longitude between -180 and 180),
 latitude double precision not null check (latitude between -90 and 90),
 created_at timestamptz not null default now(),
 unique (farm_code, name)
);
alter table public.fertilizer_mounds enable row level security;
revoke all on public.fertilizer_mounds from anon, authenticated;
grant select on public.fertilizer_mounds to authenticated;
create policy fertilizer_mounds_read on public.fertilizer_mounds for select to authenticated
 using (public.can_access_farm(farm_code));
comment on table public.fertilizer_mounds is 'Locais de abastecimento. Ausência de estoque cadastrado não significa saldo zero.';

create or replace function public.fertilizer_logistics(map_year text default '2026')
returns jsonb language sql stable security invoker set search_path = '' as $function$
with mounds as materialized (
 select m.*, f.gleba from public.fertilizer_mounds m join public.farms f on f.code=m.farm_code
), contextual as (
 select f.farm_code, coalesce(o.context->'geometry', f.feature->'geometry') geometry
 from public.farm_fields f
 left join lateral (
  select value context from jsonb_array_elements(coalesce(f.feature->'properties'->'MapContexts','[]'::jsonb))
  where value->>'operationType'='adubacao' and value->>'ano'=map_year limit 1
 ) o on true
 where exists(select 1 from mounds m where m.farm_code=f.farm_code)
  and coalesce(f.feature->'properties'->>'OperationalArchived','false') <> 'true'
  and coalesce(o.context->>'hidden','false') <> 'true'
  and (not (f.feature->'properties' ? 'MapOnlyContexts') or exists (
   select 1 from jsonb_array_elements(f.feature->'properties'->'MapOnlyContexts') c
   where c->>'operationType'='adubacao' and c->>'ano'=map_year
  ))
), masks as materialized (
 select farm_code, gis.st_unaryunion(gis.st_collect(gis.st_transform(
  gis.st_collectionextract(gis.st_makevalid(gis.st_setsrid(gis.st_geomfromgeojson(geometry),4326)),3),32722))) geom
 from contextual where geometry->>'type' in ('Polygon','MultiPolygon') group by farm_code
), sites as materialized (
 -- Coincident points share one zone; keep every mound available in its popup.
 select farm_code, min(id::text) id, jsonb_agg(id order by name) mound_ids,
  string_agg(name,' / ' order by name) name,
  gis.st_transform(gis.st_setsrid(gis.st_makepoint(longitude,latitude),4326),32722) geom
 from mounds group by farm_code,longitude,latitude
), diagrams as (
 select s.farm_code, case when count(*)=1 then k.geom else
  gis.st_voronoipolygons(gis.st_collect(s.geom),0,gis.st_envelope(k.geom)) end geom
 from sites s join masks k using(farm_code) group by s.farm_code,k.geom
), cells as (
 select d.farm_code, (gis.st_dump(d.geom)).geom from diagrams d
), clipped as materialized (
 select s.id,s.mound_ids,s.name,s.farm_code,
  gis.st_collectionextract(gis.st_intersection(c.geom,k.geom),3) geom
 from cells c join sites s on s.farm_code=c.farm_code and
  (gis.st_covers(c.geom,s.geom) or (select count(*) from sites z where z.farm_code=s.farm_code)=1)
 join masks k on k.farm_code=c.farm_code
)
select jsonb_build_object(
 'mounds',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'farm_code',farm_code,
  'gleba',gleba,'source_gleba',source_gleba,'longitude',longitude,'latitude',latitude) order by farm_code,name) from mounds),'[]'::jsonb),
 'zones',jsonb_build_object('type','FeatureCollection','features',coalesce((select jsonb_agg(jsonb_build_object(
  'type','Feature','properties',jsonb_build_object('mound_id',id,'mound_ids',mound_ids,'name',name,
   'farm_code',farm_code,'area_ha',gis.st_area(geom)/10000),
  'geometry',gis.st_asgeojson(gis.st_transform(geom,4326),9)::jsonb)) from clipped
  where not gis.st_isempty(geom)),'[]'::jsonb))
);
$function$;
revoke all on function public.fertilizer_logistics(text) from public, anon;
grant execute on function public.fertilizer_logistics(text) to authenticated;
comment on function public.fertilizer_logistics(text) is 'Voronoi por fazenda em WGS84 / UTM 22S, recortado nos limites de adubação da safra. Não considera estradas ou estoque. Executa sob RLS do usuário.';
