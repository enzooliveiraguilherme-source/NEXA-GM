-- Bind request parameters explicitly; cache columns have the same names.
create or replace function public.fertilizer_service_cached(map_year text,requested_farms text[] default null)
returns jsonb language sql stable security invoker set search_path='' as $function$
select jsonb_build_object('signature',c.signature,'zones',c.zones,'analysis',c.analysis||jsonb_build_object('cached',true))
from public.fertilizer_service_area_cache c
where c.signature=gis.fertilizer_service_signature($1,$2)
 and c.map_year=$1 and c.model_version='network-grid-v1';
$function$;
