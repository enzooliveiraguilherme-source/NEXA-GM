(function (root) {
    'use strict';
    const F = root.PlantingForecast;
    const palette = Object.freeze(['#009640', '#005eea', '#f07800', '#8b26d9', '#00a4c4', '#e32a3a', '#d61698', '#007f76', '#b88000', '#4938c7', '#68a500', '#a44918']);
    let groups = [], indexed = new Map(), selectedGroup = null, highlightContext = '';
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const date = value => value ? value.split('-').reverse().join('/') : '—';
    const hectares = value => Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' ha';
    const active = state => state.currentTab === 'plantio' && ['data-estimada-colheita', 'variedades-plantadas'].includes(state.currentSubTab);
    const harvesting = state => state.currentSubTab === 'data-estimada-colheita';
    const fieldKey = (state, feature) => F.key(feature.properties.Fazenda, feature.properties.Campo, state.currentAno, state.currentCultura);
    function row(state, feature) { return F.project(feature, indexed.get(fieldKey(state, feature)), state.currentCultura); }
    function groupKey(state, value) {
        return harvesting(state) ? value.estimatedDate || ''
            : value.variety ? F.normalize(value.variety).replace(/\s/g, '') : '';
    }
    function refresh(state, features) {
        const summary = document.getElementById('planting-map-summary'), legend = document.getElementById('planting-map-legend');
        const enabled = active(state);
        const context = JSON.stringify([state.currentTab,state.currentSubTab,state.currentAno,state.currentCultura,state.currentGleba,state.currentFazenda]);
        if (context !== highlightContext || !enabled) { selectedGroup = null; highlightContext = context; }
        summary?.classList.toggle('hidden', true); legend?.classList.toggle('hidden', !enabled);
        if (summary) summary.innerHTML = '';
        if (!enabled) return;
        state.map?.closePopup();
        indexed = new Map(Object.values(state.cloudStore?.getRecords() || {}).filter(record => record.operationType === 'plantio' || record.produto === 'Plantio')
            .map(record => [F.key(record.fazenda, record.campo, record.ano, record.cultura), record]));
        const rows = features.map(feature => row(state, feature)), totals = F.summarize(rows), collected = new Map();
        for (const value of rows) {
            const key = groupKey(state, value);
            if (!value.planted || !key) continue;
            const label = harvesting(state) ? date(key) : value.variety;
            const current = collected.get(key) || { key, label, area: 0 };
            current.area += value.plantedArea; collected.set(key, current);
        }
        groups = [...collected.values()].sort((a, b) => a.key.localeCompare(b.key)).map((value, index, all) => ({ ...value,
            color: palette[index % palette.length] }));
        if (selectedGroup !== null && selectedGroup !== '' && !groups.some(group => group.key === selectedGroup)) selectedGroup = null;
        const without = Math.max(0, totals.plantedArea - totals.estimatedArea);
        if (legend) legend.innerHTML = `<h3>${harvesting(state) ? 'Dia estimado de colheita' : 'Variedade · área plantada'}</h3>` +
            `<p class="planting-legend-hint">Clique ${harvesting(state) ? 'em uma data' : 'em uma variedade'} para destacar as áreas.</p>` +
            `<button type="button" class="planting-legend-reset" id="planting-legend-reset"${selectedGroup === null ? ' hidden' : ''}>Mostrar todas as áreas</button>` +
            groups.map(value => `<button type="button" class="planting-map-legend-row" data-planting-group="${escape(value.key)}" aria-pressed="${selectedGroup === value.key}"><i style="background:${value.color}"></i><span>${escape(value.label)}</span><b>${hectares(value.area)}</b></button>`).join('') +
            `<button type="button" class="planting-map-legend-row" data-planting-group="" aria-pressed="${selectedGroup === ''}"><i style="background:#94a3b8"></i><span>${harvesting(state) ? 'Sem previsão / sem plantio' : 'Sem variedade / sem plantio'}</span></button>` +
            '<p>Contorno tracejado: plantio parcial.<br>O cálculo considera apenas os hectares realizados.</p>' +
            (harvesting(state) ? '<p>' + (root.SeedCycleCatalog && !root.SeedCycleCatalog.available ? 'Catálogo de ciclos indisponível. Recarregue para consultar as previsões.' : 'Ciclos definidos pelo administrador em Variedades e ciclos. Previsão de referência; confirme a maturação no campo.') + '</p>' : '');
        const report = ['admin', 'projetista'].includes(root.portalAccessRole) && state.userRole === 'editor' ? '<button type="button" class="operation-export-trigger" id="planting-report-button">Exportar relatório PDF</button><span id="planting-report-status" role="status"></span>' : '';
        const notice = (!totals.plantedFields ? '<p>Não há plantio executado neste filtro. Registre a execução em “Atualizar Mapa de Plantio”.</p>' : harvesting(state) && !totals.estimatedArea ? '<p>Sem previsão: confira a variedade e a data de plantio nos registros de execução.</p>' : '') +
            (harvesting(state) && without > 0 ? `<p>${hectares(without)} plantados sem previsão: data, variedade ou ciclo ainda não definido.</p>` : '');
        const windowLabel = harvesting(state) ? `<div class="planting-legend-window"><span>Janela estimada</span><strong>${totals.first ? `${date(totals.first)} – ${date(totals.last)}` : 'Sem previsão'}</strong></div>` : '';
        if (legend) legend.innerHTML = windowLabel + legend.innerHTML + notice + report;
        const reportButton = document.getElementById('planting-report-button');
        if (reportButton && root.PlantingReport) reportButton.onclick = () => root.PlantingReport.download(state);
        if (legend) legend.onclick = event => {
            const button = event.target.closest?.('[data-planting-group]');
            if (button) selectGroup(state, button.dataset.plantingGroup);
        };
        const reset = document.getElementById('planting-legend-reset');
        if (reset) reset.onclick = () => selectGroup(state, null);
    }
    function selectGroup(state, key) {
        if (!active(state)) return;
        if (key !== null && key !== '' && !groups.some(group => group.key === key)) return;
        selectedGroup = key === selectedGroup ? null : key;
        state.map?.closePopup();
        state.geojsonLayer?.eachLayer(layer => {
            layer.closeTooltip?.();
            if (layer.feature) layer.setStyle(style(state, layer.feature));
        });
        if (selectedGroup !== null) state.geojsonLayer?.eachLayer(layer => {
            if (layer.feature && groupKey(state, row(state, layer.feature)) === selectedGroup) layer.bringToFront?.();
        });
        document.querySelectorAll('#planting-map-legend [data-planting-group]').forEach(button => {
            button.setAttribute('aria-pressed', String(button.dataset.plantingGroup === selectedGroup));
        });
        const reset = document.getElementById('planting-legend-reset');
        if (reset) reset.hidden = selectedGroup === null;
    }
    function style(state, feature) {
        const value = row(state, feature), group = groups.find(item => item.key === groupKey(state, value));
        if (selectedGroup !== null && groupKey(state, value) !== selectedGroup) return {
            color: '#64748b', weight: .7, opacity: .25, fillColor: '#94a3b8', fillOpacity: .07, dashArray: value.partial ? '5 4' : null
        };
        if (selectedGroup !== null) return {
            color: '#0f172a', weight: 3, opacity: 1, fillColor: group?.color || '#94a3b8', fillOpacity: 1, dashArray: value.partial ? '5 4' : null
        };
        return { color: '#1e293b', weight: value.partial ? 1.5 : .8, opacity: 1, fillColor: group?.color || '#94a3b8',
            fillOpacity: group ? .88 : .16, dashArray: value.partial ? '5 4' : null };
    }
    function tooltip(state, feature) {
        const value = row(state, feature);
        const title = `<div class="talhao-tooltip-inner"><div class="talhao-tooltip-title">${escape(value.field)} (${escape(value.farm)})</div>`;
        if (!harvesting(state)) return title +
            `<div>Variedade plantada: <strong>${escape(value.variety || 'Não informada')}</strong></div>` +
            `<div>Área plantada: <strong>${hectares(value.plantedArea)} / ${hectares(value.totalArea)}</strong></div>` +
            `<div>Data do plantio: <strong>${date(value.plantingDate)}</strong></div>` +
            `<div>${value.planted ? value.partial ? 'Plantio parcial: somente a área realizada.' : 'Plantio concluído.' : 'Sem plantio executado.'}</div></div>`;
        return title + `<div>Colheita estimada: <strong>${date(value.estimatedDate)}</strong></div>` +
            `<div>${value.estimatedDate ? 'Área prevista' : 'Área plantada sem previsão'}: <strong>${hectares(value.plantedArea)} / ${hectares(value.totalArea)}</strong></div>` +
            `<div>Plantio: <strong>${date(value.plantingDate)}</strong></div><div>Variedade: <strong>${escape(value.variety || 'Não informada')}</strong></div>` +
            (value.reason ? `<div>${escape(value.reason)}</div>` : `<div>Ciclo: ${value.days} dias</div>`) +
            (value.partial ? '<div>Plantio parcial: previsão somente da área realizada.</div>' : '') + '</div>';
    }
    root.PlantingMaps = Object.freeze({ active, refresh, style, tooltip, palette, selectGroup });
})(typeof window !== 'undefined' ? window : globalThis);
