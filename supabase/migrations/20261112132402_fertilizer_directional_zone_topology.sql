-- Resolve source-field overlaps and omit geometries collapsed by precision reduction.
create or replace function public.fertilizer_direction_zones(map_year text,grid_signature text,requested_farms text[],assignments jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $function$
begin
 if jsonb_typeof(assignments) is distinct from 'array' or jsonb_array_length(assignments)>30000 then
  raise exception 'Faixas de atendimento inválidas.';
 end if;
 if grid_signature is distinct from gis.fertilizer_direction_signature($1,$3) then
  raise exception 'As guias, os limites ou os acessos mudaram. Atualize o estudo.';
 end if;
 return (
 with strips as materialized (select * from gis.fertilizer_direction_strips($1,$3)),
 masks as materialized (select * from gis.fertilizer_service_masks($1,$3)),
 mounds as materialized (select m.*,f.gleba from public.fertilizer_mounds m join public.farms f on f.code=m.farm_code),
 sites as materialized (
  select gleba,longitude,latitude,min(id::text) id,jsonb_agg(id order by name) mound_ids,string_agg(name,' / ' order by name) name
  from mounds group by gleba,longitude,latitude
 ), supplied as (
  select value->>'f' farm_code,value->>'c' campo,value->>'s' strip_id,(value->>'m')::uuid mound_id
  from jsonb_array_elements(assignments) where value->>'m' is not null
 ), chosen as (
  select c.farm_code,c.campo,c.strip_id,min(s.id) mound_id
  from strips c join supplied a using(farm_code,campo,strip_id)
  join mounds m on m.id=a.mound_id and m.gleba=c.gleba
  join sites s on (s.gleba,s.longitude,s.latitude)=(m.gleba,m.longitude,m.latitude)
  group by c.farm_code,c.campo,c.strip_id
 ), routed as materialized (
  select c.farm_code,c.campo,c.gleba,c.layout,c.guide_id,c.angle,k.mound_id,gis.st_unaryunion(gis.st_collect(c.geom)) geom
  from chosen k join strips c using(farm_code,campo,strip_id)
  group by c.farm_code,c.campo,c.gleba,c.layout,c.guide_id,c.angle,k.mound_id
 ), base as (
  select f->'properties' properties,gis.st_transform(gis.st_setsrid(gis.st_geomfromgeojson(f->'geometry'),4326),32722) geom
  from jsonb_array_elements(public.fertilizer_logistics($1)->'zones'->'features') f
 ), residual as (
  select b.properties,gis.st_collectionextract(case when m.geom is null then b.geom else gis.st_difference(b.geom,m.geom) end,3) geom
  from base b left join masks m on m.farm_code=b.properties->>'farm_code'
  where m.geom is null or b.properties->>'farm_code' not in ('FE','PA')
 ), features as (
  select properties||jsonb_build_object('method','straight','area_ha',gis.st_area(geom)/10000) properties,geom
  from residual where not gis.st_isempty(geom) and gis.st_area(geom)>0.001
  union all
  select jsonb_build_object('mound_id',s.id,'mound_ids',s.mound_ids,'name',s.name,'farm_code',r.farm_code,'campo',r.campo,
   'gleba',r.gleba,'method',case when r.layout='ab_strips' then 'directional' else 'network' end,'layout',r.layout,
   'guide_id',r.guide_id,'axis_degrees',degrees(r.angle),'strip_width_m',case when r.layout='ab_strips' then 50 else 100 end,
   'area_ha',gis.st_area(r.geom)/10000),r.geom from routed r join sites s on s.id=r.mound_id
 ), rounded as materialized (
  select properties,gis.st_collectionextract(gis.st_makevalid(gis.st_reduceprecision(gis.st_transform(geom,4326),0.00000001)),3) geom
  from features
 ), unique_areas as materialized (
  -- Field cadastres can overlap slightly. Preserve the reference outside the
  -- pilot first, then resolve shared slivers by stable field/origin order.
  -- Use the same precision grid for the overlay and GeoJSON serialization.
  select f.properties,gis.st_collectionextract(case when earlier.geom is null then f.geom
   else gis.st_difference(f.geom,earlier.geom,0.00000001) end,3) geom
  from rounded f left join lateral (
   select gis.st_unaryunion(gis.st_collect(p.geom)) geom from rounded p
   where p.properties->>'farm_code'=f.properties->>'farm_code' and p.geom && f.geom
    and row(case when p.properties->>'method'='straight' then 0 else 1 end,coalesce(p.properties->>'campo',''),p.properties->>'mound_id')
      < row(case when f.properties->>'method'='straight' then 0 else 1 end,coalesce(f.properties->>'campo',''),f.properties->>'mound_id')
  ) earlier on true
  where not gis.st_isempty(f.geom)
 )
 select jsonb_build_object('signature',$2,'zones',jsonb_build_object('type','FeatureCollection','features',coalesce((select jsonb_agg(
  jsonb_build_object('type','Feature','properties',properties||jsonb_build_object('area_ha',gis.st_area(gis.st_transform(geom,32722))/10000),
   'geometry',gis.st_asgeojson(geom,8)::jsonb)) from unique_areas
   where not gis.st_isempty(geom) and gis.st_area(gis.st_transform(geom,32722))>0.001),'[]'::jsonb)),
  'analysis',jsonb_build_object('method','ab_strips','model_version','ab-strips-v1','routing_model','machine-road-v2',
   'strip_width_m',50,'sampling_step_m',100,'guide_crop','milho','scope',jsonb_build_array('FE','PA','RM 01','RM 02'),
   'guided_fields',(select count(*) from (select distinct farm_code,campo from strips where layout='ab_strips') g),
   'unguided_fields',(select count(*) from (select distinct farm_code,campo from strips where layout='grid') g),
   'strips',(select count(*) from strips),'served_strips',(select count(*) from chosen),
   'unserved_area_ha',greatest(0,coalesce((select sum(gis.st_area(geom)) from masks),0)-coalesce((select sum(area) from (
    select gis.st_area(gis.st_unaryunion(gis.st_collect(geom))) area from routed group by farm_code
   ) served),0))/10000))
 );
end;
$function$;

