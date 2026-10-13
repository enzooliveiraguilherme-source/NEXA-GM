(function(root) {
    'use strict';
    const colors={concluido:'#06b200',em_andamento:'#ffa000',nao_iniciado:'#ed3036'};
    let planning;
    const canExport=()=>['projetista','admin'].includes(root.portalAccessRole);
    const number=value=>Number(value).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
    const area=value=>`${number(value)} ha`;
    function summarize(features,isPlanned,getRecord) {
        const totals={areaPlanejada:0,areaRealizada:0,areaConcluido:0,countConcluido:0,areaAndamentoTotal:0,areaAndamentoRealizada:0,countAndamento:0,areaNaoIniciado:0,countNaoIniciado:0,fields:[]};
        const seen=new Set();
        for(const feature of features) {
            const p=feature.properties||{},key=JSON.stringify([p.Fazenda,p.Campo]);
            if(seen.has(key)||!isPlanned(feature))continue;
            seen.add(key);
            const hectares=Math.max(0,Number(p.Area)||0),record=getRecord(feature);
            const status=Object.hasOwn(colors,record.status)?record.status:'nao_iniciado';
            const done=status==='concluido'?hectares:status==='em_andamento'?Math.max(0,Math.min(hectares,Number(record.areaRealizada)||0)):0;
            totals.areaPlanejada+=hectares;totals.areaRealizada+=done;
            if(status==='concluido'){totals.areaConcluido+=hectares;totals.countConcluido++;}
            else if(status==='em_andamento'){totals.areaAndamentoTotal+=hectares;totals.areaAndamentoRealizada+=done;totals.countAndamento++;}
            else {totals.areaNaoIniciado+=hectares;totals.countNaoIniciado++;}
            totals.fields.push({feature,status,area:hectares,done});
        }
        totals.progress=totals.areaPlanejada?100*totals.areaRealizada/totals.areaPlanejada:0;
        return totals;
    }
    function snapshot(state) {
        if(!canExport())throw Error('Somente Projetistas e Administradores podem exportar o andamento.');
        if(!['plantio','adubacao'].includes(state.currentTab))throw Error('A exportação está disponível no Plantio e na Adubação.');
        if(!state.geojsonData)throw Error('Aguarde o carregamento dos talhões.');
        const features=state.geojsonData.features.filter(root.featureMatchesFilters);
        const totals=summarize(features,f=>planning.isTalhaoPlanned(f.properties.Fazenda,f.properties.Campo,state.currentAno,state.currentCultura,state.currentProduto),
            f=>root.getTalhaoRecord(f.properties.Fazenda,f.properties.Campo,state.currentAno,state.currentCultura,state.currentProduto,f.properties.Area));
        if(!totals.fields.length)throw Error('Não há talhões planejados nos filtros selecionados.');
        const farms=[...new Set(totals.fields.map(row=>row.feature.properties.Fazenda))].sort();
        const scope=state.currentFazenda!=='ALL'?state.currentFazenda:state.currentGleba!=='ALL'?state.currentGleba:farms.join(' / ');
        const name=root.portalFarms?.find(farm=>farm.code===scope)?.name;
        const now=new Date();
        return {...totals,operation:state.currentTab,operationName:state.currentTab==='plantio'?'Plantio':'Adubação',
            scope,scopeName:name||scope,farms,culture:state.currentCultura,year:String(state.currentAno),product:state.currentProduto,
            date:now.toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'}),isoDate:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now),
            satellite:!document.querySelector('input[name="basemap"][value="blank"]')?.checked};
    }
    const slug=text=>String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase();
    const filename=data=>`resumo-${slug(data.operationName)}-${slug(data.scopeName||data.scope)}-${slug(data.culture)}-${slug(data.year)}-${data.isoDate}.png`;
    function image(src) {
        return new Promise((resolve,reject)=>{const img=new Image();img.crossOrigin='anonymous';
            const timer=setTimeout(()=>{img.src='';reject(Error('Tempo excedido ao carregar o mapa.'));},12000);
            img.onload=()=>{clearTimeout(timer);resolve(img);};img.onerror=()=>{clearTimeout(timer);reject(Error('Imagem indisponível.'));};img.src=src;});
    }
    function box(ctx,x,y,w,h,color,radius=20){ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,radius);ctx.fill();}
    function label(ctx,value,x,y,size=24,color='#102c4d',weight=500,maxWidth){
        ctx.fillStyle=color;ctx.font=`${weight} ${size}px "Century Gothic", CenturyGothic, "Apple Gothic", Arial, sans-serif`;
        let text=String(value);if(maxWidth&&ctx.measureText(text).width>maxWidth){while(text.length&&ctx.measureText(text+'…').width>maxWidth)text=text.slice(0,-1);text+='…';}
        ctx.fillText(text,x,y);
    }
    // Web Mercator, a mesma projeção do mapa do portal.
    function project(point) {
        const lat=Math.max(-85.05112878,Math.min(85.05112878,point[1]))*Math.PI/180;
        return [(point[0]+180)/360,(1-Math.log(Math.tan(lat)+1/Math.cos(lat))/Math.PI)/2];
    }
    function polygons(geometry) {
        if(geometry?.type==='Polygon')return [geometry.coordinates];
        if(geometry?.type==='MultiPolygon')return geometry.coordinates;
        return [];
    }
    async function drawMap(ctx,data,rect) {
        const shapes=data.fields.map(row=>({...row,polygons:polygons(row.feature.geometry).map(poly=>poly.map(ring=>ring.map(project)))}));
        const points=shapes.flatMap(row=>row.polygons.flat(2));
        if(!points.length)throw Error('Os talhões selecionados não possuem polígonos para exportar.');
        let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
        for(const [x,y] of points){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
        const extentX=Math.max(1e-8,maxX-minX),extentY=Math.max(1e-8,maxY-minY);
        const scale=Math.min((rect.w-100)/extentX,(rect.h-100)/extentY),cx=(minX+maxX)/2,cy=(minY+maxY)/2;
        const screen=p=>[rect.x+rect.w/2+(p[0]-cx)*scale,rect.y+rect.h/2+(p[1]-cy)*scale];
        ctx.save();ctx.beginPath();ctx.roundRect(rect.x,rect.y,rect.w,rect.h,22);ctx.clip();
        ctx.fillStyle='#e6edf0';ctx.fillRect(rect.x,rect.y,rect.w,rect.h);
        let missing=0;
        if(data.satellite) {
            const zoom=Math.max(0,Math.min(18,Math.floor(Math.log2(scale/256)))),count=2**zoom,tileSize=scale/count;
            const left=cx-rect.w/(2*scale),top=cy-rect.h/(2*scale),right=cx+rect.w/(2*scale),bottom=cy+rect.h/(2*scale);
            const tiles=[];
            for(let y=Math.floor(top*count);y<=Math.floor(bottom*count);y++)for(let x=Math.floor(left*count);x<=Math.floor(right*count);x++)if(y>=0&&y<count){
                tiles.push({x,y,url:`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${y}/${((x%count)+count)%count}`});
            }
            // Limita downloads simultâneos para o celular permanecer responsivo.
            for(let at=0;at<tiles.length;at+=8)await Promise.all(tiles.slice(at,at+8).map(async tile=>{
                try{const img=await image(tile.url),pos=screen([tile.x/count,tile.y/count]);ctx.drawImage(img,pos[0],pos[1],tileSize+1,tileSize+1);}catch{missing++;}
            }));
            ctx.fillStyle='rgba(255,255,255,.62)';ctx.fillRect(rect.x,rect.y,rect.w,rect.h);
        }
        for(const row of shapes) {
            ctx.beginPath();
            for(const poly of row.polygons)for(const ring of poly){ring.forEach((p,i)=>{const pos=screen(p);if(i===0)ctx.moveTo(...pos);else ctx.lineTo(...pos);});ctx.closePath();}
            ctx.fillStyle=colors[row.status];ctx.globalAlpha=.98;ctx.fill('evenodd');ctx.globalAlpha=1;ctx.strokeStyle='#18342c';ctx.lineWidth=2;ctx.stroke();
        }
        ctx.restore();
        return missing;
    }
    async function render(data) {
        if(document.fonts)await document.fonts.ready;
        const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=1360;
        const ctx=canvas.getContext('2d');
        ctx.fillStyle='#f3f7fa';ctx.fillRect(0,0,1200,1360);
        box(ctx,0,0,1200,170,'white',0);box(ctx,0,166,1200,4,'#eb7825',0);
        ctx.textAlign='center';
        const title=data.operation==='adubacao'?`Resumo de aplicação - ${data.product}`:`Resumo de plantio - ${data.culture}`;
        let titleSize=30;
        while(titleSize>18){ctx.font=`600 ${titleSize}px "Century Gothic", CenturyGothic, "Apple Gothic", Arial, sans-serif`;if(ctx.measureText(title).width<=650)break;titleSize--;}
        label(ctx,title,600,65,titleSize,'#4c6781',600,650);
        label(ctx,data.scopeName,600,122,42,'#102c4d',700,650);
        ctx.textAlign='left';
        try{const logo=await image('apoio/GP Michels.jpg');box(ctx,38,28,230,132,'white',12);
            // Recorta apenas a margem branca da marca existente para ampliar o símbolo.
            ctx.drawImage(logo,logo.naturalWidth*.07,logo.naturalHeight*.27,logo.naturalWidth*.89,logo.naturalHeight*.46,52,42,202,104);
        }catch{/* O resumo continua disponível se a marca não carregar. */}
        ctx.textAlign='center';label(ctx,`Ano / Safra: ${data.year}`,600,214,24,'#102c4d',600,350);ctx.textAlign='left';
        if(data.operation==='adubacao')label(ctx,`Produto: ${data.product}`,48,242,19,'#5b6e7e',500,1100);
        ctx.textAlign='right';label(ctx,`Atualizado em ${data.date}`,1152,214,20,'#5b6e7e');ctx.textAlign='left';
        const cards=[['ÁREA PLANEJADA',area(data.areaPlanejada),'Área total programada','#347c99'],
            [data.operation==='plantio'?'ÁREA PLANTADA':'ÁREA APLICADA',area(data.areaRealizada),'Realizado até o momento','#079b00'],
            ['PROGRESSO',`${data.progress.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})}%`,`${area(data.areaPlanejada-data.areaRealizada)} restantes`,'#b68135']];
        cards.forEach((card,i)=>{const x=48+i*374;box(ctx,x,260,356,164,'white');box(ctx,x,260,356,6,card[3],0);
            label(ctx,card[0],x+22,300,20,card[3],700);label(ctx,card[1],x+22,356,40,'#102c4d',700,312);label(ctx,card[2],x+22,394,18,'#64748b');});
        box(ctx,48,445,1104,12,colors.nao_iniciado,6);if(data.progress>0)box(ctx,48,445,1104*data.progress/100,12,colors.concluido,6);
        const missing=await drawMap(ctx,data,{x:48,y:483,w:1104,h:690});
        const legend=[['concluido','Finalizado',data.areaConcluido,data.countConcluido],['em_andamento','Em andamento',data.areaAndamentoTotal,data.countAndamento],['nao_iniciado','Não iniciado',data.areaNaoIniciado,data.countNaoIniciado]];
        legend.forEach(([status,title,ha,count],i)=>{const x=48+i*374;box(ctx,x,1197,356,100,'white',14);box(ctx,x+20,1219,20,20,colors[status],4);
            label(ctx,title,x+52,1237,21,'#102c4d',600);label(ctx,`${area(ha)}  ·  ${count} talhões`,x+20,1267,18,'#64748b');
            if(status==='em_andamento')label(ctx,`${area(data.areaAndamentoRealizada)} realizados`,x+20,1289,15,'#64748b');});
        label(ctx,'Realizado = áreas finalizadas + hectares executados nos talhões em andamento.',48,1331,17,'#64748b',500,1100);
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
        if(!blob)throw Error('Não foi possível gerar a imagem.');
        return {blob,canvas,missing};
    }
    function init(state,planner) {
        planning=planner;
        const button=document.getElementById('operation-export-button'),dialog=document.getElementById('operation-export-dialog');
        if(!button||!dialog)return;
        button.hidden=!canExport();
        if(!canExport())return;
        const preview=document.getElementById('operation-export-preview'),status=document.getElementById('operation-export-status'),save=document.getElementById('operation-export-save'),share=document.getElementById('operation-export-share');
        let url=null,name='',file=null,busy=false,token=0;
        const revoke=()=>{if(url)URL.revokeObjectURL(url);url=null;};
        dialog.addEventListener('close',()=>{token++;revoke();file=null;preview.removeAttribute('src');save.disabled=true;if(share)share.hidden=true;busy=false;button.disabled=false;});
        button.onclick=async()=>{
            if(!canExport())return;
            if(busy)return;
            let data;try{data=snapshot(state);}catch(error){status.textContent=error.message;dialog.showModal();save.disabled=true;preview.hidden=true;return;}
            busy=true;button.disabled=true;const request=++token;revoke();preview.hidden=true;save.disabled=true;status.textContent='Preparando o resumo e carregando o mapa…';dialog.showModal();
            try{const result=await render(data);if(request!==token)return;url=URL.createObjectURL(result.blob);name=filename(data);file=new File([result.blob],name,{type:'image/png'});preview.src=url;preview.hidden=false;save.disabled=false;
                if(share)share.hidden=!navigator.canShare?.({files:[file]});
                status.textContent=result.missing?'Imagem pronta. Parte do satélite não carregou; os talhões e os totais estão completos.':'Imagem pronta para salvar e enviar no WhatsApp.';
            }catch(error){if(request===token)status.textContent=error.message;}
            finally{if(request===token){busy=false;button.disabled=false;}}
        };
        save.onclick=()=>{if(!url||!canExport())return;const link=document.createElement('a');link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();};
        if(share)share.onclick=async()=>{if(!file||!canExport())return;try{await navigator.share({files:[file]});}catch(error){if(error.name!=='AbortError')status.textContent='Use Salvar imagem PNG para compartilhar a foto.';}};
        document.getElementById('operation-export-close').onclick=()=>dialog.close();
    }
    root.OperationExport=Object.freeze({summarize,snapshot,filename,render,init});
})(window);
