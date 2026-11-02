(function (root) {
    'use strict';
    const O = root.SprayOperations, S = root.SpraySchedule;
    const el = id => document.getElementById('spray-op-' + id);
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
    const date = value => value ? value.split('-').reverse().join('/') : '—';
    const ha = value => Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' ha';
    const names = { completed:'Realizada', scheduled:'No prazo', attention:'Atenção', overdue:'Atrasada' };
    const colors = { completed:'#169447', attention:'#f5c542', pending:'#df3838', selected:'#1673d1', empty:'#94a3b8' };
    let state, features = [], schedules = [], saved = [], fields = [], all = [], visible = [], selectedField = '', selectedRow = '',
        loadedKey = '', scope = '', request = 0, loading = false, busy = false, error = '', message = '', editing = null, order = 'planned', direction = 1;
    const filters = { farm:'', field:'', status:'', from:'', to:'', search:'', deleted:false };
    const canEdit = () => state?.userRole === 'editor' && ['admin','projetista'].includes(root.portalAccessRole);
    const repo = () => root.SprayApplications.create(root.supabaseClient);
    function prepare() {
        const built = O.build(features, Object.values(state.cloudStore?.getRecords() || {}), schedules, saved,
            { year:state.currentAno, culture:state.currentCultura });
        fields = built.fields; all = built.applications;
        visible = O.sort(O.filter(all, filters), order, direction);
    }
    function updateMap() {
        state?.geojsonLayer?.eachLayer(layer => { if (layer.feature) layer.setStyle(style(layer.feature)); });
    }
    function style(feature) {
        const p = feature.properties || {}, status = O.mapStatus(loading || error ? [] : visible, O.fieldKey(p.Fazenda,p.Campo), selectedField);
        return { color:status === 'selected' ? '#083f85' : '#283b50', weight:status === 'selected' ? 3 : .9,
            fillColor:colors[status], fillOpacity:status === 'empty' ? .18 : .7, opacity:1 };
    }
    function selectFeature(feature) {
        const p = feature.properties || {};
        selectedField = O.fieldKey(p.Fazenda,p.Campo); selectedRow = ''; render();
    }
    function popup(feature) {
        const p = feature.properties || {}, key = O.fieldKey(p.Fazenda,p.Campo);
        let apps = visible.filter(row => row.fieldKey === key && !row.deleted);
        const chosen = apps.find(row => row.key === selectedRow);
        if (chosen) apps = [chosen];
        return `<div class="spray-map-popup"><strong>${escape(p.Campo)} · ${escape(p.Fazenda)}</strong><div>Área do talhão: ${ha(p.Area)}</div>` +
            (loading || error ? '<p>Aplicações ainda não confirmadas. Consulte o aviso na tabela.</p>' : !apps.length ? '<p>Sem aplicação neste filtro.</p>' :
            apps.map(row => `<section><b>${escape(row.name)}</b><div>Produto: ${escape(row.product || 'Não informado')}</div><div>Área: ${ha(row.area)}</div><div>Prevista: ${date(row.planned)}</div><div>Realizada: ${date(row.actual)}</div><div>Responsável: ${escape(row.responsible || 'Não informado')}</div><div>Status: ${names[row.status]}</div></section>`).join('')) + '</div>';
    }
    function locate(row) {
        selectedRow = row.key; selectedField = row.fieldKey; render();
        state.geojsonLayer?.eachLayer(layer => {
            if (!layer.feature) return;
            const p = layer.feature.properties;
            if (O.fieldKey(p.Fazenda,p.Campo) !== row.fieldKey) return;
            if (layer.getBounds) state.map?.fitBounds(layer.getBounds(), { padding:[35,35], maxZoom:16 });
            layer.bindPopup?.(popup(layer.feature)).openPopup?.();
        });
    }
    function render() {
        if (!state || state.currentTab !== 'pulverizacao' || !el('table')) return;
        prepare();
        el('message').textContent = error || (loading ? 'Carregando aplicações…' : message || 'Selecione uma aplicação na tabela ou um talhão no mapa.');
        el('message').classList.toggle('is-error', !!error);
        el('add').disabled = !canEdit() || loading || busy || !!error || !fields.length;
        el('inputs').disabled = busy || !canEdit();
        el('reload').disabled = loading || busy;
        if (loading || error) { el('summary').innerHTML=''; el('counts').textContent=''; el('next').textContent=''; el('table').innerHTML=''; updateMap(); return; }
        const totals = O.summarize(visible);
        const cards = [['Programadas',totals.total],['Realizadas',totals.completed],['Pendentes',totals.pending],['Atrasadas',totals.overdue],['Área programada',ha(totals.plannedArea)],['Área aplicada',ha(totals.appliedArea)]];
        el('summary').innerHTML=cards.map(([label,value])=>`<div class="spray-kpi"><span>${label}</span><strong>${value}</strong></div>`).join('');
        el('counts').innerHTML=`<span class="spray-status scheduled">${totals.scheduled} no prazo</span> <span class="spray-status attention">${totals.attention} próximas</span> <span class="spray-status overdue">${totals.overdue} atrasadas</span> <span>${visible.length} registros neste filtro · ${totals.total?Math.round(totals.completed/totals.total*100):0}% concluído</span>`;
        const next=O.sort(visible.filter(row=>!row.deleted&&!row.actual),'planned',1)[0];
        el('next').textContent=next?`Próxima pendência: ${next.name} · ${next.farm} / ${next.field} · ${date(next.planned)}`:'Nenhuma aplicação pendente neste filtro.';
        el('permission').textContent=canEdit() ? 'Edite as aplicações do cronograma ou adicione aplicações complementares.' : 'Modo de consulta. Seu perfil não permite alterar aplicações.';
        const columns=[['farm','Fazenda'],['field','Talhão'],['culture','Cultura'],['name','Aplicação'],['product','Produto'],['dose','Dose'],['area','Área (ha)'],['planned','Programada'],['actual','Realizada'],['responsible','Responsável'],['status','Status'],['notes','Observações']];
        el('table').innerHTML=visible.length ? `<table class="spray-operations-table"><caption>Aplicações · clique nos títulos para ordenar</caption><thead><tr>`+columns.map(([key,label])=>`<th scope="col" aria-sort="${order===key ? direction===1 ? 'ascending':'descending':'none'}"><button type="button" data-spray-sort="${key}">${label}${order===key ? direction===1 ? ' ↑':' ↓':''}</button></th>`).join('')+'<th scope="col">Ações</th></tr></thead><tbody>'+visible.map(row=>`<tr class="${row.fieldKey===selectedField?'selected ':''}${row.deleted?'deleted':''}"><td>${escape(row.farm)}</td><th scope="row">${escape(row.field)}</th><td>${escape(row.culture)}</td><td>${escape(row.name)}${row.plantingId?'<small>Cronograma do plantio</small>':''}</td><td>${escape(row.product || '—')}</td><td>${row.dose==null?'—':escape(row.dose+' '+row.doseUnit)}</td><td>${ha(row.area)}</td><td>${date(row.planned)}${row.provisional?'<small>Provisória</small>':''}</td><td>${date(row.actual)}</td><td>${escape(row.responsible || '—')}</td><td><span class="spray-status ${row.status}">${row.deleted?'Excluída':names[row.status]}</span></td><td class="spray-notes">${escape(row.notes || '—')}</td><td><button type="button" data-spray-action="map" data-spray-key="${escape(row.key)}">Mapa</button>${canEdit()?`<button type="button" data-spray-action="${row.deleted?'restore':'edit'}" data-spray-key="${escape(row.key)}"${busy?' disabled':''}>${row.deleted?'Restaurar':'Editar'}</button>${row.deleted?'':`<button type="button" data-spray-action="delete" data-spray-key="${escape(row.key)}"${busy?' disabled':''}>Excluir</button>`}`:''}</td></tr>`).join('')+'</tbody></table>' : '<p class="spray-empty">Nenhuma aplicação neste filtro. Os talhões cadastrados continuam visíveis no mapa.</p>';
        const farmOptions=[...new Set(fields.map(field=>field.farm))].sort();
        el('farm').innerHTML='<option value="">Todas</option>'+farmOptions.map(value=>`<option>${escape(value)}</option>`).join(''); el('farm').value=filters.farm;
        el('field').innerHTML='<option value="">Todos</option>'+fields.filter(field=>!filters.farm||field.farm===filters.farm).map(field=>`<option value="${escape(field.key)}">${escape(field.field)} · ${escape(field.farm)}</option>`).join(''); el('field').value=filters.field;
        updateMap();
    }
    function formField() { return fields.find(field=>field.key===el('input-field').value); }
    function linkedPreview(row,field) {
        const original=schedules.find(item=>item.plantingId===row.plantingId)||{plantingId:row.plantingId,actuals:{},fourth:false};
        const schedule={...original,actuals:{...original.actuals,[row.stage]:row.actual||''},fourth:original.fourth||row.stage==='fung4'};
        S.validate(field.plantingDate,schedule.actuals,schedule.fourth);
        const metadata=saved.filter(item=>!(item.plantingId===row.plantingId&&item.stage===row.stage));
        metadata.push({...row,planned:row.autoDate?null:row.planned});
        return O.build(features,Object.values(state.cloudStore?.getRecords()||{}),
            [...schedules.filter(item=>item.plantingId!==row.plantingId),schedule],metadata,
            {year:state.currentAno,culture:state.currentCultura}).applications.filter(item=>item.plantingId===row.plantingId&&!item.deleted);
    }
    function previewForm() {
        el('preview').innerHTML='';
        if(!editing?.plantingId)return;
        const field=formField();if(!field)return;
        try{
            const row={...editing,actual:el('input-actual').value,planned:el('input-planned').value,autoDate:el('input-auto').checked};
            const apps=linkedPreview(row,field),current=apps.find(item=>item.stage===row.stage);
            if(row.autoDate&&current)el('input-planned').value=current.planned;
            el('form-error').textContent='';
            el('preview').innerHTML='<strong>Prévia do cronograma · ainda não salva</strong>'+apps.map(item=>`<span>${escape(item.name)}: ${date(item.planned)}${item.actual?' · Realizada: '+date(item.actual):''}</span>`).join('');
        }catch(failure){el('form-error').textContent=failure.message;}
    }
    function configureNew() {
        if (editing?.key) return;
        editing = {};
        const field=formField(); if(!field)return;
        const fourth=el('input-type').value==='fung4';
        if(fourth){
            if(!field.plantingId||!field.plantingDate||!field.plantedArea){el('form-error').textContent='Este talhão precisa ter plantio e data registrados.';return;}
            const prior=all.find(row=>row.plantingId===field.plantingId&&row.stage==='fung3');
            const existing=all.find(row=>row.plantingId===field.plantingId&&row.stage==='fung4');
            if(existing){el('form-error').textContent='O 4º fungicida já existe. Edite-o na tabela ou restaure-o no filtro Excluídas.';return;}
            editing={plantingId:field.plantingId,stage:'fung4',autoDate:true,scheduleVersion:schedules.find(row=>row.plantingId===field.plantingId)?.version??null,
                planned:S.addDays(prior?.actual||prior?.planned||field.plantingDate,15),name:'4º Fungicida'};
        }else editing={name:'Aplicação adicional',planned:S.today()};
        el('form-error').textContent='';el('input-name').value=editing.name;el('input-area').value=fourth?field.plantedArea:field.area;
        el('input-planned').value=editing.planned;el('input-auto').checked=!!editing.autoDate;
        el('auto-label').hidden=!fourth;el('input-name').readOnly=fourth;el('input-planned').disabled=fourth;
        previewForm();
    }
    function openForm(row) {
        if(!canEdit()||busy||loading||error)return;
        editing=row?{...row}:{};
        el('form').hidden=false;el('form-error').textContent='';
        el('form-title').textContent=row?'Editar aplicação':'Adicionar aplicação';
        el('input-field').innerHTML=fields.map(field=>`<option value="${escape(field.key)}">${escape(field.farm)} · ${escape(field.field)}</option>`).join('');
        el('input-field').value=row?.fieldKey||selectedField||fields[0]?.key||'';el('input-field').disabled=!!row;
        el('type-label').hidden=!!row;el('input-type').value='manual';
        for(const [name,value]of Object.entries({name:row?.name||'',product:row?.product||'',dose:row?.dose??'',unit:row?.doseUnit||'L/ha',area:row?.area||'',planned:row?.planned||'',actual:row?.actual||'',responsible:row?.responsible||'',notes:row?.notes||''}))el('input-'+name).value=value;
        el('input-actual').max=S.today();el('input-auto').checked=!!row?.autoDate;el('auto-label').hidden=!row?.plantingId;
        el('input-planned').disabled=!!row?.autoDate;el('input-name').readOnly=!!row?.plantingId;
        if(!row)configureNew();
        previewForm();
        el('form').scrollIntoView?.({behavior:'smooth',block:'nearest'});
    }
    async function persist(row) {
        if(!canEdit()||busy||loading||error)return;
        const field=fields.find(field=>field.farm===row.farm&&field.field===row.field);
        busy=true;message='';render();
        try { await repo().save(row,field);el('form').hidden=true;editing=null;message='Alteração salva e confirmada.';loadedKey='';await load(); }
        catch(failure){ message=failure.message;el('form-error').textContent=failure.message; }
        finally{busy=false;el('submit').disabled=false;render();}
    }
    async function load() {
        const farms=[...new Set(features.map(feature=>feature.properties.Fazenda))].sort();
        const ids=Object.values(state.cloudStore?.getRecords()||{}).filter(row=>(row.operationType==='plantio'||row.produto==='Plantio')&&row.ano===state.currentAno&&row.cultura===state.currentCultura&&farms.includes(row.fazenda)).map(row=>row.id).filter(Boolean);
        const key=JSON.stringify([farms,state.currentAno,state.currentCultura,ids]);if(key===loadedKey)return;
        loadedKey=key;const token=++request;loading=true;error='';render();
        try{const [apps,dates]=await Promise.all([repo().list(farms,state.currentAno,state.currentCultura),root.SprayRepository.create(root.supabaseClient).list(ids)]);
            if(token!==request)return;saved=apps;schedules=dates;
        }catch(failure){if(token===request)error=failure.message;}
        finally{if(token===request){loading=false;render();}}
    }
    function initialize() {
        if(el('table').dataset.initialized)return;el('table').dataset.initialized='true';
        el('add').onclick=()=>openForm(null);
        el('map-jump').onclick=()=>{document.getElementById('map-container')?.scrollIntoView?.({behavior:'smooth',block:'start'});state.map?.invalidateSize?.();};
        el('reload').onclick=()=>{if(busy)return;el('form').hidden=true;editing=null;loadedKey='';load();};
        for(const name of ['farm','field','status','from','to','search']){
            const handler=()=>{filters[name]=el(name).value;if(name==='farm')filters.field='';if(name==='status'){filters.deleted=filters.status==='deleted';if(filters.deleted)filters.status='';}render();};
            el(name)[name==='search'?'oninput':'onchange']=handler;
        }
        el('clear').onclick=()=>{for(const name of ['farm','field','status','from','to','search']){filters[name]='';el(name).value='';}filters.deleted=false;selectedField='';selectedRow='';render();};
        el('table').onclick=event=>{
            const sort=event.target.closest?.('[data-spray-sort]');if(sort){direction=order===sort.dataset.spraySort?-direction:1;order=sort.dataset.spraySort;render();return;}
            const button=event.target.closest?.('[data-spray-action]');if(!button)return;
            const row=visible.find(item=>item.key===button.dataset.sprayKey);if(!row)return;
            if(button.dataset.sprayAction==='map'){locate(row);return;}
            if(!canEdit()||busy)return;
            if(button.dataset.sprayAction==='edit')openForm(row);
            if(button.dataset.sprayAction==='restore')persist({...row,deleted:false});
            if(button.dataset.sprayAction==='delete'&&root.confirm(`Excluir ${row.name} de ${row.field}? O registro sairá do controle e poderá ser restaurado no filtro Excluídas. Realizações já registradas serão preservadas no histórico do cronograma.`))persist({...row,deleted:true});
        };
        el('cancel').onclick=()=>{if(!busy){el('form').hidden=true;editing=null;}};
        el('input-field').onchange=configureNew;el('input-type').onchange=()=>{editing={};configureNew();};
        el('input-auto').onchange=()=>{el('input-planned').disabled=el('input-auto').checked;previewForm();};
        el('input-actual').onchange=previewForm;el('input-planned').onchange=previewForm;
        el('form').onsubmit=event=>{
            event.preventDefault();if(!canEdit()||busy||loading||error)return;
            const field=formField();if(!field)return;
            const row={...editing,farm:field.farm,field:field.field,fieldKey:field.key,year:state.currentAno,culture:state.currentCultura,
                name:el('input-name').value,product:el('input-product').value,dose:el('input-dose').value,doseUnit:el('input-unit').value,
                area:el('input-area').value,planned:el('input-planned').value,actual:el('input-actual').value,
                autoDate:!!editing?.plantingId&&el('input-auto').checked,responsible:el('input-responsible').value,notes:el('input-notes').value,deleted:false};
            if(!editing?.key&&el('input-type').value==='fung4'&&!row.plantingId){el('form-error').textContent='Escolha um talhão com plantio registrado para incluir o 4º fungicida.';return;}
            try{O.validate(row,field);if(row.plantingId)linkedPreview(row,field);}catch(failure){el('form-error').textContent=failure.message;return;}
            el('submit').disabled=true;persist(row);
        };
    }
    function refresh(nextState,nextFeatures=features) {
        state=nextState;features=nextFeatures;
        if(state.currentTab!=='pulverizacao'||!el('table'))return;
        const context=JSON.stringify([state.currentAno,state.currentCultura,state.currentFazenda,state.currentGleba]);
        if(context!==scope){scope=context;selectedField='';selectedRow='';filters.farm='';filters.field='';editing=null;el('form').hidden=true;}
        if(!canEdit()){el('form').hidden=true;editing=null;}
        initialize();render();load();
    }
    let day=S.today();root.setInterval?.(()=>{if(state?.currentTab==='pulverizacao'&&day!==S.today()){day=S.today();render();}},60000);
    root.SprayControl=Object.freeze({refresh,style,popup,selectFeature});
})(typeof window !== 'undefined'?window:globalThis);
