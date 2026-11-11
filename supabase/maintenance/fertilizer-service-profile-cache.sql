-- Keep v1 readers intact while publishing the new road-priority model.
alter policy fertilizer_service_area_cache_read on public.fertilizer_service_area_cache using (
 (select auth.uid()) is not null and model_version in ('network-grid-v1','machine-road-v2') and
 signature=gis.fertilizer_service_signature(map_year,requested_farms)
);
create or replace function public.fertilizer_service_cached_profile(map_year text,requested_farms text[],route_model text)
returns jsonb language sql stable security invoker set search_path='' as $function$
select jsonb_build_object('signature',c.signature,'zones',c.zones,
 'analysis',c.analysis||jsonb_build_object('cached',true,'model_version',c.model_version))
from public.fertilizer_service_area_cache c
where c.signature=gis.fertilizer_service_signature($1,$2) and c.map_year=$1
 and c.model_version=$3 and $3 in ('network-grid-v1','machine-road-v2');
$function$;
revoke all on function public.fertilizer_service_cached_profile(text,text[],text) from public,anon;
grant execute on function public.fertilizer_service_cached_profile(text,text[],text) to authenticated;
