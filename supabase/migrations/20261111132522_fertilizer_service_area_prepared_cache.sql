-- Only trusted administrative imports can publish a prepared result. Readers
-- must see exactly the same RLS-filtered source snapshot as its producer.
create table public.fertilizer_service_area_cache (
 signature text not null,
 model_version text not null default 'network-grid-v1',
 map_year text not null,
 requested_farms text[] not null,
 zones jsonb not null,
 analysis jsonb not null,
 created_at timestamptz not null default now(),
 primary key(signature,model_version)
);
alter table public.fertilizer_service_area_cache enable row level security;
revoke all on public.fertilizer_service_area_cache from public,anon,authenticated;
grant select on public.fertilizer_service_area_cache to authenticated;
create policy fertilizer_service_area_cache_read on public.fertilizer_service_area_cache
for select to authenticated using (
 (select auth.uid()) is not null and model_version='network-grid-v1' and
 signature=gis.fertilizer_service_signature(map_year,requested_farms)
);

create or replace function public.fertilizer_service_cached(map_year text,requested_farms text[] default null)
returns jsonb language sql stable security invoker set search_path='' as $function$
select jsonb_build_object('signature',c.signature,'zones',c.zones,'analysis',c.analysis||jsonb_build_object('cached',true))
from public.fertilizer_service_area_cache c
where c.signature=gis.fertilizer_service_signature(map_year,requested_farms)
 and c.map_year=map_year and c.model_version='network-grid-v1';
$function$;
revoke all on function public.fertilizer_service_cached(text,text[]) from public,anon;
grant execute on function public.fertilizer_service_cached(text,text[]) to authenticated;
