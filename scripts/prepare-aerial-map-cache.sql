-- One-time preparation; never run this during an interactive map request.
begin;
set local statement_timeout='900s';
with source as materialized(
 select farm_code,gleba,ano,cultura,ap,kind,validated_geom geom,feature->'properties' props
 from public.aerial_spray_features where ano='2026' and cultura='Soja' and ap<>'AP126'
), pairs as materialized(
 select b.farm_code,b.gleba,b.ano,b.cultura,b.ap,b.geom boundary,c.geom coverage,b.props,
  gis.st_collectionextract(gis.st_intersection(b.geom,c.geom),3) applied
 from source b join source c using(farm_code,gleba,ano,cultura,ap)
 where b.kind='limite' and c.kind='cobertura'
), graphics as materialized(
 select *,public.aerial_prepare_graphic(boundary,0.25) boundary_display,
  public.aerial_prepare_graphic(coverage,0.35) coverage_display,
  public.aerial_prepare_graphic(gis.st_difference(boundary,applied),0.35) gaps_display
 from pairs
)
insert into public.aerial_spray_map_cache(farm_code,gleba,ano,cultura,ap,boundary_geom,coverage_geom,
 boundary,coverage,tracks,gaps,bounds,fields,total_ha,applied_ha)
select farm_code,gleba,ano,cultura,ap,boundary,coverage,
 jsonb_build_object('type','Feature','properties',jsonb_build_object('AP',ap,'Campos',props->'Campos'),'geometry',boundary_display),
 jsonb_build_object('type','Feature','properties',jsonb_build_object('AP',ap),'geometry',coverage_display),
 coalesce((select jsonb_agg(jsonb_build_object('type','Feature','properties',s.props,
  'geometry',public.aerial_prepare_graphic(s.geom,0.75))) from source s
  where s.farm_code=g.farm_code and s.ap=g.ap and s.ano=g.ano and s.cultura=g.cultura and s.kind='circuito'),'[]'),
 jsonb_build_object('type','Feature','properties',jsonb_build_object('AP',ap),'geometry',gaps_display),
 jsonb_build_array(gis.st_xmin(gis.box3d(boundary)),gis.st_ymin(gis.box3d(boundary)),gis.st_xmax(gis.box3d(boundary)),gis.st_ymax(gis.box3d(boundary))),
 coalesce(props->'Campos','[]'),gis.st_area(boundary::gis.geography)/10000,gis.st_area(applied::gis.geography)/10000
from graphics g
on conflict(farm_code,gleba,ano,cultura,ap) do update set boundary_geom=excluded.boundary_geom,coverage_geom=excluded.coverage_geom,
 boundary=excluded.boundary,coverage=excluded.coverage,tracks=excluded.tracks,gaps=excluded.gaps,bounds=excluded.bounds,fields=excluded.fields,
 total_ha=excluded.total_ha,applied_ha=excluded.applied_ha,prepared_at=now();
select count(*) prepared,count(distinct ap) aps from public.aerial_spray_map_cache;
commit;
