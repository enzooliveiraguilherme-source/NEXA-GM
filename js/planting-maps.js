(function (root) {
    'use strict';
    const F = root.PlantingForecast;
    const palette = Object.freeze(['#009640', '#005eea', '#f07800', '#8b26d9', '#00a4c4', '#e32a3a', '#d61698', '#007f76', '#b88000', '#4938c7', '#68a500', '#a44918']);
    let groups = [], indexed = new Map();
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
        summary?.classList.toggle('hidden', !enabled); legend?.classList.toggle('hidden', !enabled);
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
        const title = harvesting(state) ? 'Data estimada de colheita' : 'Variedades plantadas';
        const without = Math.max(0, totals.plantedArea - totals.estimatedArea);
        if (summary) summary.innerHTML = `<header><strong>${title}</strong><span>Plantio executado · ${escape(state.currentCultura)} · safra ${escape(state.currentAno)}</span></header>` +
            `<div class="planting-map-kpis"><div><span>Área plantada</span><b>${hectares(totals.plantedArea)}</b></div><div><span>${harvesting(state) ? 'Com previsão' : 'Talhões com plantio'}</span><b>${harvesting(state) ? hectares(totals.estimatedArea) : `${totals.plantedFields} de ${rows.length}`}</b></div>` +
            (harvesting(state) ? `<div><span>Janela estimada</span><b>${totals.first ? `${date(totals.first)} – ${date(totals.last)}` : 'Sem previsão'}</b></div>` : '') + '</div>' +
            (['admin', 'projetista'].includes(root.portalAccessRole) ? '<button type="button" class="operation-export-trigger" id="planting-report-button">Exportar relatório PDF</button><span id="planting-report-status" role="status"></span>' : '') +
            (!totals.plantedFields ? '<p>Não há plantio executado neste filtro. Registre a execução em “Atualizar Mapa de Plantio”.</p>' : harvesting(state) && !totals.estimatedArea ? '<p>Sem previsão: confira a variedade e a data de plantio nos registros de execução.</p>' : '') +
            (harvesting(state) && without > 0 ? `<p>${hectares(without)} plantados sem previsão: data, variedade ou ciclo ainda não definido.</p>` : '');
        const reportButton = document.getElementById('planting-report-button');
        if (reportButton && root.PlantingReport) reportButton.onclick = () => root.PlantingReport.download(state);
        if (legend) legend.innerHTML = `<h3>${harvesting(state) ? 'Dia estimado de colheita' : 'Variedade · área plantada'}</h3>` +
            groups.map(value => `<div class="planting-map-legend-row"><i style="background:${value.color}"></i><span>${escape(value.label)}</span><b>${hectares(value.area)}</b></div>`).join('') +
            `<div class="planting-map-legend-row"><i style="background:#94a3b8"></i><span>${harvesting(state) ? 'Sem previsão / sem plantio' : 'Sem variedade / sem plantio'}</span></div>` +
            '<p>Contorno tracejado: plantio parcial.<br>O cálculo considera apenas os hectares realizados.</p>' +
            (harvesting(state) ? '<p>' + (root.SeedCycleCatalog && !root.SeedCycleCatalog.available ? 'Catálogo de ciclos indisponível. Recarregue para consultar as previsões.' : 'Ciclos definidos pelo administrador em Variedades e ciclos. Previsão de referência; confirme a maturação no campo.') + '</p>' : '');
    }
    function style(state, feature) {
        const value = row(state, feature), group = groups.find(item => item.key === groupKey(state, value));
        return { color: '#1e293b', weight: value.partial ? 1.5 : .8, opacity: 1, fillColor: group?.color || '#94a3b8',
            fillOpacity: group ? .88 : .16, dashArray: value.partial ? '5 4' : null };
    }
    function tooltip(state, feature) {
        const value = row(state, feature);
        return `<div class="talhao-tooltip-inner"><div class="talhao-tooltip-title">${escape(value.field)} (${escape(value.farm)})</div>` +
            `<div>Variedade plantada: <strong>${escape(value.variety || 'Não informada')}</strong></div><div>Plantio: <strong>${date(value.plantingDate)}</strong></div>` +
            `<div>Área plantada: <strong>${hectares(value.plantedArea)} / ${hectares(value.totalArea)}</strong></div>` +
            `<div>Colheita estimada: <strong>${date(value.estimatedDate)}</strong></div>` +
            (value.reason ? `<div>${escape(value.reason)}</div>` : `<div>Ciclo: ${value.days} dias</div>`) +
            (value.partial ? '<div>Plantio parcial: previsão somente da área realizada.</div>' : '') + '</div>';
    }
    root.PlantingMaps = Object.freeze({ active, refresh, style, tooltip, palette });
})(typeof window !== 'undefined' ? window : globalThis);
