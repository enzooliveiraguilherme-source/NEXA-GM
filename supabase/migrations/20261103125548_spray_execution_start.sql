-- A start date represents work still in progress until actual_date is recorded.
-- Existing dates and confirmed completions remain untouched.
alter table public.spray_applications add column started_date date;
alter table public.spray_applications add constraint spray_application_start_order
 check (started_date is null or actual_date is null or actual_date >= started_date);
comment on column public.spray_applications.started_date is
 'Início real da execução. Sem actual_date, aplicação em andamento; não recalcula as próximas etapas.';

create or replace function public.validate_spray_application_start()
returns trigger language plpgsql security invoker set search_path='' as $$
declare planting_date date;
begin
 if new.started_date is not null then
  if new.started_date > (now() at time zone 'America/Sao_Paulo')::date then
   raise exception 'O início da execução não pode estar no futuro.' using errcode='23514';
  end if;
  if new.planting_record_id is not null then
   select data_plantio into planting_date from public.operation_records where id=new.planting_record_id;
   if new.started_date < planting_date then
    raise exception 'O início da execução não pode ser anterior ao plantio.' using errcode='23514';
   end if;
  end if;
 end if;
 return new;
end;
$$;
revoke execute on function public.validate_spray_application_start() from public,anon;
grant execute on function public.validate_spray_application_start() to authenticated;
create trigger spray_application_start_validation before insert or update on public.spray_applications
 for each row execute function public.validate_spray_application_start();

CREATE OR REPLACE FUNCTION public.save_spray_application(p_payload jsonb, p_expected_version integer DEFAULT NULL::integer, p_schedule_version integer DEFAULT NULL::integer)
 RETURNS spray_applications
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
   product,dose,dose_unit,area,planned_date,actual_date,responsible,notes,deleted,completed_without_date,started_date)
  values(incoming.fazenda,incoming.campo,incoming.ano,incoming.cultura,incoming.planting_record_id,incoming.stage_id,
   incoming.application_name,coalesce(incoming.product,''),incoming.dose,coalesce(incoming.dose_unit,'L/ha'),incoming.area,
   incoming.planned_date,incoming.actual_date,coalesce(incoming.responsible,''),coalesce(incoming.notes,''),coalesce(incoming.deleted,false),incoming.actual_date is null and coalesce(incoming.completed_without_date,false),incoming.started_date) returning * into saved;
 else
  update public.spray_applications set fazenda=incoming.fazenda,campo=incoming.campo,ano=incoming.ano,cultura=incoming.cultura,
   planting_record_id=incoming.planting_record_id,stage_id=incoming.stage_id,application_name=incoming.application_name,
   product=coalesce(incoming.product,''),dose=incoming.dose,dose_unit=coalesce(incoming.dose_unit,'L/ha'),area=incoming.area,
   planned_date=incoming.planned_date,actual_date=incoming.actual_date,responsible=coalesce(incoming.responsible,''),
   notes=coalesce(incoming.notes,''),deleted=coalesce(incoming.deleted,false),
   started_date=case when p_payload ? 'started_date' then incoming.started_date else started_date end,
   completed_without_date=case when incoming.actual_date is not null then false else coalesce(incoming.completed_without_date,completed_without_date) end
  where id=incoming.id and version=p_expected_version returning * into saved;
  if saved.id is null then raise exception 'O registro mudou ou o acesso foi alterado. Recarregue os dados.' using errcode='40001'; end if;
 end if;
 return saved;
end;
$function$
;
revoke execute on function public.save_spray_application(jsonb,integer,integer) from public,anon;
grant execute on function public.save_spray_application(jsonb,integer,integer) to authenticated;

