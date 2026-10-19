// Prepara uma separação conservadora, sem modificar o banco ou a origem.
const fs = require('node:fs');
const path = require('node:path');
const {prepareFields} = require('./prepare-farm-fields.cjs');

function prepareSeparation(source, snapshot) {
    const {rows} = prepareFields(source);
    const groups = new Map();
    for (const row of rows) {
        const original = row.feature.properties.CampoOriginal;
        if (!original || original === row.campo) continue;
        const key = JSON.stringify([row.farm_code,original]);
        if (!groups.has(key)) groups.set(key,[]);
        groups.get(key).push(row);
    }
    const polygons = geometry => geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    const signatures = geometries => geometries.flatMap(polygons).map(JSON.stringify).sort();
    const targets = [], skipped = [];
    for (const [key,children] of groups) {
        const [farm,campo] = JSON.parse(key);
        const parent = snapshot.fields.find(row => row.farm_code === farm && row.campo === campo);
        let reason;
        if (!parent) reason = 'Cadastro original ausente';
        else if (parent.feature.properties.OperationalArchived) reason = 'Cadastro original já arquivado';
        else if (children.some(row => row.feature.properties.Area <= 0)) reason = 'Origem contém feição sem área positiva; revisar antes de separar';
        else if (JSON.stringify(signatures([parent.feature.geometry])) !== JSON.stringify(signatures(children.map(row => row.feature.geometry)))) reason = 'Geometria atual diferente da união das feições de origem';
        else if (Math.abs(Number(parent.feature.properties.Area) - children.reduce((sum,row) => sum+row.feature.properties.Area,0)) > 0.011) reason = 'Área atual diferente da soma das feições de origem';
        else if (children.some(child => snapshot.fields.some(row => row.farm_code === child.farm_code && row.campo === child.campo))) reason = 'Identificação de destino já cadastrada';
        if (reason) { skipped.push({farm,campo,reason}); continue; }
        const records = (snapshot.records || []).filter(row => row.fazenda === farm && row.campo === campo);
        targets.push({parent,children,records});
    }
    return {targets,skipped};
}

function distributeRecords(plan) {
    const result = [];
    const units = value => {
        const number = Number(value);
        if (!Number.isFinite(number) || number < 0 || !Number.isSafeInteger(Math.round(number*10000))) throw Error('Área de operação inválida');
        return Math.round(number*10000);
    };
    for (const target of plan.targets) {
        const children = [...target.children].sort((a,b)=>a.campo.localeCompare(b.campo,'pt-BR'));
        const areas = children.map(child=>units(child.feature.properties.Area));
        const total = areas.reduce((sum,value)=>sum+value,0);
        if (!total || areas.some(area=>!area)) throw Error('Feições precisam ter área positiva');
        for (const source of target.records) {
            if (!['concluido','em_andamento','nao_iniciado'].includes(source.status)) throw Error('Status de operação inválido');
            const done = units(source.area_realizada);
            if (done > units(source.area_total) || done > total) throw Error(`Área realizada excede as feições: ${source.campo}`);
            if (source.status === 'concluido' && done !== total) throw Error(`Área concluída difere da soma das feições: ${source.campo}`);
            if (source.status === 'nao_iniciado' && done !== 0) throw Error('Operação não iniciada possui área realizada');
            const allocated = areas.map(area=>Number(BigInt(done)*BigInt(area)/BigInt(total)));
            const remainders = areas.map((area,index)=>({index,remainder:BigInt(done)*BigInt(area)%BigInt(total)}))
                .sort((a,b)=>a.remainder===b.remainder ? a.index-b.index : a.remainder>b.remainder ? -1 : 1);
            const remaining = done-allocated.reduce((sum,value)=>sum+value,0);
            for (let i=0;i<remaining;i++) allocated[remainders[i].index]++;
            children.forEach((child,index)=>result.push({source_record_id:source.id,record:{
                operation_type:source.operation_type,fazenda:source.fazenda,campo:child.campo,
                gleba:source.gleba ?? child.feature.properties.Gleba,ano:source.ano,cultura:source.cultura,produto:source.produto,
                status:source.status,area_total:areas[index]/10000,area_realizada:allocated[index]/10000,
                percentual_realizado:Math.round(allocated[index]/areas[index]*10000)/100,
                taxa_aplicada:source.taxa_aplicada,variedade_semente:source.variedade_semente,
                data_plantio:source.data_plantio,tipo_progresso:source.tipo_progresso
            }}));
        }
    }
    return result;
}

function separationSql(plan, {preserveRecords = false} = {}) {
    if (!plan.targets.length) throw Error('Nenhuma separação segura disponível.');
    const literal = value => "'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
    const parents = plan.targets.map(target => target.parent);
    const children = plan.targets.flatMap(target => target.children);
    const distributed = preserveRecords ? distributeRecords(plan) : [];
    const businessColumns = 'operation_type,fazenda,campo,gleba,ano,cultura,produto,status,area_total,area_realizada,percentual_realizado,taxa_aplicada,variedade_semente,data_plantio,tipo_progresso';
    const recordType = 'operation_type text,fazenda text,campo text,gleba text,ano text,cultura text,produto text,status text,area_total numeric,area_realizada numeric,percentual_realizado numeric,taxa_aplicada numeric,variedade_semente text,data_plantio date,tipo_progresso text';
    return `begin;
lock table public.farm_fields,public.operation_records,public.operation_plans,public.operation_history in share row exclusive mode;
create temporary table parents_before on commit drop as select * from jsonb_to_recordset(${literal(parents)}) as x(farm_code text,campo text,feature jsonb);
create temporary table new_parts on commit drop as select * from jsonb_to_recordset(${literal(children)}) as x(farm_code text,campo text,feature jsonb);
create temporary table all_fields_before on commit drop as select * from public.farm_fields;
create temporary table records_before on commit drop as select * from public.operation_records;
create temporary table plans_before on commit drop as select * from public.operation_plans;
create temporary table history_before on commit drop as select * from public.operation_history;
create temporary table expected_sources on commit drop as select value record from jsonb_array_elements(${literal(plan.targets.flatMap(target=>target.records))});
create temporary table operation_parts on commit drop as select * from jsonb_to_recordset(${literal(distributed)}) as x(source_record_id uuid,record jsonb);
do $$ begin
 if exists(select 1 from parents_before p left join public.farm_fields f using(farm_code,campo) where f.campo is null or f.feature is distinct from p.feature) then raise exception 'Cadastro original mudou desde a preparação';end if;
 if exists(select 1 from new_parts n join public.farm_fields f using(farm_code,campo)) then raise exception 'Destino já cadastrado';end if;
 if exists((select to_jsonb(r) from public.operation_records r join parents_before p on p.farm_code=r.fazenda and p.campo=r.campo except select record from expected_sources) union all (select record from expected_sources except select to_jsonb(r) from public.operation_records r join parents_before p on p.farm_code=r.fazenda and p.campo=r.campo)) then raise exception 'Lançamentos mudaram desde a preparação';end if;
 if exists(select 1 from public.operation_plans p cross join lateral jsonb_array_elements(p.planned_fields) i join parents_before b on b.farm_code=i->>'fazenda' and b.campo=i->>'campo') then raise exception 'Plano explícito contém talhão agrupado; distribuir planejamento antes';end if;
end $$;
insert into public.farm_fields(farm_code,campo,feature) select farm_code,campo,feature from new_parts;
update public.farm_fields f set feature=jsonb_set(f.feature,'{properties,OperationalArchived}','true'::jsonb) from parents_before p where f.farm_code=p.farm_code and f.campo=p.campo;
create temporary table inserted_records on commit drop as
 with inserted as (insert into public.operation_records(${businessColumns}) select ${businessColumns} from operation_parts p cross join lateral jsonb_to_record(p.record) as r(${recordType}) returning *) select * from inserted;
do $$ begin
 if exists((select * from public.operation_records where id not in (select id from inserted_records) except select * from records_before) union all (select * from records_before except select * from public.operation_records))
 or exists((select * from public.operation_plans except select * from plans_before) union all (select * from plans_before except select * from public.operation_plans))
 or exists(select * from history_before except select * from public.operation_history)
 or exists(select * from public.operation_history where not (source_table='operation_records' and record_id in (select id from inserted_records)) except select * from history_before) then raise exception 'Operações, planejamento ou histórico alterados';end if;
 if (select count(*) from inserted_records)<>(select count(*) from operation_parts) or exists(select 1 from operation_parts p where not exists(select 1 from inserted_records r where to_jsonb(r)-array['id','created_by','updated_by','created_at','updated_at','version'] is not distinct from p.record)) then raise exception 'Distribuição de lançamentos incompleta';end if;
 if exists((select f.* from public.farm_fields f where not exists(select 1 from parents_before p where p.farm_code=f.farm_code and p.campo=f.campo) and not exists(select 1 from new_parts n where n.farm_code=f.farm_code and n.campo=f.campo) except select f.* from all_fields_before f where not exists(select 1 from parents_before p where p.farm_code=f.farm_code and p.campo=f.campo)) union all (select f.* from all_fields_before f where not exists(select 1 from parents_before p where p.farm_code=f.farm_code and p.campo=f.campo) except select f.* from public.farm_fields f where not exists(select 1 from parents_before p where p.farm_code=f.farm_code and p.campo=f.campo) and not exists(select 1 from new_parts n where n.farm_code=f.farm_code and n.campo=f.campo))) then raise exception 'Outros talhões alterados';end if;
 if exists(select 1 from parents_before p join public.farm_fields f using(farm_code,campo) where f.feature is distinct from jsonb_set(p.feature,'{properties,OperationalArchived}','true'::jsonb)) or exists(select 1 from new_parts n left join public.farm_fields f using(farm_code,campo) where f.feature is distinct from n.feature) then raise exception 'Separação incompleta';end if;
end $$;
commit;
`;
}

if (require.main === module) {
    const root = path.resolve(__dirname,'..');
    const dir = path.join(root,'.publish','field-parts-20261019');
    const source = JSON.parse(fs.readFileSync(path.join(root,'Talhoes.geojson'),'utf8'));
    const snapshot = JSON.parse(fs.readFileSync(path.join(dir,'backup-before-distribution.json'),'utf8'));
    const plan = prepareSeparation(source,snapshot);
    fs.writeFileSync(path.join(dir,'plan.json'),JSON.stringify(plan));
    fs.writeFileSync(path.join(dir,'separate.sql'),separationSql(plan,{preserveRecords:true}));
    fs.writeFileSync(path.join(dir,'distributed-records.json'),JSON.stringify(distributeRecords(plan),null,2));
    const report = {groups:plan.targets.length,parts:plan.targets.reduce((sum,t)=>sum+t.children.length,0),
        targets:plan.targets.map(t=>({farm:t.parent.farm_code,campo:t.parent.campo,parts:t.children.map(c=>({campo:c.campo,area:c.feature.properties.Area})),existingRecords:t.records.length})),skipped:plan.skipped};
    fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
}
module.exports = {prepareSeparation,separationSql,distributeRecords};
