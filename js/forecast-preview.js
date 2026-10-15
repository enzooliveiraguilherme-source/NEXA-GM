(async function () {
    'use strict';
    const F = window.PlantingForecast;
    const $ = id => document.getElementById(id);
    const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const hectares = area => `${Number(area || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ha`;
    const date = value => value ? value.split('-').reverse().join('/') : '—';
    const shortDate = value => value ? value.slice(5).split('-').reverse().join('/') : '—';
    const palette = ['#6a983d', '#d4a13c', '#568db9', '#ae6b86', '#8a77b4', '#56a69a', '#c67b46'];
    const session = F.createSession();
    let features = [], officialRecords = [], map, layer, mode = 'varieties', rows = [], groups = [], selected = null;
    let year = '2026', culture = 'Soja';
    const demo = window.NexaForecastDemo;
    try {
        if (demo) {
            features = demo.features; officialRecords = demo.records;
            $('portal-account-name').textContent = 'Demonstração · dados fictícios';
            $('btn-logout').hidden = true;
            $('forecast-demo-link').textContent = 'Consultar meus talhões';
            $('forecast-demo-link').href = './index.html';
            document.documentElement.classList.remove('portal-loading');
            $('auth-loading-overlay').remove();
        } else {
            if (!await window.portalReady) return;
            const repository = window.GeoOperations.createRepository(window.supabaseClient);
            const batches = await Promise.all(window.portalFarms.map(async farm => ({
                features: await repository.listFields(farm.code), records: await repository.listFarmRecords(farm.code)
            })));
            features = batches.flatMap(batch => batch.features);
            officialRecords = batches.flatMap(batch => batch.records).filter(row => row.operationType === 'plantio');
        }
        const farms = [...new Set(features.map(feature => feature.properties.Fazenda))].sort();
        const directory = demo ? demo.farms : window.portalFarms;
        for (const farm of farms) $('forecast-farm').add(new Option(directory.find(item => item.code === farm)?.name || farm, farm));
        const years = [...new Set(['2026', '2027', ...officialRecords.map(row => row.ano)])].sort();
        $('forecast-year').replaceChildren(...years.map(value => new Option(value, value)));
        const cultures = [...new Set(['Soja', 'Milho', ...officialRecords.map(row => row.cultura)])];
        $('forecast-culture').replaceChildren(...cultures.map(value => new Option(value, value)));
        year = $('forecast-year').value; culture = $('forecast-culture').value;
        const varieties = [...new Set(['Olimpo', 'NEO 790', ...officialRecords.map(row => row.variedadeSemente).filter(Boolean)])];
        $('forecast-varieties').replaceChildren(...varieties.map(value => new Option(value, value)));
        map = L.map('forecast-map', { zoomControl: false }).setView([-13.1, -52.5], 10);
        L.control.zoom({ position: 'topleft' }).addTo(map);
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles © Esri', maxZoom: 19
        }).addTo(map);
        $('forecast-farm').addEventListener('change', () => { selected = null; draw(true); fillForm(); });
        for (const id of ['forecast-year', 'forecast-culture']) $(id).addEventListener('change', () => {
            year = $('forecast-year').value; culture = $('forecast-culture').value; draw(false); fillForm();
        });
        document.querySelectorAll('[data-map]').forEach(button => button.addEventListener('click', () => {
            mode = button.dataset.map; draw(false);
        }));
        $('forecast-field').addEventListener('change', () => {
            selected = visibleFeatures().find(feature => identity(feature) === $('forecast-field').value) || null;
            fillForm();
            if (selected && layer) {
                const field = layer.getLayers().find(item => identity(item.feature) === identity(selected));
                if (field) { map.fitBounds(field.getBounds(), { padding: [35, 35], maxZoom: 15 }); field.openPopup(); }
            }
        });
        for (const id of ['forecast-variety', 'forecast-date']) $(id).addEventListener('input', updateCalculation);
        $('forecast-form').addEventListener('submit', event => {
            event.preventDefault();
            try {
                if (!selected) throw Error('Selecione um talhão para simular.');
                session.set(selected, year, culture, { variedadeSemente: $('forecast-variety').value,
                    dataPlantio: $('forecast-date').value, areaRealizada: $('forecast-area').value });
                draw(false); fillForm(); message('Simulação aplicada apenas nesta página. Os dados oficiais continuam intactos.');
            } catch (error) { message(error.message, true); }
        });
        $('forecast-remove').addEventListener('click', () => {
            if (selected) session.remove(selected, year, culture);
            draw(false); fillForm(); message('Simulação retirada. Voltamos ao registro de origem deste talhão.');
        });
        $('forecast-reset').addEventListener('click', () => {
            session.clear(); draw(false); fillForm(); message('Todos os testes foram limpos. Você está no ponto de partida.');
        });
        draw(true); fillForm();
    } catch (error) {
        $('auth-loading-overlay')?.remove();
        document.documentElement.classList.remove('portal-loading');
        message('Não foi possível carregar os talhões. Recarregue a página para tentar novamente.', true);
        $('forecast-summary').textContent = 'Consulta indisponível. Nenhum dado foi alterado.';
        $('forecast-empty').hidden = false;
        $('forecast-empty').textContent = 'Não foi possível consultar os dados da safra.';
        $('forecast-form').querySelector('button[type="submit"]').disabled = true;
        console.error('Consulta de plantio indisponível.', error);
    }
    function identity(feature) { return JSON.stringify([feature.properties.Fazenda, feature.properties.Campo]); }
    function visibleFeatures() { return features.filter(feature => $('forecast-farm').value === 'ALL' || feature.properties.Fazenda === $('forecast-farm').value); }
    function sourceRecord(feature) {
        const target = F.key(feature.properties.Fazenda, feature.properties.Campo, year, culture);
        return session.get(feature, year, culture) || officialRecords.find(record => F.key(record.fazenda, record.campo, record.ano, record.cultura) === target);
    }
    function projection(feature) { return F.project(feature, sourceRecord(feature), culture); }
    function message(text, error = false) { $('forecast-message').textContent = text; $('forecast-message').classList.toggle('is-error', error); }
    function groupKey(row) { return mode === 'varieties' ? row.variety ? F.normalize(row.variety).replace(/\s/g, '') : '' : row.estimatedDate ? F.weekStart(row.estimatedDate) : ''; }
    function fillForm() {
        $('forecast-field').value = selected ? identity(selected) : '';
        const row = selected ? projection(selected) : null;
        const record = selected ? sourceRecord(selected) : null;
        $('forecast-field-detail').textContent = row ? `${row.farm} · ${row.field} · ${hectares(row.totalArea)} totais. ${row.simulated ? 'Simulação temporária.' : demo ? 'Dado fictício da demonstração.' : 'Consulta ao plantio oficial.'}` : 'Nenhum talhão selecionado.';
        $('forecast-variety').value = row?.variety || '';
        $('forecast-date').value = row?.plantingDate || '';
        $('forecast-area').value = row ? (row.plantedArea || row.totalArea) : '';
        $('forecast-area').max = row?.totalArea || '';
        $('forecast-remove').disabled = !record?.simulated;
        updateCalculation();
    }
    function updateCalculation() {
        const days = F.cycleDays($('forecast-variety').value, culture);
        const estimate = F.harvestDate($('forecast-date').value, days);
        $('forecast-calculation').textContent = estimate ? `${date($('forecast-date').value)} + ${days} dias → ${date(estimate)}`
            : !days && $('forecast-variety').value.trim() ? 'Ciclo ainda não definido para esta variedade e cultura. O plantio pode ser simulado, mas ficará sem previsão.'
            : 'Preencha a variedade e a data para calcular.';
    }
    function draw(fit) {
        const visible = visibleFeatures();
        if (selected && !visible.some(feature => identity(feature) === identity(selected))) selected = null;
        rows = visible.map(projection);
        const summary = F.summarize(rows);
        const varieties = new Map();
        for (const row of rows) if (row.planted && groupKey(row)) {
            const key = groupKey(row), group = varieties.get(key) || { key, label: mode === 'varieties' ? row.variety : `${shortDate(key)} a ${shortDate(F.harvestDate(key, 6))} · ${key.slice(0, 4)}`, area: 0 };
            group.area += row.plantedArea; varieties.set(key, group);
        }
        groups = [...varieties.values()].sort((a, b) => a.key.localeCompare(b.key)).map((group, i) => ({ ...group,
            color: mode === 'varieties' ? palette[i % palette.length] : `hsl(${Math.round(45 + i / Math.max(1, varieties.size - 1) * 150)}, 48%, 48%)` }));
        $('forecast-map-title').textContent = mode === 'varieties' ? 'Variedades plantadas' : 'Colheita estimada';
        $('forecast-source').textContent = demo ? 'DEMONSTRAÇÃO · DADOS FICTÍCIOS' : summary.simulatedFields ? 'PLANTIO EXECUTADO + SIMULAÇÕES TEMPORÁRIAS' : 'PLANTIO EXECUTADO';
        $('forecast-planted').textContent = hectares(summary.plantedArea);
        $('forecast-estimated').textContent = hectares(summary.estimatedArea);
        $('forecast-window').textContent = summary.first ? `${shortDate(summary.first)}/${summary.first.slice(0, 4)} – ${shortDate(summary.last)}/${summary.last.slice(0, 4)}` : 'Sem previsão';
        $('forecast-summary').textContent = `${summary.plantedFields} de ${rows.length} talhões com plantio · ${summary.simulatedFields} ${summary.simulatedFields === 1 ? 'simulação' : 'simulações'} neste filtro`;
        $('forecast-reset').disabled = session.size === 0;
        $('forecast-empty').hidden = mode === 'varieties' ? summary.plantedFields > 0 : summary.estimatedArea > 0;
        $('forecast-empty').textContent = !rows.length ? 'Nenhum talhão nesta fazenda.' : mode === 'varieties' ? 'Ainda não há plantio executado neste filtro. Escolha um talhão para testar.' : 'Sem previsão neste filtro. Simule Olimpo ou NEO 790 com uma data de plantio.';
        document.querySelectorAll('[data-map]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.map === mode)));
        const fieldOptions = [new Option('Selecione um talhão', ''), ...visible.map(feature => new Option(`${feature.properties.Fazenda} · ${feature.properties.Campo}`, identity(feature)))];
        $('forecast-field').replaceChildren(...fieldOptions);
        $('forecast-field').value = selected ? identity(selected) : '';
        map.closePopup();
        if (layer) layer.remove();
        layer = L.geoJSON({ type: 'FeatureCollection', features: visible }, {
            style: feature => {
                const row = projection(feature), group = groups.find(item => item.key === groupKey(row));
                return { color: row.simulated ? '#ffe083' : '#ffffff', weight: row.simulated ? 2.5 : 1.3,
                    fillColor: group?.color || '#aab5aa', fillOpacity: group ? .78 : .19, dashArray: row.partial ? '5 4' : null };
            },
            onEachFeature: (feature, field) => {
                const row = projection(feature);
                const html = `<div class="forecast-popup"><strong>${escape(row.farm)} · ${escape(row.field)}</strong>${row.simulated ? '<span class="simulation">SIMULAÇÃO TEMPORÁRIA</span><br>' : ''}Variedade: ${escape(row.variety || 'Sem plantio registrado')}<br>Plantio: ${date(row.plantingDate)}<br>Área plantada: ${hectares(row.plantedArea)} / ${hectares(row.totalArea)}<br>Colheita estimada: ${date(row.estimatedDate)}${row.reason ? '<br>' + escape(row.reason) : '<br>Ciclo de ' + row.days + ' dias'}${row.partial ? '<br>Plantio parcial · contorno tracejado' : ''}</div>`;
                field.bindPopup(html);
                field.bindTooltip(`${escape(row.farm)} · ${escape(row.field)} · ${mode === 'varieties' ? escape(row.variety || 'Sem plantio') : row.estimatedDate ? date(row.estimatedDate) : 'Sem previsão'}`, { sticky: true });
                field.on('click', () => { selected = feature; fillForm(); });
            }
        }).addTo(map);
        if (fit && visible.length) map.fitBounds(layer.getBounds(), { padding: [32, 32], maxZoom: 14 });
        const unknown = rows.reduce((sum, row) => sum + (row.planted && !groupKey(row) ? row.plantedArea : 0), 0);
        $('forecast-legend').innerHTML = `<h3>${mode === 'varieties' ? 'Variedades · área plantada' : 'Semana estimada · área'}</h3>` +
            groups.map(group => `<div class="forecast-legend-row"><i style="background:${group.color}"></i><span>${escape(group.label)}</span><b>${hectares(group.area)}</b></div>`).join('') +
            `<div class="forecast-legend-row"><i style="background:#aab5aa"></i><span>${mode === 'varieties' ? 'Sem variedade / sem plantio' : 'Sem previsão'}</span>${unknown ? `<b>${hectares(unknown)}</b>` : ''}</div><p>Contorno amarelo: simulação.<br>Contorno tracejado: plantio parcial.</p>`;
        $('forecast-table').innerHTML = rows.map(row => `<tr><td>${escape(row.farm)} · ${escape(row.field)}</td><td>${escape(row.variety || '—')}</td><td>${date(row.plantingDate)}</td><td>${hectares(row.plantedArea)}</td><td>${row.estimatedDate ? date(row.estimatedDate) : escape(row.reason)}</td><td>${row.simulated ? 'Simulação' : demo ? 'Fictício' : 'Oficial'}</td></tr>`).join('') || '<tr><td colspan="6">Nenhum talhão neste filtro.</td></tr>';
    }
})();
