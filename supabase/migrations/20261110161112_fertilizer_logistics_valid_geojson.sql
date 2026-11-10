-- The source farms FE/FE2 aggregate several separately registered portal farms.
-- Compare sources within the canonical gleba, then clip each zone to destination farms.
create or replace function public.fertilizer_logistics(map_year text default '2026')
returns jsonb language sql stable security invoker set search_path = '' as $function$
with mounds as materialized (
 select m.*, f.gleba from public.fertilizer_mounds m join public.farms f on f.code=m.farm_code
), contextual as (
 select f.farm_code, catalog.gleba, coalesce(o.context->'geometry', f.feature->'geometry') geometry
 from public.farm_fields f join public.farms catalog on catalog.code=f.farm_code
 left join lateral (
  select value context from jsonb_array_elements(coalesce(f.feature->'properties'->'MapContexts','[]'::jsonb))
  where value->>'operationType'='adubacao' and value->>'ano'=map_year limit 1
 ) o on true
 where exists(select 1 from mounds m where m.gleba=catalog.gleba)
  and coalesce(f.feature->'properties'->>'OperationalArchived','false') <> 'true'
  and coalesce(o.context->>'hidden','false') <> 'true'
  and (not (f.feature->'properties' ? 'MapOnlyContexts') or exists (
   select 1 from jsonb_array_elements(f.feature->'properties'->'MapOnlyContexts') c
   where c->>'operationType'='adubacao' and c->>'ano'=map_year
  ))
), masks as materialized (
 select farm_code,gleba, gis.st_unaryunion(gis.st_collect(gis.st_transform(
  gis.st_collectionextract(gis.st_makevalid(gis.st_setsrid(gis.st_geomfromgeojson(geometry),4326)),3),32722))) geom
 from contextual where geometry->>'type' in ('Polygon','MultiPolygon') group by farm_code,gleba
), gleba_masks as (
 select gleba,gis.st_unaryunion(gis.st_collect(geom)) geom from masks group by gleba
), sites as materialized (
 select gleba, min(id::text) id, jsonb_agg(id order by name) mound_ids,
  string_agg(name,' / ' order by name) name,
  gis.st_transform(gis.st_setsrid(gis.st_makepoint(longitude,latitude),4326),32722) geom
 from mounds group by gleba,longitude,latitude
), diagrams as (
 select s.gleba, case when count(*)=1 then k.geom else
  gis.st_voronoipolygons(gis.st_collect(s.geom),0,gis.st_envelope(k.geom)) end geom
 from sites s join gleba_masks k using(gleba) group by s.gleba,k.geom
), cells as (
 select d.gleba, (gis.st_dump(d.geom)).geom from diagrams d
), clipped as materialized (
 select s.id,s.mound_ids,s.name,k.farm_code,s.gleba,
  gis.st_collectionextract(gis.st_intersection(c.geom,k.geom),3) geom
 from cells c join sites s on s.gleba=c.gleba and
  (gis.st_covers(c.geom,s.geom) or (select count(*) from sites z where z.gleba=s.gleba)=1)
 join masks k on k.gleba=c.gleba and gis.st_intersects(c.geom,k.geom)
)
select jsonb_build_object(
 'mounds',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'farm_code',farm_code,
  'gleba',gleba,'source_gleba',source_gleba,'longitude',longitude,'latitude',latitude) order by farm_code,name) from mounds),'[]'::jsonb),
 'zones',jsonb_build_object('type','FeatureCollection','features',coalesce((select jsonb_agg(jsonb_build_object(
  'type','Feature','properties',jsonb_build_object('mound_id',id,'mound_ids',mound_ids,'name',name,
   'farm_code',farm_code,'gleba',gleba,'area_ha',gis.st_area(geom)/10000),
  'geometry',gis.st_asgeojson(gis.st_reduceprecision(gis.st_transform(geom,4326),0.00000001),8)::jsonb)) from clipped
  where not gis.st_isempty(geom)),'[]'::jsonb))
);
$function$;
revoke all on function public.fertilizer_logistics(text) from public, anon;
grant execute on function public.fertilizer_logistics(text) to authenticated;
comment on function public.fertilizer_logistics(text) is 'Voronoi por gleba em WGS84 / UTM 22S, recortado por fazenda de destino e limites de adubação da safra. Montes mantêm a fazenda de origem. Não considera estradas ou estoque. SECURITY INVOKER respeita RLS de origens e destinos.';

