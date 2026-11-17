(function (root) {
    'use strict';
    const model = 'ab-guided-exits-v9', routingModel = 'machine-guided-v3';
    const covered = ['FE', 'IPE', 'PA', 'RM', 'SH', 'SM'];
    let epoch = 0;
    async function calculateFarm(client, year, farm, base, scope, progress) {
        if (root.FertilizerRouting?.profile?.version !== routingModel) throw Error('Perfil de rotas incompatível com as áreas de atendimento.');
        const requested = [farm], token = epoch;
        const current = () => { if (token !== epoch) throw Error('Estudo de atendimento cancelado.'); };
        const allowed = new Set(base.mounds.map(m => m.id));
        function validateResult(result) {
            const a = result?.analysis;
            if (!Array.isArray(result?.zones?.features) || typeof result.signature !== 'string' || a?.method !== 'ab_guided_exits' ||
                a.model_version !== model || a.routing_model !== routingModel || a.geometry_model !== 'orthogonal_original_guides' ||
                a.decision_unit !== 'guide_orthogonal_stripe' || a.cut_basis !== 'guides_and_road_headlands' || a.near_mound_regret_limit !== 50 || a.cut_axis !== 'orthogonal' || a.direction_source !== 'Sentido_plantio_milho.geojson')
                throw Error('Estudo preparado incompleto.');
            if (result.zones.features.some(f => f.properties?.farm_code !== farm || !Array.isArray(f.properties?.mound_ids) ||
                !f.properties.mound_ids.includes(f.properties.mound_id) || f.properties.mound_ids.some(id => !allowed.has(id))))
                throw Error('Estudo preparado fora do acesso atual.');
            return result;
        }
        progress('Consultando os cortes retos pelas guias de milho.');
        const cached = await client.rpc('fertilizer_guided_exit_cached', { map_year: String(year), requested_farms: requested });
        if (cached.error) throw cached.error;
        current();
        if (cached.data !== null && cached.data !== undefined) return validateResult(cached.data);
        const response = await client.rpc('fertilizer_guided_exit_grid', { map_year: String(year), requested_farms: requested });
        if (response.error) throw response.error;
        current();
        const grid = response.data;
        if (grid?.year !== String(year) || grid.gleba !== 'FE' || grid.model_version !== model || grid.routing_model !== routingModel ||
            grid.cut_axis !== 'orthogonal' || grid.direction_source !== 'Sentido_plantio_milho.geojson' || grid.cut_basis !== 'guides_and_road_headlands' || typeof grid.signature !== 'string' || !Array.isArray(grid.cells) ||
            grid.cells.length > 30000 || !Array.isArray(grid.fields)) throw Error('Referenciais de atendimento incompletos.');
        const frames = new Map(), sampleIds = new Set(), key = c => JSON.stringify([c.farm_code, c.campo, c.strip_id]);
        for (const f of grid.fields) {
            if (f.farm_code !== farm || typeof f.campo !== 'string' || frames.has(f.campo) || !Array.isArray(f.bounds) || f.bounds.length !== 4 ||
                f.bounds.some(x => !Number.isFinite(x)) || f.bounds[0] >= f.bounds[2] || f.bounds[1] >= f.bounds[3]) throw Error('Referencial AB inválido.');
            frames.set(f.campo, f);
        }
        for (const c of grid.cells) {
            if (c.farm_code !== farm || !frames.has(c.campo) || typeof c.strip_id !== 'string' || !c.strip_id || sampleIds.has(key(c)) ||
                !Number.isFinite(c.area_ha) || c.area_ha <= 0 || !Number.isFinite(c.u) || !Number.isFinite(c.v) || !Array.isArray(c.point) ||
                c.point.length !== 2 || c.point.some(x => !Number.isFinite(x))) throw Error('Amostras de atendimento inválidas.');
            sampleIds.add(key(c));
        }
        let plan = { regions: [], unserved: [] };
        if (grid.cells.length) {
            const network = await root.FertilizerRouting.load(client, year, grid.gleba, scope);
            current();
            plan = await network.graph.serviceStraightCosts(grid.cells, grid.fields, base.mounds.filter(m => m.gleba === grid.gleba), update => {
                if (token === epoch) progress(update.stage === 'mounds' ? 'Comparando percursos dos montes: ' + update.done + '.' : 'Escolhendo faixas completas no referencial das guias.');
            });
            current();
        }
        if (!Array.isArray(plan?.regions) || plan.regions.length > 5000 || !Array.isArray(plan.unserved) || plan.unserved.length > sampleIds.size)
            throw Error('Plano de cortes retos inválido.');
        const neutralIds = new Set();
        for (const c of plan.unserved) {
            const id = key({ farm_code: c.f, campo: c.c, strip_id: c.s });
            if (!sampleIds.has(id) || neutralIds.has(id)) throw Error('Posições sem rota inválidas.');
            neutralIds.add(id);
        }
        for (const r of plan.regions) {
            const frame = frames.get(r.campo);
            if (r.farm_code !== farm || !frame || !allowed.has(r.mound_id) || ![0, 1].includes(r.axis) || !Array.isArray(r.rect) || r.rect.length !== 4 ||
                r.rect.some(x => !Number.isFinite(x)) || r.rect[0] >= r.rect[2] || r.rect[1] >= r.rect[3]) throw Error('Região de abastecimento inválida.');
            const parent = r.parent_rect || frame.bounds, other = 1 - r.axis;
            if (!Array.isArray(parent) || parent.length !== 4 || parent.some(x => !Number.isFinite(x)) || parent[0] >= parent[2] || parent[1] >= parent[3] ||
                (r.parent_rect && (r.parent_axis !== other || Math.abs(parent[r.axis] - frame.bounds[r.axis]) > 0.01 || Math.abs(parent[r.axis + 2] - frame.bounds[r.axis + 2]) > 0.01)) ||
                parent.some((x, i) => i < 2 ? x < frame.bounds[i] - 0.01 : x > frame.bounds[i] + 0.01) ||
                Math.abs(r.rect[other] - parent[other]) > 0.01 || Math.abs(r.rect[other + 2] - parent[other + 2]) > 0.01 ||
                r.rect.some((x, i) => i < 2 ? x < parent[i] - 0.01 : x > parent[i] + 0.01)) throw Error('O corte deve formar uma faixa completa ou dividir a faixa perpendicularmente.');
        }
        progress('Recortando os talhões por linhas retas das guias.');
        const result = await client.rpc('fertilizer_guided_exit_zones', {
            map_year: String(year), grid_signature: grid.signature, requested_farms: requested,
            plan: { regions: plan.regions, unserved: plan.unserved }
        });
        if (result.error) throw result.error;
        current();
        return validateResult(result.data);
    }
    async function calculate(client, year, farms, base, scope, progress = () => {}) {
        const requested = [...new Set(farms.filter(farm => covered.includes(farm)))].sort();
        if (!requested.length) return { zones: base.zones, analysis: null };
        const token = epoch, features = base.zones.features.filter(f => !requested.includes(f.properties?.farm_code)), analyses = [];
        for (const farm of requested) {
            const study = await calculateFarm(client, year, farm, base, scope, progress);
            if (token !== epoch) throw Error('Estudo de atendimento cancelado.');
            features.push(...study.zones.features); analyses.push(study.analysis);
        }
        const analysis = { ...analyses[0], scope: requested };
        for (const name of ['sections', 'road_blocks', 'guided_fields', 'unguided_fields', 'unserved_samples', 'unserved_area_ha', 'guide_conflict_samples', 'guide_conflict_fields'])
            analysis[name] = analyses.reduce((sum, a) => sum + Number(a[name] || 0), 0);
        return { zones: { type: 'FeatureCollection', features }, analysis };
    }
    root.FertilizerServiceAreas = { calculate, invalidate: () => { epoch++; } };
})(typeof window !== 'undefined' ? window : globalThis);
