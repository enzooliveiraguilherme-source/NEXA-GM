(function (root) {
    'use strict';
    function recordKey(record) {
        return [record.fazenda, record.campo, record.ano, record.cultura, record.produto]
            .map(value => String(value || '').trim().toUpperCase()).join('__');
    }
    function planKey(plan) {
        return [plan.operationType, plan.fazenda, plan.gleba || 'ALL', plan.ano, plan.cultura, plan.produto]
            .map(value => String(value || '').trim().toUpperCase()).join('__');
    }
    function create(client, farm) {
        const repository = root.GeoOperations.createRepository(client);
        let records = {}, plans = {}, pending = false;
        async function load() {
            const [features, rows, planRows] = await Promise.all([
                repository.listFields(farm), repository.listFarmRecords(farm), repository.listFarmPlans(farm)
            ]);
            if (features.some(feature => feature?.properties?.Fazenda !== farm) || rows.some(row => row.fazenda !== farm)) {
                throw new Error('O banco retornou uma fazenda diferente do acesso selecionado.');
            }
            records = Object.fromEntries(rows.map(row => [recordKey(row), row]));
            plans = Object.fromEntries(planRows.map(row => [planKey(row), row]));
            return { type: 'FeatureCollection', features };
        }
        async function write(action) {
            if (pending) throw new Error('Aguarde a confirmação da alteração anterior.');
            pending = true;
            try { return await action(); } finally { pending = false; }
        }
        return {
            load,
            getRecords: () => ({ ...records }),
            getPlanning: () => Object.fromEntries(Object.entries(plans).map(([key, plan]) => [key, plan.plannedFields.map(field => field.campo)])),
            async saveRecords(input, type) {
                if (input.some(record => record.fazenda !== farm)) throw new Error('Escolha talhões da fazenda selecionada.');
                return write(async () => {
                    const saved = await repository.saveRecords(input, type);
                    for (const row of saved) records[recordKey(row)] = row;
                    return saved;
                });
            },
            async savePlan(context, fields) {
                if (context.fazenda !== farm) throw new Error('Planejamento fora da fazenda selecionada.');
                const key = planKey(context);
                return write(async () => {
                    const saved = await repository.savePlan({ ...plans[key], ...context,
                        plannedFields: fields.map(campo => ({ fazenda: farm, campo })) });
                    plans[key] = saved;
                    return saved;
                });
            },
            async history(record) {
                if (!record.id) return [];
                return (await repository.listHistory(record.id)).map(row => ({
                    data: new Date(row.changed_at).toLocaleString('pt-BR'), usuario: row.actor_name || 'Usuário',
                    status: { concluido: 'Concluído', em_andamento: 'Em Andamento', nao_iniciado: 'Não Iniciado' }[row.current_data.status] || '',
                    detalhe: `${row.current_data.area_realizada} ha (${row.current_data.percentual_realizado}%)` +
                        (row.current_data.variedade_semente ? ` • ${row.current_data.variedade_semente}` : '') +
                        (row.current_data.data_plantio ? ` • Plantio: ${row.current_data.data_plantio}` : '') +
                        (row.current_data.taxa_aplicada != null ? ` • Taxa: ${row.current_data.taxa_aplicada} t/ha` : '')
                }));
            }
        };
    }
    root.GeoCloudStore = Object.freeze({ create, recordKey, planKey });
})(typeof window !== 'undefined' ? window : globalThis);
