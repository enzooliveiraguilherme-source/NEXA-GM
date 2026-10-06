(function(root){
 'use strict';
 const BASE='dados/colheita/2026/milho/fe-original/pyramid/';
 let manifest;
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
 async function create(records,features){
  manifest ||= fetch(BASE+'index.json').then(r=>{if(!r.ok)throw new Error('Pirâmide indisponível.');return r.json();});
  const index=await manifest,allowed=new Set(records.map(r=>r.campo));
  const Layer=L.Layer.extend({
   initialize(){this.images=new Map();this.records=index.records.filter(r=>allowed.has(r.campo));},
   onAdd(map){this.map=map;const pane=map.getPane('harvest-pyramid')||map.createPane('harvest-pyramid');pane.style.zIndex='345';pane.style.pointerEvents='none';this.canvas=L.DomUtil.create('canvas','harvest-pyramid-canvas',pane);this.canvas.style.pointerEvents='none';this.unbindZoom=bindCanvas(this);map.on('move zoom resize',this.draw,this);this.draw();},
   draw(){
    if(!this.map||this.zooming)return;captureView(this);const map=this.map,size=map.getSize(),ratio=Math.min(root.devicePixelRatio||1,2);this.canvas.width=Math.round(size.x*ratio);this.canvas.height=Math.round(size.y*ratio);this.canvas.style.width=size.x+'px';this.canvas.style.height=size.y+'px';L.DomUtil.setPosition(this.canvas,map.containerPointToLayerPoint([0,0]));
    const ctx=this.canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.imageSmoothingEnabled=map.getZoom()<16;ctx.imageSmoothingQuality='high';
    const level=Math.max(0,Math.min(5,15-Math.floor(map.getZoom())));
    for(const record of this.records){
     let item=record.levels[level];const key=item.file;let img=this.images.get(key);
     if(!img){img=new Image();this.images.set(key,img);img.onload=()=>this.draw();img.onerror=()=>console.error('Não foi possível carregar a resolução da colheita:',key);img.src=BASE+key+'?v=3';}
     if(!img.complete||!img.naturalWidth){const fallback=record.levels.map((value,i)=>({value,distance:Math.abs(i-level)})).sort((a,b)=>a.distance-b.distance).find(({value})=>{const ready=this.images.get(value.file);return ready?.complete&&ready.naturalWidth;});if(!fallback)continue;item=fallback.value;img=this.images.get(item.file);}
     const matching=features.filter(f=>f.properties.Campo===record.campo);ctx.save();clip(ctx,map,matching);
     const bounds=item.bounds||record.bounds,a=map.latLngToContainerPoint([bounds[1][0],bounds[0][1]]),b=map.latLngToContainerPoint([bounds[0][0],bounds[1][1]]);
     ctx.drawImage(img,a.x,a.y,b.x-a.x,b.y-a.y);ctx.restore();
    }
   },
   onRemove(map){this.unbindZoom();map.off('move zoom resize',this.draw,this);this.map=null;this.canvas.remove();}
  });return new Layer();
 }
 root.HarvestPyramid=Object.freeze({create,clip,bindCanvas,captureView});
})(window);
