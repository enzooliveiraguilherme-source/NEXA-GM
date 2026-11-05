(function (root) {
    'use strict';
    const F = root.PlantingForecast;
    const palette = Object.freeze(['#009640', '#005eea', '#f07800', '#8b26d9', '#00a4c4', '#e32a3a', '#d61698', '#007f76', '#b88000', '#4938c7', '#68a500', '#a44918']);
    const varietyPalette = Object.freeze(['#FFD000', '#003B8E', '#A31515', '#D49F00', '#2474E5', '#F04A3A', '#FFE033', '#123A70', '#C92A2A']);
    let groups = [], indexed = new Map(), highlightContext = '', ungroupedArea = 0;
    const selectedGroups = new Set();
    const labelOptions = { dap: false, planting: false, harvest: false };
    let labelLayer = null, labelState = null, labelTimer = null;
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const date = value => value ? value.split('-').reverse().join('/') : '—';
    const hectares = value => Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' ha';
    const active = state => state.currentTab === 'plantio' && ['data-estimada-colheita', 'variedades-plantadas'].includes(state.currentSubTab);
    const harvesting = state => state.currentSubTab === 'data-estimada-colheita';
    const fieldKey = (state, feature) => F.key(feature.properties.Fazenda, feature.properties.Campo, state.currentAno, state.currentCultura);
    function varietyColor(variety) {
        const key = F.normalize(variety).replace(/\s/g, '');
        if (!key || key === 'NAOINFORMADA') return '#94a3b8';
        if (key === 'OLIMPO') return '#0057D9';
        if (key === 'NEO790') return '#E52222';
        // Derive the color from the variety itself, independent of farms and filters.
        let hash = 2166136261;
        for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
        return varietyPalette[hash % varietyPalette.length];
    }
    function row(state, feature) { return F.project(feature, indexed.get(fieldKey(state, feature)), state.currentCultura); }
    function daysAfterPlanting(value, today = new Date()) {
        const planted = F.dateValue(value);
        const current = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
        if (planted === null || !Number.isFinite(current) || current < planted) return null;
        return Math.round((current - planted) / 86400000);
    }
    function label(state, feature, today = new Date()) {
        const value = row(state, feature), lines = [];
        if (!value.planted) return '';
        const dap = daysAfterPlanting(value.plantingDate, today);
        if (labelOptions.dap && dap !== null) lines.push(`<strong>${dap} DAP</strong>`);
        if (labelOptions.planting && value.plantingDate) lines.push(`Plantio: ${date(value.plantingDate)}`);
        if (labelOptions.harvest && value.estimatedDate) lines.push(`Colheita: ${date(value.estimatedDate)}`);
        return lines.map(line => `<div>${line}</div>`).join('');
    }
    function clearLabels() {
        labelLayer?.remove();
        labelLayer = null;
    }
    function refreshLabels(state) {
        clearLabels();
        if (state.currentTab !== 'plantio' || !state.map || !state.geojsonLayer || !Object.values(labelOptions).some(Boolean)) return;
        labelLayer = L.layerGroup().addTo(state.map);
        const today = new Date();
        state.geojsonLayer.eachLayer(layer => {
            if (!layer.feature || (active(state) && selectedGroups.size && !selectedGroups.has(groupKey(state, row(state, layer.feature))))) return;
            const html = label(state, layer.feature, today);
            if (!html || !layer.getCenter) return;
            L.marker(layer.getCenter(), {
                interactive: false, keyboard: false, pane: 'tooltipPane',
                icon: L.divIcon({ className: 'planting-field-label', html: `<div class="planting-field-label-content">${html}</div>`, iconSize: [0, 0], iconAnchor: [0, 0] })
            }).addTo(labelLayer);
        });
    }
    function setLabelOption(state, key, checked) {
        if (!Object.hasOwn(labelOptions, key)) return;
        labelOptions[key] = !!checked;
        refreshLabels(state);
    }
    function refreshLabelControls(state) {
        labelState = state;
        const controls = document.getElementById('planting-label-controls');
        controls?.classList.toggle('hidden', state.currentTab !== 'plantio');
        if (controls) controls.onchange = event => {
            const key = event.target?.dataset?.plantingLabel;
            if (key) setLabelOption(state, key, event.target.checked);
        };
        // Recalculate DAP even when the map stays open overnight.
        if (labelTimer === null && root.setInterval) labelTimer = root.setInterval(() => {
            if (labelState) refreshLabels(labelState);
        }, 60000);
    }
    function groupKey(state, value) {
        return harvesting(state) ? value.estimatedDate || ''
            : value.variety ? F.normalize(value.variety).replace(/\s/g, '') : '';
    }
    function refresh(state, features) {
        clearLabels();
        refreshLabelControls(state);
        indexed = new Map(Object.values(state.cloudStore?.getRecords() || {}).filter(record => record.operationType === 'plantio' || record.produto === 'Plantio')
            .map(record => [F.key(record.fazenda, record.campo, record.ano, record.cultura), record]));
        const summary = document.getElementById('planting-map-summary'), legend = document.getElementById('planting-map-legend');
        const enabled = active(state);
        const context = JSON.stringify([state.currentTab,state.currentSubTab,state.currentAno,state.currentCultura,state.currentGleba,state.currentFazenda]);
        if (context !== highlightContext || !enabled) { selectedGroups.clear(); highlightContext = context; }
        summary?.classList.toggle('hidden', true); legend?.classList.toggle('hidden', !enabled);
        if (summary) summary.innerHTML = '';
        if (!enabled) return;
        state.map?.closePopup();
        const rows = features.map(feature => row(state, feature)), totals = F.summarize(rows), collected = new Map();
        ungroupedArea = 0;
        for (const value of rows) {
            const key = groupKey(state, value);
            if (value.planted && !key) ungroupedArea += value.plantedArea;
            if (!value.planted || !key) continue;
            const label = harvesting(state) ? date(key) : value.variety;
            const current = collected.get(key) || { key, label, area: 0 };
            current.area += value.plantedArea; collected.set(key, current);
        }
        groups = [...collected.values()].sort((a, b) => (harvesting(state) ? 0 : b.area - a.area) || a.key.localeCompare(b.key)).map((value, index) => ({ ...value,
            color: harvesting(state) ? palette[index % palette.length] : varietyColor(value.key) }));
        for (const key of selectedGroups) {
            if (key !== '' && !groups.some(group => group.key === key)) selectedGroups.delete(key);
        }
        const without = Math.max(0, totals.plantedArea - totals.estimatedArea);
        if (legend) legend.innerHTML = `<h3>${harvesting(state) ? 'Dia estimado de colheita' : 'Variedade · área plantada'}</h3>` +
            `<p class="planting-legend-hint">Selecione uma ou mais ${harvesting(state) ? 'datas' : 'variedades'} para destacar e somar as áreas. Toque novamente para desmarcar.</p>` +
            '<div id="planting-legend-selection" class="planting-legend-selection" role="status" aria-live="polite" hidden></div>' +
            `<button type="button" class="planting-legend-reset" id="planting-legend-reset"${selectedGroups.size ? '' : ' hidden'}>Limpar seleção · mostrar todas</button>` +
            groups.map(value => `<button type="button" class="planting-map-legend-row" data-planting-group="${escape(value.key)}" aria-pressed="${selectedGroups.has(value.key)}"><i style="background:${value.color}"></i><span>${escape(value.label)}</span><b>${hectares(value.area)}</b></button>`).join('') +
            `<button type="button" class="planting-map-legend-row" data-planting-group="" aria-pressed="${selectedGroups.has('')}"><i style="background:#94a3b8"></i><span>${harvesting(state) ? 'Sem previsão / sem plantio' : 'Sem variedade / sem plantio'}</span><b>${hectares(ungroupedArea)}</b></button>` +
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
        refreshSelectionSummary();
    }
    function refreshSelectionSummary() {
        const summary = document.getElementById('planting-legend-selection');
        if (!summary) return;
        const area = groups.reduce((total, group) => total + (selectedGroups.has(group.key) ? group.area : 0), selectedGroups.has('') ? ungroupedArea : 0);
        summary.hidden = selectedGroups.size === 0;
        summary.innerHTML = selectedGroups.size ? `<span>Área plantada selecionada</span><strong>${hectares(area)}</strong><small>${selectedGroups.size} ${selectedGroups.size === 1 ? 'item selecionado' : 'itens selecionados'}</small>` : '';
    }
    function selectGroup(state, key) {
        if (!active(state)) return;
        if (key !== null && key !== '' && !groups.some(group => group.key === key)) return;
        if (key === null) selectedGroups.clear();
        else if (selectedGroups.has(key)) selectedGroups.delete(key);
        else selectedGroups.add(key);
        state.map?.closePopup();
        state.geojsonLayer?.eachLayer(layer => {
            layer.closeTooltip?.();
            if (layer.feature) layer.setStyle(style(state, layer.feature));
        });
        if (selectedGroups.size) state.geojsonLayer?.eachLayer(layer => {
            if (layer.feature && selectedGroups.has(groupKey(state, row(state, layer.feature)))) layer.bringToFront?.();
        });
        document.querySelectorAll('#planting-map-legend [data-planting-group]').forEach(button => {
            button.setAttribute('aria-pressed', String(selectedGroups.has(button.dataset.plantingGroup)));
        });
        const reset = document.getElementById('planting-legend-reset');
        if (reset) reset.hidden = selectedGroups.size === 0;
        refreshSelectionSummary();
        refreshLabels(state);
    }
    function style(state, feature) {
        const value = row(state, feature), group = groups.find(item => item.key === groupKey(state, value));
        if (selectedGroups.size && !selectedGroups.has(groupKey(state, value))) return {
            color: '#64748b', weight: .7, opacity: .25, fillColor: '#94a3b8', fillOpacity: .07, dashArray: value.partial ? '5 4' : null
        };
        if (selectedGroups.size) return {
            color: '#0f172a', weight: 3, opacity: 1, fillColor: group?.color || '#94a3b8', fillOpacity: 1, dashArray: value.partial ? '5 4' : null
        };
        return { color: '#1e293b', weight: value.partial ? 1.5 : .8, opacity: 1, fillColor: group?.color || '#94a3b8',
            fillOpacity: group ? harvesting(state) ? .88 : 1 : .16, dashArray: value.partial ? '5 4' : null };
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
    root.PlantingMaps = Object.freeze({ active, refresh, style, tooltip, palette, varietyColor, selectGroup, daysAfterPlanting, label, setLabelOption, refreshLabels, clearLabels });
})(typeof window !== 'undefined' ? window : globalThis);
