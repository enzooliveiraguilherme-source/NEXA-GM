-- A single transaction validates final dates before persisting any application metadata.
create function public.save_spray_application_batch(p_records jsonb)
returns setof public.spray_applications language plpgsql security invoker set search_path='' as $$
declare
 source_id uuid;
 source public.operation_records%rowtype;
 current_schedule public.spray_schedules%rowtype;
 next_schedule public.spray_schedules%rowtype;
 entry jsonb;
 row_payload jsonb;
 expected integer;
 actual date;
 stage text;
 current_version integer;
 count_rows integer;
begin
 if not coalesce(public.can_edit_operations(),false) then raise exception 'Seu perfil não permite gravar aplicações.' using errcode='42501'; end if;
 if jsonb_typeof(p_records)<>'array' or p_records is null then raise exception 'Informe um lote válido.' using errcode='23514'; end if;
 count_rows:=jsonb_array_length(p_records);
 if count_rows<1 or count_rows>1000 then raise exception 'O lote deve conter entre 1 e 1000 aplicações.' using errcode='23514'; end if;
 if exists(select 1 from jsonb_array_elements(p_records) x group by case
  when nullif(x->'payload'->>'planting_record_id','') is not null then (x->'payload'->>'planting_record_id')||':'||(x->'payload'->>'stage_id')
  else x->'payload'->>'id' end having count(*)>1) then
  raise exception 'A mesma aplicação aparece mais de uma vez no lote.' using errcode='23514';
 end if;
 for source_id in select distinct (x->'payload'->>'planting_record_id')::uuid from jsonb_array_elements(p_records) x
  where nullif(x->'payload'->>'planting_record_id','') is not null order by 1
 loop
  select * into source from public.operation_records r where r.id=source_id for update;
  if source.id is null or not coalesce(public.can_access_farm(source.fazenda),false) then
   raise exception 'Sem acesso ao plantio deste lote.' using errcode='42501';
  end if;
  select * into current_schedule from public.spray_schedules where planting_record_id=source_id for update;
  next_schedule:=current_schedule;
  next_schedule.planting_record_id:=source_id;
  next_schedule.fourth_enabled:=coalesce(current_schedule.fourth_enabled,false);
  for entry in select x from jsonb_array_elements(p_records) x where x->'payload'->>'planting_record_id'=source_id::text
  loop
   expected:=(entry->>'schedule_version')::integer;
   if current_schedule.version is distinct from expected then raise exception 'O cronograma mudou. Recarregue os dados.' using errcode='40001'; end if;
   row_payload:=entry->'payload';
   if not coalesce((row_payload->>'deleted')::boolean,false) then
    actual:=(row_payload->>'actual_date')::date;stage:=row_payload->>'stage_id';
    case stage
     when 'post1' then next_schedule.post1_date:=actual;
     when 'post2' then next_schedule.post2_date:=actual;
     when 'fung1' then next_schedule.fung1_date:=actual;
     when 'fung2' then next_schedule.fung2_date:=actual;
     when 'fung3' then next_schedule.fung3_date:=actual;
     when 'fung4' then next_schedule.fung4_date:=actual;next_schedule.fourth_enabled:=true;
     else raise exception 'Etapa inválida no lote.' using errcode='23514';
    end case;
   end if;
  end loop;
  if current_schedule.planting_record_id is null then
   if next_schedule.fourth_enabled or coalesce(next_schedule.post1_date,next_schedule.post2_date,next_schedule.fung1_date,next_schedule.fung2_date,next_schedule.fung3_date,next_schedule.fung4_date) is not null then
    insert into public.spray_schedules(planting_record_id,fourth_enabled,post1_date,post2_date,fung1_date,fung2_date,fung3_date,fung4_date)
     values(source_id,next_schedule.fourth_enabled,next_schedule.post1_date,next_schedule.post2_date,next_schedule.fung1_date,next_schedule.fung2_date,next_schedule.fung3_date,next_schedule.fung4_date);
   end if;
  elsif (current_schedule.fourth_enabled,current_schedule.post1_date,current_schedule.post2_date,current_schedule.fung1_date,current_schedule.fung2_date,current_schedule.fung3_date,current_schedule.fung4_date)
   is distinct from (next_schedule.fourth_enabled,next_schedule.post1_date,next_schedule.post2_date,next_schedule.fung1_date,next_schedule.fung2_date,next_schedule.fung3_date,next_schedule.fung4_date) then
   update public.spray_schedules set fourth_enabled=next_schedule.fourth_enabled,post1_date=next_schedule.post1_date,post2_date=next_schedule.post2_date,
    fung1_date=next_schedule.fung1_date,fung2_date=next_schedule.fung2_date,fung3_date=next_schedule.fung3_date,fung4_date=next_schedule.fung4_date where planting_record_id=source_id;
  end if;
 end loop;
 for entry in select x from jsonb_array_elements(p_records) with ordinality q(x,n)
  order by coalesce(x->'payload'->>'planting_record_id',''),coalesce(x->'payload'->>'id',''),n
 loop
  row_payload:=entry->'payload';current_version:=null;
  if nullif(row_payload->>'planting_record_id','') is not null then
   select version into current_version from public.spray_schedules where planting_record_id=(row_payload->>'planting_record_id')::uuid;
  end if;
  return next public.save_spray_application(row_payload,(entry->>'expected_version')::integer,current_version);
 end loop;
end;
$$;
revoke execute on function public.save_spray_application_batch(jsonb) from public,anon;
grant execute on function public.save_spray_application_batch(jsonb) to authenticated;
