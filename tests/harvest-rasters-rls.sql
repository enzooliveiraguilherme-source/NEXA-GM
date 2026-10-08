begin;
do $$
declare test_user uuid := gen_random_uuid();
begin
    insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (test_user, 'authenticated', 'authenticated', test_user::text || '@example.invalid', now(), '{}', '{"full_name":"Raster RLS test"}', now(), now());
    update public.profiles set role='visualizador', all_farms=false where id=test_user;
    insert into public.user_farm_access(user_id,farm_code) values(test_user,'FE2');
    perform set_config('request.jwt.claims', json_build_object('sub',test_user,'role','authenticated')::text, true);
end $$;
set local role authenticated;
do $$ begin
    if exists(select 1 from public.harvest_raster_files) then raise exception 'FE2 recebeu resoluções da FE'; end if;
end $$;
reset role;
insert into public.user_farm_access(user_id,farm_code) values(auth.uid(),'FE');
set local role authenticated;
do $$ begin
    if (select count(*) from public.harvest_raster_files where version_id=(select active_version from public.harvest_test_datasets where slug='fe-milho-2026')) <> 127 then
        raise exception 'FE não recebeu a base completa';
    end if;
end $$;
reset role;
rollback;
