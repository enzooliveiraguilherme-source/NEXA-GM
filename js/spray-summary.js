(function(root){
    'use strict';
    const O=root.SprayOperations||(typeof require==='function'?require('./spray-operations.js'):null);
    const S=root.SpraySchedule||(typeof require==='function'?require('./spray-schedule.js'):null);
    const colors=Object.freeze({applied:'#06b200',in_progress:'#ffa000',not_applied:'#ed3036',future:'#cbd5df',empty:'#cbd5df'});
    const labels=Object.freeze({applied:'Aplicado',in_progress:'Em andamento',not_applied:'Não aplicado',future:'Aplicação futura',empty:'Sem programação'});
    const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const num=value=>Number(value||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
    const ha=value=>num(value)+' ha';
    const count=value=>`${value} ${value===1?'aplicação':'aplicações'}`;
    const pct=value=>Number(value||0).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'%';
    const active=state=>state?.currentTab==='pulverizacao'&&state.currentSubTab==='resumo-aplicacao';
    const canExport=state=>['admin','projetista'].includes(root.portalAccessRole)&&state?.userRole==='editor';
    const eligible=row=>!row.deleted&&!row.optional;
    function classify(row,current=S.today()){
        if(O.isCompleted(row))return 'applied';
        if(row.started)return 'in_progress';
        if(S.time(row.planned)===null)return 'empty';
        return row.planned<=current?'not_applied':'future';
    }
    function fieldStatus(rows,current=S.today()){
        const statuses=rows.filter(eligible).map(row=>classify(row,current));
        if(!statuses.length)return 'empty';
        if(statuses.every(status=>status==='applied'))return 'applied';
        for(const status of ['in_progress','not_applied','future','empty'])if(statuses.includes(status))return status;
        return 'empty';
    }
    function summarize(rows,current=S.today()){
        const buckets=Object.fromEntries(['applied','in_progress','not_applied','future','empty'].map(key=>[key,{area:0,count:0}]));
        for(const row of rows.filter(eligible)){
            const status=classify(row,current),area=Math.max(0,Number(row.area)||0);
            buckets[status].area+=area;buckets[status].count++;
        }
        const plannedArea=['applied','in_progress','not_applied','future'].reduce((sum,key)=>sum+buckets[key].area,0);
        return {buckets,plannedArea,appliedArea:buckets.applied.area,progress:plannedArea?100*buckets.applied.area/plannedArea:0};
    }
    function applicationOptions(rows){
        return O.applicationOptions(rows.filter(eligible)).filter(option=>!['all','fungicide','insecticide'].includes(option.key));
    }
    function build(features,rows,application,current=S.today()){
        const selected=rows.filter(row=>eligible(row)&&O.applicationKey(row)===application);
        const byField=new Map();
        for(const row of selected){const key=O.fieldKey(row.farm,row.field);if(!byField.has(key))byField.set(key,[]);byField.get(key).push(row);}
        const seen=new Set(),fields=[];
        for(const feature of features){const p=feature.properties||{},key=O.fieldKey(p.Fazenda,p.Campo);if(seen.has(key)||p.OperationalArchived)continue;seen.add(key);
            const fieldRows=byField.get(key)||[];fields.push({feature,status:fieldStatus(fieldRows,current),rows:fieldRows});}
        const scoped=selected.filter(row=>seen.has(O.fieldKey(row.farm,row.field)));
        return {rows:scoped,fields,totals:summarize(scoped,current),application,current};
    }
    let state,input={features:[],rows:[],loading:true,error:'',pending:false},application='',context='',revision=0,busy=false,collapsed=false;
    const el=id=>typeof document!=='undefined'?document.getElementById('spray-summary-'+id):null;
    let model=build([],[],'');
    function repaint(){state?.geojsonLayer?.eachLayer(layer=>{if(layer.feature)layer.setStyle(style(layer.feature));});}
    function update(){
        const options=applicationOptions(input.rows),select=el('application');
        if(!options.some(option=>option.key===application))application=options.find(option=>option.key==='post1')?.key||options[0]?.key||'';
        if(select){select.innerHTML=options.map(option=>`<option value="${escape(option.key)}">${escape(option.label)}</option>`).join('')||'<option value="">Sem aplicações</option>';select.value=application;select.disabled=input.loading||!!input.error;select.onchange=()=>{application=select.value;revision++;update();repaint();};}
        model=build(input.features,input.rows,application);
        const name=options.find(option=>option.key===application)?.label||'Selecione uma aplicação';
        const scope=state?.currentFazenda!=='ALL'?state?.currentFazenda:state?.currentGleba!=='ALL'?'Gleba '+state?.currentGleba:'Todas as glebas';
        if(el('title'))el('title').textContent='Resumo · '+name;
        if(el('scope'))el('scope').textContent=scope||'';
        const dashboard=el('dashboard');dashboard?.classList.toggle('hidden',!active(state));dashboard?.classList.toggle('collapsed',collapsed);
        const toggle=el('toggle');if(toggle){toggle.setAttribute('aria-expanded',String(!collapsed));toggle.setAttribute('aria-label',collapsed?'Expandir resumo':'Recolher resumo');toggle.onclick=()=>{collapsed=!collapsed;update();};}
        const button=el('export');if(button){button.hidden=!canExport(state);button.disabled=busy||input.loading||!!input.error||input.pending||!model.totals.plannedArea;button.onclick=()=>download();}
        const host=el('content');if(!host)return;
        if(input.loading||input.error){host.innerHTML=`<p class="spray-map-message" role="status">${escape(input.error||'Carregando aplicações…')}</p>`;return;}
        const t=model.totals;
        const cards=[['ÁREA PROGRAMADA',ha(t.plannedArea),'Área total da aplicação'],['ÁREA APLICADA',ha(t.appliedArea),'Execução confirmada'],['PROGRESSO',pct(t.progress),ha(Math.max(0,t.plannedArea-t.appliedArea))+' restantes']];
        host.innerHTML=`<div class="kpi-cards-grid">${cards.map(([title,value,sub],i)=>`<div class="kpi-card card-${i===0?'planejada':i===1?'realizada':'progresso'}"><div class="kpi-data"><span class="kpi-title">${title}</span><strong class="kpi-value">${value}</strong><span class="kpi-subtitle">${sub}</span></div></div>`).join('')}</div>`+
            `<div class="progress-bar-section"><div class="progress-bar-label-row"><span>Andamento da aplicação</span><strong>${pct(t.progress)} aplicado</strong></div><div class="segmented-progress-track" role="progressbar" aria-label="Área aplicada" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${t.progress.toFixed(2)}">${['applied','in_progress','not_applied','future'].map(key=>`<div class="progress-segment" style="width:${t.plannedArea?100*t.buckets[key].area/t.plannedArea:0}%;background:${colors[key]}"></div>`).join('')}</div></div>`+
            `<div class="status-summary-grid">${['applied','in_progress','not_applied'].map(key=>`<div class="status-pill"><div class="status-pill-header"><span class="status-dot" style="background:${colors[key]}"></span><strong>${labels[key]}</strong></div><span class="status-ha">${ha(t.buckets[key].area)}</span><span class="status-count">${count(t.buckets[key].count)}</span></div>`).join('')}</div>`+
            `<p class="spray-map-note">${input.pending?'Aguardando confirmação das alterações da tabela. ':''}Cinza: aplicação futura (${ha(t.buckets.future.area)}) ou sem programação. “Não aplicado” considera a data prevista de hoje ou anterior, sem início ou conclusão.</p>`;
    }
    function refresh(nextState,data){
        state=nextState;input=data;
        const key=JSON.stringify([state.currentAno,state.currentCultura,state.currentFazenda,state.currentGleba,S.today(),data.rows,data.loading,data.error,data.pending]);
        if(key!==context){context=key;revision++;}
        update();
    }
    function style(feature){
        const p=feature.properties||{},key=O.fieldKey(p.Fazenda,p.Campo);
        const status=input.loading||input.error?'empty':model.fields.find(row=>O.fieldKey(row.feature.properties.Fazenda,row.feature.properties.Campo)===key)?.status||'empty';
        return {color:'#283b50',weight:.9,fillColor:colors[status],fillOpacity:status==='empty'?.18:.95,opacity:1};
    }
    function popup(feature){
        const p=feature.properties||{},field=model.fields.find(row=>row.feature.properties.Fazenda===p.Fazenda&&row.feature.properties.Campo===p.Campo);
        const status=input.loading||input.error?'empty':field?.status||'empty';
        return `<div class="spray-map-popup"><strong>${escape(p.Campo)} · ${escape(p.Fazenda)}</strong><p>${escape(input.loading?'Carregando aplicações…':input.error||labels[status])}</p>${field?.rows.map(row=>`<div>${escape(row.name)} · ${ha(row.area)}${row.actual?' · '+escape(row.actual.split('-').reverse().join('/')):''}</div>`).join('')||''}</div>`;
    }
    function snapshot(){
        if(!active(state)||!canExport(state))throw Error('Abra Atualizar Mapa Aplicação no modo Editor para exportar.');
        if(input.loading||input.error||input.pending)throw Error(input.error||'Aguarde a confirmação dos dados da tabela antes de exportar.');
        update();if(!model.totals.plannedArea)throw Error('Não há área programada para esta aplicação.');
        const scope=state.currentFazenda!=='ALL'?state.currentFazenda:state.currentGleba!=='ALL'?'Gleba '+state.currentGleba:'Todas as glebas';
        const applicationLabel=applicationOptions(input.rows).find(option=>option.key===application)?.label||application;
        const now=new Date();return structuredClone({...model,applicationLabel,scope,scopeName:root.portalFarms?.find(farm=>farm.code===scope)?.name||scope,
            year:String(state.currentAno),culture:state.currentCultura,issued:now.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',hour12:false}),
            isoDate:S.today(now),satellite:!document.querySelector?.('input[name="basemap"][value="blank"]')?.checked});
    }
    const slug=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase();
    const filename=data=>`resumo-aplicacao-${slug(data.applicationLabel)}-${slug(data.scope)}-${slug(data.culture)}-${data.year}-${data.isoDate}.pdf`;
    function text(ctx,value,x,y,size=22,color='#102c4d',bold=false,max=1100){
        ctx.fillStyle=color;ctx.font=`${bold?700:400} ${size}px "Century Gothic", Arial, sans-serif`;let label=String(value);
        while(label.length&&ctx.measureText(label).width>max)label=label.slice(0,-1);if(label!==String(value))label=label.slice(0,-1)+'…';ctx.fillText(label,x,y);
    }
    function box(ctx,x,y,w,h,color,r=16){ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();}
    async function render(data){
        if(!root.OperationExport?.drawMap||!root.PlantingReport?.pdfFromImages)throw Error('Atualize a página para carregar o gerador de PDF.');
        if(document.fonts)await document.fonts.ready;
        const canvas=document.createElement('canvas');canvas.width=1240;canvas.height=1754;const ctx=canvas.getContext('2d'),t=data.totals;
        ctx.fillStyle='#f3f7fa';ctx.fillRect(0,0,1240,1754);box(ctx,0,0,1240,178,'white',0);box(ctx,0,174,1240,4,'#eb7825',0);
        try{const logo=await new Promise((resolve,reject)=>{const image=new Image(),timer=setTimeout(()=>reject(Error('Logo indisponível')),5000);image.onload=()=>{clearTimeout(timer);resolve(image);};image.onerror=()=>{clearTimeout(timer);reject(Error('Logo indisponível'));};image.src='apoio/GP Michels.jpg';});ctx.drawImage(logo,logo.naturalWidth*.07,logo.naturalHeight*.27,logo.naturalWidth*.89,logo.naturalHeight*.46,52,42,202,104);}catch{}
        ctx.textAlign='center';text(ctx,'Resumo de aplicação - '+data.applicationLabel,720,65,28,'#607086',true,850);text(ctx,data.scopeName,720,123,40,'#102c4d',true,850);ctx.textAlign='left';
        text(ctx,'Cultura: '+data.culture,64,218,20,'#607086',false,320);ctx.textAlign='center';text(ctx,'Ano / Safra: '+data.year,620,218,23,'#102c4d',true,350);ctx.textAlign='right';text(ctx,'Atualizado em '+data.isoDate.split('-').reverse().join('/'),1176,218,18,'#607086');ctx.textAlign='left';
        const cards=[['ÁREA PROGRAMADA',ha(t.plannedArea),'Área total da aplicação','#347c99'],['ÁREA APLICADA',ha(t.appliedArea),'Realizado até o momento',colors.applied],['PROGRESSO',pct(t.progress),ha(Math.max(0,t.plannedArea-t.appliedArea))+' restantes','#b68135']];
        cards.forEach(([title,value,sub,color],i)=>{const x=64+i*379;box(ctx,x,260,354,164,'white');box(ctx,x,260,354,6,color,0);text(ctx,title,x+22,300,20,color,true,310);text(ctx,value,x+22,356,38,'#102c4d',true,310);text(ctx,sub,x+22,394,18,'#607086',false,310);});
        box(ctx,64,445,1112,12,colors.future,6);let x=64;
        for(const key of ['applied','in_progress','not_applied']){const w=t.plannedArea?1112*t.buckets[key].area/t.plannedArea:0;if(w)box(ctx,x,445,w,12,colors[key],0);x+=w;}
        const missing=await root.OperationExport.drawMap(ctx,{fields:data.fields.map(row=>({...row,color:colors[row.status]})),satellite:data.satellite},{x:64,y:483,w:1112,h:900});
        ['applied','in_progress','not_applied'].forEach((key,i)=>{const x=64+i*379,b=t.buckets[key];box(ctx,x,1407,354,116,'white');box(ctx,x+20,1428,20,20,colors[key],4);text(ctx,labels[key],x+54,1447,22,'#102c4d',true,275);text(ctx,ha(b.area),x+20,1480,25,'#102c4d',true,314);text(ctx,count(b.count),x+20,1506,18,'#607086',false,314);});
        text(ctx,'Não aplicado: data prevista de hoje ou anterior, sem início ou conclusão.',64,1570,18,'#607086');
        text(ctx,'Cinza: aplicação futura ('+ha(t.buckets.future.area)+') ou sem programação.',64,1605,18,'#607086');
        text(ctx,'Em andamento considera a área da aplicação, sem estimar execução parcial.',64,1640,18,'#607086');
        if(missing)text(ctx,'Parte do satélite não carregou; talhões e totais preservados.',64,1675,17,'#607086');
        text(ctx,'NEXA | Emitido em '+data.issued,64,1710,18,'#607086');
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.92));if(!blob)throw Error('Não foi possível gerar o mapa.');
        const bytes=new Uint8Array(await blob.arrayBuffer());canvas.width=1;canvas.height=1;return {blob:root.PlantingReport.pdfFromImages([bytes]),pageCount:1};
    }
    async function download(){
        if(busy)return;const status=el('export-status');
        try{const data=snapshot(),request=revision;busy=true;update();if(status)status.textContent='Preparando mapa PDF…';const result=await render(data);
            if(request!==revision||!active(state)||!canExport(state)||input.pending)throw Error('Os dados ou filtros mudaram. Gere o resumo novamente.');
            const url=URL.createObjectURL(result.blob),link=document.createElement('a');link.href=url;link.download=filename(data);document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
            if(status)status.textContent='PDF de 1 página gerado.';
        }catch(error){if(status)status.textContent=error.message;}finally{busy=false;update();}
    }
    const api=Object.freeze({colors,labels,classify,fieldStatus,summarize,applicationOptions,build,active,refresh,style,popup,snapshot,filename,render,download});
    if(typeof module!=='undefined'&&module.exports)module.exports=api;root.SpraySummary=api;
})(typeof window!=='undefined'?window:globalThis);
