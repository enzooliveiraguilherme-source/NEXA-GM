-- Isolated acceptance test for completed_without_date support.
-- The DDL below mirrors tmp/spray-import-20261102/completed-without-date.sql;
-- all schema changes, identities and rows are reverted by the final ROLLBACK.
begin;
set local statement_timeout='25s';
set local lock_timeout='3s';

alter table public.spray_applications add column if not exists completed_without_date boolean not null default false;
alter table public.spray_applications drop constraint if exists spray_applications_completion_check;
alter table public.spray_applications add constraint spray_applications_completion_check
 check (not completed_without_date or actual_date is null);
comment on column public.spray_applications.completed_without_date is
 'Aplicação confirmada na origem sem data de realização. Não deve gerar uma data real fictícia.';

CREATE OR REPLACE FUNCTION public.save_spray_application(p_payload jsonb, p_expected_version integer DEFAULT NULL::integer, p_schedule_version integer DEFAULT NULL::integer)
 RETURNS public.spray_applications
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare incoming public.spray_applications; saved public.spray_applications; source_version integer;
begin
 incoming:=jsonb_populate_record(null::public.spray_applications,p_payload);
 if not coalesce(public.can_edit_operations(),false) or not coalesce(public.can_access_farm(incoming.fazenda),false) then
  raise exception 'Seu perfil não permite alterar esta aplicação.' using errcode='42501';
 end if;
 if incoming.planting_record_id is not null then
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
$function$;
revoke execute on function public.save_spray_application(jsonb,integer,integer) from public,anon;
grant execute on function public.save_spray_application(jsonb,integer,integer) to authenticated;

-- Match the temporary importer rule: gaps are allowed, but known dates remain ordered,
-- on/after planting, and no later than today.
CREATE OR REPLACE FUNCTION public.validate_spray_schedule()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $function$
declare planting_date date; previous_date date; actual_date date;
begin
 if tg_op='UPDATE' and new.planting_record_id<>old.planting_record_id then
  raise exception 'Não é permitido transferir o cronograma para outro plantio.' using errcode='23514'; end if;
 select r.data_plantio into planting_date from public.operation_records r where r.id=new.planting_record_id
  and r.operation_type='plantio' and r.status in ('concluido','em_andamento') and r.area_realizada>0;
 if planting_date is null then raise exception 'Registre primeiro a execução e a data do plantio.' using errcode='23514'; end if;
 previous_date:=planting_date;
 foreach actual_date in array array[new.post1_date,new.post2_date,new.fung1_date,new.fung2_date,new.fung3_date,new.fung4_date]
 loop
  if actual_date is not null then
   if actual_date<previous_date or actual_date>(now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'A data realizada deve respeitar a sequência do plantio e não pode estar no futuro.' using errcode='23514';
   end if;
   previous_date:=actual_date;
  end if;
 end loop;
 new.version:=case when tg_op='UPDATE' then old.version+1 else 1 end;
 new.updated_at:=clock_timestamp(); new.updated_by:=auth.uid();
 return new;
end;
$function$;
revoke execute on function public.validate_spray_schedule() from public,anon,authenticated;

create temporary table spray_completion_users(kind text primary key,id uuid not null) on commit drop;
insert into spray_completion_users values ('editor',gen_random_uuid()),('viewer',gen_random_uuid());
grant select on spray_completion_users to authenticated;
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select id,'authenticated','authenticated','spray-completion-'||kind||'@example.invalid','TEST_ONLY_SYNTHETIC_HASH',now(),
 '{"provider":"email","providers":["email"]}'::jsonb,jsonb_build_object('full_name','Spray completion test '||kind),now(),now()
from spray_completion_users;
update public.profiles p set role=case u.kind when 'editor' then 'projetista'::public.user_role else 'visualizador'::public.user_role end,
 all_farms=false from spray_completion_users u where p.id=u.id;
insert into public.user_farm_access(user_id,farm_code) select id,'FE' from spray_completion_users;
insert into public.farm_fields(farm_code,campo,feature) values
 ('FE','SPRAY-COMPLETION-TEST',jsonb_build_object('type','Feature','geometry',null,'properties',
  jsonb_build_object('Fazenda','FE','Campo','SPRAY-COMPLETION-TEST','Area',100)));
create temporary table spray_completion_plant(id uuid primary key) on commit drop;
insert into spray_completion_plant values(gen_random_uuid());
grant select on spray_completion_plant to authenticated;
insert into public.operation_records(id,operation_type,fazenda,campo,ano,cultura,produto,status,
 area_total,area_realizada,percentual_realizado,variedade_semente,data_plantio)
select id,'plantio','FE','SPRAY-COMPLETION-TEST','SPRAY_CMP','Milho','Plantio','concluido',
 40,40,100,'Semente importada',(now() at time zone 'America/Sao_Paulo')::date-30 from spray_completion_plant;

select set_config('request.jwt.claim.sub',(select id::text from spray_completion_users where kind='editor'),true);
set local role authenticated;
do $$
declare today date := (now() at time zone 'America/Sao_Paulo')::date;
        single_row public.spray_applications; batch_row public.spray_applications;
        post1_row public.spray_applications; post2_row public.spray_applications; fung1_row public.spray_applications;
        payload jsonb; rows_saved integer; denied boolean; affected integer; pid uuid; schedule_version integer;
begin
 -- Single RPC persists completed-without-date with both dates empty.
 single_row:=public.save_spray_application(jsonb_build_object('fazenda','FE','campo','SPRAY-COMPLETION-TEST',
  'ano','SPRAY_COMPLETION_TEST','cultura','Milho','stage_id','pre','application_name','OK sem data',
  'product','Produto origem','dose',2,'area',20,'completed_without_date',true),null,null);
 if not single_row.completed_without_date or single_row.actual_date is not null or single_row.planned_date is not null
    or single_row.version<>1 then raise exception 'Single não persistiu OK sem data'; end if;

 -- Historical first post may be confirmed without a date while later known stages keep their order.
 select id into pid from spray_completion_plant;
 payload:=jsonb_build_array(
  jsonb_build_object('payload',jsonb_build_object('fazenda','FE','campo','SPRAY-COMPLETION-TEST',
   'ano','SPRAY_CMP','cultura','Milho','planting_record_id',pid,'stage_id','post1',
   'application_name','Pós 1 sem data','area',20,'completed_without_date',true),
   'expected_version',null,'schedule_version',null),
  jsonb_build_object('payload',jsonb_build_object('fazenda','FE','campo','SPRAY-COMPLETION-TEST',
   'ano','SPRAY_CMP','cultura','Milho','planting_record_id',pid,'stage_id','post2',
   'application_name','Pós 2 importada','area',20,'actual_date',today-8),
   'expected_version',null,'schedule_version',null),
  jsonb_build_object('payload',jsonb_build_object('fazenda','FE','campo','SPRAY-COMPLETION-TEST',
   'ano','SPRAY_CMP','cultura','Milho','planting_record_id',pid,'stage_id','fung1',
   'application_name','Fungicida 1 importado','area',20,'actual_date',today-4),
   'expected_version',null,'schedule_version',null));
 select count(*) into rows_saved from public.save_spray_application_batch(payload);
 select * into post1_row from public.spray_applications where planting_record_id=pid and stage_id='post1';
 select * into post2_row from public.spray_applications where planting_record_id=pid and stage_id='post2';
 select * into fung1_row from public.spray_applications where planting_record_id=pid and stage_id='fung1';
 select version into schedule_version from public.spray_schedules where planting_record_id=pid;
 if rows_saved<>3 or not post1_row.completed_without_date or post1_row.actual_date is not null
    or (select post1_date from public.spray_schedules where planting_record_id=pid) is not null
    or post2_row.actual_date<>today-8 or fung1_row.actual_date<>today-4
    or (select post2_date from public.spray_schedules where planting_record_id=pid)<>today-8
    or (select fung1_date from public.spray_schedules where planting_record_id=pid)<>today-4 then
  raise exception 'Gapped historical batch did not persist dates/flag as expected'; end if;
 denied:=false;
 begin update public.spray_schedules set fung1_date=today-9 where planting_record_id=pid;
 exception when check_violation then denied:=true; end;
 if not denied then raise exception 'Accepted known dates out of chronological order across gap'; end if;
 denied:=false;
 begin update public.spray_schedules set fung1_date=today+1 where planting_record_id=pid;
 exception when check_violation then denied:=true; end;
 if not denied then raise exception 'Accepted future date after an unknown historical stage'; end if;
 if (select version from public.spray_schedules where planting_record_id=pid)<>schedule_version then
  raise exception 'Invalid chronology/future update changed schedule version'; end if;

 -- Batch insert carries the same semantics for independent stages.
 payload:=jsonb_build_object('fazenda','FE','campo','SPRAY-COMPLETION-TEST','ano','SPRAY_COMPLETION_TEST',
  'cultura','Milho','stage_id','boro','application_name','Boro OK sem data','product','Boro teste',
  'dose',1.5,'area',18,'completed_without_date',true);
 select count(*) into rows_saved from public.save_spray_application_batch(jsonb_build_array(
  jsonb_build_object('payload',payload,'expected_version',null,'schedule_version',null)));
 select * into batch_row from public.spray_applications where stage_id='boro' and campo='SPRAY-COMPLETION-TEST';
 if rows_saved<>1 or not batch_row.completed_without_date or batch_row.actual_date is not null or batch_row.version<>1 then
  raise exception 'Batch não persistiu OK sem data'; end if;

 -- Old client payload omitting the flag must preserve its stored value on metadata edits.
 payload:=(to_jsonb(single_row)-'completed_without_date')||jsonb_build_object('product','Produto editado');
 single_row:=public.save_spray_application(payload,single_row.version,null);
 if not single_row.completed_without_date or single_row.product<>'Produto editado' or single_row.version<>2 then
  raise exception 'Payload legado limpou a flag ou não incrementou versão'; end if;

 -- Explicit false reopens the row; a concrete actual date always clears the flag.
 single_row:=public.save_spray_application(to_jsonb(single_row)||jsonb_build_object('completed_without_date',false),single_row.version,null);
 if single_row.completed_without_date or single_row.actual_date is not null or single_row.version<>3 then
  raise exception 'completed_without_date=false não reabriu registro'; end if;
 single_row:=public.save_spray_application(to_jsonb(single_row)||jsonb_build_object('completed_without_date',true),single_row.version,null);
 single_row:=public.save_spray_application(to_jsonb(single_row)||jsonb_build_object('actual_date',today-1,
  'completed_without_date',true),single_row.version,null);
 if single_row.completed_without_date or single_row.actual_date<>today-1 or single_row.version<>5 then
  raise exception 'Data concreta não limpou completed_without_date'; end if;

 -- Database CHECK rejects both directions of the invalid combination.
 denied:=false;
 begin
  insert into public.spray_applications(fazenda,campo,ano,cultura,stage_id,application_name,area,actual_date,completed_without_date)
  values('FE','SPRAY-COMPLETION-TEST','SPRAY_COMPLETION_TEST','Milho','desiccation','Flag e data',10,today-1,true);
 exception when check_violation then denied:=true; end;
 if not denied then raise exception 'CHECK aceitou completed_without_date=true com actual_date'; end if;
 denied:=false;
 begin update public.spray_applications set completed_without_date=true where id=single_row.id;
 exception when check_violation then denied:=true; end;
 if not denied or (select completed_without_date from public.spray_applications where id=single_row.id)
    or (select version from public.spray_applications where id=single_row.id)<>single_row.version then
  raise exception 'UPDATE inválido passou ou deixou versão/flag alterada'; end if;

 -- RLS remains farm-scoped and viewers cannot edit or advance the version.
 perform set_config('request.jwt.claim.sub',(select id::text from spray_completion_users where kind='viewer'),true);
 if not exists(select 1 from public.spray_applications where id=single_row.id)
    or exists(select 1 from public.spray_applications where fazenda='FE2') then
  raise exception 'RLS de leitura alterada'; end if;
 update public.spray_applications set notes='viewer denied' where id=single_row.id;
 get diagnostics affected=row_count;
 if affected<>0 or (select version from public.spray_applications where id=single_row.id)<>single_row.version then
  raise exception 'Viewer alterou registro ou versão'; end if;
 denied:=false;
 begin perform public.save_spray_application(to_jsonb(single_row),single_row.version,null);
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Viewer usou RPC de escrita'; end if;
end $$;
reset role;
rollback;
select 'Flag OK sem data, compatibilidade cliente antigo, atualização, CHECK, RLS e versões: OK; DDL e fixtures revertidos.' as validation;
