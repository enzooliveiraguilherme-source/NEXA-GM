-- Retire the external integration, without affecting other operations.
drop function if exists public.savecloud_connection_read();
drop function if exists public.savecloud_connection_write(text);
drop function if exists private.savecloud_connection_read();
drop function if exists private.savecloud_connection_write(text);
delete from vault.secrets where name='nexa_savecloud_connection';
