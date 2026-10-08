begin;
do $$
declare test_user uuid := gen_random_uuid();
begin
    insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values(test_user, 'authenticated', 'authenticated', test_user::text || '@example.invalid', now(), '{}', '{"full_name":"Gleba RLS test"}', now(), now());
    update public.profiles set role='visualizador', all_farms=false where id=test_user;
    insert into public.user_farm_access(user_id,farm_code) values(test_user,'FE2');
    perform set_config('request.jwt.claims', json_build_object('sub',test_user,'role','authenticated')::text, true);
end $$;
set local role authenticated;
do $$ begin
    if (select count(*) from public.list_accessible_farms_by_gleba()) <> 1 then raise exception 'Lista ampliou as permissões'; end if;
    if not exists(select 1 from public.list_accessible_farms_by_gleba() where code='FE2' and gleba='FE') then raise exception 'Gleba incorreta'; end if;
    if exists(select 1 from public.list_accessible_farms_by_gleba() where code='FE') then raise exception 'Agrupamento liberou outra fazenda'; end if;
end $$;
reset role;
rollback;
