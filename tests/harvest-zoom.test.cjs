const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const events=new Map(),transforms=[];let redraws=0;
const map={on(name,fn){events.set(name,fn);return this;},off(name,fn){if(events.get(name)===fn)events.delete(name);return this;},getSize:()=>({x:800,y:600}),project:(p,z)=>({x:p.x*2**z,y:p.y*2**z}),containerPointToLayerPoint:()=>({x:-23,y:11}),getZoomScale:(to,from)=>2**(to-from),getZoom:()=>3,containerPointToLatLng:()=>({x:100,y:200})};
const context=vm.createContext({window:{},L:{point:(x,y)=>({x,y}),DomUtil:{addClass:(el,name)=>{el.className=name;},setTransform:(el,offset,scale)=>transforms.push({offset,scale})}}});
vm.runInContext(fs.readFileSync('js/harvest-pyramid.js','utf8'),context);const api=context.window.HarvestPyramid;
const layer={map,canvas:{},draw(){redraws++;assert.equal(this.zooming,false);api.captureView(this);}};
api.captureView(layer);const remove=api.bindCanvas(layer);assert.equal(layer.canvas.className,'leaflet-zoom-animated');
for(const [zoom,center] of [[4,{x:130,y:220}],[2,{x:150,y:240}]]){
 const snapshot=layer.renderView;events.get('zoomstart')();assert.equal(layer.zooming,true);events.get('zoomanim')({zoom,center});assert.equal(layer.renderView,snapshot,'A imagem e a máscara devem manter a mesma referência durante o zoom');
 const {offset,scale}=transforms.at(-1),point={x:110,y:205},oldPixel={x:(point.x-snapshot.corner.x)*2**snapshot.zoom,y:(point.y-snapshot.corner.y)*2**snapshot.zoom};
 assert.equal(offset.x+scale*oldPixel.x,(point.x-center.x)*2**zoom+400-23);
 assert.equal(offset.y+scale*oldPixel.y,(point.y-center.y)*2**zoom+300+11);
 events.get('zoomend')();assert.equal(layer.zooming,false);
}
assert.equal(redraws,2);remove();assert.equal(events.size,0);
console.log('Zoom para dentro e para fora: bitmap, máscara e coordenadas sincronizados, redesenho no fim e limpeza dos eventos verificados.');
