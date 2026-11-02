(function (root) {
    'use strict';
    const columns = 'planting_record_id,fourth_enabled,post1_date,post2_date,fung1_date,fung2_date,fung3_date,fung4_date,version,updated_at,updated_by';
    const ids = ['post1', 'post2', 'fung1', 'fung2', 'fung3', 'fung4'];
    function checked(result) {
        if (!result.error) return result.data;
        const code = result.error.code;
        if (code === '23505' || code === '40001') throw Error('O cronograma foi alterado por outra pessoa. Recarregue os dados antes de salvar.');
        if (code === '42501') throw Error('Seu acesso não permite alterar este talhão.');
        if (code === 'PGRST205' || code === '42P01') throw Error('O módulo de pulverização ainda não foi disponibilizado no banco.');
        if (code === '23514' || code === 'P0001') throw Error(result.error.message || 'Confira a sequência das datas realizadas.');
        throw Error('Não foi possível confirmar a operação no banco. Suas alterações não foram salvas.');
    }
    function fromRow(row) {
        return { plantingId: row.planting_record_id, fourth: row.fourth_enabled,
            actuals: Object.fromEntries(ids.map(id => [id, row[id + '_date'] || ''])),
            version: row.version, updatedAt: row.updated_at };
    }
    function create(client) {
        return {
            async list(plantingIds) {
                const result = [], unique = [...new Set(plantingIds)];
                for (let start = 0; start < unique.length; start += 100) {
                    let offset = 0;
                    while (true) {
                        const response = await client.from('spray_schedules').select(columns, { count: 'exact' })
                            .in('planting_record_id', unique.slice(start, start + 100)).order('planting_record_id').range(offset, offset + 499);
                        const rows = checked(response) || [];
                        if (!Number.isInteger(response.count)) throw Error('O banco não confirmou a consulta completa dos cronogramas.');
                        result.push(...rows.map(fromRow)); offset += rows.length;
                        if (offset >= response.count) break;
                        if (!rows.length) throw Error('A consulta dos cronogramas ficou incompleta. Recarregue os dados.');
                    }
                }
                return result;
            },
            async save(input, plantingDate, current = root.SpraySchedule.today()) {
                root.SpraySchedule.validate(plantingDate, input.actuals, input.fourth, current);
                const payload = { planting_record_id: input.plantingId, fourth_enabled: input.fourth,
                    ...Object.fromEntries(ids.map(id => [id + '_date', input.actuals[id] || null])) };
                let query;
                if (input.version != null) {
                    if (!Number.isInteger(input.version) || input.version < 1) throw Error('Recarregue o cronograma antes de salvar.');
                    query = client.from('spray_schedules').update(payload).eq('planting_record_id', input.plantingId).eq('version', input.version);
                } else query = client.from('spray_schedules').insert(payload);
                const row = checked(await query.select(columns).maybeSingle());
                if (!row) throw Error('O cronograma mudou ou seu acesso foi alterado. Recarregue os dados antes de salvar.');
                return fromRow(row);
            }
        };
    }
    root.SprayRepository = Object.freeze({ create, fromRow });
    if (typeof module !== 'undefined') module.exports = root.SprayRepository;
})(typeof window !== 'undefined' ? window : globalThis);
