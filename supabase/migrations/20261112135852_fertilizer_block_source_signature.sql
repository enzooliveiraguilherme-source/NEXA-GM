-- Source labels define application blocks and must invalidate prepared results.
create or replace function gis.fertilizer_block_signature(map_year text,requested_farms text[])
returns text language sql stable security invoker set search_path='' as $function$
select md5(concat_ws('|','ab-blocks-v2:guide-source-axis:whole-band:50:100',gis.fertilizer_direction_signature($1,$2),
 (select string_agg(g.farm_code||':'||g.campo||':'||coalesce(g.source_name,''),'|' order by g.farm_code,g.campo)
  from public.fertilizer_application_guides g where g.map_year=$1 and ($2 is null or g.farm_code=any($2)))));
$function$;
