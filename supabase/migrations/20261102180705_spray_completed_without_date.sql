-- Preserve historical completion when the source contains OK without a date.
alter table public.spray_applications add column completed_without_date boolean not null default false;
alter table public.spray_applications add constraint spray_applications_completion_check
 check (not completed_without_date or actual_date is null);
comment on column public.spray_applications.completed_without_date is
 'Aplicação confirmada na origem sem data de realização. Não deve gerar uma data real fictícia.';
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
   product,dose,dose_unit,area,planned_date,actual_date,responsible,notes,deleted,completed_without_date)
  values(incoming.fazenda,incoming.campo,incoming.ano,incoming.cultura,incoming.planting_record_id,incoming.stage_id,
   incoming.application_name,coalesce(incoming.product,''),incoming.dose,coalesce(incoming.dose_unit,'L/ha'),incoming.area,
   incoming.planned_date,incoming.actual_date,coalesce(incoming.responsible,''),coalesce(incoming.notes,''),coalesce(incoming.deleted,false),incoming.actual_date is null and coalesce(incoming.completed_without_date,false)) returning * into saved;
 else
  update public.spray_applications set fazenda=incoming.fazenda,campo=incoming.campo,ano=incoming.ano,cultura=incoming.cultura,
   planting_record_id=incoming.planting_record_id,stage_id=incoming.stage_id,application_name=incoming.application_name,
   product=coalesce(incoming.product,''),dose=incoming.dose,dose_unit=coalesce(incoming.dose_unit,'L/ha'),area=incoming.area,
   planned_date=incoming.planned_date,actual_date=incoming.actual_date,responsible=coalesce(incoming.responsible,''),
   notes=coalesce(incoming.notes,''),deleted=coalesce(incoming.deleted,false),
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

-- Historical applications may have earlier completed stages without recorded dates.
CREATE OR REPLACE FUNCTION public.validate_spray_schedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  planting_date date;
  previous_date date;
  actual_date date;
begin
  if tg_op = 'UPDATE' and new.planting_record_id <> old.planting_record_id then
    raise exception 'Não é permitido transferir o cronograma para outro plantio.' using errcode = '23514';
  end if;
  select r.data_plantio into planting_date from public.operation_records r
    where r.id = new.planting_record_id and r.operation_type = 'plantio'
    and r.status in ('concluido', 'em_andamento') and r.area_realizada > 0;
  if planting_date is null then
    raise exception 'Registre primeiro a execução e a data do plantio.' using errcode = '23514';
  end if;
  previous_date := planting_date;
  foreach actual_date in array array[new.post1_date,new.post2_date,new.fung1_date,new.fung2_date,new.fung3_date,new.fung4_date]
  loop
    if actual_date is not null then
      if actual_date < previous_date or actual_date > (now() at time zone 'America/Sao_Paulo')::date then
        raise exception 'A data realizada deve respeitar a sequência do plantio e não pode estar no futuro.' using errcode = '23514';
      end if;
      previous_date := actual_date;
    end if;
  end loop;
  new.version := case when tg_op = 'UPDATE' then old.version + 1 else 1 end;
  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end;
$function$
;
