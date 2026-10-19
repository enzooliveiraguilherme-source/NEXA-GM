const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
function prepareFields(input) {
    if (input.type !== 'FeatureCollection' || !input.features?.length) throw Error('GeoJSON vazio ou inválido.');
    const keys = new Map(), seen = new Map();
    const report = {sourceFeatures: input.features.length, inferredFarms: [], duplicates: 0, mergedParts: 0, separatedGroups: 0};
    for (const source of input.features) {
        const feature = structuredClone(source), p = feature.properties;
        if (!p || !String(p.Campo || '').trim()) throw Error('Talhão sem Campo.');
        for (const key of ['Campo','Fazenda','Gleba']) p[key] = String(p[key] || '').trim();
        if (!p.Fazenda && ((p.Gleba === 'FSTV' && /^FSTV /.test(p.Campo)) || (p.Gleba === 'FBAG' && /^FBG /.test(p.Campo)))) {
            p.Fazenda = p.Gleba; report.inferredFarms.push({campo:p.Campo,fazenda:p.Fazenda});
        }
        if (!p.Fazenda || !p.Gleba) throw Error(`Fazenda/gleba não identificada: ${p.Campo}`);
        if (p.Area == null || p.Area === '' || !Number.isFinite(Number(p.Area)) || Number(p.Area) < 0) throw Error(`Área inválida: ${p.Campo}`);
        p.Area = Number(p.Area);
        const g = feature.geometry;
        if (!g || !['Polygon','MultiPolygon'].includes(g.type)) throw Error(`Geometria inválida: ${p.Campo}`);
        const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
        if (!polygons?.length) throw Error(`Geometria vazia: ${p.Campo}`);
        for (const polygon of polygons) {
            if (!polygon?.length) throw Error(`Polígono vazio: ${p.Campo}`);
            for (const ring of polygon) {
                if (!Array.isArray(ring) || ring.length < 4 || JSON.stringify(ring[0]) !== JSON.stringify(ring.at(-1))) throw Error(`Anel inválido: ${p.Campo}`);
                for (const point of ring) if (!Array.isArray(point) || point.length < 2 || !point.every(Number.isFinite) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) throw Error(`Coordenadas fora de WGS 84: ${p.Campo}`);
            }
        }
        const key = JSON.stringify([p.Fazenda,p.Campo]), signature = JSON.stringify(g);
        if (!keys.has(key)) {keys.set(key,[feature]);seen.set(key,new Map([[signature,p.Area]]));}
        else {
            const original = keys.get(key)[0];
            if (original.properties.Gleba !== p.Gleba) throw Error(`Glebas conflitantes: ${p.Campo}`);
            if (seen.get(key).has(signature)) {
                if (seen.get(key).get(signature) !== p.Area) throw Error(`Áreas conflitantes para a mesma geometria: ${p.Campo}`);
                report.duplicates++;continue;
            }
            keys.get(key).push(feature);
            seen.get(key).set(signature,p.Area);
        }
    }
    // Campo continua sendo a chave persistida usada por seleção, operações, planos e relatórios.
    // O nome original fica disponível; a área distingue as feições sem alterar seus desenhos.
    const occupied = new Set(keys.keys());
    for (const parts of keys.values()) {
        if (parts.length < 2) continue;
        report.separatedGroups++;
        const counts = new Map();
        for (const {properties:p} of parts) counts.set(p.Area,(counts.get(p.Area)||0)+1);
        for (const feature of parts) {
            const p = feature.properties, original = p.Campo;
            const area = String(p.Area).replace('.',',');
            let campo = `${original} (${area} ha)`;
            if (counts.get(p.Area)>1 || occupied.has(JSON.stringify([p.Fazenda,campo]))) {
                const hash = createHash('sha256').update(JSON.stringify(feature.geometry)).digest('hex');
                campo += ` [${hash}]`;
            }
            const key = JSON.stringify([p.Fazenda,campo]);
            if (occupied.has(key)) throw Error(`Identificação de feição conflitante: ${campo}`);
            occupied.add(key);
            p.CampoOriginal = original;
            p.Campo = campo;
        }
    }
    const rows = [...keys.values()].flat().map(feature => ({farm_code:feature.properties.Fazenda,campo:feature.properties.Campo,feature}));
    const farms = [...new Set(rows.map(row=>row.farm_code))].map(code=>{
        const glebas=[...new Set(rows.filter(row=>row.farm_code===code).map(row=>row.feature.properties.Gleba))];
        if(glebas.length!==1) throw Error(`Fazenda com múltiplas glebas: ${code}`);
        return {code,gleba:glebas[0]};
    });
    return {rows,farms,report:{...report,fields:rows.length,farms:farms.length}};
}
function synchronizationSql({rows,farms}) {
    const literal = data => "'"+JSON.stringify(data).replaceAll("'","''")+"'::jsonb";
    return `begin;
lock table public.farm_fields,public.farms,public.operation_records,public.operation_plans,public.operation_history in share row exclusive mode;
create temporary table records_before on commit drop as select * from public.operation_records;
create temporary table plans_before on commit drop as select * from public.operation_plans;
create temporary table history_before on commit drop as select * from public.operation_history;
create temporary table incoming_fields on commit drop as select * from jsonb_to_recordset(${literal(rows)}) as x(farm_code text,campo text,feature jsonb);
create temporary table incoming_farms on commit drop as select * from jsonb_to_recordset(${literal(farms)}) as x(code text,gleba text);
create temporary table split_parents on commit drop as
 select distinct farm_code,feature->'properties'->>'CampoOriginal' campo from incoming_fields
 where nullif(feature->'properties'->>'CampoOriginal','') is not null
 and feature->'properties'->>'CampoOriginal'<>campo;
do $$ begin
 if exists(select 1 from public.operation_records r where not exists(select 1 from incoming_fields f where f.farm_code=r.fazenda and f.campo=r.campo) and not exists(select 1 from public.farm_fields f where f.farm_code=r.fazenda and f.campo=r.campo and (f.feature->'properties'->>'OperationalArchived'='true' or exists(select 1 from split_parents s where s.farm_code=f.farm_code and s.campo=f.campo))))
 or exists(select 1 from public.operation_plans p cross join lateral jsonb_array_elements(p.planned_fields) i where not exists(select 1 from incoming_fields f where f.farm_code=i->>'fazenda' and f.campo=i->>'campo') and not exists(select 1 from public.farm_fields f where f.farm_code=i->>'fazenda' and f.campo=i->>'campo' and (f.feature->'properties'->>'OperationalArchived'='true' or exists(select 1 from split_parents s where s.farm_code=f.farm_code and s.campo=f.campo))))
 then raise exception 'Talhão removido ainda possui operações ou planejamento. Atualização cancelada.';end if;
end $$;
insert into public.farms(code,name,gleba) select code,'Fazenda '||code,gleba from incoming_farms on conflict(code) do update set gleba=excluded.gleba;
insert into public.farm_fields(farm_code,campo,feature) select farm_code,campo,feature from incoming_fields on conflict(farm_code,campo) do update set feature=excluded.feature;
update public.farm_fields f set feature=jsonb_set(f.feature,'{properties,OperationalArchived}','true'::jsonb) from split_parents s where f.farm_code=s.farm_code and f.campo=s.campo and not exists(select 1 from incoming_fields i where i.farm_code=f.farm_code and i.campo=f.campo);
delete from public.farm_fields old where coalesce(old.feature->'properties'->>'OperationalArchived','false')<>'true' and not exists(select 1 from incoming_fields f where f.farm_code=old.farm_code and f.campo=old.campo);
do $$ begin
 if exists((select * from public.operation_records except select * from records_before) union all (select * from records_before except select * from public.operation_records))
 or exists((select * from public.operation_plans except select * from plans_before) union all (select * from plans_before except select * from public.operation_plans))
 or exists((select * from public.operation_history except select * from history_before) union all (select * from history_before except select * from public.operation_history))
 then raise exception 'Dados agrícolas alterados. Atualização cancelada.';end if;
 if exists((select * from incoming_fields except select * from public.farm_fields) union all (select * from public.farm_fields where coalesce(feature->'properties'->>'OperationalArchived','false')<>'true' except select * from incoming_fields)) then raise exception 'Importação incompleta.';end if;
end $$;
commit;
select jsonb_build_object('fields',(select count(*) from public.farm_fields),'records',(select count(*) from public.operation_records),'plans',(select count(*) from public.operation_plans),'history',(select count(*) from public.operation_history)) result;`;
}
if(require.main===module){
    const prepared=prepareFields(JSON.parse(fs.readFileSync(path.resolve(__dirname,'../Talhoes.geojson'),'utf8')));
    const destination=path.resolve(__dirname,'../.publish/farm-field-update-20261012');
    fs.mkdirSync(destination,{recursive:true});
    fs.writeFileSync(path.join(destination,'prepared.json'),JSON.stringify(prepared));
    fs.writeFileSync(path.join(destination,'sync.sql'),synchronizationSql(prepared));
    fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify(prepared.report,null,2));
    console.log(JSON.stringify(prepared.report,null,2));
}
module.exports={prepareFields,synchronizationSql};
