-- Subdivide masks before clipping cells, keeping the exact 100m grid and scope.
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
