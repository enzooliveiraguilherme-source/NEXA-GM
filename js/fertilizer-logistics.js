(function (root) {
    'use strict';
    const active = state => state.currentTab === 'adubacao' && state.currentSubTab === 'logistica';
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const number = value => Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    const palette = ['#f97316', '#06b6d4', '#a78bfa', '#eab308', '#ec4899', '#22c55e', '#3b82f6', '#f43f5e'];
    const cache = new Map();
    let generation = 0, routeRequest = 0, layers = null, link = null, roadLayer = null, lastMap = null, showZones = true, showLabels = true;
    function color(id) {
        let hash = 0;
        for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
        return palette[hash % palette.length];
    }
    function distance(a, b) {
        const rad = Math.PI / 180, dlat = (b[1] - a[1]) * rad, dlon = (b[0] - a[0]) * rad;
        const h = Math.sin(dlat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dlon / 2) ** 2;
        return 6371008.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
    }
    function matches(mound, state) {
        return (state.currentFazenda === 'ALL' || mound.farm_code === state.currentFazenda) &&
            (state.currentGleba === 'ALL' || mound.gleba === state.currentGleba);
    }
    function view(data, state, fields) {
        const targets = new Set(fields.map(field => field.properties.Fazenda));
        const zones = data.zones.features.filter(zone => targets.has(zone.properties.farm_code) && matches(zone.properties, state));
        const serving = new Set(zones.flatMap(zone => zone.properties.mound_ids));
        const mounds = data.mounds.filter(mound =>
            (state.currentGleba === 'ALL' || mound.gleba === state.currentGleba) &&
            (state.currentFazenda === 'ALL' || serving.has(mound.id) || (!zones.length && mound.farm_code === state.currentFazenda)));
        const missing = [...targets].filter(farm => !zones.some(zone => zone.properties.farm_code === farm));
        return { mounds, zones, missing };
    }
    async function load(client, year, farms, progress = () => {}) {
        if (!client) throw new Error('Conexão indisponível.');
        const key = JSON.stringify([root.portalUser?.id || '', year, [...farms].sort()]);
        if (!cache.has(key)) {
            const pending = (async () => {
                const { data, error } = await client.rpc('fertilizer_logistics', { map_year: String(year) });
                if (error) throw error;
                if (!Array.isArray(data?.mounds) || !Array.isArray(data?.zones?.features)) throw new Error('Resposta de logística incompleta.');
                const mounds = data.mounds.filter(m => farms.includes(m.farm_code));
                const ids = new Set(mounds.map(m => m.id));
                const result = { mounds, zones: data.zones };
                if (root.FertilizerServiceAreas) {
                    const scope = `${root.portalUser?.id || ''}:${[...farms].sort().join(',')}`;
                    const study = await root.FertilizerServiceAreas.calculate(client, year, farms, result, scope, progress);
                    result.zones = study.zones; result.analysis = study.analysis;
                }
                result.zones = { type: 'FeatureCollection', features: result.zones.features.filter(f => ids.has(f.properties?.mound_id) && farms.includes(f.properties.farm_code)) };
                return result;
            })();
            cache.set(key, pending);
            pending.catch(() => { if (cache.get(key) === pending) cache.delete(key); });
        }
        return cache.get(key);
    }
    function resetCache() {
        cache.clear();
        root.FertilizerServiceAreas?.invalidate();
        root.FertilizerRouting?.clearCache();
    }
    function clear() {
        generation++;
        routeRequest++;
        roadLayer?.remove(); roadLayer = null;
        layers?.remove(); layers = null;
        link?.remove(); link = null;
        if (lastMap) lastMap.closePopup();
        const panel = document.getElementById('fertilizer-logistics-panel');
        if (panel) panel.hidden = true;
        const container = lastMap?.getContainer?.();
        if (container?.clientWidth && container.clientHeight) lastMap.invalidateSize?.({ pan: false });
        lastMap = null;
    }
    function moundDetails(mound) {
        return `<h3>${escape(mound.name)}</h3><p>Fazenda <strong>${escape(mound.farm_code)}</strong> · Gleba ${escape(mound.gleba)}</p>` +
            (mound.source_gleba !== mound.gleba ? `<p>Gleba no arquivo: ${escape(mound.source_gleba)}</p>` : '') +
            '<div class="logistics-stock"><strong>Estoque ainda não cadastrado</strong><p>Produtos e toneladas serão registrados na próxima etapa. A quantidade disponível ainda não foi informada.</p></div>';
    }
    async function refresh(state, fields, shouldFitBounds = false) {
        clear();
        if (!active(state) || !state.map) return;
        state.map.invalidateSize?.({ pan: false });
        const token = generation, panel = document.getElementById('fertilizer-logistics-panel');
        if (!panel) return;
        lastMap = state.map;
        panel.hidden = false;
        panel.innerHTML = '<h2>Logística de adubação</h2><p role="status">Carregando montes e áreas de atendimento…</p>';
        L.DomEvent.disableClickPropagation(panel);
        L.DomEvent.disableScrollPropagation(panel);
        layers = L.featureGroup().addTo(state.map);
        const group = layers;
        // Neutral outlines remain visible even if the service fails or a farm has no mounds.
        const outlines = L.geoJSON({ type: 'FeatureCollection', features: fields }, {
            style: { color: '#e2e8f0', weight: 1.2, fillColor: '#64748b', fillOpacity: 0.06 },
            onEachFeature(feature, layer) {
                layer.bindTooltip(escape(feature.properties?.Campo || 'Talhão'));
            }
        }).addTo(group);
        if (shouldFitBounds && outlines.getBounds().isValid()) state.map.fitBounds(outlines.getBounds(), { padding: [40, 40] });
        try {
            const farms = (root.portalFarms || []).map(farm => farm.code);
            const data = await load(root.supabaseClient, state.currentAno, farms, message => {
                if (token !== generation || !active(state)) return;
                const status = panel.querySelector?.('[role="status"]');
                if (status) status.textContent = message;
            });
            if (token !== generation || !active(state)) return;
            const { mounds, zones, missing } = view(data, state, fields);
            async function routeFrom(origin, gleba) {
                const request = ++routeRequest;
                link?.remove(); link = null;
                const disclosure = panel.querySelector?.('details');
                if (disclosure) disclosure.open = false;
                const popupTop = Number(panel.offsetTop || 0) + Number(panel.offsetHeight || 0) + 12;
                const popup = L.popup({ maxWidth: 350, className: 'logistics-popup', autoPanPaddingTopLeft: [12, popupTop], autoPanPaddingBottomRight: [12, 12] })
                    .setLatLng(origin).setContent('<p role="status">Comparando caminhos até os montes…</p>').openOn(state.map);
                try {
                    if (!root.FertilizerRouting || !gleba) throw Error('Rede de caminhos indisponível.');
                    const scope = `${root.portalUser?.id || ''}:${[...farms].sort().join(',')}`;
                    const network = await root.FertilizerRouting.load(root.supabaseClient, state.currentAno, gleba, scope);
                    if (token !== generation || request !== routeRequest || !active(state)) return;
                    roadLayer?.remove();
                    roadLayer = L.geoJSON(network.data.roads, { style: { color: '#facc15', weight: 3, opacity: 0.85 }, interactive: false }).addTo(group);
                    const candidates = data.mounds.filter(m => m.gleba === gleba);
                    const result = await network.graph.rank([origin.lng, origin.lat], candidates);
                    if (token !== generation || request !== routeRequest || !active(state)) return;
                    if (!result.routes.length) {
                        popup.setContent('<strong>Sem caminho conectado aos montes</strong><p>As estradas e bordas disponíveis não confirmam um acesso a partir deste ponto. Confira as ligações no mapa.</p>');
                        return;
                    }
                    const best = result.routes[0];
                    link = L.polyline(best.coordinates.map(p => [p[1], p[0]]), { color: '#fff', weight: 4, interactive: false }).addTo(group);
                    let html = `<strong>Percurso recomendado: ${escape(best.mound.name)}</strong><p>${number(best.meters / 1000)} km até o monte.</p>`;
                    if (best.metrics) html += `<p>Estrada: ${number(best.metrics.roadMeters)} m · Bordadura: ${number(best.metrics.borderMeters)} m · Interior: ${number(best.metrics.fieldMeters)} m` +
                        (best.metrics.approachMeters > 0.1 ? ` · Conexões: ${number(best.metrics.approachMeters)} m` : '') + '.</p>';
                    else {
                        if (best.shortcutMeters > 0.1) html += `<p>Atalhos curtos dentro dos talhões: ${number(best.shortcutMeters)} m.</p>`;
                        if (best.accessMeters > 0.1) html += `<p>Acesso local ao ponto/monte: ${number(best.accessMeters)} m.</p>`;
                    }
                    html += moundDetails(best.mound);
                    if (result.routes.length > 1) html += '<p>Outras origens pela mesma prioridade:</p><ol>' + result.routes.slice(1, 4).map(r => `<li>${escape(r.mound.name)}: ${number(r.meters / 1000)} km</li>`).join('') + '</ol>';
                    if (result.unreachable) html += `<p>${result.unreachable} monte(s) sem ligação confirmada.</p>`;
                    html += '<p class="logistics-note">Prioriza estradas, mesmo com distância maior. Bordadura e interior têm preferência menor. Não considera produto ou estoque.</p>';
                    popup.setContent(html);
                    // A supplier can serve the selected farm even when its straight-line
                    // Voronoi cell does not overlap that farm. Include it in the selector.
                    const select = document.getElementById('logistics-mound');
                    if (!mounds.some(m => m.id === best.mound.id)) {
                        mounds.push(best.mound);
                        select.innerHTML += `<option value="${escape(best.mound.id)}">${escape(best.mound.name)} · ${escape(best.mound.farm_code)}</option>`;
                    }
                    select.value = best.mound.id;
                } catch (error) {
                    if (token !== generation || request !== routeRequest || !active(state)) return;
                    console.error('Falha ao calcular percurso:', error);
                    popup.setContent('<strong>Não foi possível calcular o percurso</strong><p>A rede de estradas não está disponível. Clique novamente para tentar. Confira o método indicado nas áreas coloridas.</p>');
                }
            }
            for (const layer of outlines.getLayers()) {
                layer.on('click', event => {
                    const code = layer.feature?.properties?.Fazenda;
                    const gleba = (root.portalFarms || []).find(farm => farm.code === code)?.gleba;
                    routeFrom(event.latlng, gleba);
                });
            }
            const totalArea = zones.reduce((sum, f) => sum + Number(f.properties.area_ha), 0);
            const hasNetwork = zones.some(f => f.properties.method === 'network');
            panel.innerHTML = `<details open><summary>Logística de adubação</summary><div class="logistics-content">` +
                `<p class="logistics-total"><strong>${mounds.length} montes</strong><span>${number(totalArea)} ha atendidos</span></p><p>Limites de adubação · ${escape(state.currentAno)}</p>` +
                '<p>Preferência por estradas para o deslocamento. Bordadura é usada quando evita um desvio grande; interior fica restrito aos acessos e atalhos locais. O trajeto recomendado pode ter mais quilômetros e menos deslocamento na lavoura.</p>' +
                (hasNetwork ? '<p class="logistics-note"><strong>Cores com prioridade por estradas em FE, PA e RM 01/RM 02.</strong> Estimativa em malha de 100 m, recortada nos limites dos talhões. Nas demais áreas, as cores continuam em linha reta. O clique confere a rota do ponto exato e pode variar perto das divisões. Estradas em amarelo e percurso em branco.</p>' : '<p class="logistics-note">As cores são referência em linha reta; a recomendação por percurso é calculada no clique e pode indicar outro monte. Estradas em amarelo e percurso em branco.</p>') +
                (Number(data.analysis?.unserved_area_ha) > 0.01 ? `<p class="logistics-note">${number(data.analysis.unserved_area_ha)} ha do estudo estão sem ligação aos montes e aparecem somente com contorno.</p>` : '') +
                '<p class="logistics-note">Não considera produto ou estoque.</p>' +
                (missing.length ? `<p class="logistics-note">Sem cobertura de montes disponíveis: ${escape(missing.join(', '))}.</p>` : '') +
                (!mounds.length ? '<p>Nenhum monte cadastrado para os filtros atuais.</p>' : '') +
                (mounds.length && !zones.length ? '<p>Montes cadastrados, mas sem talhões disponíveis para calcular o atendimento.</p>' : '') +
                `<div class="logistics-toggles"><label><input id="logistics-zones" type="checkbox" ${showZones ? 'checked' : ''}> Áreas de atendimento</label>` +
                `<label><input id="logistics-labels" type="checkbox" ${showLabels ? 'checked' : ''}> Nomes dos montes</label></div>` +
                '<label class="logistics-select">Consultar monte<select id="logistics-mound"><option value="">Selecione um monte</option>' +
                mounds.map(m => `<option value="${escape(m.id)}">${escape(m.name)} · ${escape(m.farm_code)}</option>`).join('') +
                '</select></label><button type="button" id="logistics-reload">Atualizar montes</button></div></details>';
            const zoneLayers = [], markers = [];
            function selectMound(mound, origin, zone) {
                routeRequest++;
                // Keep the stock popup clear of the floating controls, including on phones.
                const disclosure = panel.querySelector?.('details');
                if (disclosure) disclosure.open = false;
                const popupTop = Number(panel.offsetTop || 0) + Number(panel.offsetHeight || 0) + 12;
                for (const item of zoneLayers) item.layer.setStyle({ weight: item.feature.properties.mound_ids.includes(mound.id) ? 3 : 1, fillOpacity: item.feature.properties.mound_ids.includes(mound.id) ? 0.45 : 0.24 });
                link?.remove(); link = null;
                let html = '';
                const peers = zone ? mounds.filter(m => zone.properties.mound_ids.includes(m.id)) : [mound];
                html += peers.map(moundDetails).join('<hr>');
                const servedArea = origin && zone ? zone.properties.area_ha : zones.filter(z => z.properties.mound_ids.includes(mound.id)).reduce((sum, z) => sum + Number(z.properties.area_ha), 0);
                if (zone) html += `<p>Área de atendimento no filtro atual: ${number(servedArea)} ha.</p>`;
                L.popup({ maxWidth: 330, className: 'logistics-popup', autoPanPaddingTopLeft: [12, popupTop], autoPanPaddingBottomRight: [12, 12] }).setLatLng(origin || [mound.latitude, mound.longitude]).setContent(html).openOn(state.map);
                document.getElementById('logistics-mound').value = mound.id;
            }
            const zoneGroup = L.geoJSON({ type: 'FeatureCollection', features: zones }, {
                style: feature => ({ color: color(feature.properties.mound_id), fillColor: color(feature.properties.mound_id), weight: 1, fillOpacity: 0.24 }),
                onEachFeature(feature, layer) {
                    zoneLayers.push({ feature, layer });
                    layer.bindTooltip(`<strong>${escape(feature.properties.name)}</strong><br>${number(feature.properties.area_ha)} ha de atendimento<br>${feature.properties.method === 'network' ? 'Por percurso · malha de 100 m' : 'Referência em linha reta'}`);
                    layer.on('click', event => {
                        L.DomEvent.stopPropagation(event);
                        routeFrom(event.latlng, feature.properties.gleba);
                    });
                }
            });
            if (showZones) zoneGroup.addTo(group);
            const locations = new Map();
            for (const mound of mounds) {
                const key = JSON.stringify([mound.gleba, mound.longitude, mound.latitude]);
                if (!locations.has(key)) locations.set(key, []);
                locations.get(key).push(mound);
            }
            for (const peers of locations.values()) {
                const mound = peers[0], zone = zones.find(f => f.properties.mound_ids.includes(mound.id));
                const marker = L.marker([mound.latitude, mound.longitude], {
                    icon: L.divIcon({ className: 'logistics-marker', html: `<span style="background:${color(zone?.properties.mound_id || mound.id)}">◆</span>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
                    title: peers.map(m => m.name).join(' / '), keyboard: true
                }).addTo(group);
                marker.bindTooltip(escape(peers.map(m => m.name).join(' / ')), { permanent: showLabels, direction: 'top', className: 'logistics-label' });
                marker.on('click', () => selectMound(mound, null, zone || { properties: { mound_ids: peers.map(m => m.id), area_ha: 0 } }));
                markers.push(marker);
            }
            document.getElementById('logistics-zones').onchange = event => {
                showZones = event.target.checked;
                if (showZones) zoneGroup.addTo(group); else group.removeLayer(zoneGroup);
            };
            document.getElementById('logistics-labels').onchange = event => {
                showLabels = event.target.checked;
                for (const marker of markers) {
                    const content = marker.getTooltip().getContent();
                    marker.unbindTooltip().bindTooltip(content, { permanent: showLabels, direction: 'top', className: 'logistics-label' });
                }
            };
            document.getElementById('logistics-mound').onchange = event => {
                const mound = mounds.find(m => m.id === event.target.value);
                if (!mound) return;
                state.map.panTo([mound.latitude, mound.longitude]);
                selectMound(mound, null, zones.find(f => f.properties.mound_ids.includes(mound.id)));
            };
            document.getElementById('logistics-reload').onclick = () => { resetCache(); refresh(state, fields, false); };
            if (shouldFitBounds && group.getBounds().isValid()) state.map.fitBounds(group.getBounds(), { padding: [40, 40] });
        } catch (error) {
            if (token !== generation || !active(state)) return;
            console.error('Falha ao consultar logística:', error);
            panel.innerHTML = '<h2>Logística de adubação</h2><p role="alert">Não foi possível carregar os montes e o estudo de atendimento.</p><button type="button" id="logistics-retry">Tentar novamente</button>';
            document.getElementById('logistics-retry').onclick = () => { resetCache(); refresh(state, fields, shouldFitBounds); };
        }
    }
    root.FertilizerLogistics = { active, refresh, clear, load, matches, view, distance, moundDetails };
})(typeof window !== 'undefined' ? window : globalThis);
