begin;
revoke all on function public.is_admin(),public.can_edit_operations(),public.handle_new_user(),public.rls_auto_enable() from public,anon,authenticated;
grant execute on function public.is_admin(),public.can_edit_operations() to authenticated;
-- Triggers continuam sendo executados pelo banco; não são APIs para o navegador.
notify pgrst,'reload schema';
commit;
