(function(root){
    'use strict';
    const O=root.SprayOperations,W=1240,H=1754,left=64,width=W-128;
    const ink='#102c4d',muted='#607086';
    const num=value=>Number(value||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
    const ha=value=>num(value)+' ha';
    const canExport=state=>['admin','projetista'].includes(root.portalAccessRole)&&state?.userRole==='editor';
    const slug=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase();
    function title(application,label){
        return `Resumo de aplicação - ${application==='all'?'Pulverização':application==='fungicide'?'Fungicidas':application==='insecticide'?'Inseticidas':label}`;
    }
    function snapshot(state){
        if(!canExport(state))throw Error('Somente Projetistas e Administradores no modo Editor podem exportar este relatório.');
        if(state.currentTab!=='pulverizacao')throw Error('Abra a Pulverização para exportar.');
        const source=root.SprayControl.reportData({wholeFarm:true});
        const rows=source.rows.filter(r=>!r.deleted&&!r.optional&&!r.unplanned).map(r=>({...r}));
        if(!rows.length)throw Error('Não há aplicações nos filtros selecionados.');
        rows.sort((a,b)=>a.farm.localeCompare(b.farm,'pt-BR')||a.field.localeCompare(b.field,'pt-BR',{numeric:true})||
            (a.planned||'').localeCompare(b.planned||'')||a.name.localeCompare(b.name,'pt-BR'));
        const selectedFarm=source.farm||state.currentFazenda;
        const scope=selectedFarm!=='ALL'?selectedFarm:state.currentGleba!=='ALL'?'Gleba '+state.currentGleba:'Todas as glebas';
        const farms=[...new Set(rows.map(r=>r.farm))].map(code=>({code,name:root.portalFarms?.find(f=>f.code===code)?.name||code,
            rows:rows.filter(r=>r.farm===code),features:source.features.filter(f=>f.properties?.Fazenda===code)}));
        for(const farm of farms)farm.totals=O.summarize(farm.rows);
        const groups=O.applicationOptions(rows).filter(g=>!['all','fungicide','insecticide'].includes(g.key))
            .map(g=>({...g,totals:O.summarize(rows.filter(r=>O.applicationKey(r)===g.key))}));
        const now=new Date(),parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
        const part=type=>parts.find(p=>p.type===type).value;
        const scopeName=root.portalFarms?.find(f=>f.code===scope)?.name||scope;
        return {rows,farms,groups,scopeName,satellite:!document.querySelector?.('input[name="basemap"][value="blank"]')?.checked,totals:O.areaSummary(rows),title:title(source.application,source.applicationLabel),application:source.application,
            applicationLabel:source.applicationLabel,filterLabels:[...source.filterLabels],scope,year:String(state.currentAno),culture:state.currentCultura,
            issued:now.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',hour12:false}),isoDate:`${part('year')}-${part('month')}-${part('day')}`};
    }
    const filename=data=>`${slug(data.title)}-${slug(data.scope)}-${slug(data.culture)}-${slug(data.year)}-${data.isoDate}.pdf`;
    function font(ctx,size=21,bold=false){ctx.font=`${bold?700:400} ${size}px "Century Gothic", Arial, sans-serif`;}
    function text(ctx,value,x,y,size=21,color=ink,bold=false,maxWidth){
        font(ctx,size,bold);ctx.fillStyle=color;let s=String(value??'');
        if(maxWidth&&ctx.measureText(s).width>maxWidth){while(s.length&&ctx.measureText(s+'…').width>maxWidth)s=s.slice(0,-1);s+='…';}
        ctx.fillText(s,x,y);
    }
    function rect(ctx,x,y,w,h,color,r=12){ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();}
    async function render(data,onProgress=()=>{}){
        if(!root.PlantingReport?.pdfFromImages||!root.OperationExport?.drawMap)throw Error('O gerador de PDF não carregou. Atualize a página.');
        if(document.fonts)await document.fonts.ready;
        onProgress('Preparando página 1 de 1…');
        const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;const ctx=canvas.getContext('2d');
        ctx.fillStyle='#f3f7fa';ctx.fillRect(0,0,W,H);rect(ctx,0,0,W,178,'white',0);rect(ctx,0,174,W,4,'#eb7825',0);
        let logo=null;
        try{logo=await new Promise((resolve,reject)=>{const img=new Image(),timer=setTimeout(()=>reject(Error('Logo indisponível')),5000);
            img.onload=()=>{clearTimeout(timer);resolve(img);};img.onerror=()=>{clearTimeout(timer);reject(Error('Logo indisponível'));};img.src='apoio/GP Michels.jpg';});}catch{}
        if(logo)ctx.drawImage(logo,logo.naturalWidth*.07,logo.naturalHeight*.27,logo.naturalWidth*.89,logo.naturalHeight*.46,52,42,202,104);
        ctx.textAlign='center';text(ctx,data.title,630,65,29,muted,true,690);text(ctx,data.scopeName||data.scope,630,122,40,ink,true,690);ctx.textAlign='left';
        text(ctx,`Cultura: ${data.culture}`,left,218,20,muted,false,300);
        ctx.textAlign='center';text(ctx,`Ano / Safra: ${data.year}`,630,218,23,ink,true,350);
        ctx.textAlign='right';text(ctx,`Atualizado em ${data.isoDate.split('-').reverse().join('/')}`,W-left,218,18,muted);ctx.textAlign='left';
        const palette=root.SprayControl.mapColors;
        const t=data.totals,progress=Math.max(0,Math.min(100,t.progress));
        const cards=[['ÁREA PROGRAMADA',ha(t.plannedArea),'Área total programada','#347c99'],
            ['ÁREA APLICADA',ha(t.appliedArea),'Realizado até o momento',palette.completed],
            ['PROGRESSO',progress.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'%',`${ha(Math.max(0,t.plannedArea-t.appliedArea))} restantes`,'#b68135']];
        cards.forEach(([label,value,sub,color],i)=>{const x=left+i*379;rect(ctx,x,260,354,164,'white');rect(ctx,x,260,354,6,color,0);
            text(ctx,label,x+22,300,20,color,true,310);text(ctx,value,x+22,356,38,ink,true,310);text(ctx,sub,x+22,394,18,muted,false,310);});
        const legend=[['Realizadas',t.appliedArea,t.completed,palette.completed],['No prazo',Math.max(0,t.onTimeArea-t.attentionArea),t.scheduled,palette.scheduled],
            ['Próximas da data',t.attentionArea,t.attention,palette.attention],['Atrasadas',t.overdueArea,t.overdue,palette.pending]];
        rect(ctx,left,445,width,12,'#e2e8f0',6);
        ctx.save();ctx.beginPath();ctx.roundRect(left,445,width,12,6);ctx.clip();let segmentX=left;
        for(const [,area,,color]of legend){const segmentWidth=t.plannedArea?width*area/t.plannedArea:0;ctx.fillStyle=color;ctx.fillRect(segmentX,445,segmentWidth,12);segmentX+=segmentWidth;}ctx.restore();
        const fields=data.farms.flatMap(farm=>farm.features.map(feature=>{const p=feature.properties||{},status=O.mapStatus(data.rows,O.fieldKey(p.Fazenda,p.Campo));
            return {feature,color:palette[status]};}));
        const missing=await root.OperationExport.drawMap(ctx,{fields,satellite:data.satellite},{x:left,y:483,w:width,h:900});
        const gap=14,cardWidth=(width-3*gap)/4;
        legend.forEach(([label,area,count,color],i)=>{const x=left+i*(cardWidth+gap);rect(ctx,x,1407,cardWidth,116,'white');rect(ctx,x+16,1426,17,17,color,3);
            text(ctx,label,x+42,1442,19,ink,true,cardWidth-54);text(ctx,ha(area),x+16,1476,23,ink,true,cardWidth-32);text(ctx,`${count} aplicações`,x+16,1504,17,muted,false,cardWidth-32);});
        text(ctx,'Área aplicada: hectares das aplicações realizadas, inclusive confirmações sem data.',left,1565,17,muted,false,width);
        if(['all','fungicide','insecticide'].includes(data.application))text(ctx,'Áreas somadas por aplicação; um talhão pode participar de várias etapas.',left,1595,17,muted,false,width);
        text(ctx,'Cinza: sem registro da aplicação neste filtro.',left,1633,17,muted,false,width);
        if(missing)text(ctx,'Parte do satélite não carregou; talhões e totais preservados.',left,1665,17,muted,false,width);
        text(ctx,`NEXA | Emitido em ${data.issued}`,left,1710,18,muted,false,1000);
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.92));
        if(!blob)throw Error('Não foi possível preparar o PDF.');
        const bytes=new Uint8Array(await blob.arrayBuffer());canvas.width=1;canvas.height=1;
        return {blob:root.PlantingReport.pdfFromImages([bytes]),pageCount:1};
    }
    let busy=false;
    async function download(state){
        if(busy)return;
        const button=document.getElementById('spray-report-button'),status=document.getElementById('spray-report-status');
        try{const data=snapshot(state);busy=true;if(button)button.disabled=true;if(status)status.textContent='Preparando relatório PDF…';
            const result=await render(data,message=>{if(status)status.textContent=message;});
            if(!canExport(state))throw Error('Seu perfil ou modo de visualização não permite exportar.');
            const url=URL.createObjectURL(result.blob),link=document.createElement('a');link.href=url;link.download=filename(data);
            document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
            if(status)status.textContent='PDF de 1 página gerado.';
        }catch(error){if(status)status.textContent=error.message;}
        finally{busy=false;if(button){button.hidden=!canExport(state);try{root.SprayControl.reportData();button.disabled=false;}catch{button.disabled=true;}}}
    }
    root.SprayReport=Object.freeze({title,snapshot,filename,render,download,get busy(){return busy;}});
})(window);
