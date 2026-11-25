-- Fast path: read prepared JSON columns directly. No GIS, unions, intersections or aggregation.
create function public.aerial_spray_layers(map_year text,map_culture text,map_farm text,map_gleba text,selected_aps text[])
returns table(farm_code text,ap text,boundary jsonb,coverage jsonb,tracks jsonb,total double precision,applied double precision)
language sql stable security invoker set search_path='' as $$
 select c.farm_code,c.ap,c.boundary,c.coverage,c.tracks,c.total_ha,c.applied_ha
 from public.aerial_spray_map_cache c
 where c.ano=map_year and c.cultura=map_culture and c.ap=any(selected_aps)
 and (map_farm='ALL' or c.farm_code=map_farm) and (map_gleba='ALL' or c.gleba=map_gleba)
 order by c.ap,c.farm_code;
$$;
revoke all on function public.aerial_spray_layers(text,text,text,text,text[]) from public,anon;
grant execute on function public.aerial_spray_layers(text,text,text,text,text[]) to authenticated;
notify pgrst,'reload schema';
