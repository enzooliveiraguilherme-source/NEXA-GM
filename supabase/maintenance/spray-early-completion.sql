-- A previsão é uma referência. Concluir não exige data prevista nem intervalo mínimo.
-- Mantém as validações de datas reais, sequência conhecida, área e acesso existentes.
alter table public.spray_applications drop constraint spray_applications_check1;
alter table public.spray_applications add constraint spray_applications_check1 check (
  planting_record_id is not null
  or coalesce(stage_id in ('pre','boro','desiccation'), false)
  or planned_date is not null
  or actual_date is not null
  or completed_without_date
);
