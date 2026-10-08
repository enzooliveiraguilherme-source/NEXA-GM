-- Aplicar após schema.sql e 202610060001_operations.sql; sem apagar dados existentes.
begin;
create table public.farms (
 code text primary key check(length(btrim(code)) between 1 and 100),
 name text not null check(length(btrim(name)) between 1 and 150)
);
insert into public.farms(code,name) values
 ('FE','Fazenda Esperança'),('FE2','Esperança 2'),('PA','Fazenda PA'),('RM','Fazenda RM'),
 ('SH','Fazenda SH'),('SM','Fazenda SM'),('SMA','Fazenda SMA'),('IPE','Fazenda IPE'),
 ('FBLA','Fazenda FBLA'),('FALG','Fazenda FALG'),('FSTV','Fazenda FSTV'),('FPAR','Fazenda FPAR'),
 ('FEAR','Fazenda FEAR'),('FPER','Fazenda FPER'),('FSAL','Fazenda FSAL'),('F3R','Fazenda F3R');
alter table public.profiles add column all_farms boolean not null default false;
alter table public.profiles add column requested_farm text references public.farms(code);
create table public.user_farm_access (
 user_id uuid not null references public.profiles(id) on delete cascade,
 farm_code text not null references public.farms(code),
 primary key(user_id,farm_code)
);
create table public.farm_fields (
 farm_code text not null references public.farms(code),
 campo text not null,
 feature jsonb not null check(jsonb_typeof(feature)='object' and feature->>'type'='Feature'),
 primary key(farm_code,campo),
 check(feature->'properties'->>'Fazenda'=farm_code and feature->'properties'->>'Campo'=campo)
);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join auth.users u on u.id=p.id
  where p.id=auth.uid() and p.role='admin' and u.email_confirmed_at is not null);
$$;
create function public.can_access_farm(code text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join auth.users u on u.id=p.id
  where p.id=auth.uid() and u.email_confirmed_at is not null
  and (p.role='admin' or p.all_farms or exists(select 1 from public.user_farm_access a where a.user_id=p.id and a.farm_code=code)));
$$;
create function public.can_access_farm_scope(code text)
returns boolean language sql stable security definer set search_path='' as $$
 select case when code='ALL' then exists(select 1 from public.profiles p join auth.users u on u.id=p.id
  where p.id=auth.uid() and u.email_confirmed_at is not null and (p.role='admin' or p.all_farms))
 else public.can_access_farm(code) end;
$$;
create or replace function public.can_edit_operations()
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join auth.users u on u.id=p.id
 where p.id=auth.uid() and p.role in('admin','projetista') and u.email_confirmed_at is not null);
$$;

alter table public.farms enable row level security;
alter table public.user_farm_access enable row level security;
alter table public.farm_fields enable row level security;
revoke all on public.farms,public.user_farm_access,public.farm_fields from public,anon,authenticated;
grant select on public.farms to anon,authenticated;
grant select,insert,update,delete on public.user_farm_access to authenticated;
grant select,insert,update on public.farm_fields to authenticated;
create policy farms_directory on public.farms for select to anon,authenticated using(true);
create policy own_farm_access on public.user_farm_access for select to authenticated using(user_id=auth.uid() or public.is_admin());
create policy admin_farm_access on public.user_farm_access for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy fields_read on public.farm_fields for select to authenticated using(public.can_access_farm(farm_code));
create policy fields_create on public.farm_fields for insert to authenticated with check(public.is_admin());
create policy fields_edit on public.farm_fields for update to authenticated using(public.is_admin()) with check(public.is_admin());
revoke all on public.profiles from anon;

create function public.list_accessible_farms()
returns table(code text,name text) language sql stable security invoker set search_path='' as $$
 select f.code,f.name from public.farms f where public.can_access_farm(f.code) order by f.name;
$$;
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id,full_name,requested_farm)
 values(new.id,left(coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'),''),new.email),100),
 (select code from public.farms where code=new.raw_user_meta_data->>'requested_farm'))
 on conflict(id) do nothing;
 -- Pedido de fazenda é uma solicitação; não cria permissão de acesso.
 return new;
end;
$$;

drop policy records_read on public.operation_records;
drop policy records_create on public.operation_records;
drop policy records_edit on public.operation_records;
create policy records_read on public.operation_records for select to authenticated using(public.can_access_farm(fazenda));
create policy records_create on public.operation_records for insert to authenticated with check(public.can_edit_operations() and public.can_access_farm(fazenda));
create policy records_edit on public.operation_records for update to authenticated using(public.can_edit_operations() and public.can_access_farm(fazenda)) with check(public.can_edit_operations() and public.can_access_farm(fazenda));
drop policy plans_read on public.operation_plans;
drop policy plans_create on public.operation_plans;
drop policy plans_edit on public.operation_plans;
create function public.plan_fields_accessible(fields jsonb,scope text)
returns boolean language sql stable security invoker set search_path='' as $$
 select public.valid_operation_fields(fields) and not exists(select 1 from jsonb_array_elements(fields) i
 where not public.can_access_farm(i->>'fazenda') or (scope<>'ALL' and i->>'fazenda'<>scope)
 or not exists(select 1 from public.farm_fields f where f.farm_code=i->>'fazenda' and f.campo=i->>'campo'));
$$;
create policy plans_read on public.operation_plans for select to authenticated using(public.can_access_farm_scope(fazenda_scope));
create policy plans_create on public.operation_plans for insert to authenticated with check(public.can_edit_operations() and public.can_access_farm_scope(fazenda_scope) and public.plan_fields_accessible(planned_fields,fazenda_scope));
create policy plans_edit on public.operation_plans for update to authenticated using(public.can_edit_operations() and public.can_access_farm_scope(fazenda_scope)) with check(public.can_edit_operations() and public.can_access_farm_scope(fazenda_scope) and public.plan_fields_accessible(planned_fields,fazenda_scope));
drop policy history_read on public.operation_history;
create policy history_read on public.operation_history for select to authenticated using(
 case when source_table='operation_records' then public.can_access_farm(current_data->>'fazenda')
 else public.can_access_farm_scope(current_data->>'fazenda_scope') end
);
alter table public.operation_records add constraint records_field_exists foreign key(fazenda,campo) references public.farm_fields(farm_code,campo) not valid;

-- A base de colheita existente pertence à Fazenda Esperança.
drop policy harvest_files_read on public.harvest_test_files;
drop policy harvest_datasets_read on public.harvest_test_datasets;
create policy harvest_files_read on public.harvest_test_files for select to authenticated using(public.can_access_farm('FE'));
create policy harvest_datasets_read on public.harvest_test_datasets for select to authenticated using(public.can_access_farm('FE'));

create function public.admin_list_access()
returns table(id uuid,email text,full_name text,role public.user_role,all_farms boolean,requested_farm text,email_confirmed boolean,farms text[])
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'Somente o administrador pode gerenciar os acessos.' using errcode='42501'; end if;
 return query select p.id,u.email::text,p.full_name,p.role,p.all_farms,p.requested_farm,u.email_confirmed_at is not null,
 coalesce((select array_agg(a.farm_code order by a.farm_code) from public.user_farm_access a where a.user_id=p.id),'{}'::text[])
 from public.profiles p join auth.users u on u.id=p.id order by p.full_name;
end;
$$;
create function public.admin_set_access(target uuid,new_role public.user_role,all_access boolean,farm_codes text[])
returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'Somente o administrador pode gerenciar os acessos.' using errcode='42501'; end if;
 if target=auth.uid() and new_role<>'admin' then raise exception 'Mantenha seu próprio perfil como administrador.'; end if;
 if farm_codes is null or all_access is null or new_role is null then raise exception 'Preencha as permissões.'; end if;
 if exists(select 1 from unnest(farm_codes) c where c is null or not exists(select 1 from public.farms f where f.code=c)) then raise exception 'Fazenda inválida.'; end if;
 update public.profiles set role=new_role,all_farms=all_access where id=target;
 if not found then raise exception 'Conta não encontrada.'; end if;
 delete from public.user_farm_access where user_id=target;
 insert into public.user_farm_access(user_id,farm_code) select target,c from (select distinct unnest(farm_codes) c) x;
end;
$$;

create function public.save_operation_batch(records jsonb)
returns setof public.operation_records language plpgsql security invoker set search_path='' as $$
declare item jsonb; input public.operation_records; saved public.operation_records;
begin
 if not public.can_edit_operations() then raise exception 'Seu perfil não permite editar.' using errcode='42501'; end if;
 if jsonb_typeof(records)<>'array' or jsonb_array_length(records) not between 1 and 500 then raise exception 'Seleção inválida.'; end if;
 for item in select value from jsonb_array_elements(records) loop
  input:=jsonb_populate_record(null::public.operation_records,item);
  if input.id is null then
   insert into public.operation_records(operation_type,fazenda,campo,gleba,ano,cultura,produto,status,area_total,area_realizada,percentual_realizado,taxa_aplicada,variedade_semente,data_plantio,tipo_progresso)
   values(input.operation_type,input.fazenda,input.campo,input.gleba,input.ano,input.cultura,input.produto,input.status,input.area_total,input.area_realizada,input.percentual_realizado,input.taxa_aplicada,input.variedade_semente,input.data_plantio,input.tipo_progresso)
   returning * into saved;
  else
   update public.operation_records set status=input.status,area_total=input.area_total,area_realizada=input.area_realizada,
    percentual_realizado=input.percentual_realizado,taxa_aplicada=input.taxa_aplicada,variedade_semente=input.variedade_semente,
    data_plantio=input.data_plantio,tipo_progresso=input.tipo_progresso
   where id=input.id and version=input.version and operation_type=input.operation_type and fazenda=input.fazenda and campo=input.campo
    and ano=input.ano and cultura=input.cultura and produto=input.produto returning * into saved;
   if not found then raise exception 'O registro mudou ou seu acesso foi alterado. Recarregue antes de salvar.' using errcode='40001'; end if;
  end if;
  return next saved;
 end loop;
end;
$$;
-- Permissões explícitas: helpers só consultam acesso; RPCs de administração checam o administrador.
revoke all on function public.can_access_farm(text),public.can_access_farm_scope(text),public.list_accessible_farms(),public.plan_fields_accessible(jsonb,text),public.admin_list_access(),public.admin_set_access(uuid,public.user_role,boolean,text[]),public.save_operation_batch(jsonb) from public,anon,authenticated;
grant execute on function public.can_access_farm(text),public.can_access_farm_scope(text),public.list_accessible_farms(),public.plan_fields_accessible(jsonb,text),public.admin_list_access(),public.admin_set_access(uuid,public.user_role,boolean,text[]),public.save_operation_batch(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
