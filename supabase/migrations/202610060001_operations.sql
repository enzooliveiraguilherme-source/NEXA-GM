-- Etapa 1: executar DEPOIS de supabase/schema.sql no SQL Editor do Supabase.
-- Esta migration não importa nem apaga dados do navegador.
begin;

create table public.operation_records (
    id uuid primary key default gen_random_uuid(),
    operation_type text not null check (operation_type in ('adubacao', 'plantio')),
    fazenda text not null check (length(trim(fazenda)) between 1 and 100),
    campo text not null check (length(trim(campo)) between 1 and 100),
    gleba text check (gleba is null or length(trim(gleba)) between 1 and 100),
    ano text not null check (length(trim(ano)) between 1 and 20),
    cultura text not null check (length(trim(cultura)) between 1 and 100),
    produto text not null check (length(trim(produto)) between 1 and 150),
    status text not null default 'nao_iniciado'
        check (status in ('nao_iniciado', 'em_andamento', 'concluido')),
    area_total numeric(14,4) not null check (area_total >= 0 and area_total <> 'NaN'::numeric),
    area_realizada numeric(14,4) not null default 0
        check (area_realizada >= 0 and area_realizada <= area_total),
    percentual_realizado numeric(6,2) not null default 0
        check (percentual_realizado between 0 and 100),
    taxa_aplicada numeric(14,4) check (taxa_aplicada > 0 and taxa_aplicada <> 'NaN'::numeric),
    variedade_semente text check (variedade_semente is null or length(trim(variedade_semente)) between 1 and 80),
    data_plantio date,
    tipo_progresso text not null default 'percentual' check (tipo_progresso in ('percentual', 'hectares')),
    created_by uuid references auth.users(id) on delete set null,
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version integer not null default 1 check (version > 0),
    constraint operation_context_unique unique (operation_type, fazenda, campo, ano, cultura, produto),
    constraint operation_not_started check (
        status <> 'nao_iniciado' or (area_realizada = 0 and percentual_realizado = 0)
    ),
    constraint operation_completed check (
        status <> 'concluido' or (area_realizada = area_total and percentual_realizado = 100)
    ),
    constraint application_completed_rate check (
        operation_type <> 'adubacao' or status <> 'concluido' or taxa_aplicada is not null
    ),
    constraint planting_required_details check (
        operation_type <> 'plantio' or status = 'nao_iniciado'
        or (variedade_semente is not null and data_plantio is not null)
    ),
    constraint operation_specific_details check (
        (operation_type = 'plantio' and produto = 'Plantio' and taxa_aplicada is null)
        or (operation_type = 'adubacao' and variedade_semente is null and data_plantio is null)
    )
);

-- Fazenda + Campo identificam o talhão existente no GeoJSON nesta primeira etapa.
-- O planejamento guarda referências explícitas aos dois, inclusive no filtro ALL.
create function public.valid_operation_fields(fields jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
    if fields is null or jsonb_typeof(fields) <> 'array' then return false; end if;
    return not exists (
        select 1 from jsonb_array_elements(fields) as items(item)
        where jsonb_typeof(item) is distinct from 'object'
            or jsonb_typeof(item -> 'fazenda') is distinct from 'string'
            or jsonb_typeof(item -> 'campo') is distinct from 'string'
            or length(trim(item ->> 'fazenda')) not between 1 and 100
            or length(trim(item ->> 'campo')) not between 1 and 100
    ) and (
        select count(*) = count(distinct (item ->> 'fazenda', item ->> 'campo'))
        from jsonb_array_elements(fields) as items(item)
    );
end;
$$;

create table public.operation_plans (
    id uuid primary key default gen_random_uuid(),
    operation_type text not null check (operation_type in ('adubacao', 'plantio')),
    fazenda_scope text not null default 'ALL' check (length(trim(fazenda_scope)) between 1 and 100),
    gleba_scope text not null default 'ALL' check (length(trim(gleba_scope)) between 1 and 100),
    ano text not null check (length(trim(ano)) between 1 and 20),
    cultura text not null check (length(trim(cultura)) between 1 and 100),
    produto text not null check (length(trim(produto)) between 1 and 150),
    planned_fields jsonb not null default '[]'::jsonb check (public.valid_operation_fields(planned_fields)),
    created_by uuid references auth.users(id) on delete set null,
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version integer not null default 1 check (version > 0),
    unique (operation_type, fazenda_scope, gleba_scope, ano, cultura, produto),
    check (operation_type <> 'plantio' or produto = 'Plantio')
);

-- Histórico gerado pelo banco; o navegador não fornece autor nem data de auditoria.
create table public.operation_history (
    id bigint generated always as identity primary key,
    source_table text not null check (source_table in ('operation_records', 'operation_plans')),
    record_id uuid not null,
    action text not null check (action in ('INSERT', 'UPDATE')),
    actor_id uuid references auth.users(id) on delete set null,
    actor_name text,
    changed_at timestamptz not null default now(),
    previous_data jsonb,
    current_data jsonb not null
);

create index operation_records_filters_idx
    on public.operation_records (operation_type, ano, cultura, produto, fazenda, gleba);
create index operation_history_record_idx
    on public.operation_history (source_table, record_id, id);

create function public.stamp_operation_change()
returns trigger language plpgsql set search_path = '' as $$
begin
    if TG_OP = 'INSERT' then
        new.created_by := auth.uid();
        new.created_at := now();
        new.version := 1;
    else
        if new.id is distinct from old.id then
            raise exception 'O identificador do registro não pode ser alterado.';
        end if;
        new.created_by := old.created_by;
        new.created_at := old.created_at;
        new.version := old.version + 1;
    end if;
    new.updated_by := auth.uid();
    new.updated_at := now();
    return new;
end;
$$;

create function public.audit_operation_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    insert into public.operation_history (
        source_table, record_id, action, actor_id, actor_name, previous_data, current_data
    ) values (
        TG_TABLE_NAME, new.id, TG_OP, auth.uid(),
        (select full_name from public.profiles where id = auth.uid()),
        case when TG_OP = 'UPDATE' then to_jsonb(old) else null end,
        to_jsonb(new)
    );
    return new;
end;
$$;

create trigger stamp_operation_record before insert or update on public.operation_records
    for each row execute function public.stamp_operation_change();
create trigger audit_operation_record after insert or update on public.operation_records
    for each row execute function public.audit_operation_change();
create trigger stamp_operation_plan before insert or update on public.operation_plans
    for each row execute function public.stamp_operation_change();
create trigger audit_operation_plan after insert or update on public.operation_plans
    for each row execute function public.audit_operation_change();

alter table public.operation_records enable row level security;
alter table public.operation_plans enable row level security;
alter table public.operation_history enable row level security;

-- Remove privilégios eventualmente concedidos pelos defaults do projeto.
revoke all on public.operation_records, public.operation_plans, public.operation_history from public, anon, authenticated;
revoke all on sequence public.operation_history_id_seq from public, anon, authenticated;
grant select, insert, update on public.operation_records, public.operation_plans to authenticated;
grant select on public.operation_history to authenticated;
revoke all on function public.valid_operation_fields(jsonb) from public, anon, authenticated;
grant execute on function public.valid_operation_fields(jsonb) to authenticated;
revoke all on function public.stamp_operation_change() from public, anon, authenticated;
revoke all on function public.audit_operation_change() from public, anon, authenticated;

create policy records_read on public.operation_records for select to authenticated using (true);
create policy records_create on public.operation_records for insert to authenticated
    with check (public.can_edit_operations());
create policy records_edit on public.operation_records for update to authenticated
    using (public.can_edit_operations()) with check (public.can_edit_operations());
create policy plans_read on public.operation_plans for select to authenticated using (true);
create policy plans_create on public.operation_plans for insert to authenticated
    with check (public.can_edit_operations());
create policy plans_edit on public.operation_plans for update to authenticated
    using (public.can_edit_operations()) with check (public.can_edit_operations());
create policy history_read on public.operation_history for select to authenticated using (true);

comment on table public.operation_records is 'Operações por tipo, fazenda, talhão, safra, cultura e produto.';
comment on table public.operation_plans is 'Planejamento por contexto e escopo dos filtros; lista vazia representa nenhum talhão planejado.';
comment on table public.operation_history is 'Auditoria automática e somente leitura para usuários do site.';
comment on column public.operation_records.taxa_aplicada is 'Taxa de adubação em toneladas por hectare (t/ha).';
comment on column public.operation_records.version is 'Usar junto ao id no filtro de atualização para detectar edição simultânea.';
commit;
