(function (root) {
    'use strict';
    const O = root.SprayOperations, S = root.SpraySchedule;
    const el = id => document.getElementById('spray-op-' + id);
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
    const date = value => value ? value.split('-').reverse().join('/') : '—';
    const ha = value => Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' ha';
    const names = { completed:'Realizada', scheduled:'No prazo', attention:'Atenção', overdue:'Atrasada', optional:'Opcional', unplanned:'Sem data' };
    const tableNames = {completed:'Concluída', in_progress:'Em execução', planned:'Planejada', overdue:'Atrasada', unplanned:'Sem planejamento'};
    const colors = { completed:'#1673d1', scheduled:'#169447', attention:'#f5c542', pending:'#df3838', empty:'#94a3b8' };
    const phone=root.matchMedia?.('(max-width: 820px)');
    const onPhone=()=>!!phone?.matches;
    const grid=root.SprayGrid.create(),checked=new Set();
    let mode='grid',mapApplication='all',mapRows=[],mapDashboardCollapsed=false;
    let autoError='',focusAfterSave=null,quick=null,showFieldInfo=false,overviewExpanded=false,overviewRows=[];
    let state, features = [], schedules = [], saved = [], fields = [], all = [], visible = [], selectedField = '', selectedRow = '',
        loadedKey = '', scope = '', request = 0, loading = false, busy = false, error = '', message = '', editing = null, order = 'planned', direction = 1;
    const filters = { farm:'', field:'', application:'all', status:'', from:'', to:'', search:'', deleted:false, table:true };
    const canEdit = () => state?.userRole === 'editor' && ['admin','projetista'].includes(root.portalAccessRole);
    const repo = () => root.SprayApplications.create(root.supabaseClient);
    function prepare() {
        const projected=grid.project(schedules,saved);
        const built = O.build(features, Object.values(state.cloudStore?.getRecords() || {}), projected.schedules, projected.saved,
            { year:state.currentAno, culture:state.currentCultura });
        fields = built.fields; all = built.applications;
        visible = O.sort(O.filter(all, filters), order, direction);
        const confirmed=grid.size?O.build(features,Object.values(state.cloudStore?.getRecords()||{}),schedules,saved,{year:state.currentAno,culture:state.currentCultura}).applications:all;
        overviewRows=O.filter(confirmed,filters);
        mapRows=O.filter(confirmed,{application:mapApplication,deleted:false});
    }
    function updateMap() {
        state?.geojsonLayer?.eachLayer(layer => { if (layer.feature) layer.setStyle(style(layer.feature)); });
    }
    function style(feature) {
        const p = feature.properties || {}, status = O.mapStatus(loading || error ? [] : mapRows, O.fieldKey(p.Fazenda,p.Campo));
        return { color:'#283b50', weight:.9,
            fillColor:colors[status], fillOpacity:status === 'empty' ? .18 : .95, opacity:1 };
    }
    function selectFeature(feature) {
        const p = feature.properties || {};
        selectedField = O.fieldKey(p.Fazenda,p.Campo); selectedRow = '';
        if(!visible.some(row=>row.fieldKey===selectedField)&&all.some(row=>row.fieldKey===selectedField&&!row.deleted)){
            for(const name of ['farm','field','status','from','to','search']){filters[name]='';el(name).value='';}
            filters.application='all';filters.deleted=false;message='Filtros da tabela ajustados para localizar o talhão selecionado.';
        }
        render();if(state.currentSubTab!=='mapa-pulverizacao')scrollSelection();
    }
    function popup(feature) {
        const p = feature.properties || {}, key = O.fieldKey(p.Fazenda,p.Campo);
        let apps = mapRows.filter(row => row.fieldKey === key && !row.deleted && !row.optional && !row.unplanned);
        const chosen = apps.find(row => row.key === selectedRow);
        if (chosen) apps = [chosen];
        return `<div class="spray-map-popup"><strong>${escape(p.Campo)} · ${escape(p.Fazenda)}</strong><div>Área do talhão: ${ha(p.Area)}</div>` +
            (loading || error ? '<p>Aplicações ainda não confirmadas. Consulte o aviso na tabela.</p>' : !apps.length ? '<p>Sem aplicação neste filtro.</p>' :
            apps.map(row => `<section><b>${escape(row.name)}</b><div>Produto: ${escape(row.product || 'Não informado')}</div><div>Área: ${ha(row.area)}</div><div>Prevista: ${date(row.planned)}</div><div>Realizada: ${row.completedWithoutDate&&!row.actual?'Aplicada · data não informada':date(row.actual)}</div><div>Responsável: ${escape(row.responsible || 'Não informado')}</div><div>Status: ${names[row.status]}</div></section>`).join('')) + '</div>';
    }
    function locate(row) {
        selectedRow = row.key; selectedField = row.fieldKey; render();
        root.dispatchEvent?.(new root.CustomEvent('geoportal:spray-view',{detail:{view:'mapa-pulverizacao'}}));
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
    }
    function cell(row,column){
        const value=row.optional&&column==='planned'?'':row[column]??'',editable=canEdit()&&!busy&&!loading&&!error&&!row.deleted;
        const completedLabel=column==='actual'&&row.completedWithoutDate&&!row.actual?'<small>Aplicada · sem data</small>':'';
        if(!editable)return completedLabel||(['planned','actual','started'].includes(column)?date(value):escape(value||'—'));
        const type=['planned','actual','started'].includes(column)?'date':['dose','area'].includes(column)?'number':'text';
        return `${completedLabel}<input type="${type}" data-spray-cell="${column}" data-spray-key="${escape(row.key)}" aria-label="${escape(row.field+' · '+row.name+' · '+({planned:'Data programada',actual:'Data realizada',started:'Início da execução',product:'Produto',dose:'Dose',doseUnit:'Unidade da dose',area:'Área',responsible:'Responsável',notes:'Observações'}[column]||column))}" value="${escape(value)}"${type==='number'?' min="0" step="any"':''}${['actual','started'].includes(column)?` max="${S.today()}"`:''}${column==='notes'?' maxlength="2000"':type==='text'?` maxlength="${column==='doseUnit'?30:150}"`:''} class="${grid.has(row.key)?'spray-cell-draft':''}">`;
    }
    function selection(row){return canEdit()&&!row.deleted?`<input type="checkbox" data-spray-check="${escape(row.key)}" aria-label="Selecionar ${escape(row.field+' · '+row.name)}"${checked.has(row.key)?' checked':''}${busy?' disabled':''}>`:'';}
    function quickEditor(row) {
        const choices=[['completed','Verde · Concluída'],['planned','Azul · Planejada'],['in_progress','Amarelo · Em execução'],['overdue','Vermelho · Atrasada'],['unplanned','Branco · Sem planejamento']];
        const labels={completed:'Data realizada',planned:'Data planejada',in_progress:'Data de início',overdue:'Data prevista vencida',unplanned:'Previsão calculada'};
        const disabled=busy||loading||!canEdit(),limit=['completed','in_progress','overdue'].includes(quick.status)?` max="${quick.status==='overdue'?S.addDays(S.today(),-1):S.today()}"`:'';
        return `<div class="spray-quick-editor ${quick.status}" role="group" aria-label="Editar ${escape(row.field+' · '+row.name)}"><strong>${escape(row.field)} · ${escape(row.name)}</strong><label>Legenda / cor<select id="spray-op-quick-status" data-spray-quick="status"${disabled?' disabled':''}>${choices.filter(([key])=>key!=='unplanned'||row.plantingId||O.isIndependent(row.stage)).map(([key,label])=>`<option value="${key}"${quick.status===key?' selected':''}>${label}</option>`).join('')}</select></label><label>${labels[quick.status]}<input id="spray-op-quick-date" type="date" data-spray-quick="date" value="${escape(quick.date)}"${limit}${disabled||quick.status==='unplanned'?' disabled':''}></label><small>${quick.status==='unplanned'?(row.plantingId?'Retoma a previsão calculada. Se estiver vencida, ficará vermelha automaticamente.':'Limpa a data e o planejamento desta aplicação.'):quick.status==='completed'?'Sem data, mantém a confirmação como OK. Ao informar a data, as próximas etapas são recalculadas.':quick.status==='in_progress'?'A data informa quando a execução começou. Permanece amarela até concluir.':'O vermelho indica uma data vencida sem execução.'}</small><p class="spray-validation" role="alert">${escape(quick.error||'')}</p><div><button type="button" data-spray-action="quick-save" data-spray-key="${escape(row.key)}"${disabled?' disabled':''}>${busy?'Salvando…':'Salvar'}</button><button type="button" data-spray-action="quick-cancel" data-spray-key="${escape(row.key)}"${disabled?' disabled':''}>Cancelar</button></div></div>`;
    }
    function quickUsesDialog(){return onPhone()&&typeof el('quick-dialog').showModal==='function';}
    function hideQuickDialog(){const dialog=el('quick-dialog');if(dialog.open)dialog.close?.();dialog.innerHTML='';}
    function focusQuickCell(key){
        const button=Array.from(el('table').querySelectorAll?.('[data-spray-action="quick"]')||[]).find(button=>button.dataset.sprayKey===key);
        (button||el('table')).focus?.({preventScroll:true});
    }
    function syncQuickDialog(){
        const row=quick&&visible.find(row=>row.key===quick.key),dialog=el('quick-dialog');
        if(row&&quickUsesDialog()){
            dialog.innerHTML=quickEditor(row);
            el('quick-status').value=quick.status;el('quick-date').value=quick.date;
            if(!dialog.open)dialog.showModal();
        }else hideQuickDialog();
    }
    function openQuick(row) {
        if(!canEdit()||busy||loading||error||row.deleted)return;
        if(grid.size){message='Salve ou descarte as alterações pendentes antes de editar outra célula.';render();return;}
        quick={key:row.key,status:O.tableStatus(row),date:row.completedWithoutDate&&!row.actual?'':row.actual||row.started||(row.optional?'':row.planned)||'',error:''};
        editing=null;el('form').hidden=true;quietSelect(row);
        if(quickUsesDialog())syncQuickDialog();else render();
        el('quick-status').focus?.({preventScroll:true});
    }
    function closeQuick() {
        const key=quick?.key,modal=quickUsesDialog();quick=null;
        if(modal)hideQuickDialog();else render();
        focusQuickCell(key);
    }
    async function saveQuick() {
        if(!quick||!canEdit()||busy||loading||error)return;
        const row=all.find(item=>item.key===quick.key),field=fields.find(item=>item.key===row?.fieldKey);
        if(!row||row.deleted)return;
        quick.status=el('quick-status').value;quick.date=el('quick-date').value;
        if(quick.status==='unplanned'&&row.optional){closeQuick();return;}
        let updated;
        try { updated=O.quickUpdate(row,quick.status,quick.date,field);if(updated.plantingId)linkedPreview(updated,field); }
        catch(failure){quick.error=failure.message;if(quickUsesDialog())syncQuickDialog();else render();return;}
        await persist(updated);
        if(!quick)focusQuickCell(row.key);
    }
    function matrixTable(){
        const matrix=O.matrix(visible);
        const heading=column=>([...O.independentSteps,...S.steps].find(step=>step.id===column.key)?.short||column.label)+(column.key==='fung4'?' (opcional)':'');
        const applicationCell=row=>{
            if(quick&&quick.key===row.key&&!quickUsesDialog())return quickEditor(row);
            const status=O.tableStatus(row),value=row.actual||row.started||(row.optional?'':row.planned);
            const label=row.completedWithoutDate&&!row.actual?'OK':value?date(value).slice(0,6)+value.slice(2,4):'';
            const title=`${row.field} · ${row.name} · ${tableNames[status]}${row.autoDate?' · Data calculada':''}\nPrevista: ${date(row.optional?'':row.planned)}\nInício: ${date(row.started)}\nRealizada: ${row.completedWithoutDate&&!row.actual?'OK · sem data informada':date(row.actual)}`;
            const editable=canEdit()&&!busy&&!loading&&!error&&!row.deleted;
            return `<div class="spray-compact-cell ${status}${grid.has(row.key)?' has-draft':''}" data-spray-row="${escape(row.key)}" title="${escape(title)}">${editable?`<button type="button" class="spray-date-button" data-spray-action="quick" data-spray-key="${escape(row.key)}" aria-label="${escape(title+' · Editar data e cor')}">${escape(label)||'&nbsp;'}</button>`:`<span class="spray-date-value" aria-label="${escape(title)}">${escape(label)||'&nbsp;'}</span>`}</div>`;
        };
        return `<table class="spray-matrix spray-compact-table"><thead><tr><th scope="col"><button type="button" data-spray-sort="field">Talhão / Fazenda</button></th><th scope="col" class="spray-field-info">Variedade</th><th scope="col" class="spray-field-info">Hectares</th><th scope="col" class="spray-field-info">Plantio</th><th scope="col" class="spray-field-info" title="Dias após o plantio">DAP</th>${matrix.columns.map(column=>`<th scope="col">${escape(heading(column))}</th>`).join('')}</tr></thead><tbody>`+matrix.rows.map(field=>{
            const info=fields.find(item=>item.key===field.key)||{};
            const dap=info.plantingDate?Math.round((S.time(S.today())-S.time(info.plantingDate))/86400000):null;
            return `<tr data-spray-field-key="${escape(field.key)}" class="spray-field-row"><th scope="row"><button type="button" data-spray-field-select="${escape(field.key)}">${escape(field.field)}<small>${escape(field.farm)}</small></button></th><td class="spray-field-info">${escape(info.variety)}</td><td class="spray-field-info">${Number(info.area||0).toLocaleString('pt-BR',{maximumFractionDigits:2})}</td><td class="spray-field-info">${info.plantingDate?date(info.plantingDate).slice(0,6)+info.plantingDate.slice(2,4):''}</td><td class="spray-field-info">${dap===null?'':dap}</td>`+matrix.columns.map(column=>`<td>${(field.cells.get(column.key)||[]).map(applicationCell).join('')}</td>`).join('')+'</tr>';
        }).join('')+'</tbody></table>';
    }
    function listTable(){
        const columns=[['farm','Fazenda'],['field','Talhão'],['culture','Cultura'],['name','Aplicação'],['product','Produto'],['dose','Dose'],['doseUnit','Unidade'],['area','Área (ha)'],['planned','Programada'],['started','Início'],['actual','Realizada'],['responsible','Responsável'],['status','Status'],['notes','Observações']];
        return `<table class="spray-operations-table"><caption>Lista editável · selecione células ou registros para atualizar em conjunto</caption><thead><tr><th>Selecionar</th>`+columns.map(([key,label])=>`<th scope="col" aria-sort="${order===key?direction===1?'ascending':'descending':'none'}"><button type="button" data-spray-sort="${key}">${label}${order===key?direction===1?' ↑':' ↓':''}</button></th>`).join('')+'<th scope="col">Ações</th></tr></thead><tbody>'+visible.map(row=>`<tr data-spray-field-key="${escape(row.fieldKey)}" data-spray-row="${escape(row.key)}" class="${grid.has(row.key)?'has-draft ':''}${row.deleted?'deleted':''}"><td>${selection(row)}</td>`+columns.map(([key])=>`<td>${key==='status'?`<span class="spray-status ${O.tableStatus(row)}">${row.deleted?'Excluída':tableNames[O.tableStatus(row)]}</span>`:['product','dose','doseUnit','area','planned','started','actual','responsible','notes'].includes(key)?cell(row,key):escape(row[key])}</td>`).join('')+`<td><button type="button" data-spray-action="map" data-spray-key="${escape(row.key)}">Mapa</button>${canEdit()?`<button type="button" data-spray-action="${row.deleted?'restore':'edit'}" data-spray-key="${escape(row.key)}"${busy||grid.size?' disabled':''}>${row.deleted?'Restaurar':'Detalhes'}</button>${row.deleted?'':`<button type="button" data-spray-action="delete" data-spray-key="${escape(row.key)}"${busy||grid.size?' disabled':''}>Excluir</button>`}`:''}</td></tr>`).join('')+'</tbody></table>';
    }
    function editCell(row,column,value){
        if(!canEdit()||busy||loading||error||row.deleted)return;
        if(!grid.has(row.key)&&grid.size>=1000){message='O limite é de 1000 aplicações por lote. Salve as alterações antes de continuar.';return;}
        const field=fields.find(field=>field.key===row.fieldKey);
        if(!field)return;
        grid.edit(row,field,schedules.find(item=>item.plantingId===row.plantingId),column,value);
        selectedField=row.fieldKey;selectedRow=row.key;message='Prévia das alterações. As aplicações ainda não foram salvas.';
        autoError='';
    }
    async function savePending(){
        if(!canEdit()||busy||loading||error||!grid.size)return;
        let rows;try{rows=grid.validate();}catch(failure){autoError=failure.message;message='Não salvo: '+autoError;render();return;}
        busy=true;autoError='';message='Salvando…';render();
        try{
            await repo().saveBatch(rows,grid.fields());grid.clear();checked.clear();el('check-visible').checked=false;
            loadedKey='';await load();message='Salvo';
        }catch(failure){autoError=failure.message;message='Não foi possível salvar: '+autoError;}
        finally{
            busy=false;render();
            if(focusAfterSave){const target=focusAfterSave;focusAfterSave=null;
                Array.from(el('table').querySelectorAll?.('[data-spray-cell]')||[]).find(input=>input.dataset.sprayKey===target.sprayKey&&input.dataset.sprayCell===target.sprayCell)?.focus?.({preventScroll:true});}
        }
    }
    function batchControls(){
        let failure='';if(grid.size)try{grid.validate();}catch(problem){failure=problem.message;}
        el('batch-message').textContent=failure||`${grid.size} aplicações com alterações não salvas · ${visible.filter(row=>checked.has(row.key)&&!row.deleted).length} selecionadas neste filtro.`+(grid.size?' Alterações fora do filtro também serão salvas.':' Edite as células ou aplique um valor aos itens selecionados.');
        el('batch-save').disabled=!canEdit()||busy||loading||!!error||!grid.size||!!failure;
        el('batch-save').hidden=!autoError;
        el('batch-discard').hidden=!autoError;
        el('batch-discard').disabled=busy||!grid.size;
        el('bulk-apply').disabled=!canEdit()||busy||loading||!!error||!visible.some(row=>checked.has(row.key)&&!row.deleted);
        el('check-visible').disabled=!canEdit()||busy||loading;
        const selectable=visible.filter(row=>!row.deleted&&!row.optional),selectedCount=selectable.filter(row=>checked.has(row.key)).length;
        el('check-visible').checked=!!selectable.length&&selectedCount===selectable.length;
        el('check-visible').indeterminate=selectedCount>0&&selectedCount<selectable.length;
        el('grid-mode').setAttribute?.('aria-pressed',String(mode==='grid'));
        el('list-mode').setAttribute?.('aria-pressed',String(mode==='list'));
    }
    function renderMapDashboard() {
        const dashboard=document.getElementById('spray-map-dashboard');
        if(!dashboard||!state)return;
        dashboard.classList.toggle('hidden',state.currentTab!=='pulverizacao'||state.currentSubTab!=='mapa-pulverizacao');
        dashboard.classList.toggle('collapsed',mapDashboardCollapsed);
        el('map-toggle').setAttribute?.('aria-expanded',String(!mapDashboardCollapsed));
        el('map-toggle').setAttribute?.('aria-label',mapDashboardCollapsed?'Expandir acompanhamento':'Recolher acompanhamento');
        const application=O.applicationOptions(all).find(option=>option.key===mapApplication)?.label||'Todas';
        el('map-title').textContent=mapApplication==='all'?'Acompanhamento da Pulverização':`Acompanhamento · ${application}`;
        el('map-scope').textContent=`${state.currentFazenda==='ALL'?'Fazendas: Todas':`Fazenda: ${state.currentFazenda}`} · ${state.currentGleba==='ALL'?'Todas as glebas':`Gleba ${state.currentGleba}`}`;
        if(loading||error){el('map-content').innerHTML=`<p class="spray-map-message" role="status">${escape(error||'Carregando aplicações…')}</p>`;return;}
        const total=O.areaSummary(mapRows),pct=value=>`${Number(value).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})}%`;
        const percent=area=>total.plannedArea?100*area/total.plannedArea:0;
        const categories=[['realized','Realizadas',total.appliedArea,total.completed,colors.completed],
            ['overdue','Atrasadas',total.overdueArea,total.overdue,colors.pending],['ontime','Em dia',total.onTimeArea,total.onTimeCount,colors.scheduled]];
        const cards=[['planejada','calendar-check','ÁREA PROGRAMADA',ha(total.plannedArea),'Área total das aplicações'],
            ['realizada','circle-check','ÁREA REALIZADA',ha(total.appliedArea),'Aplicado até o momento'],
            ['progresso','bars-progress','PROGRESSO GERAL',pct(total.progress),`${ha(total.appliedArea)} de ${ha(total.plannedArea)}`]];
        el('map-content').innerHTML=`<div class="kpi-cards-grid">${cards.map(([key,icon,label,value,sub])=>`<div class="kpi-card card-${key}"><div class="kpi-icon-wrapper icon-${key==='planejada'?'blue':key==='realizada'?'green':'orange'}"><i class="fa-solid fa-${icon}" aria-hidden="true"></i></div><div class="kpi-data"><span class="kpi-title">${label}</span><strong class="kpi-value">${value}</strong><span class="kpi-subtitle">${sub}</span></div></div>`).join('')}</div>`+
            `<div class="progress-bar-section"><div class="progress-bar-label-row"><span class="progress-bar-title">Andamento das aplicações</span><strong>${pct(total.progress)} realizado</strong></div><div class="segmented-progress-track" role="progressbar" aria-label="Área realizada" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${total.progress.toFixed(2)}">${categories.map(([,label,area,,color])=>`<div class="progress-segment" style="width:${percent(area)}%;background:${color}" title="${label}: ${ha(area)}"></div>`).join('')}</div></div>`+
            `<div class="status-summary-grid">${categories.map(([key,label,area,count,color])=>`<div class="status-pill spray-map-status" style="--spray-status-color:${color}"><div class="status-pill-header"><span class="status-dot" style="background:${color}"></span><strong>${label}</strong></div><div class="status-pill-numbers"><span class="status-ha" data-spray-map-area="${key}">${ha(area)}</span><span class="status-pct">(${pct(percent(area))})</span></div><span class="status-count">${count} aplicações</span>${key==='ontime'?`<span class="spray-map-attention">Próximas da data: ${ha(total.attentionArea)}</span>`:''}</div>`).join('')}</div>`+
            `<p class="spray-map-note">${['all','fungicide','insecticide'].includes(mapApplication)?'Áreas somadas por aplicação. ':''}Amarelo: vence hoje ou em até 2 dias. Cinza: sem aplicação neste filtro.</p>`;
    }
    function renderOverview() {
        const host=el('overview-content'),badge=el('overview-progress');
        if(loading||error){badge.textContent=error?'Indisponível':'Carregando…';host.innerHTML=`<p class="spray-overview-note" role="status">${escape(error||'Carregando indicadores…')}</p>`;return;}
        if(filters.deleted){badge.textContent='Excluídas';host.innerHTML='<p class="spray-overview-note">Registros excluídos não entram nos indicadores. Selecione outro status para acompanhar a execução.</p>';return;}
        const t=O.dashboardSummary(overviewRows,fields),pct=value=>value===null?'—':Number(value).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%';
        badge.textContent=t.progress===null?'Sem área prevista':pct(t.progress)+' concluído';
        const count=(n,one,many)=>`${n} ${n===1?one:many}`;
        const cards=[['fields','Área dos talhões',ha(t.fieldArea),count(t.fieldCount,'talhão','talhões')+' no filtro'],
            ['completed','Área aplicada',ha(t.appliedArea),count(t.buckets.completed.count,'aplicação','aplicações')+' concluída'+(t.buckets.completed.count===1?'':'s')],
            ['in_progress','Em execução',ha(t.runningArea),count(t.buckets.in_progress.count,'aplicação','aplicações')+' em andamento'],
            ['overdue','Em atraso',ha(t.overdueArea),count(t.buckets.overdue.count,'aplicação','aplicações')+' atrasada'+(t.buckets.overdue.count===1?'':'s')]];
        const buckets=[['completed','Concluída','#00b050'],['in_progress','Em execução','#e4c600'],['planned','Planejada','#00a9df'],['overdue','Atrasada','#e3655e'],['calculated','Previsão calculada','#cbd5df']];
        host.innerHTML=`<p class="spray-overview-scope">${escape(state.currentCultura)} · ${escape(state.currentAno)} · Indicadores conforme os filtros da tabela</p>`+
            `<div class="spray-overview-cards" aria-label="Indicadores de área">${cards.map(([key,label,value,sub])=>`<article class="spray-overview-card ${key}"><span>${label}</span><strong data-spray-overview-area="${key}">${value}</strong><small>${escape(sub)}</small></article>`).join('')}</div>`+
            `<div class="spray-overview-progress"><div><strong>Andamento por área</strong><span>${t.totalArea?`${ha(t.appliedArea)} de ${ha(t.totalArea)} previstas`:'Sem aplicações com data ou confirmação'}</span></div><div class="spray-overview-track" role="progressbar" aria-label="Percentual da área aplicada" aria-valuemin="0" aria-valuemax="100"${t.progress===null?' aria-valuetext="Sem área prevista"':` aria-valuenow="${t.progress.toFixed(2)}"`}>${buckets.map(([key,label,color])=>`<span style="width:${t.totalArea?100*t.buckets[key].area/t.totalArea:0}%;background:${color}" title="${label}: ${ha(t.buckets[key].area)}"></span>`).join('')}</div></div>`+
            `<p class="spray-overview-note">${grid.size||busy?'Indicadores mantêm os dados confirmados durante o salvamento. ':''}Áreas de aplicação são somadas por etapa. Um talhão pode entrar mais de uma vez.</p>`+
            `<details id="spray-op-overview-details" class="spray-overview-details"${overviewExpanded?' open':''}><summary>Etapas e prioridades</summary><div class="spray-overview-detail-grid"><section><h3>Andamento por aplicação</h3><div class="spray-overview-stages">${t.stages.map(stage=>`<div class="spray-overview-stage"><div><strong>${escape(stage.label)}</strong><span>${pct(stage.progress)}</span></div><div class="spray-overview-stage-track"><span style="width:${stage.progress??0}%"></span></div><small>${ha(stage.appliedArea)} aplicadas de ${ha(stage.totalArea)} previstas · ${stage.completed}/${stage.count} concluídas</small></div>`).join('')||'<p class="spray-overview-note">Nenhuma etapa com área prevista neste filtro.</p>'}</div></section><section><h3>Atrasos e próximos 7 dias</h3><ol class="spray-overview-priorities">${t.upcoming.map(row=>`<li><div><strong>${escape(row.field)} <small>${escape(row.farm)}</small></strong><span class="${row.planned<S.today()?'overdue':''}">${date(row.planned)}${row.planned<S.today()?' · Atrasada':row.planned===S.today()?' · Hoje':''}</span></div><p>${escape(row.name)} · ${ha(row.area)}</p></li>`).join('')||'<li>Nenhuma pendência datada nesse período.</li>'}</ol>${t.dueCount>5?`<p class="spray-overview-note">Mostrando 5 de ${t.dueCount} pendências. Use os filtros para consultar as demais.</p>`:''}<div class="spray-overview-breakdown">${buckets.map(([key,label,color])=>`<span><i style="background:${color}"></i>${label}: <b>${ha(t.buckets[key].area)}</b></span>`).join('')}</div><p class="spray-overview-note">${t.unplannedCount} etapas sem data ou planejamento ficam fora da área prevista. Branco não significa em dia. Em execução considera a área da aplicação inteira, sem estimar uma conclusão parcial.</p></section></div></details>`;
        const detail=el('overview-details');detail.ontoggle=()=>{if(el('overview-details')===detail)overviewExpanded=detail.open;};
    }
    function render() {
        if (!state || state.currentTab !== 'pulverizacao' || !el('table')) return;
        prepare();
        document.querySelectorAll?.('.spray-mobile-views [data-spray-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.sprayView===(state.currentSubTab||'tabela-pulverizacao'))));
        if(!quick||loading||error)hideQuickDialog();
        const activeFilters=[filters.farm,filters.field,filters.application!=='all',filters.status,filters.deleted,filters.from,filters.to,filters.search].filter(Boolean).length;
        el('filter-count').textContent=activeFilters?`${activeFilters} filtro${activeFilters===1?'':'s'} ativo${activeFilters===1?'':'s'}`:'Todos os talhões';
        el('table-count').textContent=loading?'Carregando…':error?'Não foi possível carregar':`${new Set(visible.map(row=>row.fieldKey)).size} talhões · ${visible.length} aplicações`;
        el('field-info').hidden=mode!=='grid';el('field-info').setAttribute('aria-pressed',String(showFieldInfo));
        el('field-info').textContent=showFieldInfo?'Ocultar dados':'Dados do talhão';
        el('touch-hint').textContent=canEdit()?'Deslize para ver as aplicações. Toque na data para editar.':'Deslize para ver as aplicações.';
        el('table').classList.toggle('spray-show-field-info',showFieldInfo);
        el('message').textContent = error || (busy ? 'Salvando…' : loading ? 'Carregando…' : message || 'Alterações salvas automaticamente');
        el('message').classList.toggle('is-error', !!error||!!autoError);
        el('save-status').textContent=error?'Falha ao carregar':busy?'Salvando…':loading?'Carregando…':autoError?'Não salvo':grid.size?'Alteração não salva':message==='Salvo'?'Salvo':'Salvamento automático';
        el('save-status').classList.toggle('is-error',!!error||!!autoError);
        el('save-status').title=error||autoError||'';
        const report=document.getElementById('spray-report-button');
        if(report){report.hidden=!canEdit();report.disabled=loading||busy||!!error||!!grid.size||!!root.SprayReport?.busy;}
        const exportHost=document.getElementById(state.currentSubTab==='mapa-pulverizacao'?'spray-map-export-actions':'spray-table-export-actions');
        const exportActions=document.getElementById('spray-report-actions');
        if(exportActions){exportActions.hidden=!canEdit();if(exportHost&&exportActions.parentElement!==exportHost)exportHost.appendChild?.(exportActions);}
        renderMapDashboard();
        renderOverview();
        el('add').disabled = !canEdit() || loading || busy || !!error || !fields.length || !!grid.size;
        el('inputs').disabled = busy || !canEdit();
        el('reload').disabled = loading || busy;
        batchControls();
        if (loading || error) { el('summary').innerHTML=''; el('counts').textContent=''; el('next').textContent=''; el('table').innerHTML=''; updateMap(); return; }
        const totals = O.summarize(visible);
        const cards = [['Programadas',totals.total],['Realizadas',totals.completed],['Pendentes',totals.pending],['Atrasadas',totals.overdue],['Área programada',ha(totals.plannedArea)],['Área aplicada',ha(totals.appliedArea)]];
        el('summary').innerHTML=cards.map(([label,value])=>`<div class="spray-kpi"><span>${label}</span><strong>${value}</strong></div>`).join('');
        el('counts').innerHTML=`<span class="spray-status scheduled">${totals.scheduled} no prazo</span> <span class="spray-status attention">${totals.attention} próximas</span> <span class="spray-status overdue">${totals.overdue} atrasadas</span> <span>${visible.length} registros neste filtro · ${totals.total?Math.round(totals.completed/totals.total*100):0}% concluído</span>`;
        const next=O.sort(visible.filter(row=>!row.deleted&&!row.optional&&!row.unplanned&&!O.isCompleted(row)),'planned',1)[0];
        el('next').textContent=next?`Próxima pendência: ${next.name} · ${next.farm} / ${next.field} · ${date(next.planned)}`:'Nenhuma aplicação pendente neste filtro.';
        el('permission').textContent=canEdit() ? 'Edite as datas na grade ou os demais campos na lista. Salve todas as alterações juntas. Limpar a data programada de uma etapa do plantio retoma o cálculo automático.' : 'Modo de consulta. Seu perfil não permite alterar aplicações.';
        el('table').innerHTML=visible.length?(mode==='grid'?matrixTable():listTable()):'<p class="spray-empty">Nenhuma aplicação neste filtro. Os talhões cadastrados continuam visíveis no mapa.</p>';
        syncQuickDialog();
        if(quick){el('quick-status').value=quick.status;el('quick-date').value=quick.date;}
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
            const existing=all.find(row=>row.plantingId===field.plantingId&&row.stage==='fung4'&&!row.optional);
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
        quick=null;editing=row?{...row}:{};
        el('form').hidden=false;el('form-error').textContent='';
        el('form-title').textContent=row?'Editar aplicação':'Adicionar aplicação';
        el('input-field').innerHTML=fields.map(field=>`<option value="${escape(field.key)}">${escape(field.farm)} · ${escape(field.field)}</option>`).join('');
        el('input-field').value=row?.fieldKey||selectedField||fields[0]?.key||'';el('input-field').disabled=!!row;
        el('type-label').hidden=!!row;el('input-type').value='manual';
        for(const [name,value]of Object.entries({name:row?.name||'',product:row?.product||'',dose:row?.dose??'',unit:row?.doseUnit||'L/ha',area:row?.area||'',planned:row?.planned||'',actual:row?.actual||'',started:row?.started||'',responsible:row?.responsible||'',notes:row?.notes||''}))el('input-'+name).value=value;
        el('input-started').max=S.today();
        el('input-actual').max=S.today();el('input-auto').checked=!!row?.autoDate;el('auto-label').hidden=!row?.plantingId;
        el('input-planned').disabled=!!row?.autoDate;el('input-name').readOnly=!!row?.plantingId;
        el('input-planned').required=!O.isIndependent(row?.stage);
        if(O.isIndependent(row?.stage))el('input-name').readOnly=true;
        el('stage-note').textContent=(O.isIndependent(row?.stage)?'Datas manuais e independentes do plantio. ':'Desmarque a data calculada para confirmar o planejamento. ')+ 'Informe o início para marcar em execução e a data realizada ao concluir.'+(row?.plantingId?' A conclusão recalcula as próximas datas automáticas.':'');
        if(!row)configureNew();
        previewForm();
        el('form').scrollIntoView?.({behavior:'smooth',block:'nearest'});
    }
    async function persist(row) {
        if(!canEdit()||busy||loading||error)return;
        if(grid.size){message='Salve ou descarte as alterações da grade antes de usar ações individuais.';render();return;}
        const field=fields.find(field=>field.farm===row.farm&&field.field===row.field);
        busy=true;message='';render();
        try { await repo().save(row,field);el('form').hidden=true;editing=null;quick=null;message='Alteração salva e confirmada.';loadedKey='';await load(); }
        catch(failure){ message=failure.message;if(quick)quick.error=failure.message;el('form-error').textContent=failure.message; }
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
        el('filter-disclosure').open=!onPhone();
        el('legend-disclosure').open=!onPhone();
        phone?.addEventListener?.('change',()=>{el('filter-disclosure').open=!onPhone();el('legend-disclosure').open=!onPhone();if(state?.currentTab==='pulverizacao'){render();if(quick)el('quick-status').focus?.({preventScroll:true});}});
        el('field-info').onclick=()=>{showFieldInfo=!showFieldInfo;render();};
        const report=document.getElementById('spray-report-button');
        if(report)report.onclick=()=>root.SprayReport?.download(state);
        el('map-toggle').onclick=()=>{mapDashboardCollapsed=!mapDashboardCollapsed;renderMapDashboard();};
        el('add').onclick=()=>openForm(null);
        el('map-jump').onclick=()=>{root.dispatchEvent?.(new root.CustomEvent('geoportal:spray-view',{detail:{view:'mapa-pulverizacao'}}));state.map?.invalidateSize?.();};
        el('reload').onclick=()=>{if(busy)return;if(grid.size){message='Suas alterações da grade foram mantidas. Salve ou descarte antes de recarregar.';render();return;}quick=null;el('form').hidden=true;editing=null;loadedKey='';load();};
        for(const name of ['farm','field','application','status','from','to','search']){
            const handler=()=>{quick=null;filters[name]=el(name).value;if(name==='farm')filters.field='';if(name==='status'){filters.deleted=filters.status==='deleted';if(filters.deleted)filters.status='';}render();};
            el(name)[name==='search'?'oninput':'onchange']=handler;
        }
        el('clear').onclick=()=>{quick=null;for(const name of ['farm','field','status','from','to','search']){filters[name]='';el(name).value='';}filters.application='all';filters.deleted=false;selectedField='';selectedRow='';render();};
        el('map-application').onchange=()=>{mapApplication=el('map-application').value;selectedField='';selectedRow='';render();};
        el('grid-mode').onclick=()=>{quick=null;mode='grid';render();};el('list-mode').onclick=()=>{quick=null;mode='list';render();};
        el('check-visible').onchange=()=>{for(const row of visible.filter(row=>!row.deleted&&!row.optional))if(el('check-visible').checked)checked.add(row.key);else checked.delete(row.key);render();};
        el('bulk-field').onchange=()=>{const key=el('bulk-field').value;el('bulk-value').type=['actual','planned'].includes(key)?'date':['dose','area'].includes(key)?'number':'text';el('bulk-value').value='';};
        el('bulk-apply').onclick=()=>{
            if(!canEdit()||busy||loading||error)return;
            const key=el('bulk-field').value,value=el('bulk-value').value;
            const targets=visible.filter(row=>checked.has(row.key)&&!row.deleted);
            if(new Set([...grid.rows().map(row=>row.key),...targets.map(row=>row.key)]).size>1000){message='O limite é de 1000 aplicações por lote. Reduza a seleção ou salve as alterações pendentes.';render();return;}
            for(const row of targets)editCell(row,key,value);
            render();return savePending();
        };
        el('batch-discard').onclick=()=>{if(busy)return;grid.clear();autoError='';message='Alteração descartada.';render();};
        el('batch-save').onclick=savePending;
        el('table').onchange=event=>{
            if(event.target.dataset?.sprayQuick){
                if(!quick||!canEdit()||busy||loading||error)return;
                quick[event.target.dataset.sprayQuick]=event.target.value;quick.error='';
                if(event.target.dataset.sprayQuick==='status'){
                    if(quick.status==='unplanned'){const row=all.find(row=>row.key===quick.key);quick.date=row?.plantingId&&!row.optional?row.planned||'':'';}
                    if(quickUsesDialog())syncQuickDialog();else render();
                    el('quick-status').focus?.({preventScroll:true});
                }
                return;
            }
            const key=event.target.dataset?.sprayKey,column=event.target.dataset?.sprayCell;
            if(event.target.dataset?.sprayCheck){const id=event.target.dataset.sprayCheck;if(event.target.checked)checked.add(id);else checked.delete(id);batchControls();return;}
            const row=visible.find(item=>item.key===key);if(!row||!column)return;
            if(document.activeElement===event.target)focusAfterSave={sprayKey:key,sprayCell:column};
            editCell(row,column,event.target.value);render();return savePending();
        };
        el('table').onfocusin=event=>{const row=visible.find(item=>item.key===event.target.dataset?.sprayKey);if(row)quietSelect(row);};
        el('table').onkeydown=event=>{
            if(event.key==='Escape'&&quick&&!busy){event.preventDefault();closeQuick();return;}
            if(event.target.dataset?.sprayQuick){
                if(busy)return;
                if(event.key==='Escape'){event.preventDefault();closeQuick();}
                if(event.key==='Enter'&&event.target.dataset.sprayQuick==='date'){event.preventDefault();return saveQuick();}
                return;
            }
            if(event.key!=='Tab'||!event.target.dataset?.sprayCell||!canEdit()||busy)return;
            const inputs=Array.from(el('table').querySelectorAll?.('[data-spray-cell]')||[]),index=inputs.indexOf(event.target),next=inputs[index+(event.shiftKey?-1:1)];
            if(index<0||!next)return;
            event.preventDefault();
            const row=visible.find(item=>item.key===event.target.dataset.sprayKey),column=event.target.dataset.sprayCell;
            const changed=row&&String(row[column]??'')!==event.target.value;
            if(changed)editCell(row,column,event.target.value);
            const target={...next.dataset};render();
            if(changed){focusAfterSave=target;return savePending();}
            const replacement=Array.from(el('table').querySelectorAll?.('[data-spray-cell]')||[]).find(input=>input.dataset.sprayKey===target.sprayKey&&input.dataset.sprayCell===target.sprayCell);
            replacement?.focus?.({preventScroll:true});
        };
        el('table').onclick=event=>{
            const fieldButton=event.target.closest?.('[data-spray-field-select]');if(fieldButton){const row=visible.find(item=>item.fieldKey===fieldButton.dataset.sprayFieldSelect);if(row)quietSelect(row);return;}
            if(event.target.dataset?.sprayCell||event.target.dataset?.sprayCheck)return;
            const sort=event.target.closest?.('[data-spray-sort]');if(sort){direction=order===sort.dataset.spraySort?-direction:1;order=sort.dataset.spraySort;render();return;}
            const button=event.target.closest?.('[data-spray-action]');if(!button){const element=event.target.closest?.('[data-spray-row]');const row=visible.find(item=>item.key===element?.dataset.sprayRow);if(row)quietSelect(row);return;}
            const row=visible.find(item=>item.key===button.dataset.sprayKey);if(!row)return;
            if(button.dataset.sprayAction==='quick'){openQuick(row);return;}
            if(button.dataset.sprayAction==='quick-cancel'){if(!busy)closeQuick();return;}
            if(button.dataset.sprayAction==='quick-save')return saveQuick();
            if(button.dataset.sprayAction==='map'){locate(row);return;}
            if(!canEdit()||busy)return;
            if(grid.size){message='Salve ou descarte as alterações da grade antes de usar ações individuais.';render();return;}
            if(button.dataset.sprayAction==='edit')openForm(row);
            if(button.dataset.sprayAction==='restore')persist({...row,deleted:false});
            if(button.dataset.sprayAction==='delete'&&root.confirm(`Excluir ${row.name} de ${row.field}? O registro sairá do controle e poderá ser restaurado no filtro Excluídas. Realizações já registradas serão preservadas no histórico do cronograma.`))persist({...row,deleted:true});
        };
        const dialog=el('quick-dialog');
        dialog.onchange=el('table').onchange;dialog.onkeydown=el('table').onkeydown;
        dialog.onclick=event=>{if(event.target===dialog){if(!busy)closeQuick();return;}return el('table').onclick(event);};
        dialog.oncancel=event=>{event.preventDefault();if(!busy)closeQuick();};
        el('cancel').onclick=()=>{if(!busy){el('form').hidden=true;editing=null;}};
        el('input-field').onchange=configureNew;el('input-type').onchange=()=>{editing={};configureNew();};
        el('input-auto').onchange=()=>{el('input-planned').disabled=el('input-auto').checked;previewForm();};
        el('input-actual').onchange=previewForm;el('input-planned').onchange=previewForm;
        el('form').onsubmit=event=>{
            event.preventDefault();if(!canEdit()||busy||loading||error)return;
            const field=formField();if(!field)return;
            const row={...editing,farm:field.farm,field:field.field,fieldKey:field.key,year:state.currentAno,culture:state.currentCultura,
                name:el('input-name').value,product:el('input-product').value,dose:el('input-dose').value,doseUnit:el('input-unit').value,
                area:el('input-area').value,planned:el('input-planned').value,actual:el('input-actual').value,started:el('input-started').value,
                autoDate:!!editing?.plantingId&&el('input-auto').checked,responsible:el('input-responsible').value,notes:el('input-notes').value,deleted:false};
            if(!editing?.key&&el('input-type').value==='fung4'&&!row.plantingId){el('form-error').textContent='Escolha um talhão com plantio registrado para incluir o 4º fungicida.';return;}
            try{O.validate(row,field);if(row.plantingId)linkedPreview(row,field);}catch(failure){el('form-error').textContent=failure.message;return;}
            el('submit').disabled=true;return persist(row);
        };
    }
    function refresh(nextState,nextFeatures=features) {
        state=nextState;features=nextFeatures;
        if(state.currentTab!=='pulverizacao'||!el('table'))return;
        const context=JSON.stringify([state.currentAno,state.currentCultura,state.currentFazenda,state.currentGleba]);
        if(context!==scope){scope=context;quick=null;selectedField='';selectedRow='';filters.farm='';filters.field='';filters.application='all';mapApplication='all';editing=null;el('form').hidden=true;}
        if(state.currentSubTab==='mapa-pulverizacao')quick=null;
        if(!canEdit()){quick=null;el('form').hidden=true;editing=null;}
        initialize();render();load();
        if(state.currentSubTab!=='mapa-pulverizacao'&&selectedField)scrollSelection();
    }
    let day=S.today();root.setInterval?.(()=>{if(state?.currentTab==='pulverizacao'&&day!==S.today()){day=S.today();render();}},60000);
    root.addEventListener?.('beforeunload',event=>{if(grid.size){event.preventDefault();event.returnValue='';}});
    function reportData({wholeFarm=false}={}) {
        if(!canEdit()||state?.currentTab!=='pulverizacao')throw Error('Abra a Pulverização no modo Editor para exportar.');
        if(loading||!loadedKey)throw Error('Aguarde o carregamento das aplicações.');
        if(error)throw Error('Recarregue as aplicações antes de exportar.');
        if(busy||grid.size||autoError)throw Error('Aguarde a confirmação das alterações antes de exportar.');
        const application=state.currentSubTab==='mapa-pulverizacao'?mapApplication:filters.application;
        const applicationLabel=O.applicationOptions(all).find(item=>item.key===application)?.label||'Todas';
        const reportFarm=state.currentSubTab==='mapa-pulverizacao'?'':filters.farm;
        const reportRows=wholeFarm?O.filter(all,{farm:reportFarm,application,deleted:false}):(state.currentSubTab==='mapa-pulverizacao'?mapRows:visible);
        const rows=reportRows.filter(row=>!row.deleted&&!row.optional&&!row.unplanned).map(row=>({...row}));
        const statusLabel=names[filters.status]||'';
        const filterLabels=[filters.farm&&`Fazenda: ${filters.farm}`,filters.field&&`Talhão: ${fields.find(f=>f.key===filters.field)?.field||''}`,
            statusLabel&&`Status: ${statusLabel}`,filters.from&&`De ${date(filters.from)}`,filters.to&&`Até ${date(filters.to)}`,filters.search&&`Pesquisa: ${filters.search}`].filter(Boolean);
        return {rows,features:[...features],application,applicationLabel,farm:reportFarm,
            filterLabels:wholeFarm?(reportFarm?[`Fazenda: ${reportFarm}`]:[]):state.currentSubTab==='mapa-pulverizacao'?[]:filterLabels};
    }
    root.SprayControl=Object.freeze({refresh,style,popup,selectFeature,reportData,mapColors:Object.freeze({...colors})});
})(typeof window !== 'undefined'?window:globalThis);
