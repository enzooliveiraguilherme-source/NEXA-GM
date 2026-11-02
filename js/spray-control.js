(function (root) {
    'use strict';
    const O = root.SprayOperations, S = root.SpraySchedule;
    const el = id => document.getElementById('spray-op-' + id);
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
    const date = value => value ? value.split('-').reverse().join('/') : '—';
    const ha = value => Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' ha';
    const names = { completed:'Realizada', scheduled:'No prazo', attention:'Atenção', overdue:'Atrasada' };
    const colors = { completed:'#169447', attention:'#f5c542', pending:'#df3838', selected:'#1673d1', empty:'#94a3b8' };
    const grid=root.SprayGrid.create(),checked=new Set();
    let mode='grid',mapApplication='all',mapRows=[];
    let state, features = [], schedules = [], saved = [], fields = [], all = [], visible = [], selectedField = '', selectedRow = '',
        loadedKey = '', scope = '', request = 0, loading = false, busy = false, error = '', message = '', editing = null, order = 'planned', direction = 1;
    const filters = { farm:'', field:'', application:'all', status:'', from:'', to:'', search:'', deleted:false };
    const canEdit = () => state?.userRole === 'editor' && ['admin','projetista'].includes(root.portalAccessRole);
    const repo = () => root.SprayApplications.create(root.supabaseClient);
    function prepare() {
        const projected=grid.project(schedules,saved);
        const built = O.build(features, Object.values(state.cloudStore?.getRecords() || {}), projected.schedules, projected.saved,
            { year:state.currentAno, culture:state.currentCultura });
        fields = built.fields; all = built.applications;
        visible = O.sort(O.filter(all, filters), order, direction);
        mapRows=O.filter(all,{...filters,application:mapApplication,deleted:false});
    }
    function updateMap() {
        state?.geojsonLayer?.eachLayer(layer => { if (layer.feature) layer.setStyle(style(layer.feature)); });
    }
    function style(feature) {
        const p = feature.properties || {}, status = O.mapStatus(loading || error ? [] : mapRows, O.fieldKey(p.Fazenda,p.Campo), selectedField);
        return { color:status === 'selected' ? '#083f85' : '#283b50', weight:status === 'selected' ? 3 : .9,
            fillColor:colors[status], fillOpacity:status === 'empty' ? .18 : .7, opacity:1 };
    }
    function selectFeature(feature) {
        const p = feature.properties || {};
        selectedField = O.fieldKey(p.Fazenda,p.Campo); selectedRow = '';
        if(!visible.some(row=>row.fieldKey===selectedField)&&all.some(row=>row.fieldKey===selectedField&&!row.deleted)){
            for(const name of ['farm','field','status','from','to','search']){filters[name]='';el(name).value='';}
            filters.application='all';filters.deleted=false;message='Filtros da tabela ajustados para localizar o talhão selecionado.';
        }
        render();scrollSelection();
    }
    function popup(feature) {
        const p = feature.properties || {}, key = O.fieldKey(p.Fazenda,p.Campo);
        let apps = mapRows.filter(row => row.fieldKey === key && !row.deleted);
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
    function scrollSelection(){
        const rows=Array.from(document.querySelectorAll?.('#spray-op-table [data-spray-field-key]')||[]);
        rows.find(row=>row.dataset.sprayFieldKey===selectedField)?.scrollIntoView?.({behavior:'smooth',block:'nearest',inline:'nearest'});
    }
    function quietSelect(row){
        selectedField=row.fieldKey;selectedRow=row.key;updateMap();
        for(const element of document.querySelectorAll?.('#spray-op-table [data-spray-field-key]')||[])element.classList.toggle('selected',element.dataset.sprayFieldKey===selectedField);
    }
    function cell(row,column){
        const value=row[column]??'',editable=canEdit()&&!busy&&!loading&&!error&&!row.deleted;
        if(!editable)return column==='planned'||column==='actual'?date(value):escape(value||'—');
        const type=['planned','actual'].includes(column)?'date':['dose','area'].includes(column)?'number':'text';
        return `<input type="${type}" data-spray-cell="${column}" data-spray-key="${escape(row.key)}" aria-label="${escape(row.field+' · '+row.name+' · '+({planned:'Data programada',actual:'Data realizada',product:'Produto',dose:'Dose',doseUnit:'Unidade da dose',area:'Área',responsible:'Responsável',notes:'Observações'}[column]||column))}" value="${escape(value)}"${type==='number'?' min="0" step="any"':''}${column==='actual'?` max="${S.today()}"`:''}${column==='notes'?' maxlength="2000"':type==='text'?` maxlength="${column==='doseUnit'?30:150}"`:''} class="${grid.has(row.key)?'spray-cell-draft':''}">`;
    }
    function selection(row){return canEdit()&&!row.deleted?`<input type="checkbox" data-spray-check="${escape(row.key)}" aria-label="Selecionar ${escape(row.field+' · '+row.name)}"${checked.has(row.key)?' checked':''}${busy?' disabled':''}>`:'';}
    function matrixTable(){
        const matrix=O.matrix(visible);
        return `<table class="spray-matrix"><caption>Grade de datas · edite várias células e depois salve o conjunto</caption><thead><tr><th scope="col"><button type="button" data-spray-sort="field">Fazenda / Talhão</button></th>${matrix.columns.map(column=>`<th scope="col">${escape(column.label)}<small>Programada / Realizada</small></th>`).join('')}</tr></thead><tbody>`+matrix.rows.map(field=>`<tr data-spray-field-key="${escape(field.key)}" class="${field.key===selectedField?'selected':''}"><th scope="row"><button type="button" data-spray-field-select="${escape(field.key)}">${escape(field.field)}<small>${escape(field.farm)}</small></button></th>`+matrix.columns.map(column=>`<td>${(field.cells.get(column.key)||[]).map(row=>`<div class="spray-matrix-entry ${row.status}${grid.has(row.key)?' has-draft':''}" data-spray-row="${escape(row.key)}">${selection(row)}<span class="spray-status ${row.status}">${row.deleted?'Excluída':names[row.status]}</span><label>Programada${cell(row,'planned')}</label><label>Realizada${cell(row,'actual')}</label>${row.provisional?'<small>Previsão provisória</small>':''}</div>`).join('')||'—'}</td>`).join('')+'</tr>').join('')+'</tbody></table>';
    }
    function listTable(){
        const columns=[['farm','Fazenda'],['field','Talhão'],['culture','Cultura'],['name','Aplicação'],['product','Produto'],['dose','Dose'],['doseUnit','Unidade'],['area','Área (ha)'],['planned','Programada'],['actual','Realizada'],['responsible','Responsável'],['status','Status'],['notes','Observações']];
        return `<table class="spray-operations-table"><caption>Lista editável · selecione células ou registros para atualizar em conjunto</caption><thead><tr><th>Selecionar</th>`+columns.map(([key,label])=>`<th scope="col" aria-sort="${order===key?direction===1?'ascending':'descending':'none'}"><button type="button" data-spray-sort="${key}">${label}${order===key?direction===1?' ↑':' ↓':''}</button></th>`).join('')+'<th scope="col">Ações</th></tr></thead><tbody>'+visible.map(row=>`<tr data-spray-field-key="${escape(row.fieldKey)}" data-spray-row="${escape(row.key)}" class="${row.fieldKey===selectedField?'selected ':''}${grid.has(row.key)?'has-draft ':''}${row.deleted?'deleted':''}"><td>${selection(row)}</td>`+columns.map(([key])=>`<td>${key==='status'?`<span class="spray-status ${row.status}">${row.deleted?'Excluída':names[row.status]}</span>`:['product','dose','doseUnit','area','planned','actual','responsible','notes'].includes(key)?cell(row,key):escape(row[key])}</td>`).join('')+`<td><button type="button" data-spray-action="map" data-spray-key="${escape(row.key)}">Mapa</button>${canEdit()?`<button type="button" data-spray-action="${row.deleted?'restore':'edit'}" data-spray-key="${escape(row.key)}"${busy||grid.size?' disabled':''}>${row.deleted?'Restaurar':'Detalhes'}</button>${row.deleted?'':`<button type="button" data-spray-action="delete" data-spray-key="${escape(row.key)}"${busy||grid.size?' disabled':''}>Excluir</button>`}`:''}</td></tr>`).join('')+'</tbody></table>';
    }
    function editCell(row,column,value){
        if(!canEdit()||busy||loading||error||row.deleted)return;
        if(!grid.has(row.key)&&grid.size>=1000){message='O limite é de 1000 aplicações por lote. Salve as alterações antes de continuar.';return;}
        const field=fields.find(field=>field.key===row.fieldKey);
        if(!field)return;
        grid.edit(row,field,schedules.find(item=>item.plantingId===row.plantingId),column,value);
        selectedField=row.fieldKey;selectedRow=row.key;message='Prévia das alterações. As aplicações ainda não foram salvas.';
    }
    function batchControls(){
        let failure='';if(grid.size)try{grid.validate();}catch(problem){failure=problem.message;}
        el('batch-message').textContent=failure||`${grid.size} aplicações com alterações não salvas · ${visible.filter(row=>checked.has(row.key)&&!row.deleted).length} selecionadas neste filtro.`+(grid.size?' Alterações fora do filtro também serão salvas.':' Edite as células ou aplique um valor aos itens selecionados.');
        el('batch-save').disabled=!canEdit()||busy||loading||!!error||!grid.size||!!failure;
        el('batch-discard').disabled=busy||!grid.size;
        el('bulk-apply').disabled=!canEdit()||busy||loading||!!error||!visible.some(row=>checked.has(row.key)&&!row.deleted);
        el('check-visible').disabled=!canEdit()||busy||loading;
        const selectable=visible.filter(row=>!row.deleted),selectedCount=selectable.filter(row=>checked.has(row.key)).length;
        el('check-visible').checked=!!selectable.length&&selectedCount===selectable.length;
        el('check-visible').indeterminate=selectedCount>0&&selectedCount<selectable.length;
        el('grid-mode').setAttribute?.('aria-pressed',String(mode==='grid'));
        el('list-mode').setAttribute?.('aria-pressed',String(mode==='list'));
    }
    function render() {
        if (!state || state.currentTab !== 'pulverizacao' || !el('table')) return;
        prepare();
        el('message').textContent = error || (loading ? 'Carregando aplicações…' : message || 'Selecione uma aplicação na tabela ou um talhão no mapa.');
        el('message').classList.toggle('is-error', !!error);
        el('add').disabled = !canEdit() || loading || busy || !!error || !fields.length || !!grid.size;
        el('inputs').disabled = busy || !canEdit();
        el('reload').disabled = loading || busy;
        batchControls();
        if (loading || error) { el('summary').innerHTML=''; el('counts').textContent=''; el('next').textContent=''; el('table').innerHTML=''; updateMap(); return; }
        const totals = O.summarize(visible);
        const cards = [['Programadas',totals.total],['Realizadas',totals.completed],['Pendentes',totals.pending],['Atrasadas',totals.overdue],['Área programada',ha(totals.plannedArea)],['Área aplicada',ha(totals.appliedArea)]];
        el('summary').innerHTML=cards.map(([label,value])=>`<div class="spray-kpi"><span>${label}</span><strong>${value}</strong></div>`).join('');
        el('counts').innerHTML=`<span class="spray-status scheduled">${totals.scheduled} no prazo</span> <span class="spray-status attention">${totals.attention} próximas</span> <span class="spray-status overdue">${totals.overdue} atrasadas</span> <span>${visible.length} registros neste filtro · ${totals.total?Math.round(totals.completed/totals.total*100):0}% concluído</span>`;
        const next=O.sort(visible.filter(row=>!row.deleted&&!row.actual),'planned',1)[0];
        el('next').textContent=next?`Próxima pendência: ${next.name} · ${next.farm} / ${next.field} · ${date(next.planned)}`:'Nenhuma aplicação pendente neste filtro.';
        el('permission').textContent=canEdit() ? 'Edite as datas na grade ou os demais campos na lista. Salve todas as alterações juntas. Limpar a data programada de uma etapa do plantio retoma o cálculo automático.' : 'Modo de consulta. Seu perfil não permite alterar aplicações.';
        el('table').innerHTML=visible.length?(mode==='grid'?matrixTable():listTable()):'<p class="spray-empty">Nenhuma aplicação neste filtro. Os talhões cadastrados continuam visíveis no mapa.</p>';
        const options=O.applicationOptions(all).map(option=>'<option value="'+escape(option.key)+'">'+escape(option.label)+'</option>').join('');
        el('application').innerHTML=options;el('application').value=filters.application;
        el('map-application').innerHTML=options;el('map-application').value=mapApplication;
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
        if(grid.size){message='Salve ou descarte as alterações da grade antes de abrir detalhes individuais.';render();return;}
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
        if(grid.size){message='Salve ou descarte as alterações da grade antes de usar ações individuais.';render();return;}
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
        el('reload').onclick=()=>{if(busy)return;if(grid.size){message='Suas alterações da grade foram mantidas. Salve ou descarte antes de recarregar.';render();return;}el('form').hidden=true;editing=null;loadedKey='';load();};
        for(const name of ['farm','field','application','status','from','to','search']){
            const handler=()=>{filters[name]=el(name).value;if(name==='farm')filters.field='';if(name==='status'){filters.deleted=filters.status==='deleted';if(filters.deleted)filters.status='';}render();};
            el(name)[name==='search'?'oninput':'onchange']=handler;
        }
        el('clear').onclick=()=>{for(const name of ['farm','field','status','from','to','search']){filters[name]='';el(name).value='';}filters.application='all';filters.deleted=false;selectedField='';selectedRow='';render();};
        el('map-application').onchange=()=>{mapApplication=el('map-application').value;selectedField='';selectedRow='';render();};
        el('grid-mode').onclick=()=>{mode='grid';render();};el('list-mode').onclick=()=>{mode='list';render();};
        el('check-visible').onchange=()=>{for(const row of visible.filter(row=>!row.deleted))if(el('check-visible').checked)checked.add(row.key);else checked.delete(row.key);render();};
        el('bulk-field').onchange=()=>{const key=el('bulk-field').value;el('bulk-value').type=['actual','planned'].includes(key)?'date':['dose','area'].includes(key)?'number':'text';el('bulk-value').value='';};
        el('bulk-apply').onclick=()=>{
            if(!canEdit()||busy||loading||error)return;
            const key=el('bulk-field').value,value=el('bulk-value').value;
            const targets=visible.filter(row=>checked.has(row.key)&&!row.deleted);
            if(new Set([...grid.rows().map(row=>row.key),...targets.map(row=>row.key)]).size>1000){message='O limite é de 1000 aplicações por lote. Reduza a seleção ou salve as alterações pendentes.';render();return;}
            for(const row of targets)editCell(row,key,value);
            render();
        };
        el('batch-discard').onclick=()=>{if(busy)return;grid.clear();message='Alterações da grade descartadas.';render();};
        el('batch-save').onclick=async()=>{
            if(!canEdit()||busy||loading||error||!grid.size)return;
            let rows;try{rows=grid.validate();}catch(failure){message=failure.message;render();return;}
            busy=true;render();
            try{await repo().saveBatch(rows,grid.fields());grid.clear();checked.clear();el('check-visible').checked=false;message=`${rows.length} aplicações salvas e confirmadas juntas.`;loadedKey='';await load();}
            catch(failure){message=failure.message;}
            finally{busy=false;render();}
        };
        el('table').onchange=event=>{
            const key=event.target.dataset?.sprayKey,column=event.target.dataset?.sprayCell;
            if(event.target.dataset?.sprayCheck){const id=event.target.dataset.sprayCheck;if(event.target.checked)checked.add(id);else checked.delete(id);batchControls();return;}
            const row=visible.find(item=>item.key===key);if(!row||!column)return;
            editCell(row,column,event.target.value);render();
        };
        el('table').onfocusin=event=>{const row=visible.find(item=>item.key===event.target.dataset?.sprayKey);if(row)quietSelect(row);};
        el('table').onkeydown=event=>{
            if(event.key!=='Tab'||!event.target.dataset?.sprayCell||!canEdit()||busy)return;
            const inputs=Array.from(el('table').querySelectorAll?.('[data-spray-cell]')||[]),index=inputs.indexOf(event.target),next=inputs[index+(event.shiftKey?-1:1)];
            if(index<0||!next)return;
            event.preventDefault();
            const row=visible.find(item=>item.key===event.target.dataset.sprayKey),column=event.target.dataset.sprayCell;
            if(row&&String(row[column]??'')!==event.target.value)editCell(row,column,event.target.value);
            const target={...next.dataset};render();
            const replacement=Array.from(el('table').querySelectorAll?.('[data-spray-cell]')||[]).find(input=>input.dataset.sprayKey===target.sprayKey&&input.dataset.sprayCell===target.sprayCell);
            replacement?.focus?.({preventScroll:true});
        };
        el('table').onclick=event=>{
            const fieldButton=event.target.closest?.('[data-spray-field-select]');if(fieldButton){const row=visible.find(item=>item.fieldKey===fieldButton.dataset.sprayFieldSelect);if(row)locate(row);return;}
            if(event.target.dataset?.sprayCell||event.target.dataset?.sprayCheck)return;
            const sort=event.target.closest?.('[data-spray-sort]');if(sort){direction=order===sort.dataset.spraySort?-direction:1;order=sort.dataset.spraySort;render();return;}
            const button=event.target.closest?.('[data-spray-action]');if(!button){const element=event.target.closest?.('[data-spray-row]');const row=visible.find(item=>item.key===element?.dataset.sprayRow);if(row)locate(row);return;}
            const row=visible.find(item=>item.key===button.dataset.sprayKey);if(!row)return;
            if(button.dataset.sprayAction==='map'){locate(row);return;}
            if(!canEdit()||busy)return;
            if(grid.size){message='Salve ou descarte as alterações da grade antes de usar ações individuais.';render();return;}
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
        if(context!==scope){scope=context;selectedField='';selectedRow='';filters.farm='';filters.field='';filters.application='all';mapApplication='all';editing=null;el('form').hidden=true;}
        if(!canEdit()){el('form').hidden=true;editing=null;}
        initialize();render();load();
    }
    let day=S.today();root.setInterval?.(()=>{if(state?.currentTab==='pulverizacao'&&day!==S.today()){day=S.today();render();}},60000);
    root.addEventListener?.('beforeunload',event=>{if(grid.size){event.preventDefault();event.returnValue='';}});
    root.SprayControl=Object.freeze({refresh,style,popup,selectFeature});
})(typeof window !== 'undefined'?window:globalThis);
