-- Replace the full FE/PA mask, avoiding rounded GeoJSON remnants.
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
