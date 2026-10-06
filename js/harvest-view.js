(function (root) {
    'use strict';
    let request = 0;
    const cache = new Map();
    const format = value => value == null ? 'Dados não importados' : Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    const text = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    function color(value) { return value == null ? '#94a3b8' : value < 80 ? '#d73027' : value < 110 ? '#fc8d59' : value < 140 ? '#fee08b' : value < 170 ? '#91cf60' : '#1a9850'; }
    function clear(state) {
        request++;
        if (state.harvestDetailLayer) state.map.removeLayer(state.harvestDetailLayer);
        state.harvestDetailLayer = null;
        state.harvestSelected = null;
        text('harvest-selection-title', 'Explore os talhões');
        text('harvest-selection-hint', 'Selecione um talhão no mapa ou na lista para ver a produtividade dentro dele.');
        document.getElementById('harvest-field-metrics')?.classList.add('hidden');
        document.getElementById('harvest-back')?.classList.add('hidden');
        const select = document.getElementById('harvest-field-select');
        if (select) select.value = '';
        state.geojsonLayer?.setStyle(root.getFeatureStyle);
    }
    async function select(state, feature) {
        clear(state);
        const token = request;
        const campo = feature.properties.Campo;
        state.harvestSelected = campo;
        const record = state.harvestSummary.records.find(r => r.campo === campo);
        text('harvest-selection-title', campo);
        text('harvest-selection-hint', record ? 'Carregando a produtividade do talhão…' : 'Dados não importados para este talhão.');
        document.getElementById('harvest-back')?.classList.remove('hidden');
        const selectEl = document.getElementById('harvest-field-select');
        if (selectEl) selectEl.value = campo;
        const polygons = state.harvestData.features.filter(f => f.properties.Campo === campo);
        state.map.fitBounds(L.geoJSON({ type: 'FeatureCollection', features: polygons }).getBounds(), { padding: [65, 65] });
        state.geojsonLayer?.setStyle(root.getFeatureStyle);
        if (!record) return;
        document.getElementById('harvest-field-metrics')?.classList.remove('hidden');
        text('harvest-mean', format(record.mean));
        text('harvest-min', format(record.min));
        text('harvest-max', format(record.max));
        try {
            const cacheKey = `${state.harvestDataset.version || 'site'}:${record.file}`;
            let data = cache.get(cacheKey);
            if (!data) { data = root.HarvestImport.normalize(await root.HarvestStore.loadField(state.harvestDataset, record.file)); cache.set(cacheKey, data); }
            if (token !== request || state.currentTab !== 'colheita') return;
            if (!state.harvestRenderer) state.harvestRenderer = L.canvas({ padding: 0.5 });
            state.harvestDetailLayer = L.geoJSON(data, {
                pointToLayer: (f, latlng) => L.circleMarker(latlng, { renderer: state.harvestRenderer, radius: 3.5, stroke: false, fillColor: color(f.properties.produtividade), fillOpacity: 0.9 }),
                onEachFeature: (f, layer) => layer.bindTooltip(`${format(f.properties.produtividade)} sc/ha`, { sticky: true, className: 'harvest-point-tooltip' })
            }).addTo(state.map);
            text('harvest-selection-hint', 'Detalhe da produtividade · grade de 25 m. Datas: Dados não importados.');
        } catch (error) {
            if (token === request) text('harvest-selection-hint', error.message);
        }
    }
    function init(state) {
        const selectEl = document.getElementById('harvest-field-select');
        if (selectEl) {
            selectEl.innerHTML = '<option value="">Selecionar talhão</option>';
            const fields = [...new Set(state.harvestData.features.map(f => f.properties.Campo))].sort((a,b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
            fields.forEach(campo => { const opt = document.createElement('option'); opt.value = campo; opt.textContent = campo; selectEl.appendChild(opt); });
            selectEl.onchange = () => { const feature = state.harvestData.features.find(f => f.properties.Campo === selectEl.value); if (feature) select(state, feature); else clear(state); };
        }
        document.getElementById('harvest-back').onclick = () => { clear(state); root.renderMap(true); };
        const upload = document.getElementById('harvest-cloud-upload');
        upload.classList.toggle('hidden', root.portalAccessRole !== 'admin');
        upload.onclick = async () => {
            upload.disabled = true;
            try {
                await root.HarvestStore.publish((done, total) => text('harvest-cloud-status', `Enviando ${done} de ${total} arquivos…`));
                text('harvest-cloud-status', 'Base de teste salva no Supabase.');
                cache.clear(); clear(state);
                await root.loadHarvestTest();
                root.renderMap(true);
            } catch (error) { text('harvest-cloud-status', error.message); }
            finally { upload.disabled = false; }
        };
        text('harvest-import-status', `${state.harvestSummary.records.length} talhões · Milho 2026`);
        clear(state);
    }
    root.HarvestView = Object.freeze({ init, select, clear, color });
})(window);
