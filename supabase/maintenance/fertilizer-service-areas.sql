-- Read-only pilot: FE, PA and only RM 01/RM 02. No field geometry is modified.
create or replace function gis.fertilizer_service_masks(map_year text, requested_farms text[])
returns table(farm_code text,gleba text,geom gis.geometry)
language sql stable security invoker set search_path='' as $function$
with contextual as (
 select f.farm_code,f.campo,catalog.gleba,coalesce(o.context->'geometry',f.feature->'geometry') geometry
 from public.farm_fields f join public.farms catalog on catalog.code=f.farm_code
 left join lateral (
  select value context from jsonb_array_elements(coalesce(f.feature->'properties'->'MapContexts','[]'::jsonb))
  where value->>'operationType'='adubacao' and value->>'ano'=map_year limit 1
 ) o on true
 where (f.farm_code in ('FE','PA') or (f.farm_code='RM' and f.campo in ('RM 01','RM 02')))
  and (requested_farms is null or f.farm_code=any(requested_farms))
  and coalesce(f.feature->'properties'->>'OperationalArchived','false') <> 'true'
  and coalesce(o.context->>'hidden','false') <> 'true'
  and (not (f.feature->'properties' ? 'MapOnlyContexts') or exists (
   select 1 from jsonb_array_elements(f.feature->'properties'->'MapOnlyContexts') c
   where c->>'operationType'='adubacao' and c->>'ano'=map_year
  ))
)
select farm_code,gleba,gis.st_unaryunion(gis.st_collect(gis.st_collectionextract(gis.st_makevalid(
 gis.st_transform(gis.st_setsrid(gis.st_geomfromgeojson(geometry),4326),32722)),3) order by campo)) geom
from contextual where geometry->>'type' in ('Polygon','MultiPolygon') group by farm_code,gleba;
$function$;

create or replace function gis.fertilizer_service_signature(map_year text, requested_farms text[])
returns text language sql stable security invoker set search_path='' as $function$
select md5(concat_ws('|',map_year,
 array_to_string(array(select distinct f from unnest(coalesce(requested_farms,array['FE','PA','RM'])) f order by f),','),
 (select string_agg(f.farm_code||':'||f.campo||':'||f.feature::text,'|' order by f.farm_code,f.campo)
  from public.farm_fields f join public.farms catalog on catalog.code=f.farm_code where catalog.gleba='FE'),
 (select string_agg(r.source_id::text||':'||r.farm_codes::text||':'||encode(gis.st_asewkb(r.geom),'hex'),'|' order by r.source_id)
  from public.fertilizer_roads r),
 (select string_agg(m.id::text||':'||m.longitude::text||':'||m.latitude::text||':'||m.name,'|' order by m.id)
  from public.fertilizer_mounds m join public.farms f on f.code=m.farm_code where f.gleba='FE')
));
$function$;

create or replace function gis.fertilizer_service_cells(map_year text, requested_farms text[])
returns table(farm_code text,gleba text,i integer,j integer,geom gis.geometry,point gis.geometry)
language sql stable security invoker set search_path='' as $function$
with masks as materialized (select * from gis.fertilizer_service_masks(map_year,requested_farms)),
parts as materialized (
 select farm_code,gleba,gis.st_subdivide(geom,128) geom from masks
), cuts as (
 select m.farm_code,m.gleba,g.i,g.j,gis.st_collectionextract(gis.st_intersection(g.geom,m.geom),3) geom
 from parts m cross join lateral gis.st_squaregrid(100,m.geom) g where gis.st_intersects(g.geom,m.geom)
), clipped as (
 select farm_code,gleba,i,j,gis.st_unaryunion(gis.st_collect(geom)) geom
 from cuts where not gis.st_isempty(geom) group by farm_code,gleba,i,j
)
select farm_code,gleba,i,j,geom,gis.st_transform(gis.st_pointonsurface(geom),4326) point
from clipped where not gis.st_isempty(geom) and gis.st_area(geom)>0;
$function$;

create or replace function public.fertilizer_service_grid(map_year text, requested_farms text[] default null)
returns jsonb language sql stable security invoker set search_path='' as $function$
select jsonb_build_object('year',map_year,'gleba','FE','resolution_m',100,
 'signature',gis.fertilizer_service_signature(map_year,requested_farms),
 'cells',coalesce((select jsonb_agg(jsonb_build_object('farm_code',farm_code,'i',i,'j',j,
  'point',jsonb_build_array(gis.st_x(point),gis.st_y(point)),'area_ha',gis.st_area(geom)/10000) order by farm_code,i,j)
  from gis.fertilizer_service_cells(map_year,requested_farms)),'[]'::jsonb));
$function$;

create or replace function public.fertilizer_service_zones(map_year text,grid_signature text,requested_farms text[],assignments jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $function$
begin
 if jsonb_typeof(assignments) is distinct from 'array' or jsonb_array_length(assignments)>30000 then
  raise exception 'Malha de atendimento inválida.';
 end if;
 if grid_signature is distinct from gis.fertilizer_service_signature(map_year,requested_farms) then
  raise exception 'Os limites, montes ou estradas mudaram. Atualize o estudo de atendimento.';
 end if;
 return (
 with masks as materialized (select * from gis.fertilizer_service_masks(map_year,requested_farms)),
 cells as materialized (select * from gis.fertilizer_service_cells(map_year,requested_farms)),
 mounds as materialized (
  select m.*,f.gleba from public.fertilizer_mounds m join public.farms f on f.code=m.farm_code
 ), sites as materialized (
  select gleba,longitude,latitude,min(id::text) id,jsonb_agg(id order by name) mound_ids,
   string_agg(name,' / ' order by name) name from mounds group by gleba,longitude,latitude
 ), supplied as (
  select value->>'f' farm_code,(value->>'i')::integer i,(value->>'j')::integer j,(value->>'m')::uuid mound_id
  from jsonb_array_elements(assignments) where value->>'m' is not null
 ), chosen as (
  -- One winner per cell, even for malformed duplicate assignments. Origins must
  -- remain readable under mound RLS and in the destination's canonical gleba.
  select c.farm_code,c.i,c.j,min(s.id) mound_id
  from cells c join supplied a on (c.farm_code,c.i,c.j)=(a.farm_code,a.i,a.j)
  join mounds m on m.id=a.mound_id and m.gleba=c.gleba
  join sites s on s.gleba=m.gleba and s.longitude=m.longitude and s.latitude=m.latitude
  group by c.farm_code,c.i,c.j
 ), routed as materialized (
  select c.farm_code,c.gleba,k.mound_id,gis.st_unaryunion(gis.st_collect(c.geom)) geom
  from chosen k join cells c using(farm_code,i,j) group by c.farm_code,c.gleba,k.mound_id
 ), base as (
  select f->'properties' properties,gis.st_transform(gis.st_setsrid(gis.st_geomfromgeojson(f->'geometry'),4326),32722) geom
  from jsonb_array_elements(public.fertilizer_logistics(map_year)->'zones'->'features') f
 ), residual as (
  select b.properties,gis.st_collectionextract(case when m.geom is null then b.geom else gis.st_difference(b.geom,m.geom) end,3) geom
  from base b left join masks m on m.farm_code=b.properties->>'farm_code'
  -- These two farms are entirely inside the pilot. Do not retain millimetric
  -- remnants introduced by the straight-line GeoJSON's coordinate rounding.
  where m.geom is null or b.properties->>'farm_code' not in ('FE','PA')
 ), features as (
  select properties||jsonb_build_object('method','straight','area_ha',gis.st_area(geom)/10000) properties,geom
  from residual where not gis.st_isempty(geom) and gis.st_area(geom)>0.001
  union all
  select jsonb_build_object('mound_id',s.id,'mound_ids',s.mound_ids,'name',s.name,'farm_code',r.farm_code,
   'gleba',r.gleba,'method','network','resolution_m',100,'area_ha',gis.st_area(r.geom)/10000),r.geom
  from routed r join sites s on s.id=r.mound_id
 )
 select jsonb_build_object('zones',jsonb_build_object('type','FeatureCollection','features',coalesce((select jsonb_agg(
  jsonb_build_object('type','Feature','properties',properties,'geometry',
   gis.st_asgeojson(gis.st_reduceprecision(gis.st_transform(geom,4326),0.00000001),8)::jsonb)) from features),'[]'::jsonb)),
  'analysis',jsonb_build_object('method','network_grid','resolution_m',100,'scope',jsonb_build_array('FE','PA','RM 01','RM 02'),
   'cells',(select count(*) from cells),'served_cells',(select count(*) from chosen),
   'unserved_area_ha',greatest(0,coalesce((select sum(gis.st_area(geom)) from cells),0)-coalesce((select sum(gis.st_area(geom)) from routed),0))/10000))
 );
end;
$function$;

revoke all on function gis.fertilizer_service_masks(text,text[]) from public,anon;
revoke all on function gis.fertilizer_service_signature(text,text[]) from public,anon;
revoke all on function gis.fertilizer_service_cells(text,text[]) from public,anon;
revoke all on function public.fertilizer_service_grid(text,text[]) from public,anon;
revoke all on function public.fertilizer_service_zones(text,text,text[],jsonb) from public,anon;
grant execute on function gis.fertilizer_service_masks(text,text[]) to authenticated;
grant execute on function gis.fertilizer_service_signature(text,text[]) to authenticated;
grant execute on function gis.fertilizer_service_cells(text,text[]) to authenticated;
grant execute on function public.fertilizer_service_grid(text,text[]) to authenticated;
grant execute on function public.fertilizer_service_zones(text,text,text[],jsonb) to authenticated;
