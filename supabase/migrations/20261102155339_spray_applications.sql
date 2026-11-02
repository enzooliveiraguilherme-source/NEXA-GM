create table public.spray_applications (
 id uuid primary key default gen_random_uuid(),
 fazenda text not null, campo text not null,
 ano text not null check (length(btrim(ano)) between 1 and 30),
 cultura text not null check (length(btrim(cultura)) between 1 and 80),
 planting_record_id uuid references public.operation_records(id),
 stage_id text check (stage_id in ('post1','post2','fung1','fung2','fung3','fung4')),
 application_name text not null check (length(btrim(application_name)) between 1 and 150),
 product text not null default '' check (length(product)<=150),
 dose numeric check (dose>=0 and dose<=1000000),
 dose_unit text not null default 'L/ha' check (length(btrim(dose_unit)) between 1 and 30),
 area numeric not null check (area>0 and area<=100000000),
 planned_date date, actual_date date,
 responsible text not null default '' check (length(responsible)<=150),
 notes text not null default '' check (length(notes)<=2000),
 deleted boolean not null default false,
 version integer not null default 1 check (version>0),
 updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id) on delete set null,
 foreign key (fazenda,campo) references public.farm_fields(farm_code,campo),
 check ((planting_record_id is null) = (stage_id is null)),
 check (planting_record_id is not null or planned_date is not null),
 unique (planting_record_id,stage_id)
);
create index spray_applications_scope_idx on public.spray_applications(fazenda,ano,cultura);
create index spray_applications_updated_by_idx on public.spray_applications(updated_by);
alter table public.spray_applications enable row level security;
revoke all on public.spray_applications from public,anon,authenticated;
grant select,insert,update on public.spray_applications to authenticated;
create policy spray_applications_read on public.spray_applications for select to authenticated
 using (public.can_access_farm(fazenda));
create policy spray_applications_insert on public.spray_applications for insert to authenticated
 with check ((select public.can_edit_operations()) and public.can_access_farm(fazenda));
create policy spray_applications_update on public.spray_applications for update to authenticated
 using ((select public.can_edit_operations()) and public.can_access_farm(fazenda))
 with check ((select public.can_edit_operations()) and public.can_access_farm(fazenda));

create function public.validate_spray_application()
returns trigger language plpgsql security invoker set search_path='' as $$
declare
 source public.operation_records%rowtype;
 schedule public.spray_schedules%rowtype;
 field_area numeric;
 canonical date;
begin
 if tg_op='UPDATE' and (new.id,new.fazenda,new.campo,new.ano,new.cultura,new.planting_record_id,new.stage_id)
  is distinct from (old.id,old.fazenda,old.campo,old.ano,old.cultura,old.planting_record_id,old.stage_id) then
  raise exception 'Para trocar o talhão ou a safra, crie outra aplicação.' using errcode='23514';
 end if;
 select (f.feature->'properties'->>'Area')::numeric into field_area from public.farm_fields f
  where f.farm_code=new.fazenda and f.campo=new.campo;
 if field_area is null or new.area>field_area then
  raise exception 'A área da aplicação não pode ultrapassar a área do talhão.' using errcode='23514';
 end if;
 if new.actual_date>(now() at time zone 'America/Sao_Paulo')::date then
  raise exception 'A data realizada não pode estar no futuro.' using errcode='23514';
 end if;
 if new.planting_record_id is not null then
  select * into source from public.operation_records r where r.id=new.planting_record_id for update;
  if source.id is null or source.operation_type<>'plantio' or source.data_plantio is null
   or source.area_realizada<=0 or source.status not in ('concluido','em_andamento')
   or (source.fazenda,source.campo,source.ano,source.cultura) is distinct from (new.fazenda,new.campo,new.ano,new.cultura) then
   raise exception 'O registro não corresponde a um plantio executado deste talhão, safra e cultura.' using errcode='23514';
  end if;
  if new.area>source.area_realizada then
   raise exception 'A área não pode ultrapassar a execução do plantio.' using errcode='23514';
  end if;
  select * into schedule from public.spray_schedules s where s.planting_record_id=source.id for update;
  canonical:=case new.stage_id when 'post1' then schedule.post1_date when 'post2' then schedule.post2_date
   when 'fung1' then schedule.fung1_date when 'fung2' then schedule.fung2_date when 'fung3' then schedule.fung3_date else schedule.fung4_date end;
  if not new.deleted and (new.actual_date is distinct from canonical or (new.stage_id='fung4' and not coalesce(schedule.fourth_enabled,false))) then
   if schedule.planting_record_id is null then
    insert into public.spray_schedules(planting_record_id,fourth_enabled,post1_date,post2_date,fung1_date,fung2_date,fung3_date,fung4_date)
    values(source.id,new.stage_id='fung4',case when new.stage_id='post1' then new.actual_date end,
     case when new.stage_id='post2' then new.actual_date end,case when new.stage_id='fung1' then new.actual_date end,
     case when new.stage_id='fung2' then new.actual_date end,case when new.stage_id='fung3' then new.actual_date end,
     case when new.stage_id='fung4' then new.actual_date end);
   else
    update public.spray_schedules set fourth_enabled=fourth_enabled or new.stage_id='fung4',
     post1_date=case when new.stage_id='post1' then new.actual_date else post1_date end,
     post2_date=case when new.stage_id='post2' then new.actual_date else post2_date end,
     fung1_date=case when new.stage_id='fung1' then new.actual_date else fung1_date end,
     fung2_date=case when new.stage_id='fung2' then new.actual_date else fung2_date end,
     fung3_date=case when new.stage_id='fung3' then new.actual_date else fung3_date end,
     fung4_date=case when new.stage_id='fung4' then new.actual_date else fung4_date end
    where planting_record_id=source.id;
   end if;
  end if;
 end if;
 new.version:=case when tg_op='UPDATE' then old.version+1 else 1 end;
 new.updated_at:=clock_timestamp(); new.updated_by:=auth.uid();
 return new;
end;
$$;
create trigger spray_application_validate before insert or update on public.spray_applications
 for each row execute function public.validate_spray_application();
revoke execute on function public.validate_spray_application() from public,anon,authenticated;

create function public.save_spray_application(p_payload jsonb,p_expected_version integer default null,p_schedule_version integer default null)
returns public.spray_applications language plpgsql security invoker set search_path='' as $$
declare
 incoming public.spray_applications;
 saved public.spray_applications;
 source_version integer;
begin
 incoming:=jsonb_populate_record(null::public.spray_applications,p_payload);
 if not coalesce(public.can_edit_operations(),false) or not coalesce(public.can_access_farm(incoming.fazenda),false) then
  raise exception 'Seu perfil não permite alterar esta aplicação.' using errcode='42501';
 end if;
 if incoming.planting_record_id is not null then
  -- Same lock order as the validation trigger; serializes distinct stages of the same planting.
  perform 1 from public.operation_records where id=incoming.planting_record_id for update;
  select version into source_version from public.spray_schedules where planting_record_id=incoming.planting_record_id for update;
  if source_version is distinct from p_schedule_version then
   raise exception 'O cronograma mudou. Recarregue os dados.' using errcode='40001';
  end if;
 end if;
 if incoming.id is null then
  if p_expected_version is not null then raise exception 'Versão inválida.' using errcode='40001'; end if;
  insert into public.spray_applications(fazenda,campo,ano,cultura,planting_record_id,stage_id,application_name,
   product,dose,dose_unit,area,planned_date,actual_date,responsible,notes,deleted)
  values(incoming.fazenda,incoming.campo,incoming.ano,incoming.cultura,incoming.planting_record_id,incoming.stage_id,
   incoming.application_name,coalesce(incoming.product,''),incoming.dose,coalesce(incoming.dose_unit,'L/ha'),incoming.area,
   incoming.planned_date,incoming.actual_date,coalesce(incoming.responsible,''),coalesce(incoming.notes,''),coalesce(incoming.deleted,false)) returning * into saved;
 else
  update public.spray_applications set fazenda=incoming.fazenda,campo=incoming.campo,ano=incoming.ano,cultura=incoming.cultura,
   planting_record_id=incoming.planting_record_id,stage_id=incoming.stage_id,application_name=incoming.application_name,
   product=coalesce(incoming.product,''),dose=incoming.dose,dose_unit=coalesce(incoming.dose_unit,'L/ha'),area=incoming.area,
   planned_date=incoming.planned_date,actual_date=incoming.actual_date,responsible=coalesce(incoming.responsible,''),
   notes=coalesce(incoming.notes,''),deleted=coalesce(incoming.deleted,false)
  where id=incoming.id and version=p_expected_version returning * into saved;
  if saved.id is null then raise exception 'O registro mudou ou o acesso foi alterado. Recarregue os dados.' using errcode='40001'; end if;
 end if;
 return saved;
end;
$$;
revoke execute on function public.save_spray_application(jsonb,integer,integer) from public,anon;
grant execute on function public.save_spray_application(jsonb,integer,integer) to authenticated;
comment on table public.spray_applications is 'Controle operacional: exclusão reversível, metadados das etapas do plantio e aplicações adicionais. Realizações vinculadas mantêm spray_schedules como fonte canônica.';
