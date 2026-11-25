(function(root) {
    'use strict';
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const lineStyle = feature => ({color:String(feature.properties?.APLICANDO)==='1'?'#16a34a':'#dc2626',weight:1.6,opacity:0.9});
    const formatArea = value => value == null || !Number.isFinite(Number(value)) ? '-' : Number(value).toLocaleString('pt-BR',{maximumFractionDigits:2})+' ha';
    function baseFeatures(state, year) {
        const source=state.fieldData || state.geojsonData;
        return (source?.features || []).flatMap(feature => {
            const p=feature.properties || {};
            if (p.OperationalArchived === true || (state.currentFazenda!=='ALL' && p.Fazenda!==state.currentFazenda) ||
                (state.currentGleba!=='ALL' && p.Gleba!==state.currentGleba)) return [];
            const match=c=>c.operationType==='pulverizacao' && String(c.ano)===String(year);
            if (p.MapOnlyContexts && !p.MapOnlyContexts.some(match)) return [];
            const context=p.MapContexts?.find(match);
            if (context?.hidden) return [];
            return [{...feature,geometry:context?.geometry || feature.geometry}];
        });
    }
    function targetBounds(rows) {
        const boxes=rows.map(row=>row.bounds).filter(b=>Array.isArray(b)&&b.length===4&&b.every(Number.isFinite));
        if (!boxes.length) return null;
        return [[Math.min(...boxes.map(b=>b[1])),Math.min(...boxes.map(b=>b[0]))],
                [Math.max(...boxes.map(b=>b[3])),Math.max(...boxes.map(b=>b[2]))]];
    }
    function createView({document,L,client}) {
        const el=name=>document.getElementById('aerial-'+name);
        let state,active=false,initialized=false,context='',catalog=[],selected=new Set(),layers={},base=null,baseRef=null;
        let generation=0,query=0,controller=null,delay=null,renderer=null,baseScope='';
        const responses=new Map(), totals=new Map();
        const status=text=>{el('status').textContent=text;};
        const args=()=>({map_year:el('year').value,map_culture:el('culture').value,map_farm:state.currentFazenda,map_gleba:state.currentGleba,selected_aps:[...selected].sort()});
        const keyFor=()=>JSON.stringify([context,args()]);
        const chosenRows=()=>catalog.filter(row=>String(row.ano)===el('year').value && row.cultura===el('culture').value && selected.has(row.ap));
        function setStats(data) {for (const name of ['total','applied','unapplied']) el(name).textContent=formatArea(data?.[name]);}
        function cancel() {++query;controller?.abort();controller=null;clearTimeout(delay);}
        function clearLayers() {Object.values(layers).forEach(layer=>state?.map?.removeLayer(layer));layers={};}
        function clearBase() {if(base)state?.map?.removeLayer(base);base=null;baseRef=null;baseScope='';}
        function labels() {
            const visible=(state?.map?.getZoom?.() ?? 13)>=12;
            base?.eachLayer?.(layer=>{if(visible)layer.openTooltip?.();else layer.closeTooltip?.();});
        }
        function visibility() {
            if(base) {if(el('show-boundaries').checked)base.addTo(state.map);else state.map.removeLayer(base);}
            for(const [key,layer] of Object.entries(layers)) {
                if(el('show-'+key).checked)layer.addTo(state.map);else state.map.removeLayer(layer);
            }
        }
        function drawBase(fit=false) {
            if(!state?.map)return;
            const ref=state.fieldData || state.geojsonData,scope=JSON.stringify([state.currentFazenda,state.currentGleba,el('year').value||state.currentAno]);
            if(base && baseRef===ref && baseScope===scope){visibility();if(fit&&!selected.size){const bounds=base.getBounds?.();if(bounds?.isValid())state.map.fitBounds(bounds,{padding:[30,30],maxZoom:15});}return;}
            clearBase();baseRef=ref;baseScope=scope;
            const features=baseFeatures(state,el('year').value||state.currentAno);
            if(!features.length)return;
            if(!renderer)renderer=L.canvas({padding:0.3});
            base=L.geoJSON({type:'FeatureCollection',features},{
                renderer,style:{color:'#f8fafc',weight:1.4,opacity:0.95,fill:false},
                onEachFeature(feature,layer) {
                    const p=feature.properties||{};
                    layer.bindTooltip?.(escape(p.Campo||''),{permanent:true,direction:'center',className:'aerial-field-label'});
                    layer.bindPopup?.('<strong>'+escape(p.Campo)+'</strong><br>Fazenda '+escape(p.Fazenda));
                }
            });
            visibility();labels();
            if(fit&&!selected.size){const bounds=base.getBounds?.();if(bounds?.isValid())state.map.fitBounds(bounds,{padding:[30,30],maxZoom:15});}
        }
        function focus() {
            const bounds=targetBounds(chosenRows());
            if(bounds)state.map.fitBounds(bounds,{padding:[40,40],maxZoom:16});
            else {
                const target=layers.boundaries?.getBounds?.();
                if(target?.isValid())state.map.fitBounds(target,{padding:[40,40],maxZoom:16});
            }
        }
        async function request(name,params,signal) {
            let call=client.rpc(name,params);
            if(signal && typeof call.abortSignal==='function')call=call.abortSignal(signal);
            return await call;
        }
        function remember(cache,key,data) {
            cache.delete(key);cache.set(key,data);
            if(cache.size>12)cache.delete(cache.keys().next().value);
        }
        function options(name,values,preferred) {
            const previous=preferred??el(name).value;el(name).replaceChildren();
            for(const value of values){const option=document.createElement('option');option.value=value;option.textContent=value;el(name).append(option);}
            if(values.includes(previous))el(name).value=previous;el(name).disabled=!values.length;
        }
        function applications() {
            const rows=catalog.filter(row=>String(row.ano)===el('year').value&&row.cultura===el('culture').value);
            const aps=[...new Set(rows.map(row=>row.ap))].sort((a,b)=>a.localeCompare(b,'pt-BR',{numeric:true}));
            selected=new Set([...selected].filter(ap=>aps.includes(ap)));
            el('aps').innerHTML=aps.map(ap=>{
                const fields=[...new Set(rows.filter(row=>row.ap===ap).flatMap(row=>row.fields||[]))];
                return '<label><input type="checkbox" value="'+escape(ap)+'"'+(selected.has(ap)?' checked':'')+'><span>'+escape(ap)+(fields.length?'<small>'+escape(fields.join(' · '))+'</small>':'')+'</span></label>';
            }).join('')||'<p>Nenhuma AP neste ano e cultura.</p>';
            el('all').disabled=!aps.length;el('none').disabled=!aps.length;
            if(el('focus'))el('focus').disabled=!selected.size;
        }
        function cultures() {options('culture',[...new Set(catalog.filter(row=>String(row.ano)===el('year').value).map(row=>row.cultura))].sort(),state.currentCultura);applications();}
        async function loadCatalog(force=false) {
            cancel();const version=++generation;clearLayers();selected.clear();setStats();catalog=[];
            if(force){responses.clear();totals.clear();}
            options('year',[]);options('culture',[]);applications();drawBase();
            status('Carregando lista de APs…');el('reload').disabled=true;
            try {
                const {data,error}=await request('aerial_spray_catalog',{map_farm:state.currentFazenda,map_gleba:state.currentGleba});
                if(version!==generation||!active)return;
                if(error)throw error;
                catalog=(data||[]).map(row=>({...row,ano:String(row.ano)}));
                options('year',[...new Set(catalog.map(row=>row.ano))].sort().reverse(),state.currentAno);cultures();drawBase(true);
                status(catalog.length?'Selecione uma ou mais APs. Os talhões de base já estão no mapa.':'Nenhuma AP disponível nesta fazenda e safra.');
            }catch(error){if(version===generation&&active)status('Não foi possível carregar a lista. Clique em Atualizar.');root.console?.error('APs:',error);}
            finally {if(version===generation)el('reload').disabled=false;}
        }
        function applyMap(data) {
            clearLayers();
            if(!renderer)renderer=L.canvas({padding:0.3});
            const add=(name,geojson,style)=>{
                if(!geojson)return;
                layers[name]=L.geoJSON(geojson,{renderer,style,onEachFeature(feature,layer) {
                    const p=feature.properties||{};
                    if(p.AP)layer.bindPopup?.('<strong>'+escape(p.AP)+'</strong>'+(name==='tracks'?'<br>'+(String(p.APLICANDO)==='1'?'Aplicando':'Sem aplicação'):''));
                }});
            };
            add('boundaries',data.boundaries,{color:'#facc15',weight:2.5,opacity:1,fill:false});
            add('coverage',data.coverage,{color:'#22c55e',weight:0.5,fillColor:'#22c55e',fillOpacity:0.28});
            add('tracks',data.tracks,lineStyle);
            add('gaps',data.gaps,{color:'#f59e0b',weight:0.4,fillColor:'#f59e0b',fillOpacity:0.3});
            el('show-gaps').disabled=!data.gaps;
            visibility();labels();
        }
        async function updateTotals(params,key,version,scope,signal) {
            if(totals.has(key)){setStats(totals.get(key));return;}
            try {
                const {data,error}=await request('aerial_spray_totals',params,signal);
                if(version!==query||scope!==generation||!active||signal.aborted)return;
                if(error)throw error;
                remember(totals,key,data);setStats(data);
            }catch(error){if(version===query&&scope===generation&&active&&!signal.aborted)setStats();}
        }
        async function draw() {
            cancel();const version=query,scope=generation;
            if(el('focus'))el('focus').disabled=!selected.size;
            drawBase();
            if(!selected.size){clearLayers();setStats();status('Selecione uma ou mais APs.');return;}
            const rows=chosenRows(),params=args(),key=keyFor();
            if(rows.length===1)setStats(rows[0]);else if(totals.has(key))setStats(totals.get(key));else setStats();
            focus();
            status('Carregando camadas da seleção…');
            controller=new AbortController();const signal=controller.signal;
            try {
                let data=responses.get(key);
                if(!data){
                    const response=await request('aerial_spray_layers',params,signal);if(response.error)throw response.error;
                    const records=response.data||[],fc=features=>({type:'FeatureCollection',features});
                    if(!records.length)throw Error('Nenhuma camada preparada para esta seleção.');
                    data={prepared:true,boundaries:fc(records.map(r=>r.boundary)),coverage:fc(records.map(r=>r.coverage)),tracks:fc(records.flatMap(r=>r.tracks||[])),gaps:null,needsTotals:records.length>1};
                    if(records.length===1){data.total=records[0].total;data.applied=records[0].applied;data.unapplied=Math.max(0,data.total-data.applied);}
                }
                if(version!==query||scope!==generation||!active||signal.aborted)return;
                if(!data)throw Error('Mapa indisponível.');
                remember(responses,key,data);applyMap(data);
                // Camera uses ONLY the target talhões, never the aircraft's transit circuit.
                if(!targetBounds(rows)){const bounds=layers.boundaries?.getBounds?.();if(bounds?.isValid())state.map.fitBounds(bounds,{padding:[40,40],maxZoom:16});}
                if(data.total!=null){setStats(data);remember(totals,key,data);}
                status(selected.size+' AP(s) no mapa. Talhões de base em branco; seleção em amarelo.');
                // Consolidated statistics are independent; they never hold up graphics or navigation.
                if(data.needsTotals && !totals.has(key)) {
                    const run=()=>{if(version===query&&scope===generation&&active&&!signal.aborted)updateTotals(params,key,version,scope,signal);};
                    if(root.requestAnimationFrame)root.requestAnimationFrame(()=>root.setTimeout(run,0));else root.setTimeout(run,0);
                }
            }catch(error) {
                if(version===query&&scope===generation&&active&&!signal.aborted)status('Não foi possível carregar a seleção. Os talhões de base continuam disponíveis.');
                if(!signal.aborted)root.console?.error('Mapa aéreo:',error);
            }
        }
        function schedule() {cancel();if(el('focus'))el('focus').disabled=!selected.size;focus();delay=root.setTimeout(draw,120);}
        function init() {
            initialized=true;
            el('reload').addEventListener('click',()=>loadCatalog(true));
            el('focus')?.addEventListener('click',focus);
            el('year').addEventListener('change',()=>{selected.clear();cultures();clearLayers();drawBase(true);draw();});
            el('culture').addEventListener('change',()=>{selected.clear();applications();clearLayers();drawBase(true);draw();});
            el('aps').addEventListener('change',event=>{
                if(event.target.type!=='checkbox')return;
                if(event.target.checked)selected.add(event.target.value);else selected.delete(event.target.value);schedule();
            });
            for(const action of ['all','none'])el(action).addEventListener('click',()=>{
                el('aps').querySelectorAll('input').forEach(input=>{input.checked=action==='all';});
                selected=new Set([...el('aps').querySelectorAll('input:checked')].map(input=>input.value));draw();
            });
            for(const name of ['boundaries','gaps','coverage','tracks'])el('show-'+name).addEventListener('change',visibility);
        }
        function refresh(nextState) {
            if(!el('panel'))return;if(!initialized)init();
            const enabled=nextState.currentTab==='aerea';el('panel').hidden=!enabled;
            if(!enabled){if(active){cancel();++generation;clearLayers();clearBase();state.map?.off?.('zoomend',labels);}active=false;state=nextState;return;}
            const wasActive=active;state=nextState;active=true;
            const key=JSON.stringify([root.portalUser?.id,state.currentFazenda,state.currentGleba]);
            if(!wasActive)state.map?.on?.('zoomend',labels);
            drawBase(!wasActive);state.map?.invalidateSize();
            if(context!==key||!catalog.length){context=key;loadCatalog();}
            else if(!wasActive&&selected.size)draw();
        }
        return {refresh};
    }
    let view;
    root.AerialSpray={createView,lineStyle,formatArea,baseFeatures,targetBounds,refresh(state){
        if(!view)view=createView({document:root.document,L:root.L,client:root.supabaseClient});view.refresh(state);
    }};
    if(typeof module!=='undefined')module.exports={createView,lineStyle,formatArea,baseFeatures,targetBounds};
})(typeof window!=='undefined'?window:globalThis);
