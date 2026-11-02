-- Only the server-side integration can read or replace this shared connection.
-- Passwords and external agricultural data are never retained.
grant usage on schema private to service_role;

create or replace function private.savecloud_connection_read()
returns text language plpgsql security definer set search_path = '' as $$
begin
    if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
        raise exception 'Connection access denied' using errcode = '42501';
    end if;
    return (select decrypted_secret from vault.decrypted_secrets where name = 'nexa_savecloud_connection');
end;
$$;

create or replace function private.savecloud_connection_write(p_token text)
returns void language plpgsql security definer set search_path = '' as $$
declare secret_id uuid;
begin
    if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
        raise exception 'Connection access denied' using errcode = '42501';
    end if;
    if p_token is null or p_token !~ '^[a-fA-F0-9]{40}$' then
        raise exception 'Invalid connection' using errcode = '22023';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('nexa_savecloud_connection', 0));
    select id into secret_id from vault.secrets where name = 'nexa_savecloud_connection';
    if secret_id is null then
        perform vault.create_secret(p_token, 'nexa_savecloud_connection', 'SaveCloud integration token; server only');
    else
        perform vault.update_secret(secret_id, p_token);
    end if;
end;
$$;

revoke all on function private.savecloud_connection_read() from public, anon, authenticated;
revoke all on function private.savecloud_connection_write(text) from public, anon, authenticated;
grant execute on function private.savecloud_connection_read() to service_role;
grant execute on function private.savecloud_connection_write(text) to service_role;

-- API entrypoints are invoker functions; privileged work stays in the private schema.
create or replace function public.savecloud_connection_read()
returns text language sql security invoker set search_path = ''
as $$ select private.savecloud_connection_read(); $$;
create or replace function public.savecloud_connection_write(p_token text)
returns void language sql security invoker set search_path = ''
as $$ select private.savecloud_connection_write(p_token); $$;
revoke all on function public.savecloud_connection_read() from public, anon, authenticated;
revoke all on function public.savecloud_connection_write(text) from public, anon, authenticated;
grant execute on function public.savecloud_connection_read() to service_role;
grant execute on function public.savecloud_connection_write(text) to service_role;
