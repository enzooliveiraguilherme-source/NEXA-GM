(function(root) {
    'use strict';
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const lineStyle = feature => ({color: String(feature.properties?.APLICANDO) === '1' ? '#16a34a' : '#dc2626', weight: 2, opacity: 0.95});
    const formatArea = value => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('pt-BR', {maximumFractionDigits:2}) + ' ha';
    function createView({document, L, client}) {
        const el = name => document.getElementById('aerial-' + name);
        let state, active = false, initialized = false, context = '', catalog = [], selected = new Set(), layers = {}, generation = 0, query = 0;
        const status = text => { el('status').textContent = text; };
        function clearLayers() {
            Object.values(layers).forEach(layer => state?.map?.removeLayer(layer)); layers = {};
        }
        function clearResult() {
            clearLayers();
            for (const name of ['total','applied','unapplied']) el(name).textContent = '—';
        }
        function visibility() {
            for (const [key, layer] of Object.entries(layers)) {
                if (el('show-' + key).checked) layer.addTo(state.map);
                else state.map.removeLayer(layer);
            }
        }
        function choices(name, values, preferred) {
            const previous = preferred ?? el(name).value;
            el(name).replaceChildren();
            for (const value of values) {
                const option = document.createElement('option'); option.value = value; option.textContent = value; el(name).append(option);
            }
            if (values.includes(previous)) el(name).value = previous;
            el(name).disabled = !values.length;
        }
        function applications() {
            const aps = [...new Set(catalog.filter(row => row.ano === el('year').value && row.cultura === el('culture').value).map(row => row.ap))].sort((a,b)=>a.localeCompare(b,'pt-BR',{numeric:true}));
            selected = new Set([...selected].filter(ap => aps.includes(ap)));
            el('aps').innerHTML = aps.map(ap => `<label><input type="checkbox" value="${escape(ap)}"${selected.has(ap) ? ' checked' : ''}>${escape(ap)}</label>`).join('') || '<p>Nenhuma AP disponível neste ano e cultura.</p>';
            el('all').disabled = !aps.length; el('none').disabled = !aps.length;
        }
        function cultures() {
            choices('culture', [...new Set(catalog.filter(row => row.ano === el('year').value).map(row => row.cultura))].sort(), state.currentCultura);
            applications();
        }
        async function loadCatalog() {
            const version = ++generation; ++query; clearResult(); selected.clear(); catalog = [];
            choices('year', []); choices('culture', []); applications();
            status('Carregando aplicações aéreas…'); el('reload').disabled = true;
            try {
                const {data,error} = await client.rpc('aerial_spray_catalog', {map_farm:state.currentFazenda,map_gleba:state.currentGleba});
                if (version !== generation || !active) return;
                if (error) throw error;
                catalog = (data || []).map(row=>({...row,ano:String(row.ano)}));
                choices('year', [...new Set(catalog.map(row=>row.ano))].sort().reverse(), state.currentAno);
                cultures();
                status(catalog.length ? 'Escolha o ano, a cultura e uma ou mais APs.' : 'Aguardando os dados da pulverização aérea. As APs aparecerão aqui após a importação.');
            } catch(error) {
                if (version === generation && active) status('Não foi possível carregar as APs. Clique em Atualizar para tentar novamente.');
                root.console?.error('Pulverização aérea:', error);
            } finally { if (version === generation) el('reload').disabled = false; }
        }
        async function draw() {
            const version = ++query, scope = generation;
            clearResult();
            if (!selected.size) { status('Selecione uma ou mais APs para visualizar.'); return; }
            status('Calculando a cobertura das APs selecionadas…');
            try {
                const {data,error} = await client.rpc('aerial_spray_map', {map_year:el('year').value,map_culture:el('culture').value,map_farm:state.currentFazenda,map_gleba:state.currentGleba,selected_aps:[...selected]});
                if (version !== query || scope !== generation || !active) return;
                if (error) throw error;
                if (!data) throw new Error('Resposta incompleta.');
                for (const name of ['total','applied','unapplied']) el(name).textContent = formatArea(data[name]);
                const add = (name, geojson, options) => {
                    if (geojson) layers[name] = L.geoJSON(geojson, {...options, renderer:L.canvas({padding:0.5}), onEachFeature(feature,layer) {
                        if (feature.properties?.AP) layer.bindPopup(`<strong>${escape(feature.properties.AP)}</strong>${name==='tracks' ? '<br>' + (String(feature.properties.APLICANDO)==='1' ? 'Aplicando' : 'Sem aplicação') : ''}`);
                    }});
                };
                add('boundaries',data.boundaries,{style:{color:'#e2e8f0',weight:2,fill:false}});
                add('gaps',data.gaps,{style:{color:'#f59e0b',weight:0.5,fillColor:'#f59e0b',fillOpacity:0.35}});
                add('coverage',data.coverage,{style:{color:'#22c55e',weight:0.4,fillColor:'#22c55e',fillOpacity:0.3}});
                add('tracks',data.tracks,{style:lineStyle});
                visibility();
                const bounds = L.featureGroup(Object.values(layers)).getBounds();
                if (bounds.isValid()) state.map.fitBounds(bounds,{padding:[35,35],maxZoom:17});
                status(data.missingLimits || data.missingCoverage ? 'Dados incompletos: faltam limites dos talhões ou polígonos de cobertura em uma ou mais APs. Os indicadores dependentes ficam indisponíveis.' : `${selected.size} AP(s) selecionada(s). Áreas calculadas dentro dos limites dos talhões, sem duplicar sobreposições.`);
            } catch(error) {
                if (version === query && scope === generation && active) {clearResult(); status('Não foi possível calcular a cobertura. Atualize os dados e tente novamente.');}
                root.console?.error('Pulverização aérea:',error);
            }
        }
        function init() {
            initialized = true;
            el('reload').addEventListener('click',loadCatalog);
            el('year').addEventListener('change',()=>{selected.clear(); cultures(); draw();});
            el('culture').addEventListener('change',()=>{selected.clear(); applications(); draw();});
            el('aps').addEventListener('change',event=>{
                if (event.target.type !== 'checkbox') return;
                if (event.target.checked) selected.add(event.target.value); else selected.delete(event.target.value);
                draw();
            });
            for (const action of ['all','none']) el(action).addEventListener('click',()=>{
                el('aps').querySelectorAll('input').forEach(input=>{input.checked=action==='all';});
                selected = new Set([...el('aps').querySelectorAll('input:checked')].map(input=>input.value)); draw();
            });
            for (const key of ['boundaries','gaps','coverage','tracks']) el('show-'+key).addEventListener('change',visibility);
        }
        function refresh(nextState) {
            if (!el('panel')) return;
            if (!initialized) init();
            const enabled = nextState.currentTab === 'aerea';
            el('panel').hidden = !enabled;
            if (!enabled) { if (active) {++generation; ++query; clearLayers(); context='';} active=false; state=nextState; return; }
            state = nextState; active=true;
            const key = JSON.stringify([root.portalUser?.id,state.currentFazenda,state.currentGleba]);
            if (context !== key) {context=key; loadCatalog();}
            state.map?.invalidateSize();
        }
        return {refresh};
    }
    let view;
    root.AerialSpray = {createView,lineStyle,formatArea,refresh(state) {
        if (!view) view=createView({document:root.document,L:root.L,client:root.supabaseClient});
        view.refresh(state);
    }};
    if (typeof module !== 'undefined') module.exports = {createView,lineStyle,formatArea};
})(typeof window !== 'undefined' ? window : globalThis);
