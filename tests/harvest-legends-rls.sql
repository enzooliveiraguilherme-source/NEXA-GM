-- Teste transacional: todos os registros de teste são desfeitos ao final.
begin;
select set_config('test.legend_owner',(select id::text from auth.users order by created_at limit 1),true);
select set_config('request.jwt.claim.sub',current_setting('test.legend_owner'),true);
set local role authenticated;
insert into public.harvest_user_legends(name,palette,breaks,colors)
values('__legend_rls_check__','harvest',array[120,130,140,160,180],array['#d73027','#fc8d59','#fee08b','#d9ef8b','#91cf60','#1a9850']);
do $$
declare affected integer;
begin
 if not exists(select 1 from public.harvest_user_legends where name='__legend_rls_check__') then raise exception 'Proprietário não recuperou sua legenda';end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 if exists(select 1 from public.harvest_user_legends where name='__legend_rls_check__') then raise exception 'Outra conta conseguiu ler a legenda';end if;
 update public.harvest_user_legends set name='__legend_rls_wrong__' where name='__legend_rls_check__';
 get diagnostics affected=row_count;
 if affected<>0 then raise exception 'Outra conta conseguiu alterar a legenda';end if;
 begin
  insert into public.harvest_user_legends(user_id,name,palette,breaks,colors)
  values(current_setting('test.legend_owner')::uuid,'__legend_rls_borrowed__','harvest',array[120,130,140,160,180],array['#d73027','#fc8d59','#fee08b','#d9ef8b','#91cf60','#1a9850']);
  raise exception 'Outra conta conseguiu salvar no proprietário';
 exception when insufficient_privilege then null;
 end;
end $$;
rollback;
