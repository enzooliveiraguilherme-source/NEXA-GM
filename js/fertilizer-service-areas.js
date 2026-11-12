(function (root) {
    'use strict';
    const model = 'ab-blocks-v2', routingModel = 'machine-road-v2';
    let epoch = 0;
    // Older databases keep serving their existing road-priority study until the
    // directional RPCs are installed. Other failures must remain visible.
    async function previousStudy(client, year, requested, farms, base, scope, current, progress) {
        progress('Consultando o estudo por percurso disponível para esta versão do portal.');
        const cached = await client.rpc('fertilizer_service_cached_profile', {
            map_year: String(year), requested_farms: requested, route_model: routingModel
        });
        if (cached.error) throw cached.error;
        current();
        if (cached.data != null) {
            const result = cached.data, allowed = new Set(base.mounds.map(m => m.id));
            if (result.analysis?.method !== 'network_grid' || result.analysis?.model_version !== routingModel ||
                result.analysis?.resolution_m !== 100 || typeof result.signature !== 'string' ||
                !Array.isArray(result.zones?.features) || result.zones.features.some(f =>
                    !farms.includes(f.properties?.farm_code) || !Array.isArray(f.properties?.mound_ids) ||
                    f.properties.mound_ids.some(id => !allowed.has(id)))) throw Error('Estudo preparado incompleto.');
            return result;
        }
        const response = await client.rpc('fertilizer_service_grid', { map_year: String(year), requested_farms: requested });
        if (response.error) throw response.error;
        current();
        const grid = response.data;
        if (grid?.year !== String(year) || grid.gleba !== 'FE' || grid.resolution_m !== 100 ||
            typeof grid.signature !== 'string' || !Array.isArray(grid.cells) || grid.cells.length > 30000 ||
            grid.cells.some(c => !requested.includes(c.farm_code) || !Number.isInteger(c.i) || !Number.isInteger(c.j) ||
                !Array.isArray(c.point) || c.point.length !== 2 || c.point.some(v => !Number.isFinite(v)))) throw Error('Malha de atendimento incompleta.');
        if (!grid.cells.length) return { zones: base.zones, analysis: null };
        const network = await root.FertilizerRouting.load(client, year, grid.gleba, scope);
        current();
        const costs = await network.graph.serviceCosts(grid.cells, base.mounds.filter(m => m.gleba === grid.gleba));
        current();
        const allowed = new Set(base.mounds.map(m => m.id));
        if (!Array.isArray(costs) || costs.length !== grid.cells.length || costs.some((c, i) =>
            c.farm_code !== grid.cells[i].farm_code || c.i !== grid.cells[i].i || c.j !== grid.cells[i].j ||
            (c.mound_id !== null && (!allowed.has(c.mound_id) || !Number.isFinite(c.score) || !Number.isFinite(c.meters))))) throw Error('Resultado de atendimento inválido.');
        const result = await client.rpc('fertilizer_service_zones', { map_year: String(year), grid_signature: grid.signature,
            requested_farms: requested, assignments: costs.filter(c => c.mound_id).map(c => ({ f: c.farm_code, i: c.i, j: c.j, m: c.mound_id })) });
        if (result.error) throw result.error;
        current();
        if (!Array.isArray(result.data?.zones?.features) || result.data.analysis?.method !== 'network_grid') throw Error('Áreas de atendimento incompletas.');
        return { ...result.data, analysis: { ...result.data.analysis, model_version: routingModel, ranking_metric: 'weighted_surface' } };
    }
    async function calculate(client, year, farms, base, scope, progress = () => {}) {
        const requested = [...new Set(farms.filter(farm => ['FE', 'PA', 'RM'].includes(farm)))].sort();
        if (!requested.length) return { zones: base.zones, analysis: null };
        if (root.FertilizerRouting?.profile?.version !== routingModel) throw Error('Perfil de rotas incompatível com as áreas de atendimento.');
        const token = epoch;
        const current = () => { if (token !== epoch) throw Error('Estudo de atendimento cancelado.'); };
        const allowed = new Set(base.mounds.map(m => m.id));
        function validateResult(result) {
            if (!Array.isArray(result?.zones?.features) || result.analysis?.method !== 'ab_blocks' ||
                result.analysis?.model_version !== model || result.analysis?.routing_model !== routingModel ||
                result.analysis?.strip_width_m !== 50 || result.analysis?.sampling_step_m !== 100 || typeof result.signature !== 'string') throw Error('Estudo preparado incompleto.');
            if (result.zones.features.some(f => !farms.includes(f.properties?.farm_code) ||
                !Array.isArray(f.properties?.mound_ids) || !f.properties.mound_ids.includes(f.properties.mound_id) ||
                f.properties.mound_ids.some(id => !allowed.has(id)))) throw Error('Estudo preparado fora do acesso atual.');
            return result;
        }
        progress('Consultando as áreas no sentido do plantio de milho.');
        const cached = await client.rpc('fertilizer_service_cached_profile', { map_year: String(year), requested_farms: requested, route_model: model });
        if (cached.error) throw cached.error;
        current();
        if (cached.data !== null && cached.data !== undefined) return validateResult(cached.data);
        progress('Unindo os talhões do mesmo bloco de aplicação e preparando as faixas AB.');
        const gridResult = await client.rpc('fertilizer_block_grid', { map_year: String(year), requested_farms: requested });
        if (gridResult.error?.code === 'PGRST202') {
            current();
            return previousStudy(client, year, requested, farms, base, scope, current, progress);
        }
        if (gridResult.error) throw gridResult.error;
        current();
        const grid = gridResult.data;
        if (grid?.year !== String(year) || grid.gleba !== 'FE' || grid.model_version !== model || grid.routing_model !== routingModel ||
            grid.strip_width_m !== 50 || grid.sampling_step_m !== 100 || typeof grid.signature !== 'string' ||
            !Array.isArray(grid.cells) || grid.cells.length > 30000 || grid.cells.some(c =>
                !requested.includes(c.farm_code) || typeof c.campo !== 'string' || typeof c.strip_id !== 'string' || !c.strip_id ||
                !Number.isFinite(c.area_ha) || c.area_ha <= 0 || !Array.isArray(c.point) || c.point.length !== 2 ||
                c.point.some(x => !Number.isFinite(x)))) throw Error('Amostras de atendimento incompletas ou fora do escopo.');
        if (!grid.cells.length) return { zones: base.zones, analysis: null };
        progress(`Comparando os montes para ${grid.cells.length.toLocaleString('pt-BR')} amostras das faixas.`);
        const network = await root.FertilizerRouting.load(client, year, grid.gleba, scope);
        current();
        const costs = await network.graph.serviceBlockCosts(grid.cells, base.mounds.filter(m => m.gleba === grid.gleba), update => {
            if (token !== epoch) return;
            progress(update.stage === 'mounds' ? `Calculando percursos dos montes: ${update.done}/${update.total}.`
                : `Comparando abastecimento por faixa: ${Math.round(update.done / Math.max(1, update.total) * 100)}%.`);
        });
        current();
        const stripKey = c => JSON.stringify([c.farm_code, c.campo, c.strip_id]);
        const expected = new Set(grid.cells.map(stripKey)), received = new Set();
        if (!Array.isArray(costs) || costs.length !== expected.size || costs.some(c => {
            const key = stripKey(c);
            if (!expected.has(key) || received.has(key) || (c.mound_id !== null &&
                (!allowed.has(c.mound_id) || !Number.isFinite(c.score) || !Number.isFinite(c.meters)))) return true;
            received.add(key); return false;
        })) throw Error('Resultado de atendimento inválido.');
        progress('Unindo as faixas atendidas por cada monte.');
        const assignments = costs.filter(c => c.mound_id).map(c => ({ f: c.farm_code, c: c.campo, s: c.strip_id, m: c.mound_id }));
        const result = await client.rpc('fertilizer_block_zones', {
            map_year: String(year), grid_signature: grid.signature, requested_farms: requested, assignments
        });
        if (result.error) throw result.error;
        current();
        return validateResult(result.data);
    }
    root.FertilizerServiceAreas = { calculate, invalidate: () => { epoch++; } };
})(typeof window !== 'undefined' ? window : globalThis);
