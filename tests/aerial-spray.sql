-- Transactional regression test for public.aerial_spray_map. Final ROLLBACK leaves no rows.
begin;
insert into public.aerial_spray_features(farm_code,gleba,ano,cultura,ap,kind,feature) values
('FE','__TEST_AERIAL__','2098','TEST','__TEST_AERIAL__union','limite','{"type":"Feature","properties":{"AP":"__TEST_AERIAL__union"},"geometry":{"type":"Polygon","coordinates":[[[0,0],[0.01,0],[0.01,0.01],[0,0.01],[0,0]]]}}'),
('FE','__TEST_AERIAL__','2098','TEST','__TEST_AERIAL__union','cobertura','{"type":"Feature","properties":{"AP":"__TEST_AERIAL__union"},"geometry":{"type":"Polygon","coordinates":[[[0,0],[0.01,0],[0.01,0.01],[0,0.01],[0,0]]]}}'),
('FE','__TEST_AERIAL__','2098','TEST','__TEST_AERIAL__union','cobertura','{"type":"Feature","properties":{"AP":"__TEST_AERIAL__union"},"geometry":{"type":"Polygon","coordinates":[[[0,0],[0.01,0],[0.01,0.01],[0,0.01],[0,0]]]}}'),
('FE','__TEST_AERIAL__','2098','TEST','__TEST_AERIAL__union','cobertura','{"type":"Feature","properties":{"AP":"__TEST_AERIAL__union"},"geometry":{"type":"Polygon","coordinates":[[[0.005,0],[0.015,0],[0.015,0.01],[0.005,0.01],[0.005,0]]]}}'),
('FE','__TEST_AERIAL__','2098','TEST','__TEST_AERIAL__clip','limite','{"type":"Feature","properties":{"AP":"__TEST_AERIAL__clip"},"geometry":{"type":"Polygon","coordinates":[[[0.02,0],[0.03,0],[0.03,0.01],[0.02,0.01],[0.02,0]]]}}'),
('FE','__TEST_AERIAL__','2098','TEST','__TEST_AERIAL__clip','cobertura','{"type":"Feature","properties":{"AP":"__TEST_AERIAL__clip"},"geometry":{"type":"Polygon","coordinates":[[[0.015,0],[0.025,0],[0.025,0.01],[0.015,0.01],[0.015,0]]]}}'),
('FE','__TEST_AERIAL__','2098','TEST','__TEST_AERIAL__nolimit','cobertura','{"type":"Feature","properties":{"AP":"__TEST_AERIAL__nolimit"},"geometry":{"type":"Polygon","coordinates":[[[0.04,0],[0.05,0],[0.05,0.01],[0.04,0.01],[0.04,0]]]}}'),
('FE','__TEST_AERIAL__','2098','TEST','__TEST_AERIAL__flags','limite','{"type":"Feature","properties":{"AP":"__TEST_AERIAL__flags"},"geometry":{"type":"Polygon","coordinates":[[[0.06,0],[0.07,0],[0.07,0.01],[0.06,0.01],[0.06,0]]]}}'),
('FE','__TEST_AERIAL__','2098','TEST','__TEST_AERIAL__flags','circuito','{"type":"Feature","properties":{"AP":"__TEST_AERIAL__flags","APLICANDO":"0"},"geometry":{"type":"LineString","coordinates":[[0.061,0.001],[0.062,0.002]]}}'),
('FE','__TEST_AERIAL__','2098','TEST','__TEST_AERIAL__flags','circuito','{"type":"Feature","properties":{"AP":"__TEST_AERIAL__flags","APLICANDO":"1"},"geometry":{"type":"LineString","coordinates":[[0.063,0.001],[0.064,0.002]]}}'),
('FE','__TEST_AERIAL__','2098','TEST','__TEST_AERIAL__ap_a','limite','{"type":"Feature","properties":{"AP":"__TEST_AERIAL__ap_a"},"geometry":{"type":"Polygon","coordinates":[[[0.10,0],[0.11,0],[0.11,0.01],[0.10,0.01],[0.10,0]]]}}'),
('FE','__TEST_AERIAL__','2098','TEST','__TEST_AERIAL__ap_a','cobertura','{"type":"Feature","properties":{"AP":"__TEST_AERIAL__ap_a"},"geometry":{"type":"Polygon","coordinates":[[[0.10,0],[0.11,0],[0.11,0.01],[0.10,0.01],[0.10,0]]]}}'),
('FE','__TEST_AERIAL__','2098','TEST','__TEST_AERIAL__ap_b','limite','{"type":"Feature","properties":{"AP":"__TEST_AERIAL__ap_b"},"geometry":{"type":"Polygon","coordinates":[[[0.105,0],[0.115,0],[0.115,0.01],[0.105,0.01],[0.105,0]]]}}'),
('FE','__TEST_AERIAL__','2098','TEST','__TEST_AERIAL__ap_b','cobertura','{"type":"Feature","properties":{"AP":"__TEST_AERIAL__ap_b"},"geometry":{"type":"Polygon","coordinates":[[[0.105,0],[0.115,0],[0.115,0.01],[0.105,0.01],[0.105,0]]]}}');
do $$
declare m jsonb; expected double precision; got double precision;
begin
 m:=public.aerial_spray_map('2098','TEST','FE','__TEST_AERIAL__',array['__TEST_AERIAL__union']);
 expected:=gis.st_area(gis.st_geomfromgeojson((m->'boundaries'->'geometry')::text)::gis.geography)/10000;
 got:=(m->>'applied')::double precision;
 if abs(got-expected)>greatest(0.00001,expected*0.00001) then raise exception 'duplicate/overlap union failed: applied %, expected %',got,expected; end if;
 if abs((m->>'unapplied')::double precision)>0.00001 then raise exception 'fully covered AP has nonzero unapplied: %',m; end if;
 m:=public.aerial_spray_map('2098','TEST','FE','__TEST_AERIAL__',array['__TEST_AERIAL__ap_a','__TEST_AERIAL__ap_b']);
 expected:=gis.st_area(gis.st_geomfromgeojson((m->'boundaries'->'geometry')::text)::gis.geography)/10000;
 if abs((m->>'total')::double precision-expected)>0.00001 or abs((m->>'applied')::double precision-expected)>0.00001 then raise exception 'overlapping APs double-counted area: % expected %',m,expected; end if;
 m:=public.aerial_spray_map('2098','TEST','FE','__TEST_AERIAL__',array['__TEST_AERIAL__clip']);
 if not ((m->>'applied')::double precision>0 and (m->>'applied')::double precision<(m->>'total')::double precision) then raise exception 'coverage not clipped: %',m; end if;
 if abs((m->>'applied')::double precision/(m->>'total')::double precision-0.5)>0.01 then raise exception 'clipped coverage should be half: %',m; end if;
 if abs(((m->>'applied')::double precision+(m->>'unapplied')::double precision)-(m->>'total')::double precision)>0.00001 then raise exception 'applied + unapplied != total: %',m; end if;
 m:=public.aerial_spray_map('2098','TEST','FE','__TEST_AERIAL__',array['__TEST_AERIAL__nolimit']);
 if m->>'total' is not null or m->>'applied' is not null or m->>'unapplied' is not null or (m->>'missingLimits')::int<>1 then raise exception 'missing boundary must yield null areas: %',m; end if;
 m:=public.aerial_spray_map('2098','TEST','FE','__TEST_AERIAL__',array['__TEST_AERIAL__flags']);
 if jsonb_array_length(m->'tracks'->'features')<>2 then raise exception 'valid flags 0 and 1 were not accepted: %',m; end if;
 m:=public.aerial_spray_map('2099','TEST','FE','__TEST_AERIAL__',array['__TEST_AERIAL__union']);
 if jsonb_array_length(m->'coverage'->'features')<>0 or (m->>'missingLimits')::int<>0 then raise exception 'year filter failed: %',m; end if;
 m:=public.aerial_spray_map('2098','OTHER','FE','__TEST_AERIAL__',array['__TEST_AERIAL__union']);
 if jsonb_array_length(m->'coverage'->'features')<>0 then raise exception 'culture filter failed: %',m; end if;
 m:=public.aerial_spray_map('2098','TEST','NO_SUCH_FARM','__TEST_AERIAL__',array['__TEST_AERIAL__union']);
 if jsonb_array_length(m->'coverage'->'features')<>0 then raise exception 'farm filter failed: %',m; end if;
 begin
  insert into public.aerial_spray_features(farm_code,gleba,ano,cultura,ap,kind,feature) values ('FE','__TEST_AERIAL__','2098','TEST','__TEST_AERIAL__bad3','circuito','{"type":"Feature","properties":{"AP":"__TEST_AERIAL__bad3","APLICANDO":"3"},"geometry":{"type":"LineString","coordinates":[[0.08,0],[0.09,0]]}}');
  raise exception 'APLICANDO=3 unexpectedly accepted';
 exception when check_violation then null; end;
 begin
  insert into public.aerial_spray_features(farm_code,gleba,ano,cultura,ap,kind,feature) values ('FE','__TEST_AERIAL__','2098','TEST','__TEST_AERIAL__badmissing','circuito','{"type":"Feature","properties":{"AP":"__TEST_AERIAL__badmissing"},"geometry":{"type":"LineString","coordinates":[[0.08,0],[0.09,0]]}}');
  raise exception 'missing APLICANDO unexpectedly accepted';
 exception when check_violation then null; end;
end $$;
rollback;
