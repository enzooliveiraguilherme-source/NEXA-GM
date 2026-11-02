-- Cronograma por registro de execução de plantio. Não altera operações existentes.
create table public.spray_schedules (
  planting_record_id uuid primary key references public.operation_records(id),
  fourth_enabled boolean not null default false,
  post1_date date,
  post2_date date,
  fung1_date date,
  fung2_date date,
  fung3_date date,
  fung4_date date,
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  check (fourth_enabled or fung4_date is null)
);
create index spray_schedules_updated_by_idx on public.spray_schedules(updated_by);
alter table public.spray_schedules enable row level security;
revoke all on public.spray_schedules from public, anon, authenticated;
grant select, insert, update on public.spray_schedules to authenticated;

create policy spray_read on public.spray_schedules for select to authenticated
using (exists (select 1 from public.operation_records r where r.id = planting_record_id
  and r.operation_type = 'plantio' and public.can_access_farm(r.fazenda)));
create policy spray_insert on public.spray_schedules for insert to authenticated
with check ((select public.can_edit_operations()) and exists (
  select 1 from public.operation_records r where r.id = planting_record_id
  and r.operation_type = 'plantio' and public.can_access_farm(r.fazenda)));
create policy spray_update on public.spray_schedules for update to authenticated
using ((select public.can_edit_operations()) and exists (
  select 1 from public.operation_records r where r.id = planting_record_id
  and r.operation_type = 'plantio' and public.can_access_farm(r.fazenda)))
with check ((select public.can_edit_operations()) and exists (
  select 1 from public.operation_records r where r.id = planting_record_id
  and r.operation_type = 'plantio' and public.can_access_farm(r.fazenda)));

create function public.validate_spray_schedule()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  planting_date date;
  previous_date date;
  actual_date date;
  missing_previous boolean := false;
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
    if actual_date is null then missing_previous := true;
    else
      if missing_previous then
        raise exception 'Registre primeiro a data realizada da aplicação anterior.' using errcode = '23514';
      end if;
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
$$;
create trigger spray_schedule_validate before insert or update on public.spray_schedules
  for each row execute function public.validate_spray_schedule();
revoke execute on function public.validate_spray_schedule() from public, anon, authenticated;
comment on table public.spray_schedules is 'Datas efetivamente realizadas de pulverização; previsões são derivadas do plantio e das aplicações anteriores.';
