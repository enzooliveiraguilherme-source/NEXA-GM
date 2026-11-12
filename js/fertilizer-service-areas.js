(function (root) {
    'use strict';
    const model = 'ab-plan-v4', routingModel = 'machine-road-v2';
    let epoch = 0;
    async function calculate(client, year, farms, base, scope, progress = () => {}) {
        const requested = [...new Set(farms.filter(farm => ['FE', 'PA', 'RM'].includes(farm)))].sort();
        if (!requested.length) return { zones: base.zones, analysis: null };
        if (root.FertilizerRouting?.profile?.version !== routingModel) throw Error('Perfil de rotas incompatível com as áreas de atendimento.');
        const token = epoch;
        const current = () => { if (token !== epoch) throw Error('Estudo de atendimento cancelado.'); };
        const allowed = new Set(base.mounds.map(m => m.id));
        function validateResult(result) {
            if (!Array.isArray(result?.zones?.features) || result.analysis?.method !== 'ab_plan' ||
                result.analysis?.model_version !== model || result.analysis?.routing_model !== routingModel ||
                result.analysis?.strip_width_m !== 50 || result.analysis?.sampling_step_m !== 100 ||
                result.analysis?.decision_unit !== 'ab_section' || result.analysis?.cut_basis !== 'guides_and_road_headlands' ||
                result.analysis?.absolute_regret_limit !== 500 || result.analysis?.near_mound_regret_limit !== 50 ||
                typeof result.signature !== 'string') throw Error('Estudo preparado incompleto.');
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
        progress('Preparando as posições de abastecimento no sentido das guias AB.');
        const gridResult = await client.rpc('fertilizer_ab_plan_grid', { map_year: String(year), requested_farms: requested });

        if (gridResult.error) throw gridResult.error;
        current();
        const grid = gridResult.data;
        if (grid?.year !== String(year) || grid.gleba !== 'FE' || grid.model_version !== model || grid.routing_model !== routingModel ||
            grid.strip_width_m !== 50 || grid.sampling_step_m !== 100 || grid.cut_basis !== 'guides_and_road_headlands' || typeof grid.signature !== 'string' ||
            !Array.isArray(grid.cells) || grid.cells.length > 30000 || grid.cells.some(c =>
                !requested.includes(c.farm_code) || typeof c.campo !== 'string' || typeof c.strip_id !== 'string' || !c.strip_id ||
                !Number.isFinite(c.area_ha) || c.area_ha <= 0 || !Array.isArray(c.point) || c.point.length !== 2 ||
                c.point.some(x => !Number.isFinite(x)))) throw Error('Amostras de atendimento incompletas ou fora do escopo.');
        if (!grid.cells.length) return { zones: base.zones, analysis: null };
        progress(`Comparando os percursos em ${grid.cells.length.toLocaleString('pt-BR')} posições dos talhões.`);
        const network = await root.FertilizerRouting.load(client, year, grid.gleba, scope);
        current();
        const costs = await network.graph.servicePlanCosts(grid.cells, base.mounds.filter(m => m.gleba === grid.gleba), update => {
            if (token !== epoch) return;
            progress(update.stage === 'sections' ? 'Planejando cortes contínuos pelas guias AB.' : update.stage === 'mounds' ? `Calculando percursos dos montes: ${update.done}/${update.total}.`
                : `Comparando abastecimento por posição: ${Math.round(update.done / Math.max(1, update.total) * 100)}%.`);
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
        progress('Recortando as seções no sentido das guias AB.');
        const assignments = costs.filter(c => c.mound_id).map(c => ({ f: c.farm_code, c: c.campo, s: c.strip_id, m: c.mound_id, p: c.plan_id, q: c.section_id }));
        const result = await client.rpc('fertilizer_ab_plan_zones', {
            map_year: String(year), grid_signature: grid.signature, requested_farms: requested, assignments
        });
        if (result.error) throw result.error;
        current();
        return validateResult(result.data);
    }
    root.FertilizerServiceAreas = { calculate, invalidate: () => { epoch++; } };
})(typeof window !== 'undefined' ? window : globalThis);
