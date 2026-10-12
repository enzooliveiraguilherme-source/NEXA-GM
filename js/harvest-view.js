(function (root) {
    'use strict';
    let request = 0, controller;
    const cache = new Map();
    const fieldKey = feature => JSON.stringify([feature.properties.Fazenda,feature.properties.Campo]);
    const recordKey = record => JSON.stringify([record.fazenda,record.campo]);
    const format = value => value == null ? 'Dados não importados' : Number(value).toLocaleString('pt-BR', {maximumFractionDigits:1});
    const text = (id,value) => { const el=document.getElementById(id); if(el) el.textContent=value; };
    function color(v) { return root.HarvestStyle?root.HarvestStyle.color(v):v==null?'#94a3b8':v<120?'#d73027':v<130?'#fc8d59':v<140?'#fee08b':v<160?'#d9ef8b':v<=180?'#91cf60':'#1a9850'; }
    function clear(state) {
        root.HarvestLegend?.show(state.currentTab==='colheita');
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
        const fields=new Set(records.map(recordKey)),features=state.harvestData.features.filter(f=>fields.has(fieldKey(f)));
        const group=L.layerGroup().addTo(state.map);state.harvestDetailLayer=group;
        const overview=()=>text('harvest-selection-hint','Datas: Dados não importados.');
        try {
            const datasets=new Map();
            for(const record of records){const dataset=record.dataset||state.harvestDataset;if(!datasets.has(dataset.version))datasets.set(dataset.version,{dataset,records:[]});datasets.get(dataset.version).records.push(record);}
            const pyramids=await Promise.all([...datasets.values()].map(({dataset,records})=>root.HarvestPyramid.create(records,features.filter(f=>!dataset.farm||f.properties.Fazenda===dataset.farm),dataset)));
            if(token!==request)return;
            for(const pyramid of pyramids)pyramid.addTo(group);
            overview();
        }
        catch(error){if(token===request)text('harvest-selection-hint','Não foi possível carregar a visualização. Selecione novamente para tentar.');return;}
        const details=new Map();let active=true;
        const loadDetail=async(record,item,matching)=>{
            const dataset=record.dataset||state.harvestDataset;
            const layer=root.HarvestPoints.create([(bounds[0]+bounds[2])/2,(bounds[1]+bounds[3])/2],matching).addTo(group);
            item.layer=layer;
            try{
                for(const name of record.chunks){
                    if(!active||token!==request||item.controller.signal.aborted)return;
                    const key=dataset.version+':'+name;let chunk=cache.get(key);
                    if(!chunk){chunk=await root.HarvestStore.loadChunk(dataset,name,item.controller.signal);cache.set(key,chunk);while(cache.size>8)cache.delete(cache.keys().next().value);}
                    if(!active||token!==request||item.controller.signal.aborted)return;
                    layer.addPoints(chunk.values,chunk.stride);
                }
                item.complete=true;
                if([...details.values()].every(item=>item.complete))overview();
            }catch(error){
                if(active&&token===request&&!item.controller.signal.aborted){
                    group.removeLayer(layer);details.delete(recordKey(record));
                    text('harvest-selection-hint','Não foi possível carregar todos os pontos. Selecione novamente para tentar.');
                    console.error('Carregamento da produtividade:',error);
                }
            }
        };
        const detail=()=>{
            if(!active||token!==request||state.currentTab!=='colheita')return;
            const desired=new Map();
            if(state.map.getZoom()>=16)for(const record of records){
                const matching=features.filter(feature=>fieldKey(feature)===recordKey(record));
                const extent=L.geoJSON({type:'FeatureCollection',features:matching}).getBounds();
                if(!state.map.getBounds||extent.intersects(state.map.getBounds()))desired.set(recordKey(record),{record,matching});
            }
            for(const [key,item] of details)if(!desired.has(key)){item.controller.abort();if(item.layer)group.removeLayer(item.layer);details.delete(key);}
            for(const [key,{record,matching}] of desired)if(!details.has(key)){
                const item={controller:new AbortController(),complete:false};details.set(key,item);loadDetail(record,item,matching);
            }
            if([...details.values()].some(item=>!item.complete))text('harvest-selection-hint','Carregando detalhe da produtividade…');else overview();
        };
        state.map.on('zoomend moveend',detail);
        group.once('remove',()=>{active=false;for(const item of details.values())item.controller.abort();details.clear();state.map.off('zoomend moveend',detail);});
        detail();
    }
    async function select(state,feature) {
        clear(state); const token=request, campo=feature.properties.Campo;
        state.harvestSelected=fieldKey(feature);
        const record=state.harvestSummary.records.find(r=>recordKey(r)===fieldKey(feature));
        text('harvest-selection-title',campo);
        const selectEl=document.getElementById('harvest-field-select'); if(selectEl) selectEl.value=fieldKey(feature);
        document.getElementById('harvest-back')?.classList.remove('hidden');
        const features=state.harvestData.features.filter(f=>fieldKey(f)===fieldKey(feature));
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
        const allowed=new Set(features.map(fieldKey));
        const records=state.harvestSummary.records.filter(r=>allowed.has(recordKey(r)));
        text('harvest-selection-title','Todos os talhões');
        if(!records.length) return;
        state.map.stop(); state.map.fitBounds(L.geoJSON({type:'FeatureCollection',features}).getBounds(),{padding:[45,45],animate:false});
        await draw(state,records,token);
    }
    function init(state) {
        root.HarvestLegend.init(state.map);root.HarvestLegend.show(state.currentTab==='colheita');
        const selectEl=document.getElementById('harvest-field-select');
        if(selectEl) {
            selectEl.innerHTML='<option value="">Todos os talhões</option>';
            const fields=[...new Map(state.harvestData.features.map(f=>[fieldKey(f),f])).values()].sort((a,b)=>a.properties.Campo.localeCompare(b.properties.Campo,'pt-BR',{numeric:true}));
            fields.forEach(feature=>{const opt=document.createElement('option'); opt.value=fieldKey(feature); opt.textContent=feature.properties.Campo; selectEl.appendChild(opt);});
            selectEl.onchange=()=>{const f=state.harvestData.features.find(f=>fieldKey(f)===selectEl.value); if(f) select(state,f); else showAll(state);};
        }
        document.getElementById('harvest-back').onclick=()=>showAll(state);
        document.getElementById('harvest-all').onclick=()=>showAll(state);
        const upload=document.getElementById('harvest-cloud-upload');
        // Esta base já está no banco. Os arquivos públicos anteriores foram retirados do acesso direto.
        upload.classList.add('hidden');
        upload.onclick=async()=>{
            upload.disabled=true;
            try {
                await root.HarvestStore.publish((done,total)=>text('harvest-cloud-status','Enviando '+done+' de '+total+' blocos…'));
                text('harvest-cloud-status','Pontos originais salvos no Supabase.');
                cache.clear(); clear(state); await root.loadHarvestTest(); root.renderMap(true);
            } catch(error) {text('harvest-cloud-status',error.message);}
            finally {upload.disabled=false;}
        };
        const legacyDataset=state.harvestDataset.datasets?.find(dataset=>dataset.source==='supabase')||state.harvestDataset;
        if(legacyDataset.source==='supabase'&&root.portalAccessRole==='admin'&&!document.getElementById('harvest-restore-rasters')){
            const restore=document.createElement('button');restore.type='button';restore.id='harvest-restore-rasters';restore.className='harvest-sync';restore.textContent='Restaurar visualização da colheita';
            const files=document.createElement('input');files.type='file';files.multiple=true;files.accept='.json';files.hidden=true;
            restore.onclick=()=>files.click();
            files.onchange=async()=>{
                const selected=Array.from(files.files);if(!selected.length)return;
                restore.disabled=true;let done=0;
                try{
                    for(let at=0;at<selected.length;at+=4){
                        await Promise.all(selected.slice(at,at+4).map(async file=>{
                            if(!/^(index\.json|fe-[\d.]+-[0-5]\.json)$/.test(file.name))throw Error('Arquivo de visualização inválido.');
                            const contents=JSON.parse(await file.text());
                            if(file.name==='index.json'?!Array.isArray(contents.records):contents.format!=='harvest-values-f64-v1')throw Error('Formato de visualização inválido.');
                            const {error}=await root.supabaseClient.from('harvest_raster_files').upsert({version_id:legacyDataset.version,path:file.name,contents},{onConflict:'version_id,path',ignoreDuplicates:true});
                            if(error)throw error;
                            text('harvest-cloud-status',`Restaurando visualização: ${++done} de ${selected.length}.`);
                        }));
                    }
                    text('harvest-cloud-status','Visualização restaurada no banco.');restore.hidden=true;
                    showAll(state);
                }catch(error){text('harvest-cloud-status','Não foi possível restaurar todos os arquivos. Tente novamente.');console.error('Restauração da colheita:',error);}
                finally{restore.disabled=false;files.value='';}
            };
            document.getElementById('harvest-import-section').append(restore,files);
            restore.hidden=true;
            root.supabaseClient.from('harvest_raster_files').select('path',{count:'exact',head:true}).eq('version_id',legacyDataset.version)
                .then(({count,error})=>{restore.hidden=!error&&count===127;})
                .catch(()=>{restore.hidden=false;});
        }
        text('harvest-import-status',state.harvestSummary.records.length+' talhões · Milho 2026'); clear(state);
    }
    root.HarvestView=Object.freeze({init,select,showAll,clear,color,fieldKey});
})(window);
