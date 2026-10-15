-- Recoverable catalogue exclusion; execution records remain unchanged.
alter table public.seed_variety_cycles add column archived boolean not null default false;
comment on column public.seed_variety_cycles.archived is
  'Excluded from active catalogue and forecasts; administrators can restore it. Planting records are preserved.';
