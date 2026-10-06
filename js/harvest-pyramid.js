(function(root){
 'use strict';
 const BASE='dados/colheita/2026/milho/fe-original/pyramid/';
 let manifest;
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
   onAdd(map){this.map=map;const pane=map.getPane('harvest-pyramid')||map.createPane('harvest-pyramid');pane.style.zIndex='345';pane.style.pointerEvents='none';this.canvas=L.DomUtil.create('canvas','harvest-pyramid-canvas',pane);this.canvas.style.pointerEvents='none';map.on('move zoom resize',this.draw,this);this.draw();},
   draw(){
    if(!this.map)return;const map=this.map,size=map.getSize(),ratio=Math.min(root.devicePixelRatio||1,2);this.canvas.width=Math.round(size.x*ratio);this.canvas.height=Math.round(size.y*ratio);this.canvas.style.width=size.x+'px';this.canvas.style.height=size.y+'px';L.DomUtil.setPosition(this.canvas,map.containerPointToLayerPoint([0,0]));
    const ctx=this.canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    const level=Math.max(0,Math.min(5,17-Math.floor(map.getZoom())));
    for(const record of this.records){
     const item=record.levels[level],key=item.file;let img=this.images.get(key);
     if(!img){img=new Image();this.images.set(key,img);img.onload=()=>this.draw();img.onerror=()=>console.error('Não foi possível carregar a resolução da colheita:',key);img.src=BASE+key;}
     if(!img.complete||!img.naturalWidth)continue;
     const matching=features.filter(f=>f.properties.Campo===record.campo);ctx.save();clip(ctx,map,matching);
     const bounds=item.bounds||record.bounds,a=map.latLngToContainerPoint([bounds[1][0],bounds[0][1]]),b=map.latLngToContainerPoint([bounds[0][0],bounds[1][1]]);
     ctx.drawImage(img,a.x,a.y,b.x-a.x,b.y-a.y);ctx.restore();
    }
   },
   onRemove(map){map.off('move zoom resize',this.draw,this);this.map=null;this.canvas.remove();}
  });return new Layer();
 }
 root.HarvestPyramid=Object.freeze({create,clip});
})(window);
