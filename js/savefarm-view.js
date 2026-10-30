(function (root) {
    'use strict';
    // Dados externos somente em memória. Sem banco, Storage ou cache persistente.
    function createClient({ client, config, fetchImpl = root.fetch.bind(root) }) {
        return async (body, signal) => {
            const { data, error } = await client.auth.getSession();
            if (signal?.aborted) throw new DOMException('Consulta cancelada', 'AbortError');
            if (error || !data?.session?.access_token) throw new Error('Entre novamente no NEXA.');
            const response = await fetchImpl(config.supabaseUrl + '/functions/v1/savecloud', {
                method: 'POST', cache: 'no-store', credentials: 'omit', signal,
                headers: { 'Content-Type': 'application/json', apikey: config.supabaseAnonKey,
                    Authorization: 'Bearer ' + data.session.access_token }, body: JSON.stringify(body)
            });
            let result;
            try { result = await response.json(); } catch { throw new Error('Não foi possível consultar a conexão SaveCloud.'); }
            if (!response.ok) throw new Error(result.error || 'Não foi possível consultar a conexão SaveCloud.');
            return result;
        };
    }

    function createView({ document, L, request, role = () => root.portalProfile?.role }) {
        const el = name => document.getElementById('savefarm-' + name);
        let state, active = false, initialized = false, catalog = null, layer = null, controller = null, version = 0;
        const message = text => { el('status').textContent = text; };
        function cancel() { version++; controller?.abort(); controller = null; }
        function clearResults() {
            if (layer) { layer.clearLayers(); state?.map?.removeLayer(layer); layer = null; }
            el('results').replaceChildren();
            state?.map?.closePopup();
        }
        function locked(value) {
            for (const control of el('form').querySelectorAll('select,input,button[type="submit"]')) control.disabled = value;
            el('reload').disabled = value && !active;
        }
        function options(select, items, placeholder) {
            select.replaceChildren();
            if (!items.length) {
                const option = document.createElement('option'); option.value = ''; option.textContent = placeholder; select.append(option);
            }
            for (const item of items) {
                const option = document.createElement('option'); option.value = item.id; option.textContent = item.label; select.append(option);
            }
        }
        function farmOptions() {
            const farm = catalog?.farms.find(item => item.code === el('farm').value);
            options(el('polygon'), farm?.polygons || [], 'Sem talhões vinculados');
            options(el('machine'), farm?.machines || [], 'Sem máquinas vinculadas');
        }
        function clearQuery() { cancel(); clearResults(); locked(!catalog?.configured); }
        function defaults(timezone) {
            const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
            const part = name => parts.find(item => item.type === name).value;
            const today = `${part('year')}-${part('month')}-${part('day')}`;
            const previous = new Date(today + 'T00:00:00Z'); previous.setUTCDate(previous.getUTCDate() - 1);
            el('from').value = previous.toISOString().slice(0, 10) + 'T00:00';
            el('to').value = today + 'T00:00';
        }
        async function loadCatalog() {
            cancel(); clearResults(); catalog = null; locked(true);
            for (const name of ['farm', 'polygon', 'machine']) options(el(name), [], 'Aguardando conexão');
            if (role() !== 'admin') { message('Integração em validação, disponível inicialmente para administradores.'); return; }
            const current = version; controller = new AbortController();
            message('Conferindo conexão com a SaveCloud…');
            try {
                const result = await request({ action: 'catalog' }, controller.signal);
                if (!active || current !== version) return;
                catalog = result;
                options(el('farm'), result.farms.map(farm => ({ id: farm.code, label: farm.name })), 'Aguardando vinculação');
                farmOptions(); defaults(result.timezone);
                el('timezone').textContent = result.timezone ? `Horários de referência: ${result.timezone} (fuso a confirmar). Período máximo: sete dias.` : 'O fuso horário será definido ao configurar a conexão.';
                message(result.message); locked(!result.configured);
            } catch (error) {
                if (current === version && active && error.name !== 'AbortError') message(error.message);
            }
        }
        function addStat(label, value, unit) {
            const card = document.createElement('div'), title = document.createElement('span'), number = document.createElement('strong');
            title.textContent = label;
            number.textContent = typeof value === 'number' && Number.isFinite(value)
                ? value.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + (unit ? ' ' + unit : '') : 'Indisponível';
            card.append(title, number); el('results').append(card);
        }
        async function query(event) {
            event.preventDefault();
            if (!active || !catalog?.configured) return;
            clearQuery(); locked(true);
            const current = version; controller = new AbortController(); const signal = controller.signal;
            const mode = el('mode').value;
            const body = { farm: el('farm').value, polygon: el('polygon').value, machine: el('machine').value,
                from: el('from').value, to: el('to').value };
            message('Consultando a SaveCloud…');
            // Falhas de estatísticas não escondem um mapa válido, nem preservam indicadores antigos.
            const requests = [request({ ...body, action: mode === 'boundaries' ? 'boundaries' : 'map', ...(mode === 'boundaries' ? {} : { mode: Number(mode) }) }, signal)];
            if (mode !== 'boundaries') requests.push(request({ ...body, action: 'statistics' }, signal));
            const results = await Promise.allSettled(requests);
            if (!active || current !== version) return;
            locked(false);
            const map = results[0], stats = results[1];
            let text;
            if (map.status === 'fulfilled') {
                try {
                    const geojson = map.value.geojson;
                    const label = el('polygon').selectedOptions[0]?.textContent || 'Talhão';
                    layer = L.geoJSON(geojson, { renderer: L.canvas({ padding: 0.5 }),
                        style: { color: mode === 'boundaries' ? '#163c51' : '#078363', weight: 1.5, fillColor: '#19b782', fillOpacity: 0.45 },
                        onEachFeature: (_feature, featureLayer) => {
                            const popup = document.createElement('span'); popup.textContent = 'SaveCloud · ' + label; featureLayer.bindPopup(popup);
                        } }).addTo(state.map);
                    const bounds = layer.getBounds(); if (bounds.isValid()) state.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 18 });
                    text = geojson.features.length ? 'Mapa recebido da SaveCloud.' : 'Nenhuma geometria retornada para esta consulta.';
                    if (map.value.scope === 'machine') text += ' Consulta por máquina, sem vínculo de talhão; pode incluir várias fazendas.';
                    const time = new Date(map.value.queriedAt);
                    if (Number.isFinite(time.getTime())) text += ' Consulta: ' + time.toLocaleString('pt-BR') + '.';
                } catch { clearResults(); text = 'O mapa recebido não pôde ser exibido.'; }
            } else text = map.reason.message;
            if (stats?.status === 'fulfilled') {
                const values = stats.value.summary;
                addStat('Litros aplicados · prévia', values.ltsTotal, 'L');
                addStat('Área percorrida · prévia', values.Hectareas, 'ha');
                addStat('Área seletiva · prévia', values.hectareasSelectiva, 'ha');
                addStat('Economia calculada · prévia', values.savedLiters, 'L');
                text += ' Indicadores preliminares; unidades e agregações aguardam validação.';
            } else if (stats) text += ' Estatísticas indisponíveis: ' + stats.reason.message;
            message(text);
        }
        function init() {
            initialized = true;
            el('form').addEventListener('submit', query);
            el('reload').addEventListener('click', loadCatalog);
            el('clear').addEventListener('click', () => { clearQuery(); message('Mapa e indicadores descartados.'); });
            for (const name of ['farm', 'polygon', 'machine', 'mode', 'from', 'to']) el(name).addEventListener('change', () => {
                clearQuery(); if (name === 'farm') farmOptions(); message('Filtros alterados. Consulte para atualizar o mapa.');
            });
            document.getElementById('btn-logout')?.addEventListener('click', dispose, { capture: true });
        }
        function dispose() {
            cancel(); clearResults(); catalog = null; active = false;
            if (initialized) {
                el('panel').hidden = true;
                for (const name of ['farm', 'polygon', 'machine']) options(el(name), [], 'Aguardando conexão');
                locked(true);
            }
        }
        function refresh(nextState) {
            state = nextState;
            if (!el('panel')) return;
            if (!initialized) init();
            const enabled = state.currentTab === 'savefarm';
            el('panel').hidden = !enabled;
            if (!enabled) { if (active) dispose(); return; }
            if (!active) { active = true; defaults(); loadCatalog(); }
            state.map?.invalidateSize();
        }
        return { refresh, dispose };
    }
    let view;
    root.SaveFarmView = {
        createClient, createView,
        refresh(state) {
            if (!view) view = createView({ document: root.document, L: root.L,
                request: createClient({ client: root.supabaseClient, config: root.GEO_PORTAL_CONFIG }) });
            view.refresh(state);
        },
        dispose() { view?.dispose(); }
    };
    root.addEventListener?.('pagehide', () => root.SaveFarmView.dispose());
    if (typeof module !== 'undefined') module.exports = { createClient, createView };
})(typeof window !== 'undefined' ? window : globalThis);
