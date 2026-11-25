-- Prepared map graphics. Runtime rendering reads JSON; original analytical geometries stay intact.
create table public.aerial_spray_map_cache (
 farm_code text not null references public.farms(code),gleba text not null,ano text not null,cultura text not null,ap text not null,
 boundary_geom gis.geometry not null,coverage_geom gis.geometry not null,
 boundary jsonb not null,coverage jsonb not null,tracks jsonb not null,gaps jsonb,
 bounds jsonb not null,fields jsonb not null,total_ha double precision not null,applied_ha double precision not null,
 prepared_at timestamptz not null default now(),primary key(farm_code,gleba,ano,cultura,ap)
);
alter table public.aerial_spray_map_cache enable row level security;
revoke all on public.aerial_spray_map_cache from public,anon;
grant select,insert,update,delete on public.aerial_spray_map_cache to authenticated;
create policy aerial_cache_read on public.aerial_spray_map_cache for select to authenticated using(public.can_access_farm(farm_code));
create policy aerial_cache_write on public.aerial_spray_map_cache for all to authenticated
 using(public.is_admin()) with check(public.is_admin() and public.can_access_farm(farm_code));

create or replace function public.aerial_prepare_graphic(shape gis.geometry, tolerance_m double precision)
returns jsonb language sql immutable strict security invoker set search_path='' as $$
 with simplified as materialized(select gis.st_simplify(gis.st_transform(shape,32722),tolerance_m) g),
 valid as materialized(select case when gis.st_isvalid(g) then g else gis.st_makevalid(g) end g from simplified)
 select gis.st_asgeojson(gis.st_transform(g,4326),7)::jsonb from valid;
$$;
revoke all on function public.aerial_prepare_graphic(gis.geometry,double precision) from public,anon;
grant execute on function public.aerial_prepare_graphic(gis.geometry,double precision) to authenticated;

create function public.aerial_spray_render(map_year text,map_culture text,map_farm text,map_gleba text,selected_aps text[])
returns jsonb language sql stable security invoker set search_path='' as $$
 with selected as materialized(select * from public.aerial_spray_map_cache
  where ano=map_year and cultura=map_culture and ap=any(selected_aps)
   and (map_farm='ALL' or farm_code=map_farm) and (map_gleba='ALL' or gleba=map_gleba)),
 fc as (select jsonb_build_object('type','FeatureCollection','features',coalesce(jsonb_agg(boundary),'[]')) boundaries,
   jsonb_build_object('type','FeatureCollection','features',coalesce(jsonb_agg(coverage),'[]')) coverage,
   jsonb_build_object('type','FeatureCollection','features',coalesce(jsonb_agg(gaps) filter(where gaps is not null),'[]')) gaps,
   count(*) records,max(total_ha) total,max(applied_ha) applied from selected)
 select jsonb_build_object('boundaries',boundaries,'coverage',coverage,
  'tracks',jsonb_build_object('type','FeatureCollection','features',coalesce((select jsonb_agg(t) from selected s cross join lateral jsonb_array_elements(s.tracks) t),'[]')),
  'gaps',case when records=1 then gaps else null end,
  'total',case when records=1 then total end,'applied',case when records=1 then applied end,
  'unapplied',case when records=1 then greatest(0,total-applied) end,'needsTotals',records>1,
  'fields',coalesce((select jsonb_agg(f) from selected s cross join lateral jsonb_array_elements(s.fields) f),'[]'),
  'prepared',true) from fc;
$$;
revoke all on function public.aerial_spray_render(text,text,text,text,text[]) from public,anon;
grant execute on function public.aerial_spray_render(text,text,text,text,text[]) to authenticated;

create function public.aerial_spray_totals(map_year text,map_culture text,map_farm text,map_gleba text,selected_aps text[])
returns jsonb language sql stable security invoker set search_path='' set statement_timeout='30s' as $$
 with selected as materialized(select boundary_geom b,coverage_geom c from public.aerial_spray_map_cache
  where ano=map_year and cultura=map_culture and ap=any(selected_aps)
   and (map_farm='ALL' or farm_code=map_farm) and (map_gleba='ALL' or gleba=map_gleba)),
 combined as materialized(select gis.st_union(b) b,gis.st_union(c) c from selected),
 clipped as materialized(select b,gis.st_collectionextract(gis.st_intersection(b,c),3) a from combined),
 areas as materialized(select gis.st_area(b::gis.geography)/10000 total,gis.st_area(a::gis.geography)/10000 applied from clipped)
 select jsonb_build_object('total',total,'applied',applied,'unapplied',greatest(0,total-applied)) from areas;
$$;
revoke all on function public.aerial_spray_totals(text,text,text,text,text[]) from public,anon;
grant execute on function public.aerial_spray_totals(text,text,text,text,text[]) to authenticated;

create or replace function public.aerial_spray_catalog(map_farm text,map_gleba text)
returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('ano',ano,'cultura',cultura,'ap',ap,'farm',farm_code,
  'bounds',bounds,'fields',fields,'total',total_ha,'applied',applied_ha,'unapplied',greatest(0,total_ha-applied_ha)) order by ano,cultura,ap,farm_code),'[]')
 from public.aerial_spray_map_cache
 where (map_farm='ALL' or farm_code=map_farm) and (map_gleba='ALL' or gleba=map_gleba);
$$;
notify pgrst,'reload schema';
