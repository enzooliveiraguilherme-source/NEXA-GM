(function (root) {
    'use strict';
    let request = 0, controller;
    const cache = new Map();
    const format = value => value == null ? 'Dados não importados' : Number(value).toLocaleString('pt-BR', {maximumFractionDigits:1});
    const text = (id,value) => { const el=document.getElementById(id); if(el) el.textContent=value; };
    function color(v) { return v==null?'#94a3b8':v<120?'#d73027':v<130?'#fc8d59':v<140?'#fee08b':v<160?'#d9ef8b':v<=180?'#91cf60':'#1a9850'; }
    function clear(state) {
        request++; controller?.abort();
        if(state.harvestDetailLayer) state.map.removeLayer(state.harvestDetailLayer);
        state.harvestDetailLayer=null; state.harvestSelected=null;
        text('harvest-selection-title','Explore a produtividade');
        text('harvest-selection-hint','Veja todos os talhões juntos ou selecione um para explorar os detalhes.');
        document.getElementById('harvest-field-metrics')?.classList.add('hidden');
        document.getElementById('harvest-back')?.classList.add('hidden');
        const select=document.getElementById('harvest-field-select'); if(select) select.value='';
        state.geojsonLayer?.setStyle(root.getFeatureStyle);
    }
    async function draw(state,records,token) {
        controller=new AbortController();
        const signal=controller.signal, bounds=state.harvestSummary.bounds;
        const fields=new Set(records.map(r=>r.campo)),features=state.harvestData.features.filter(f=>fields.has(f.properties.Campo));
        const group=L.layerGroup().addTo(state.map);state.harvestDetailLayer=group;
        const overview=()=>text('harvest-selection-hint','Visualização em pirâmides · '+records.reduce((n,r)=>n+r.points,0).toLocaleString('pt-BR')+' pontos preservados na base. Datas: Dados não importados.');
        try {const pyramid=await root.HarvestPyramid.create(records,features);if(token!==request)return;pyramid.addTo(group);overview();}
        catch(error){if(token===request)text('harvest-selection-hint','Não foi possível carregar a visualização. Selecione novamente para tentar.');return;}
        let started=false;
        const detail=async()=>{
        if(token!==request||state.currentTab!=='colheita')return;
        if(state.map.getZoom()<18){overview();return;}
        if(started)return;started=true;
        const layer=root.HarvestPoints.create([(bounds[0]+bounds[2])/2,(bounds[1]+bounds[3])/2],features).addTo(group);
        let loaded=0;
        try {
            for(const name of records.flatMap(r=>r.chunks)) {
                if(token!==request) return;
                const key=(state.harvestDataset.version||'site')+':'+name;
                let chunk=cache.get(key);
                if(!chunk) { chunk=await root.HarvestStore.loadChunk(state.harvestDataset,name,signal); cache.set(key,chunk); }
                if(token!==request||state.currentTab!=='colheita') return;
                layer.addPoints(chunk.values,chunk.stride); loaded+=chunk.count;
                if(state.map.getZoom()>=18)text('harvest-selection-hint','Carregando detalhe original: '+loaded.toLocaleString('pt-BR')+'…');
            }
            if(state.map.getZoom()>=18)text('harvest-selection-hint',loaded.toLocaleString('pt-BR')+' pontos originais · furos e limites respeitados. Datas: Dados não importados.');
        } catch(error) {
            if(token===request) {
                group.removeLayer(layer);started=false;
                text('harvest-selection-hint','Não foi possível carregar todos os pontos. Selecione novamente para tentar.');
                console.error('Carregamento da produtividade:',error);
            }
        }
        };
        state.map.on('zoomend',detail);group.once('remove',()=>state.map.off('zoomend',detail));await detail();
    }
    async function select(state,feature) {
        clear(state); const token=request, campo=feature.properties.Campo;
        state.harvestSelected=campo;
        const record=state.harvestSummary.records.find(r=>r.campo===campo);
        text('harvest-selection-title',campo);
        const selectEl=document.getElementById('harvest-field-select'); if(selectEl) selectEl.value=campo;
        document.getElementById('harvest-back')?.classList.remove('hidden');
        const features=state.harvestData.features.filter(f=>f.properties.Campo===campo);
        state.map.stop(); state.map.fitBounds(L.geoJSON({type:'FeatureCollection',features}).getBounds(),{padding:[45,45],animate:false});
        state.geojsonLayer?.setStyle(root.getFeatureStyle);
        if(!record) { text('harvest-selection-hint','Dados não importados para este talhão.'); return; }
        document.getElementById('harvest-field-metrics')?.classList.remove('hidden');
        text('harvest-mean',format(record.mean)); text('harvest-min',format(record.min)); text('harvest-max',format(record.max));
        await draw(state,[record],token);
    }
    async function showAll(state) {
        if(!state.harvestSummary||state.currentTab!=='colheita') return;
        clear(state); const token=request;
        const features=state.harvestData.features.filter(root.featureMatchesFilters);
        const allowed=new Set(features.map(f=>f.properties.Campo));
        const records=state.harvestSummary.records.filter(r=>allowed.has(r.campo));
        text('harvest-selection-title','Todos os talhões');
        if(!records.length) return;
        state.map.stop(); state.map.fitBounds(L.geoJSON({type:'FeatureCollection',features}).getBounds(),{padding:[45,45],animate:false});
        await draw(state,records,token);
    }
    function init(state) {
        const selectEl=document.getElementById('harvest-field-select');
        if(selectEl) {
            selectEl.innerHTML='<option value="">Todos os talhões</option>';
            const fields=[...new Set(state.harvestData.features.map(f=>f.properties.Campo))].sort((a,b)=>a.localeCompare(b,'pt-BR',{numeric:true}));
            fields.forEach(campo=>{const opt=document.createElement('option'); opt.value=campo; opt.textContent=campo; selectEl.appendChild(opt);});
            selectEl.onchange=()=>{const f=state.harvestData.features.find(f=>f.properties.Campo===selectEl.value); if(f) select(state,f); else showAll(state);};
        }
        document.getElementById('harvest-back').onclick=()=>showAll(state);
        document.getElementById('harvest-all').onclick=()=>showAll(state);
        const upload=document.getElementById('harvest-cloud-upload');
        upload.classList.toggle('hidden',root.portalAccessRole!=='admin');
        upload.onclick=async()=>{
            upload.disabled=true;
            try {
                await root.HarvestStore.publish((done,total)=>text('harvest-cloud-status','Enviando '+done+' de '+total+' blocos…'));
                text('harvest-cloud-status','Pontos originais salvos no Supabase.');
                cache.clear(); clear(state); await root.loadHarvestTest(); root.renderMap(true);
            } catch(error) {text('harvest-cloud-status',error.message);}
            finally {upload.disabled=false;}
        };
        text('harvest-import-status',state.harvestSummary.records.length+' talhões · Milho 2026'); clear(state);
    }
    root.HarvestView=Object.freeze({init,select,showAll,clear,color});
})(window);
