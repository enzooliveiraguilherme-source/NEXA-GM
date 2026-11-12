-- Application axis from supplied maize AB guides; road-priority routing stays v2.
-- New functions/cache version preserve older clients and their prepared results.
create table public.fertilizer_application_guides (
 map_year text not null check (map_year ~ '^20[0-9]{2}$'),
 farm_code text not null,
 campo text not null,
 crop text not null default 'milho' check (crop='milho'),
 source_id integer not null,
 source_name text,
 inherited_from text,
 source_sha256 text not null,
 geom gis.geometry(LineString,32722) not null check (gis.st_length(geom)>1),
 primary key(map_year,farm_code,campo),
 foreign key(farm_code,campo) references public.farm_fields(farm_code,campo) on delete cascade
);
alter table public.fertilizer_application_guides enable row level security;
revoke all on public.fertilizer_application_guides from public,anon,authenticated;
grant select on public.fertilizer_application_guides to authenticated;
create policy fertilizer_application_guides_read on public.fertilizer_application_guides
 for select to authenticated using (public.can_access_farm(farm_code));

create or replace function gis.fertilizer_direction_signature(map_year text,requested_farms text[])
returns text language sql stable security invoker set search_path='' as $function$
select md5(concat_ws('|','ab-strips-v1:50:100:machine-road-v2',
 gis.fertilizer_service_signature($1,$2),
 (select string_agg(g.farm_code||':'||g.campo||':'||g.source_id||':'||g.source_sha256||':'||
  coalesce(g.inherited_from,'')||':'||encode(gis.st_asewkb(g.geom),'hex'),'|' order by g.farm_code,g.campo)
  from public.fertilizer_application_guides g where g.map_year=$1 and ($2 is null or g.farm_code=any($2))),
 -- Base zones outside the pilot also belong to the current reader's snapshot.
 (select string_agg(f.farm_code||':'||f.campo||':'||f.feature::text,'|' order by f.farm_code,f.campo) from public.farm_fields f),
 (select string_agg(m.id||':'||m.name||':'||m.farm_code||':'||m.longitude||':'||m.latitude,'|' order by m.id) from public.fertilizer_mounds m)
));
$function$;

create or replace function gis.fertilizer_direction_fields(map_year text,requested_farms text[])
returns table(farm_code text,campo text,gleba text,geom gis.geometry,guide_id integer,angle double precision,origin gis.geometry)
language sql stable security invoker set search_path='' as $function$
with contextual as materialized (
 select f.farm_code,f.campo,catalog.gleba,coalesce(o.context->'geometry',f.feature->'geometry') geometry
 from public.farm_fields f join public.farms catalog on catalog.code=f.farm_code
 left join lateral (
  select value context from jsonb_array_elements(coalesce(f.feature->'properties'->'MapContexts','[]'::jsonb))
  where value->>'operationType'='adubacao' and value->>'ano'=$1 limit 1
 ) o on true
 where (f.farm_code in ('FE','PA') or (f.farm_code='RM' and f.campo in ('RM 01','RM 02')))
  and ($2 is null or f.farm_code=any($2))
  and coalesce(f.feature->'properties'->>'OperationalArchived','false')<>'true'
  and coalesce(o.context->>'hidden','false')<>'true'
  and (not(f.feature->'properties' ? 'MapOnlyContexts') or exists (
   select 1 from jsonb_array_elements(f.feature->'properties'->'MapOnlyContexts') c
   where c->>'operationType'='adubacao' and c->>'ano'=$1
  ))
)
select f.farm_code,f.campo,f.gleba,gis.st_collectionextract(gis.st_makevalid(gis.st_transform(
 gis.st_setsrid(gis.st_geomfromgeojson(f.geometry),4326),32722)),3),g.source_id,
 -- An AB is an undirected axis: reversing A/B leaves the cuts unchanged.
 case when g.geom is not null then mod((atan2(gis.st_y(gis.st_endpoint(g.geom))-gis.st_y(gis.st_startpoint(g.geom)),
  gis.st_x(gis.st_endpoint(g.geom))-gis.st_x(gis.st_startpoint(g.geom)))+2*pi())::numeric,pi()::numeric)::double precision end,
 gis.st_startpoint(g.geom)
from contextual f left join public.fertilizer_application_guides g
 on g.map_year=$1 and g.farm_code=f.farm_code and g.campo=f.campo and g.crop='milho'
where f.geometry->>'type' in ('Polygon','MultiPolygon');
$function$;

create or replace function gis.fertilizer_direction_strips(map_year text,requested_farms text[])
returns table(farm_code text,campo text,gleba text,strip_id text,layout text,guide_id integer,
 angle double precision,origin gis.geometry,geom gis.geometry)
language sql stable security invoker set search_path='' as $function$
with fields as materialized (select * from gis.fertilizer_direction_fields($1,$2)),
frames as materialized (
 select f.*,gis.st_rotate(gis.st_translate(f.geom,-gis.st_x(f.origin),-gis.st_y(f.origin)),-f.angle) rotated
 from fields f where f.guide_id is not null
), cuts as (
 select f.*,i,gis.st_collectionextract(gis.st_intersection(f.rotated,gis.st_makeenvelope(
  gis.st_xmin(f.rotated)-1,i*50,gis.st_xmax(f.rotated)+1,(i+1)*50,32722)),3) cut
 from frames f cross join lateral generate_series(floor(gis.st_ymin(f.rotated)/50)::integer,
  floor(gis.st_ymax(f.rotated)/50)::integer) i
), parts as (
 select c.*,(gis.st_dump(c.cut)).path part,(gis.st_dump(c.cut)).geom piece from cuts c where not gis.st_isempty(c.cut)
), missing as (
 -- A missing guide is never inferred from field shape or an unrelated neighbor.
 select f.*,g.i,g.j,gis.st_collectionextract(gis.st_intersection(f.geom,g.geom),3) cut
 from fields f cross join lateral gis.st_squaregrid(100,f.geom) g
 where f.guide_id is null and gis.st_intersects(f.geom,g.geom)
)
select farm_code,campo,gleba,'ab:'||i||':'||array_to_string(part,'.'),'ab_strips',guide_id,angle,origin,
 gis.st_translate(gis.st_rotate(piece,angle),gis.st_x(origin),gis.st_y(origin))
from parts where gis.st_area(piece)>0.0001
union all
select farm_code,campo,gleba,'grid:'||i||':'||j,'grid',null,null,null,cut
from missing where not gis.st_isempty(cut) and gis.st_area(cut)>0.0001;
$function$;

create or replace function gis.fertilizer_direction_samples(map_year text,requested_farms text[])
returns table(farm_code text,campo text,gleba text,strip_id text,point gis.geometry,area_ha double precision)
language sql stable security invoker set search_path='' as $function$
with strips as materialized (select * from gis.fertilizer_direction_strips($1,$2)),
frames as (
 select s.*,gis.st_rotate(gis.st_translate(s.geom,-gis.st_x(s.origin),-gis.st_y(s.origin)),-s.angle) rotated
 from strips s where s.layout='ab_strips'
), samples as (
 select f.farm_code,f.campo,f.gleba,f.strip_id,f.angle,f.origin,
 gis.st_collectionextract(gis.st_intersection(f.rotated,gis.st_makeenvelope(j*100,gis.st_ymin(f.rotated)-1,
  (j+1)*100,gis.st_ymax(f.rotated)+1,32722)),3) cut
 from frames f cross join lateral generate_series(floor(gis.st_xmin(f.rotated)/100)::integer,
  floor(gis.st_xmax(f.rotated)/100)::integer) j
)
select farm_code,campo,gleba,strip_id,gis.st_transform(gis.st_translate(gis.st_rotate(gis.st_pointonsurface(cut),angle),
 gis.st_x(origin),gis.st_y(origin)),4326),gis.st_area(cut)/10000
from samples where not gis.st_isempty(cut) and gis.st_area(cut)>0.0001
union all
select farm_code,campo,gleba,strip_id,gis.st_transform(gis.st_pointonsurface(geom),4326),gis.st_area(geom)/10000
from strips where layout='grid';
$function$;

create or replace function public.fertilizer_direction_grid(map_year text,requested_farms text[] default null)
returns jsonb language sql stable security invoker set search_path='' as $function$
select jsonb_build_object('year',$1,'gleba','FE','model_version','ab-strips-v1','routing_model','machine-road-v2',
 'strip_width_m',50,'sampling_step_m',100,'signature',gis.fertilizer_direction_signature($1,$2),
 'cells',coalesce((select jsonb_agg(jsonb_build_object('farm_code',farm_code,'campo',campo,'strip_id',strip_id,
  'point',jsonb_build_array(gis.st_x(point),gis.st_y(point)),'area_ha',area_ha) order by farm_code,campo,strip_id,gis.st_x(point),gis.st_y(point))
 from gis.fertilizer_direction_samples($1,$2)),'[]'::jsonb));
$function$;

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
   where p.properties->>'farm_code'=f.properties->>'farm_code' and gis.st_intersects(p.geom,f.geom)
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

alter policy fertilizer_service_area_cache_read on public.fertilizer_service_area_cache using (
 (select auth.uid()) is not null and case when model_version='ab-strips-v1' then
  signature=gis.fertilizer_direction_signature(map_year,requested_farms)
 else model_version in ('network-grid-v1','machine-road-v2') and signature=gis.fertilizer_service_signature(map_year,requested_farms) end
);
create or replace function public.fertilizer_service_cached_profile(map_year text,requested_farms text[],route_model text)
returns jsonb language sql stable security invoker set search_path='' as $function$
select jsonb_build_object('signature',c.signature,'zones',c.zones,
 'analysis',c.analysis||jsonb_build_object('cached',true,'model_version',c.model_version))
from public.fertilizer_service_area_cache c
where c.signature=case when $3='ab-strips-v1' then gis.fertilizer_direction_signature($1,$2) else gis.fertilizer_service_signature($1,$2) end
 and c.map_year=$1 and c.model_version=$3 and $3 in ('network-grid-v1','machine-road-v2','ab-strips-v1');
$function$;

revoke all on function gis.fertilizer_direction_signature(text,text[]) from public,anon;
revoke all on function gis.fertilizer_direction_fields(text,text[]) from public,anon;
revoke all on function gis.fertilizer_direction_strips(text,text[]) from public,anon;
revoke all on function gis.fertilizer_direction_samples(text,text[]) from public,anon;
revoke all on function public.fertilizer_direction_grid(text,text[]) from public,anon;
revoke all on function public.fertilizer_direction_zones(text,text,text[],jsonb) from public,anon;
grant execute on function gis.fertilizer_direction_signature(text,text[]),gis.fertilizer_direction_fields(text,text[]),
 gis.fertilizer_direction_strips(text,text[]),gis.fertilizer_direction_samples(text,text[]),
 public.fertilizer_direction_grid(text,text[]),public.fertilizer_direction_zones(text,text,text[],jsonb) to authenticated;
notify pgrst,'reload schema';
