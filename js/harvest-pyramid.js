(function(root){
 'use strict';
 const manifests=new Map();
 // O bitmap e sua máscara permanecem juntos durante a animação.
 // Transforme a última imagem pronta e só redesenhe ao encerrar o zoom.
 function bindCanvas(layer){
  const map=layer.map;L.DomUtil.addClass(layer.canvas,'leaflet-zoom-animated');
  const start=()=>{layer.zooming=true;};
  const animate=e=>{
   if(!layer.renderView)return;
   const size=map.getSize(),corner=map.project(layer.renderView.corner,e.zoom),center=map.project(e.center,e.zoom),pane=map.containerPointToLayerPoint([0,0]);
   const offset=L.point(corner.x-center.x+size.x/2+pane.x,corner.y-center.y+size.y/2+pane.y);
   L.DomUtil.setTransform(layer.canvas,offset,map.getZoomScale(e.zoom,layer.renderView.zoom));
  };
  const end=()=>{layer.zooming=false;layer.draw();};
  map.on('zoomstart',start).on('zoomanim',animate).on('zoomend',end);
  return ()=>map.off('zoomstart',start).off('zoomanim',animate).off('zoomend',end);
 }
 function captureView(layer){layer.renderView={corner:layer.map.containerPointToLatLng([0,0]),zoom:layer.map.getZoom()};}
 function polygons(features){return features.flatMap(f=>f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates);}
 function clip(ctx,map,features){
  ctx.beginPath();
  for(const polygon of polygons(features))for(const ring of polygon){ring.forEach((coord,i)=>{const p=map.latLngToContainerPoint([coord[1],coord[0]]);if(i)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);});ctx.closePath();}
  ctx.clip('evenodd');
 }
 async function create(records,features,dataset){
  let manifest=manifests.get(dataset.version);
  if(!manifest){manifest=root.HarvestStore.loadRaster(dataset,'index.json');manifests.set(dataset.version,manifest);manifest.catch(()=>manifests.delete(dataset.version));}
  const index=await manifest,allowed=new Set(records.map(r=>r.campo));
  const Layer=L.Layer.extend({
   initialize(){this.images=new Map();this.colored=new Map();this.records=index.records.filter(r=>allowed.has(r.campo));},
   onAdd(map){this.map=map;const pane=map.getPane('harvest-pyramid')||map.createPane('harvest-pyramid');pane.style.zIndex='345';pane.style.pointerEvents='none';this.canvas=L.DomUtil.create('canvas','harvest-pyramid-canvas',pane);this.canvas.style.pointerEvents='none';this.unbindZoom=bindCanvas(this);this.unbindStyle=root.HarvestStyle.subscribe(()=>{this.colored.clear();this.draw();});map.on('move zoom resize',this.draw,this);this.draw();},
   draw(){
    if(!this.map||this.zooming)return;captureView(this);const map=this.map,size=map.getSize(),ratio=Math.min(root.devicePixelRatio||1,2);this.canvas.width=Math.round(size.x*ratio);this.canvas.height=Math.round(size.y*ratio);this.canvas.style.width=size.x+'px';this.canvas.style.height=size.y+'px';L.DomUtil.setPosition(this.canvas,map.containerPointToLayerPoint([0,0]));
    const ctx=this.canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.imageSmoothingEnabled=map.getZoom()<16;ctx.imageSmoothingQuality='high';
    const level=Math.max(0,Math.min(5,15-Math.floor(map.getZoom())));
    for(const record of this.records){
     let item=record.levels[level];const key=item.valuesFile;let img=this.images.get(key);
     if(!img){const requestedImage={values:null};img=requestedImage;this.images.set(key,requestedImage);loadValues(item,dataset).then(values=>{requestedImage.values=values;this.draw();}).catch(error=>{this.images.delete(key);console.error('Não foi possível carregar a produtividade:',error);});}
     if(!img.values){const fallback=record.levels.map((value,i)=>({value,distance:Math.abs(i-level)})).sort((a,b)=>a.distance-b.distance).find(({value})=>this.images.get(value.valuesFile)?.values);if(!fallback)continue;item=fallback.value;img=this.images.get(item.valuesFile);}
     const matching=features.filter(f=>f.properties.Campo===record.campo);ctx.save();clip(ctx,map,matching);
     const bounds=item.bounds||record.bounds,a=map.latLngToContainerPoint([bounds[1][0],bounds[0][1]]),b=map.latLngToContainerPoint([bounds[0][0],bounds[1][1]]);
     let colored=this.colored.get(item.valuesFile);if(!colored){colored=renderValues(img.values,item.width,item.height,root.HarvestStyle.get());this.colored.set(item.valuesFile,colored);}ctx.drawImage(colored,a.x,a.y,b.x-a.x,b.y-a.y);ctx.restore();
    }
   },
   onRemove(map){this.unbindStyle();this.unbindZoom();map.off('move zoom resize',this.draw,this);this.map=null;this.canvas.remove();}
  });return new Layer();
 }
 async function loadValues(item,dataset){const p=await root.HarvestStore.loadRaster(dataset,item.valuesFile);if(p.format!=='harvest-values-f64-v1'||p.width!==item.width||p.height!==item.height)throw new Error('Resolução inválida.');const compressed=Uint8Array.from(atob(p.gzip_base64),c=>c.charCodeAt(0)),buffer=await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();if(buffer.byteLength!==item.width*item.height*8)throw new Error('Resolução incompleta.');return new Float64Array(buffer);}
 function valuesPixels(values,style){const data=new Uint8ClampedArray(values.length*4),rgb=style.colors.map(hex=>[parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)]),b=style.breaks;for(let i=0;i<values.length;i++){const v=values[i];if(!Number.isFinite(v))continue;const c=rgb[v<b[0]?0:v<b[1]?1:v<b[2]?2:v<b[3]?3:v<=b[4]?4:5];data.set([...c,255],i*4);}return data;}
 function renderValues(values,width,height,style){const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(width,height);pixels.data.set(valuesPixels(values,style));ctx.putImageData(pixels,0,0);return canvas;}
 const sourceColors=[0xd73027,0xfc8d59,0xfee08b,0xd9ef8b,0x91cf60,0x1a9850];
 function recolorPixels(data,colors){const rgb=colors.map(hex=>[parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)]);for(let i=0;i<data.length;i+=4){if(!data[i+3])continue;const category=sourceColors.indexOf((data[i]<<16)|(data[i+1]<<8)|data[i+2]);if(category>=0){const c=rgb[category];data[i]=c[0];data[i+1]=c[1];data[i+2]=c[2];}}return data;}
 function recolor(img,colors){const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);recolorPixels(pixels.data,colors);ctx.putImageData(pixels,0,0);return canvas;}
 root.HarvestPyramid=Object.freeze({create,clip,bindCanvas,captureView,recolorPixels,valuesPixels});
})(window);
