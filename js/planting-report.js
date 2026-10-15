(function(root) {
    'use strict';
    const F = root.PlantingForecast;
    const num = value => Number(value || 0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
    const ha = value => num(value) + ' ha';
    const date = value => value ? value.split('-').reverse().join('/') : 'Sem previsão';
    const varietyKey = row => F.normalize(row.variety || 'Não informada').replace(/\s/g, '');
    const canExport = state => ['admin','projetista'].includes(root.portalAccessRole) && state?.userRole === 'editor';
    const slug = value => F.normalize(value).replace(/[^A-Z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase();
    const W=1240, H=1754, left=64, width=W-128, bottom=1450;
    const ink='#102c4d', muted='#607086', green='#008b50';

    function aggregate(rows) {
        const varieties=new Map(), days=new Map();
        let plantedArea=0, estimatedArea=0;
        for(const row of rows) {
            if(!row.planted)continue;
            plantedArea+=row.plantedArea;
            const key=varietyKey(row);
            const v=varieties.get(key)||{key,label:row.variety||'Não informada',area:0,fields:0};
            v.area+=row.plantedArea;v.fields++;varieties.set(key,v);
            if(row.estimatedDate) {
                estimatedArea+=row.plantedArea;
                const d=days.get(row.estimatedDate)||{key:row.estimatedDate,label:date(row.estimatedDate),area:0,fields:0};
                d.area+=row.plantedArea;d.fields++;days.set(d.key,d);
            }
        }
        const sortedDays=[...days.values()].sort((a,b)=>a.key.localeCompare(b.key));
        let accumulated=0;
        for(const day of sortedDays){accumulated+=day.area;day.accumulated=accumulated;}
        return {plantedArea,estimatedArea,withoutForecast:Math.max(0,plantedArea-estimatedArea),
            plantedFields:rows.filter(r=>r.planted).length,unplantedFields:rows.filter(r=>!r.planted).length,
            varieties:[...varieties.values()].sort((a,b)=>a.key.localeCompare(b.key)),days:sortedDays,
            first:sortedDays[0]?.key,last:sortedDays.at(-1)?.key};
    }

    function snapshot(state) {
        if(!canExport(state))throw Error('Somente Projetistas e Administradores no modo Editor podem exportar este relatório.');
        if(!root.PlantingMaps.active(state))throw Error('Abra Data estimada de colheita ou Variedades plantadas.');
        if(!state.geojsonData || !state.cloudStore)throw Error('Aguarde o carregamento dos talhões e do plantio.');
        const records=new Map(Object.values(state.cloudStore.getRecords()).filter(r=>r.operationType==='plantio'||r.produto==='Plantio')
            .map(r=>[F.key(r.fazenda,r.campo,r.ano,r.cultura),r]));
        const seen=new Set(),rows=[];
        for(const feature of state.geojsonData.features.filter(root.featureMatchesFilters)) {
            const p=feature.properties||{},key=F.key(p.Fazenda,p.Campo,state.currentAno,state.currentCultura);
            if(seen.has(key))continue;seen.add(key);
            rows.push({...F.project(feature,records.get(key),state.currentCultura),feature});
        }
        if(!rows.length)throw Error('Não há talhões nos filtros selecionados.');
        if(!rows.some(r=>r.planted))throw Error('Não há plantio executado nos filtros selecionados.');
        rows.sort((a,b)=>a.farm.localeCompare(b.farm,'pt-BR')||a.field.localeCompare(b.field,'pt-BR',{numeric:true}));
        const scope=state.currentFazenda!=='ALL'?state.currentFazenda:state.currentGleba!=='ALL'?'Gleba '+state.currentGleba:'Todas as glebas';
        const farmName=code=>root.portalFarms?.find(f=>f.code===code)?.name||code;
        const farms=[...new Set(rows.map(r=>r.farm))].map(code=>({code,name:farmName(code),rows:rows.filter(r=>r.farm===code)}));
        for(const farm of farms)farm.totals=aggregate(farm.rows);
        const now=new Date(),parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
        const part=type=>parts.find(p=>p.type===type).value;
        const isoDate=`${part('year')}-${part('month')}-${part('day')}`;
        return {rows,farms,totals:aggregate(rows),scope,year:String(state.currentAno),culture:state.currentCultura,
            issued:now.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',hour12:false}),isoDate,
            catalogAvailable:root.SeedCycleCatalog?.available!==false};
    }

    function filename(data){return `plantio-variedades-colheita-${slug(data.scope)}-${slug(data.culture)}-${slug(data.year)}-${data.isoDate}.pdf`;}
    function colors(items){return new Map(items.filter(r=>r.key!=='NAOINFORMADA').map((r,i)=>[r.key,root.PlantingMaps.palette[i%root.PlantingMaps.palette.length]]));}
    function text(ctx,value,x,y,size=23,color=ink,bold=false,maxWidth) {
        ctx.fillStyle=color;ctx.font=`${bold?700:400} ${size}px "Century Gothic", Arial, sans-serif`;
        let label=String(value??'');
        if(maxWidth)while(label.length&&ctx.measureText(label).width>maxWidth)label=label.slice(0,-2)+'…';
        ctx.fillText(label,x,y);
    }
    function rect(ctx,x,y,w,h,color,r=12){ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();}
    function wrapped(ctx,value,x,y,maxWidth,size=21,lineHeight=30,color=muted) {
        ctx.font=`400 ${size}px "Century Gothic", Arial, sans-serif`;
        let line='';
        for(const word of String(value).split(/\s+/)){const next=line?line+' '+word:word;
            if(line&&ctx.measureText(next).width>maxWidth){text(ctx,line,x,y,size,color);line=word;y+=lineHeight;}else line=next;}
        if(line){text(ctx,line,x,y,size,color);y+=lineHeight;}return y;
    }
    function cards(ctx,totals,y) {
        const cards=[['ÁREA PLANTADA',ha(totals.plantedArea),green],['COM PREVISÃO',ha(totals.estimatedArea),'#005eea'],['SEM PREVISÃO',ha(totals.withoutForecast),'#b16a00']];
        cards.forEach(([label,value,color],i)=>{const x=left+i*379;rect(ctx,x,y,354,120,'#ffffff');rect(ctx,x,y,354,5,color,0);text(ctx,label,x+20,y+36,19,color,true);text(ctx,value,x+20,y+88,34,ink,true,315);});
    }
    function drawMap(ctx,rows,groupColors,y,harvest=false,height=600) {
        const shapes=[];
        for(const row of rows){const g=row.feature.geometry,polys=g?.type==='Polygon'?[g.coordinates]:g?.type==='MultiPolygon'?g.coordinates:[];
            shapes.push({row,polys:polys.map(poly=>poly.map(ring=>ring.map(([lng,lat])=>{const rad=Math.max(-85,Math.min(85,lat))*Math.PI/180;return [(lng+180)/360,(1-Math.log(Math.tan(rad)+1/Math.cos(rad))/Math.PI)/2];})))});}
        const points=shapes.flatMap(s=>s.polys.flat(2));
        rect(ctx,left,y,width,height,'#e8edf2');
        if(!points.length){text(ctx,'Mapa indisponível para este recorte.',left+24,y+70,23,muted);return;}
        const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
        const scale=Math.min((width-70)/Math.max(maxX-minX,1e-8),(height-70)/Math.max(maxY-minY,1e-8));
        const screen=([x,v])=>[left+width/2+(x-(minX+maxX)/2)*scale,y+height/2+(v-(minY+maxY)/2)*scale];
        ctx.save();ctx.beginPath();ctx.rect(left,y,width,height);ctx.clip();
        for(const {row,polys} of shapes){ctx.beginPath();for(const poly of polys)for(const ring of poly){ring.forEach((point,i)=>{const pos=screen(point);if(i)ctx.lineTo(...pos);else ctx.moveTo(...pos);});ctx.closePath();}
            const key=harvest?row.estimatedDate:varietyKey(row);
            ctx.fillStyle=row.planted&&key?groupColors.get(key)||'#c5ced7':'#c5ced7';ctx.fill('evenodd');ctx.strokeStyle='#16344a';ctx.lineWidth=1.5;ctx.setLineDash(row.partial?[7,5]:[]);ctx.stroke();}
        ctx.restore();ctx.setLineDash([]);
    }

    // Each page is rendered locally. The PDF contains JPEG pages and needs no external service.
    function pdfFromImages(images) {
        const encoder=new TextEncoder(),chunks=[],offsets=[0];let length=0;
        const add=value=>{const bytes=typeof value==='string'?encoder.encode(value):value;chunks.push(bytes);length+=bytes.length;};
        const obj=(id,body)=>{offsets[id]=length;add(`${id} 0 obj\n`);add(body);add('\nendobj\n');};
        add('%PDF-1.4\n');
        obj(1,'<< /Type /Catalog /Pages 2 0 R >>');
        obj(2,`<< /Type /Pages /Count ${images.length} /Kids [${images.map((_,i)=>`${5+i*3} 0 R`).join(' ')}] >>`);
        images.forEach((image,i)=>{const id=3+i*3;offsets[id]=length;
            add(`${id} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`);
            add(image);add('\nendstream\nendobj\n');
            const stream='q\n595.28 0 0 841.89 0 0 cm\n/Im0 Do\nQ\n';
            obj(id+1,`<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}endstream`);
            obj(id+2,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${id} 0 R >> >> /Contents ${id+1} 0 R >>`);
        });
        const start=length,count=3+images.length*3;
        add(`xref\n0 ${count}\n0000000000 65535 f \n`);
        for(let i=1;i<count;i++)add(`${String(offsets[i]).padStart(10,'0')} 00000 n \n`);
        add(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
        return new Blob(chunks,{type:'application/pdf'});
    }

    async function render(data,onProgress=()=>{}) {
        if(document.fonts)await document.fonts.ready;
        const pages=[],images=[],varietyColors=colors(data.totals.varieties),dayColors=colors(data.totals.days);
        varietyColors.set('NAOINFORMADA','#94a3b8');
        const tablePages=(count,start)=>1+Math.ceil(Math.max(0,count-Math.floor((bottom-start-45)/43))/Math.floor((bottom-350-45)/43));
        const pageCount=tablePages(data.totals.varieties.length,540)+tablePages(data.totals.days.length,540)+data.farms.reduce((total,farm)=>{
            const fields=farm.rows.filter(r=>r.planted),pending=fields.filter(r=>!r.estimatedDate);
            return total+tablePages(farm.totals.varieties.length,1020)+tablePages(farm.totals.days.length,1020)+(fields.length?tablePages(fields.length,350):0)+(pending.length?tablePages(pending.length,350):0);
        },0);
        async function encodePages() {
            for(const {ctx,canvas} of pages.splice(0)) {
                if(!data.catalogAvailable)text(ctx,'ATENÇÃO: catálogo de ciclos indisponível; previsões ausentes.',left,1710,18,'#a34800',true,width);
                else text(ctx,`NEXA | Emitido em ${data.issued}`,left,1710,18,muted,false,950);
                ctx.textAlign='right';text(ctx,`${images.length+1} / ${pageCount}`,W-left,1710,18,muted);ctx.textAlign='left';
                const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.92));
                if(!blob)throw Error('Não foi possível preparar uma página do PDF.');
                images.push(new Uint8Array(await blob.arrayBuffer()));canvas.width=1;canvas.height=1;
            }
        }
        let logo=null;
        try{logo=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src='apoio/GP Michels.jpg';});}catch{/* Report remains usable without the logo. */}
        function page(title,scope,section) {
            const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
            const ctx=canvas.getContext('2d');ctx.fillStyle='#f3f7fa';ctx.fillRect(0,0,W,H);
            rect(ctx,0,0,W,178,'white',0);rect(ctx,0,174,W,4,'#eb7825',0);
            if(logo)ctx.drawImage(logo,logo.naturalWidth*.07,logo.naturalHeight*.27,logo.naturalWidth*.89,logo.naturalHeight*.46,64,35,200,104);
            text(ctx,'PLANTIO E PREVISÃO DE COLHEITA',300,60,24,muted,true,870);
            text(ctx,scope,300,118,37,ink,true,870);
            text(ctx,`${data.culture} | Safra ${data.year} | ${data.scope}`,left,218,22,muted,false,width);
            text(ctx,title,left,283,36,ink,true,width);
            pages.push({canvas,ctx,scope,section});return ctx;
        }
        function notes(ctx,totals,scopeRows,top=1472) {
            let y=top+28;rect(ctx,left,top,width,204,'#e7eef4');
            const peak=totals.days.reduce((best,day)=>!best||day.area>best.area?day:best,null);
            const dominant=totals.varieties.reduce((best,v)=>!best||v.area>best.area?v:best,null);
            const insight=[peak?`Maior volume estimado: ${date(peak.key)} (${ha(peak.area)}).`:'Nenhuma data estimada disponível.',
                dominant?`Variedade predominante: ${dominant.label} (${(100*dominant.area/totals.plantedArea).toFixed(1).replace('.',',')}%).`:''].join(' ');
            y=wrapped(ctx,insight,left+18,y,width-36,19,25);
            y=wrapped(ctx,'Estimativa = data de plantio + ciclo cadastrado pelo ADM. Confirme a maturação no campo.',left+18,y+3,width-36,19,25);
            const partial=scopeRows.filter(r=>r.partial).length;
            wrapped(ctx,`${partial} talhão(ões) com plantio parcial; somente os hectares realizados são somados. ${totals.unplantedFields} sem plantio executado. Área sem previsão: ${ha(totals.withoutForecast)}.`,left+18,y+3,width-36,19,25);
        }
        function table(title,scope,section,headers,widths,rows,totals,scopeRows,start=350,ctx=null) {
            let y=start;
            const head=()=>{rect(ctx,left,y,width,45,ink,0);let x=left;headers.forEach((h,i)=>{text(ctx,h,x+12,y+29,19,'white',true,widths[i]-24);x+=widths[i];});y+=45;};
            const next=()=>{notes(ctx,totals,scopeRows);ctx=page(title+' - continuação',scope,section);y=350;head();};
            if(!ctx)ctx=page(title,scope,section);head();
            if(!rows.length){text(ctx,'Nenhum dado para esta seção nos filtros selecionados.',left+15,y+40,23,muted);}
            rows.forEach((row,index)=>{if(y+43>bottom)next();rect(ctx,left,y,width,43,index%2?'#e8eef4':'white',0);let x=left;
                row.forEach((cell,i)=>{const value=typeof cell==='object'?cell.label:cell;
                    if(cell?.color){rect(ctx,x+12,y+14,15,15,cell.color,3);text(ctx,value,x+38,y+29,21,ink,false,widths[i]-50);}
                    else text(ctx,value,x+12,y+29,21,ink,false,widths[i]-24);x+=widths[i];});y+=43;});
            notes(ctx,totals,scopeRows,Math.min(y+28,1472));return {ctx,y};
        }
        const scheduleRows=totals=>totals.days.map(d=>[{label:d.label,color:dayColors.get(d.key)},String(d.fields),ha(d.area),ha(d.accumulated)]);
        let ctx;
        // Keep each farm's maps, corresponding tables and field details together.
        for(const farm of data.farms) {
            onProgress(`Preparando mapas de ${farm.name}…`);
            ctx=page('Mapa de variedades plantadas',farm.name,'Variedades');
            drawMap(ctx,farm.rows,varietyColors,320);
            text(ctx,`Área plantada: ${ha(farm.totals.plantedArea)} | Cinza: sem plantio | Tracejado: parcial`,left,965,21,muted,false,width);
            const rows=farm.totals.varieties.map(v=>[{label:v.label,color:varietyColors.get(v.key)},String(v.fields),ha(v.area),farm.totals.plantedArea?(100*v.area/farm.totals.plantedArea).toFixed(1).replace('.',',')+'%':'0%']);
            table('Variedades plantadas',farm.name,'Variedades',['Variedade','Talhões','Área plantada','Participação'],[430,160,280,242],rows,farm.totals,farm.rows,1020,ctx);
            ctx=page('Mapa do dia estimado de colheita',farm.name,'Colheita');
            drawMap(ctx,farm.rows,dayColors,320,true);
            text(ctx,`Com previsão: ${ha(farm.totals.estimatedArea)} | Cinza: sem previsão / sem plantio`,left,965,21,muted,false,width);
            table('Dia estimado de colheita',farm.name,'Colheita',['Data estimada','Talhões','Área no dia','Área acumulada'],[340,180,296,296],scheduleRows(farm.totals),farm.totals,farm.rows,1020,ctx);
            const fields=farm.rows.filter(r=>r.planted).sort((a,b)=>(a.estimatedDate||'9999').localeCompare(b.estimatedDate||'9999')||a.field.localeCompare(b.field,'pt-BR',{numeric:true}));
            const details=fields.map(r=>[r.field,r.variety||'Não informada',date(r.plantingDate),r.days?String(r.days)+' d':'Sem ciclo',date(r.estimatedDate),ha(r.plantedArea)]);
            if(details.length)table('Detalhamento dos talhões',farm.name,'Talhões',['Talhão','Variedade','Plantio','Ciclo','Colheita estimada','Área plantada'],[175,210,180,135,220,192],details,farm.totals,farm.rows);
            const pending=fields.filter(r=>!r.estimatedDate);
            if(pending.length)table('Pendências para previsão',farm.name,'Pendências',['Talhão','Variedade','Área plantada','Pendência'],[200,260,200,452],pending.map(r=>[r.field,r.variety||'Não informada',ha(r.plantedArea),r.reason]),farm.totals,farm.rows);
            await encodePages();
            await new Promise(resolve=>setTimeout(resolve,0));
        }
        const totalRows=data.totals.varieties.map(v=>[{label:v.label,color:varietyColors.get(v.key)},String(v.fields),ha(v.area),(100*v.area/data.totals.plantedArea).toFixed(1).replace('.',',')+'%']);
        ctx=page('Variedades plantadas - resumo geral',data.scope,'Resumo geral');cards(ctx,data.totals,320);
        text(ctx,`${data.farms.length} fazenda(s) | ${data.totals.plantedFields} talhões com execução`,left,493,24,muted);
        table('Variedades plantadas - resumo geral',data.scope,'Resumo geral',['Variedade','Talhões','Área plantada','Participação'],[430,160,280,242],totalRows,data.totals,data.rows,540,ctx);
        ctx=page('Dia estimado de colheita - resumo geral',data.scope,'Resumo geral');cards(ctx,data.totals,320);
        text(ctx,'Talhões com a mesma data são somados na mesma linha.',left,493,23,muted);
        table('Dia estimado de colheita - resumo geral',data.scope,'Resumo geral',['Data estimada','Talhões','Área no dia','Área acumulada'],[340,180,296,296],scheduleRows(data.totals),data.totals,data.rows,540,ctx);
        await encodePages();
        if(images.length!==pageCount)throw Error('Falha na paginação do relatório.');
        return {blob:pdfFromImages(images),pageCount:images.length};
    }
    let busy=false;
    async function download(state) {
        if(busy)return;
        const button=document.getElementById('planting-report-button'),status=document.getElementById('planting-report-status');
        try {
            const data=snapshot(state);busy=true;if(button)button.disabled=true;
            if(status)status.textContent='Preparando relatório PDF…';
            const {blob,pageCount}=await render(data,message=>{if(status)status.textContent=message;});
            if(!canExport(state))throw Error('Seu perfil ou modo de visualização não permite exportar este relatório.');
            const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename(data);
            document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
            if(status)status.textContent=`PDF gerado com ${pageCount} páginas.`;
        }catch(error){if(status)status.textContent=error.message;}
        finally {busy=false;if(button)button.disabled=false;}
    }
    root.PlantingReport=Object.freeze({aggregate,snapshot,filename,pdfFromImages,render,download});
})(window);
