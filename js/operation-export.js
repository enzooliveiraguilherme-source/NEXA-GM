(function(root) {
    'use strict';
    const colors={concluido:'#06b200',em_andamento:'#ff9900',nao_iniciado:'#e32323'};
    let planning;
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
        ctx.fillStyle=color;ctx.font=`${weight} ${size}px Arial, sans-serif`;
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
            ctx.fillStyle='rgba(255,255,255,.28)';ctx.fillRect(rect.x,rect.y,rect.w,rect.h);
        }
        for(const row of shapes) {
            ctx.beginPath();
            for(const poly of row.polygons)for(const ring of poly){ring.forEach((p,i)=>{const pos=screen(p);if(i===0)ctx.moveTo(...pos);else ctx.lineTo(...pos);});ctx.closePath();}
            ctx.fillStyle=colors[row.status];ctx.globalAlpha=.84;ctx.fill('evenodd');ctx.globalAlpha=1;ctx.strokeStyle='#18342c';ctx.lineWidth=2;ctx.stroke();
        }
        ctx.restore();
        return missing;
    }
    async function render(data) {
        const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=1500;
        const ctx=canvas.getContext('2d');
        ctx.fillStyle='#f3f7fa';ctx.fillRect(0,0,1200,1500);
        box(ctx,0,0,1200,190,'#102c4d',0);box(ctx,0,185,1200,6,'#eb7825',0);
        label(ctx,'GRUPO MICHELS  /  GESTÃO AGRÍCOLA',48,46,19,'#bdd0e3',600);
        label(ctx,`RESUMO DE ${data.operationName.toUpperCase()}`,48,94,30,'#bdd0e3',600);
        label(ctx,data.scopeName,48,153,44,'white',700,910);
        try{const logo=await image('apoio/GP Michels.jpg');box(ctx,988,28,164,104,'white',12);
            const ratio=Math.min(140/logo.naturalWidth,80/logo.naturalHeight),w=logo.naturalWidth*ratio,h=logo.naturalHeight*ratio;ctx.drawImage(logo,1000+(140-w)/2,40+(80-h)/2,w,h);
        }catch{/* O resumo continua disponível se a marca não carregar. */}
        label(ctx,`${data.culture}  ·  Ano / Safra ${data.year}`,48,234,27,'#102c4d',700,1100);
        const context=data.operation==='plantio'?'Andamento do plantio':`Produto: ${data.product}`;
        label(ctx,context,48,271,21,'#5b6e7e',500,790);
        ctx.textAlign='right';label(ctx,`Atualizado em ${data.date}`,1152,271,20,'#5b6e7e');ctx.textAlign='left';
        const cards=[['ÁREA PLANEJADA',area(data.areaPlanejada),'Área total programada','#1675ae'],
            [data.operation==='plantio'?'ÁREA PLANTADA':'ÁREA APLICADA',area(data.areaRealizada),'Realizado até o momento','#087f60'],
            ['PROGRESSO',`${data.progress.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})}%`,`${area(data.areaPlanejada-data.areaRealizada)} restantes`,'#102c4d']];
        cards.forEach((card,i)=>{const x=48+i*374,accent=i===2;box(ctx,x,305,356,166,accent?'#102c4d':'white');if(!accent)box(ctx,x,305,356,6,card[3],0);
            label(ctx,card[0],x+22,345,20,accent?'#bdd0e3':card[3],700);label(ctx,card[1],x+22,401,accent?46:40,accent?'white':'#102c4d',700,312);label(ctx,card[2],x+22,439,18,accent?'#bdd0e3':'#64748b');});
        box(ctx,48,488,1104,12,'#dce5eb',6);if(data.progress>0)box(ctx,48,488,1104*data.progress/100,12,'#087f60',6);
        label(ctx,'MAPA DO ANDAMENTO',48,542,21,'#102c4d',700);
        label(ctx,`${data.fields.length} talhões planejados  ·  ${data.farms.join(' / ')}`,48,576,19,'#64748b',500,1100);
        const missing=await drawMap(ctx,data,{x:48,y:600,w:1104,h:690});
        const legend=[['concluido','Finalizado',data.areaConcluido,data.countConcluido],['em_andamento','Em andamento',data.areaAndamentoTotal,data.countAndamento],['nao_iniciado','Não iniciado',data.areaNaoIniciado,data.countNaoIniciado]];
        legend.forEach(([status,title,ha,count],i)=>{const x=48+i*374;box(ctx,x,1315,356,100,'white',14);box(ctx,x+20,1337,20,20,colors[status],4);
            label(ctx,title,x+52,1355,21,'#102c4d',600);label(ctx,`${area(ha)}  ·  ${count} talhões`,x+20,1385,18,'#64748b');
            if(status==='em_andamento')label(ctx,`${area(data.areaAndamentoRealizada)} realizados`,x+20,1407,15,'#64748b');});
        label(ctx,'Realizado = áreas finalizadas + hectares executados nos talhões em andamento.',48,1450,17,'#64748b',500,1100);
        label(ctx,data.satellite?(missing?'Fundo de satélite parcialmente indisponível · talhões e totais preservados.':'Imagem de fundo: Esri World Imagery · fontes e créditos: mapa do Geoportal.'):'Fundo branco · talhões e totais conforme os filtros selecionados.',48,1479,15,'#64748b',500,1100);
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
        if(!blob)throw Error('Não foi possível gerar a imagem.');
        return {blob,canvas,missing};
    }
    function init(state,planner) {
        planning=planner;
        const button=document.getElementById('operation-export-button'),dialog=document.getElementById('operation-export-dialog');
        if(!button||!dialog)return;
        const preview=document.getElementById('operation-export-preview'),status=document.getElementById('operation-export-status'),save=document.getElementById('operation-export-save'),share=document.getElementById('operation-export-share');
        let url=null,name='',file=null,busy=false,token=0;
        const revoke=()=>{if(url)URL.revokeObjectURL(url);url=null;};
        dialog.addEventListener('close',()=>{token++;revoke();file=null;preview.removeAttribute('src');save.disabled=true;if(share)share.hidden=true;busy=false;button.disabled=false;});
        button.onclick=async()=>{
            if(busy)return;
            let data;try{data=snapshot(state);}catch(error){status.textContent=error.message;dialog.showModal();save.disabled=true;preview.hidden=true;return;}
            busy=true;button.disabled=true;const request=++token;revoke();preview.hidden=true;save.disabled=true;status.textContent='Preparando o resumo e carregando o mapa…';dialog.showModal();
            try{const result=await render(data);if(request!==token)return;url=URL.createObjectURL(result.blob);name=filename(data);file=new File([result.blob],name,{type:'image/png'});preview.src=url;preview.hidden=false;save.disabled=false;
                if(share)share.hidden=!navigator.canShare?.({files:[file]});
                status.textContent=result.missing?'Imagem pronta. Parte do satélite não carregou; os talhões e os totais estão completos.':'Imagem pronta para salvar e enviar no WhatsApp.';
            }catch(error){if(request===token)status.textContent=error.message;}
            finally{if(request===token){busy=false;button.disabled=false;}}
        };
        save.onclick=()=>{if(!url)return;const link=document.createElement('a');link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();};
        if(share)share.onclick=async()=>{if(!file)return;try{await navigator.share({files:[file]});}catch(error){if(error.name!=='AbortError')status.textContent='Use Salvar imagem PNG para compartilhar a foto.';}};
        document.getElementById('operation-export-close').onclick=()=>dialog.close();
    }
    root.OperationExport=Object.freeze({summarize,snapshot,filename,render,init});
})(window);
