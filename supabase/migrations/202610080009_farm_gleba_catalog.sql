alter table public.farms add column gleba text;
update public.farms f set gleba = groups.gleba
from (select farm_code, min(nullif(btrim(feature->'properties'->>'Gleba'),'')) gleba
      from public.farm_fields group by farm_code
      having count(distinct nullif(btrim(feature->'properties'->>'Gleba'),'')) = 1) groups
where f.code = groups.farm_code;
create function public.list_accessible_farms_by_gleba()
returns table(code text, name text, gleba text)
language sql stable security invoker set search_path = '' as $$
select f.code, f.name, f.gleba from public.farms f
where public.can_access_farm(f.code) order by f.gleba nulls last, f.name, f.code;
$$;
revoke all on function public.list_accessible_farms_by_gleba() from public, anon;
grant execute on function public.list_accessible_farms_by_gleba() to authenticated;
