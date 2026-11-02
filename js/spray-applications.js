(function (root) {
    'use strict';
    const columns = 'id,fazenda,campo,ano,cultura,planting_record_id,stage_id,application_name,product,dose,dose_unit,area,planned_date,actual_date,responsible,notes,deleted,version';
    function fromRow(row) {
        return { id: row.id, farm: row.fazenda, field: row.campo, year: row.ano, culture: row.cultura,
            plantingId: row.planting_record_id, stage: row.stage_id, name: row.application_name,
            product: row.product, dose: row.dose == null ? null : Number(row.dose), doseUnit: row.dose_unit,
            area: Number(row.area), planned: row.planned_date, actual: row.actual_date,
            responsible: row.responsible, notes: row.notes, deleted: row.deleted, version: row.version };
    }
    function check(result) {
        if (!result.error) return result.data;
        const code = result.error.code;
        if (['40001', '23505'].includes(code)) throw Error('Este registro mudou. Recarregue os dados antes de salvar novamente.');
        if (code === '42501') throw Error('Seu perfil não permite alterar esta aplicação.');
        if (['23514', 'P0001'].includes(code)) throw Error(result.error.message);
        throw Error('Não foi possível confirmar a operação. Nenhuma alteração foi confirmada. Recarregue e tente novamente.');
    }
    function create(client) {
        function payload(row){
            return { id: row.id || null, fazenda: row.farm, campo: row.field, ano: row.year, cultura: row.culture,
                planting_record_id: row.plantingId || null, stage_id: row.stage || null, application_name: row.name,
                product: row.product || '', dose: row.dose === '' || row.dose == null ? null : Number(row.dose),
                dose_unit: row.doseUnit || 'L/ha', area: Number(row.area), planned_date: row.plantingId && row.autoDate ? null : row.planned || null,
                actual_date: row.actual || null, responsible: row.responsible || '', notes: row.notes || '', deleted: !!row.deleted };
        }
        return {
            async saveBatch(rows,fields){
                if(!Array.isArray(rows)||!rows.length||rows.length>1000)throw Error('Altere entre 1 e 1000 aplicações por lote.');
                const unique=new Set();
                for(const row of rows){
                    root.SprayOperations.validate(row,fields.find(field=>field.farm===row.farm&&field.field===row.field));
                    const key=root.SprayOperations.rowKey(row);if(unique.has(key))throw Error('A mesma aplicação aparece mais de uma vez no lote.');unique.add(key);
                }
                const result=check(await client.rpc('save_spray_application_batch',{p_records:rows.map(row=>({payload:payload(row),expected_version:row.version??null,schedule_version:row.scheduleVersion??null}))}));
                if(!Array.isArray(result)||result.length!==rows.length||result.some(row=>!row.id)||new Set(result.map(row=>row.id)).size!==rows.length)throw Error('O banco não confirmou todo o lote. Recarregue os dados antes de tentar novamente.');
                return result.map(fromRow);
            },
            async list(farms, year, culture) {
                const all = [], unique = [...new Set(farms)];
                for (let start = 0; start < unique.length; start += 100) {
                    let offset = 0;
                    while (true) {
                        const response = await client.from('spray_applications').select(columns, { count: 'exact' })
                            .in('fazenda', unique.slice(start, start + 100)).eq('ano', year).eq('cultura', culture).order('id').range(offset, offset + 499);
                        const page = check(response) || [];
                        if (!Number.isInteger(response.count)) throw Error('A consulta das aplicações ficou incompleta.');
                        all.push(...page.map(fromRow)); offset += page.length;
                        if (offset >= response.count) break;
                        if (!page.length) throw Error('A consulta das aplicações ficou incompleta.');
                    }
                }
                return all;
            },
            async save(row, field) {
                root.SprayOperations.validate(row, field);
                const result = check(await client.rpc('save_spray_application', { p_payload: payload(row),
                    p_expected_version: row.version ?? null, p_schedule_version: row.scheduleVersion ?? null }));
                const saved = Array.isArray(result) ? result[0] : result;
                if (!saved?.id) throw Error('A gravação não foi confirmada. Recarregue os dados.');
                return fromRow(saved);
            }
        };
    }
    root.SprayApplications = Object.freeze({ create, fromRow });
    if (typeof module !== 'undefined') module.exports = root.SprayApplications;
})(typeof window !== 'undefined' ? window : globalThis);
