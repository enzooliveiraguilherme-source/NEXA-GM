(function (root) {
    'use strict';
    const model = 'machine-road-v2';
    let epoch = 0;
    async function calculate(client, year, farms, base, scope, progress = () => {}) {
        const requested = [...new Set(farms.filter(farm => ['FE', 'PA', 'RM'].includes(farm)))].sort();
        if (!requested.length) return { zones: base.zones, analysis: null };
        if (root.FertilizerRouting?.profile?.version !== model) throw Error('Perfil de rotas incompatível com as áreas de atendimento.');
        const token = epoch;
        const current = () => { if (token !== epoch) throw Error('Estudo de atendimento cancelado.'); };
        progress('Consultando as áreas de atendimento por percurso…');
        const cached = await client.rpc('fertilizer_service_cached_profile', { map_year: String(year), requested_farms: requested, route_model: model });
        if (cached.error) throw cached.error;
        current();
        if (cached.data !== null && cached.data !== undefined) {
            if (!Array.isArray(cached.data.zones?.features) || cached.data.analysis?.method !== 'network_grid' ||
                cached.data.analysis?.resolution_m !== 100 || cached.data.analysis?.model_version !== model || typeof cached.data.signature !== 'string') throw Error('Estudo preparado incompleto.');
            const allowed = new Set(base.mounds.map(m => m.id));
            if (cached.data.zones.features.some(f => !farms.includes(f.properties?.farm_code) ||
                !Array.isArray(f.properties?.mound_ids) || f.properties.mound_ids.some(id => !allowed.has(id)))) throw Error('Estudo preparado fora do acesso atual.');
            return cached.data;
        }
        progress('Preparando a malha das áreas de atendimento por percurso…');
        const gridResult = await client.rpc('fertilizer_service_grid', { map_year: String(year), requested_farms: requested });
        if (gridResult.error) throw gridResult.error;
        current();
        const grid = gridResult.data;
        if (grid?.year !== String(year) || grid.gleba !== 'FE' || grid.resolution_m !== 100 ||
            typeof grid.signature !== 'string' || !Array.isArray(grid.cells) || grid.cells.length > 30000 ||
            grid.cells.some(c => !requested.includes(c.farm_code) || !Number.isInteger(c.i) || !Number.isInteger(c.j) ||
                !Array.isArray(c.point) || c.point.length !== 2 || c.point.some(x => !Number.isFinite(x)))) {
            throw Error('Malha de atendimento incompleta ou fora do escopo.');
        }
        if (!grid.cells.length) return { zones: base.zones, analysis: null };
        progress(`Montando a rede para calcular ${grid.cells.length.toLocaleString('pt-BR')} partes dos talhões…`);
        const network = await root.FertilizerRouting.load(client, year, grid.gleba, scope);
        current();
        const costs = await network.graph.serviceCosts(grid.cells, base.mounds.filter(m => m.gleba === grid.gleba), update => {
            if (token !== epoch) return;
            progress(update.stage === 'mounds'
                ? `Calculando percursos dos montes: ${update.done}/${update.total}…`
                : `Calculando áreas por percurso: ${Math.round(update.done / Math.max(1, update.total) * 100)}%…`);
        });
        current();
        progress('Recortando e unindo as áreas por monte…');
        const allowed = new Set(base.mounds.map(m => m.id));
        if (!Array.isArray(costs) || costs.length !== grid.cells.length || costs.some((c, index) =>
            c.farm_code !== grid.cells[index].farm_code || c.i !== grid.cells[index].i || c.j !== grid.cells[index].j ||
            (c.mound_id !== null && (!allowed.has(c.mound_id) || !Number.isFinite(c.score) || !Number.isFinite(c.meters))))) throw Error('Resultado de atendimento inválido.');
        const assignments = costs.filter(c => c.mound_id).map(c => ({ f: c.farm_code, i: c.i, j: c.j, m: c.mound_id }));
        const result = await client.rpc('fertilizer_service_zones', {
            map_year: String(year), grid_signature: grid.signature, requested_farms: requested, assignments
        });
        if (result.error) throw result.error;
        current();
        if (!Array.isArray(result.data?.zones?.features) || result.data?.analysis?.method !== 'network_grid') throw Error('Áreas de atendimento incompletas.');
        return { ...result.data, analysis: { ...result.data.analysis, model_version: model, ranking_metric: 'weighted_surface' } };
    }
    root.FertilizerServiceAreas = { calculate, invalidate: () => { epoch++; } };
})(typeof window !== 'undefined' ? window : globalThis);
