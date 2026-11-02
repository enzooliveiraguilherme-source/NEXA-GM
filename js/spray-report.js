(function(root){
    'use strict';
    const O=root.SprayOperations,W=1240,H=1754,left=64,width=W-128,bottom=1570;
    const ink='#102c4d',muted='#607086';
    const labels={completed:'Realizada',scheduled:'No prazo',attention:'Atenção',overdue:'Atrasada'};
    const num=value=>Number(value||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
    const ha=value=>num(value)+' ha';
    const date=value=>value?value.split('-').reverse().join('/'):'-';
    const canExport=state=>['admin','projetista'].includes(root.portalAccessRole)&&state?.userRole==='editor';
    const slug=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase();
    function title(application,label){
        if(application==='all')return 'Andamento da pulverização';
        if(application==='fungicide')return 'Andamento dos fungicidas';
        if(application==='insecticide')return 'Andamento dos inseticidas';
        const feminine=application==='desiccation'||/^\d+ª/.test(label);
        return `Andamento ${feminine?'da':'do'} ${label}`;
    }
    function snapshot(state){
        if(!canExport(state))throw Error('Somente Projetistas e Administradores no modo Editor podem exportar este relatório.');
        if(state.currentTab!=='pulverizacao')throw Error('Abra a Pulverização para exportar.');
        const source=root.SprayControl.reportData();
        const rows=source.rows.filter(r=>!r.deleted&&!r.optional&&!r.unplanned).map(r=>({...r}));
        if(!rows.length)throw Error('Não há aplicações nos filtros selecionados.');
        rows.sort((a,b)=>a.farm.localeCompare(b.farm,'pt-BR')||a.field.localeCompare(b.field,'pt-BR',{numeric:true})||
            (a.planned||'').localeCompare(b.planned||'')||a.name.localeCompare(b.name,'pt-BR'));
        const scope=state.currentFazenda!=='ALL'?state.currentFazenda:state.currentGleba!=='ALL'?'Gleba '+state.currentGleba:'Todas as glebas';
        const farms=[...new Set(rows.map(r=>r.farm))].map(code=>({code,name:root.portalFarms?.find(f=>f.code===code)?.name||code,
            rows:rows.filter(r=>r.farm===code),features:source.features.filter(f=>f.properties?.Fazenda===code)}));
        for(const farm of farms)farm.totals=O.summarize(farm.rows);
        const groups=O.applicationOptions(rows).filter(g=>!['all','fungicide','insecticide'].includes(g.key))
            .map(g=>({...g,totals:O.summarize(rows.filter(r=>O.applicationKey(r)===g.key))}));
        const now=new Date(),parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
        const part=type=>parts.find(p=>p.type===type).value;
        return {rows,farms,groups,totals:O.summarize(rows),title:title(source.application,source.applicationLabel),application:source.application,
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
    function lines(ctx,value,maxWidth,size=20){
        font(ctx,size);const output=[];let line='';
        for(const word of String(value??'').split(/\s+/)){
            const next=line?line+' '+word:word;
            if(ctx.measureText(next).width<=maxWidth){line=next;continue;}
            if(line){output.push(line);line='';}
            for(const char of word){if(line&&ctx.measureText(line+char).width>maxWidth){output.push(line);line='';}line+=char;}
        }
        if(line)output.push(line);return output.length?output:['-'];
    }
    function cards(ctx,totals,y){
        const progress=totals.total?100*totals.completed/totals.total:0;
        [['ÁREA PROGRAMADA',ha(totals.plannedArea),'#347c99'],['ÁREA APLICADA',ha(totals.appliedArea),'#1673d1'],['CONCLUÍDO',progress.toFixed(1).replace('.',',')+'%','#b68135']]
            .forEach(([label,value,color],i)=>{const x=left+i*379;rect(ctx,x,y,354,120,'white');rect(ctx,x,y,354,5,color,0);
                text(ctx,label,x+20,y+36,19,color,true);text(ctx,value,x+20,y+88,34,ink,true,315);});
    }
    function drawMap(ctx,farm,y,height){
        const shapes=farm.features.map(feature=>{const g=feature.geometry,polys=g?.type==='Polygon'?[g.coordinates]:g?.type==='MultiPolygon'?g.coordinates:[];
            return {key:O.fieldKey(feature.properties.Fazenda,feature.properties.Campo),polys:polys.map(poly=>poly.map(ring=>ring.map(([lng,lat])=>{
                const rad=Math.max(-85,Math.min(85,lat))*Math.PI/180;return [(lng+180)/360,(1-Math.log(Math.tan(rad)+1/Math.cos(rad))/Math.PI)/2];})))};});
        const points=shapes.flatMap(s=>s.polys.flat(2));rect(ctx,left,y,width,height,'#e8edf2');
        if(!points.length){text(ctx,'Mapa indisponível para este recorte.',left+24,y+70,23,muted);return;}
        let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
        for(const [x,v]of points){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,v);maxY=Math.max(maxY,v);}
        const scale=Math.min((width-70)/Math.max(maxX-minX,1e-8),(height-70)/Math.max(maxY-minY,1e-8));
        const screen=([x,v])=>[left+width/2+(x-(minX+maxX)/2)*scale,y+height/2+(v-(minY+maxY)/2)*scale];
        ctx.save();ctx.beginPath();ctx.rect(left,y,width,height);ctx.clip();
        for(const shape of shapes){ctx.beginPath();for(const poly of shape.polys)for(const ring of poly){ring.forEach((p,i)=>{const pos=screen(p);if(i)ctx.lineTo(...pos);else ctx.moveTo(...pos);});ctx.closePath();}
            ctx.fillStyle=root.SprayControl.mapColors[O.mapStatus(farm.rows,shape.key)];ctx.fill('evenodd');ctx.strokeStyle='#16344a';ctx.lineWidth=1.5;ctx.stroke();}
        ctx.restore();
    }
    async function render(data,onProgress=()=>{}){
        if(!root.PlantingReport?.pdfFromImages)throw Error('O gerador de PDF não carregou. Atualize a página.');
        if(document.fonts)await document.fonts.ready;
        const measure=document.createElement('canvas'),ctxMeasure=measure.getContext('2d'),pages=[];
        let logo=null;
        try{logo=await new Promise((resolve,reject)=>{const img=new Image(),timer=setTimeout(()=>reject(Error('Logo indisponível')),5000);
            img.onload=()=>{clearTimeout(timer);resolve(img);};img.onerror=()=>{clearTimeout(timer);reject(Error('Logo indisponível'));};img.src='apoio/GP Michels.jpg';});}catch{/* Mantém o relatório disponível sem a marca. */}
        function page(section,scope){const result={draw:[],section,scope};pages.push(result);return result;}
        function table(section,scope,headers,widths,entries,start=350,initial=null){
            let current=initial||page(section,scope),y=start;
            const head=()=>{const top=y;current.draw.push(ctx=>{rect(ctx,left,top,width,45,ink,0);let x=left;headers.forEach((h,i)=>{text(ctx,h,x+12,top+29,18,'white',true,widths[i]-24);x+=widths[i];});});y+=45;};head();
            for(const [index,entry]of entries.entries()){
                const cells=entry.cells.map((value,i)=>lines(ctxMeasure,value,widths[i]-24));
                const detail=entry.detail?lines(ctxMeasure,entry.detail,width-28,18):[];
                const mainHeight=Math.max(48,Math.max(...cells.map(c=>c.length))*27+20),height=mainHeight+(detail.length?detail.length*24+14:0);
                if(y+height>bottom){current=page(section+' - continuação',scope);y=350;head();}
                const top=y;current.draw.push(ctx=>{rect(ctx,left,top,width,height,index%2?'#e8eef4':'white',0);let x=left;
                    cells.forEach((list,i)=>{list.forEach((value,j)=>text(ctx,value,x+12,top+31+j*27,20,i===4&&entry.color?entry.color:ink));x+=widths[i];});
                    detail.forEach((value,j)=>text(ctx,value,left+14,top+mainHeight+22+j*24,18,muted));});
                y+=height;
            }
        }
        const summary=page('Resumo geral',data.scope);
        summary.draw.push(ctx=>{cards(ctx,data.totals,350);text(ctx,`${data.totals.total} aplicações | ${data.totals.completed} realizadas | ${data.totals.pending} pendentes`,left,520,24,ink,true);
            text(ctx,`${data.totals.scheduled} no prazo | ${data.totals.attention} em atenção | ${data.totals.overdue} atrasadas`,left,560,23,muted);
            text(ctx,`${data.farms.length} fazenda(s) | ${new Set(data.rows.map(r=>r.fieldKey)).size} talhões`,left,600,23,muted);});
        table('Resumo por aplicação',data.scope,['Aplicação','Previstas','Realizadas','Pendentes','Atrasadas','Área aplicada'],[342,145,145,145,145,190],
            data.groups.map(g=>({cells:[g.label,String(g.totals.total),String(g.totals.completed),String(g.totals.pending),String(g.totals.overdue),ha(g.totals.appliedArea)]})),650,summary);
        for(const farm of data.farms){
            const map=page('Mapa de acompanhamento',farm.name);
            map.draw.push(ctx=>{cards(ctx,farm.totals,350);drawMap(ctx,farm,510,820);
                const legend=[['completed','Realizada'],['scheduled','No prazo'],['attention','Atenção'],['pending','Atrasada'],['empty','Sem registro neste filtro']];
                legend.forEach(([status,label],i)=>{const x=left+(i%3)*379,y=1370+Math.floor(i/3)*44;rect(ctx,x,y,17,17,root.SprayControl.mapColors[status],3);text(ctx,label,x+28,y+17,20,ink,false,325);});
                text(ctx,`${farm.totals.total} aplicações | ${farm.totals.completed} realizadas | ${farm.totals.overdue} atrasadas`,left,1510,23,muted);});
            table('Cronograma de aplicações',farm.name,['Talhão','Aplicação','Prevista','Realizada','Status','Área (ha)'],[145,245,166,190,204,162],
                farm.rows.map(r=>({cells:[r.field,r.name,date(r.planned),r.actual?date(r.actual):r.completedWithoutDate?'Aplicada sem data':'-',labels[r.status]||r.status,num(r.area)],
                    color:r.status==='overdue'?'#c32626':r.status==='attention'?'#946800':r.status==='completed'?'#1673d1':ink,
                    detail:[r.product&&`Produto: ${r.product}`,r.dose!==null&&r.dose!==undefined&&r.dose!==''&&`Dose: ${num(r.dose)} ${r.doseUnit||''}`,r.responsible&&`Responsável: ${r.responsible}`].filter(Boolean).join(' | ')})));
        }
        measure.width=1;measure.height=1;
        const images=[];
        for(const [index,spec]of pages.entries()){
            onProgress(`Preparando página ${index+1} de ${pages.length}…`);
            const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;const ctx=canvas.getContext('2d');
            ctx.fillStyle='#f3f7fa';ctx.fillRect(0,0,W,H);rect(ctx,0,0,W,178,'white',0);rect(ctx,0,174,W,4,'#eb7825',0);
            if(logo)ctx.drawImage(logo,logo.naturalWidth*.07,logo.naturalHeight*.27,logo.naturalWidth*.89,logo.naturalHeight*.46,64,35,200,104);
            text(ctx,data.title.toUpperCase(),300,60,23,muted,true,870);text(ctx,spec.scope,300,118,37,ink,true,870);
            text(ctx,`${data.culture} | Safra ${data.year} | ${data.scope}`,left,218,22,muted,false,width);
            text(ctx,spec.section,left,283,36,ink,true,width);
            if(data.filterLabels.length)text(ctx,data.filterLabels.join(' | '),left,320,17,muted,false,width);
            spec.draw.forEach(draw=>draw(ctx));
            text(ctx,'Áreas somadas por aplicação; um talhão pode participar de várias etapas.',left,1657,18,muted,false,width);
            text(ctx,`NEXA | Emitido em ${data.issued}`,left,1710,18,muted,false,950);
            ctx.textAlign='right';text(ctx,`${index+1} / ${pages.length}`,W-left,1710,18,muted);ctx.textAlign='left';
            const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.92));
            if(!blob)throw Error('Não foi possível preparar uma página do PDF.');
            images.push(new Uint8Array(await blob.arrayBuffer()));canvas.width=1;canvas.height=1;
            await new Promise(resolve=>setTimeout(resolve,0));
        }
        return {blob:root.PlantingReport.pdfFromImages(images),pageCount:images.length};
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
            if(status)status.textContent=`PDF gerado com ${result.pageCount} páginas.`;
        }catch(error){if(status)status.textContent=error.message;}
        finally{busy=false;if(button){button.hidden=!canExport(state);try{root.SprayControl.reportData();button.disabled=false;}catch{button.disabled=true;}}}
    }
    root.SprayReport=Object.freeze({title,snapshot,filename,render,download,get busy(){return busy;}});
})(window);
