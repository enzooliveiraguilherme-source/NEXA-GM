const test=require('node:test');
const assert=require('node:assert/strict');
const A=require('../js/aerial-spray.js');
const pause=(ms=0)=>new Promise(resolve=>setTimeout(resolve,ms));
class Element {
 constructor(id){this.id=id;this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.textContent='';this.events={};this.children=[];this.inputs=[];}
 addEventListener(type,fn){(this.events[type]??=[]).push(fn);}
 fire(type,event={}){for(const fn of this.events[type]||[])fn(event);}
 replaceChildren(){this.children=[];this.value='';}
 append(child){this.children.push(child);if(!this.value)this.value=child.value;}
 set innerHTML(html){this.html=html;this.inputs=[...html.matchAll(/<input type="checkbox" value="([^"]+)"( checked)?/g)].map(m=>({type:'checkbox',value:m[1],checked:!!m[2]}));}
 get innerHTML(){return this.html;}
 querySelectorAll(selector){return selector==='input:checked'?this.inputs.filter(x=>x.checked):this.inputs;}
}
const field=(campo,extra={})=>({type:'Feature',properties:{Campo:campo,Fazenda:'F1',Gleba:'G1',...extra},geometry:{type:'Polygon',coordinates:[[[10,20],[11,20],[11,21],[10,20]]]}});
const catalog={data:[{ano:'2026',cultura:'Soja',ap:'AP 1',bounds:[10,20,11,21],fields:['T1'],total:10,applied:4,unapplied:6},{ano:'2026',cultura:'Soja',ap:'AP 2',bounds:[12,22,13,23],fields:['T2'],total:12,applied:8,unapplied:4}]};
const prepared=(values={})=>({data:Array.from({length:values.needsTotals?2:1},(_,i)=>({farm_code:'F1',ap:'AP '+(i+1),total:10,applied:4,boundary:{name:'boundaries'},coverage:{name:'coverage'},tracks:[{name:'tracks'}],...values}))});
function harness(rpc=async name=>name==='aerial_spray_catalog'?catalog:prepared()){
 const ids=['panel','status','reload','focus','year','culture','aps','all','none','total','applied','unapplied','show-boundaries','show-gaps','show-coverage','show-tracks'];
 const elements=Object.fromEntries(ids.map(id=>['aerial-'+id,new Element(id)]));
 for(const name of ['boundaries','coverage','tracks'])elements['aerial-show-'+name].checked=true;
 const calls=[],map={layers:new Set(),fits:[],addLayer(layer){this.layers.add(layer);},removeLayer(layer){this.layers.delete(layer);},fitBounds(bounds){this.fits.push(bounds);},invalidateSize(){},getZoom(){return 13;},on(){},off(){}};
 const L={canvas(){return {};},geoJSON(data,options){const name=typeof options.style==='function'?'tracks':({'#f8fafc':'base','#facc15':'boundaries','#22c55e':'coverage','#f59e0b':'gaps'}[options.style?.color]||'base');const layer={name,data,options,addTo(target){target.addLayer(this);return this;},getBounds(){return {isValid(){return true;},tag:name};},eachLayer(){}};return layer;}};
 const document={getElementById:id=>elements[id],createElement:()=>new Element('option')};
 const client={rpc(name,args){calls.push({name,args});return rpc(name,args);}};
 const state={currentTab:'aerea',currentFazenda:'F1',currentGleba:'G1',currentAno:'2026',currentCultura:'Soja',fieldData:{type:'FeatureCollection',features:[field('T1'),field('T2')]},map};
 return {elements,calls,map,state,view:A.createView({document,L,client})};
}
const selectedLayers=h=>[...h.map.layers].map(l=>l.name);
test('flags and hectares preserve zero and distinguish missing data',()=>{
 assert.equal(A.lineStyle({properties:{APLICANDO:'0'}}).color,'#dc2626');
 assert.equal(A.lineStyle({properties:{APLICANDO:1}}).color,'#16a34a');
 assert.equal(A.formatArea(0),'0 ha');assert.equal(A.formatArea(null),'-');
});
test('base fields use spraying/year overrides and exclude archived or inaccessible fields',()=>{
 const h=harness();h.state.fieldData.features=[field('ok'),field('archived',{OperationalArchived:true}),field('other',{Fazenda:'F2'}),field('wrong year',{MapOnlyContexts:[{operationType:'pulverizacao',ano:'2027'}]}),field('override',{MapContexts:[{operationType:'pulverizacao',ano:'2026',geometry:{type:'Polygon',coordinates:[]}}]})];
 const result=A.baseFeatures(h.state,'2026');assert.deepEqual(result.map(f=>f.properties.Campo),['ok','override']);assert.deepEqual(result[1].geometry.coordinates,[]);
});
test('base map is visible before choosing any AP and survives a failed overlay',async t=>{
 t.mock.method(console,'error',()=>{});
 const h=harness(async name=>name==='aerial_spray_catalog'?catalog:{error:Error('offline')});h.view.refresh(h.state);await pause();
 assert.deepEqual(selectedLayers(h),['base']);h.elements['aerial-all'].fire('click');await pause();assert.deepEqual(selectedLayers(h),['base']);
});
test('camera immediately frames target fields and never frames the transit circuit',async()=>{
 let resolve;const h=harness(async name=>name==='aerial_spray_catalog'?catalog:new Promise(r=>{resolve=r;}));
 h.view.refresh(h.state);await pause();h.elements['aerial-all'].fire('click');
 assert.deepEqual(h.map.fits.at(-1),[[20,10],[23,13]]);
 resolve(prepared());await pause();assert.deepEqual(h.map.fits.at(-1),[[20,10],[23,13]]);
});
test('cached base still honors a requested fit after the catalog arrives',async()=>{
 const h=harness();h.view.refresh(h.state);const before=h.map.fits.length;await pause();assert(h.map.fits.length>before);
});
test('render uses prepared data; consolidated totals start after overlays are added',async()=>{
 let totalsAfterMap=false;const h=harness(async name=>{
  if(name==='aerial_spray_catalog')return catalog;
  if(name==='aerial_spray_layers')return prepared({total:null,applied:null,needsTotals:true});
  if(name==='aerial_spray_totals'){totalsAfterMap=selectedLayers(h).includes('tracks');return {data:{total:20,applied:12,unapplied:8}};}
  throw Error('Unexpected RPC '+name);
 });h.view.refresh(h.state);await pause();h.elements['aerial-all'].fire('click');await pause(30);
 assert(totalsAfterMap);assert(!h.calls.some(c=>c.name==='aerial_spray_map'));assert.equal(h.elements['aerial-total'].textContent,'20 ha');
});
test('reselecting cached APs avoids a second render request',async()=>{
 const h=harness();h.view.refresh(h.state);await pause();h.elements['aerial-all'].fire('click');await pause();h.elements['aerial-none'].fire('click');h.elements['aerial-all'].fire('click');await pause();
 assert.equal(h.calls.filter(c=>c.name==='aerial_spray_layers').length,1);
});
test('rapid checkbox changes are coalesced into one request',async()=>{
 const h=harness();h.view.refresh(h.state);await pause();const list=h.elements['aerial-aps'];
 for(const input of list.inputs){input.checked=true;list.fire('change',{target:input});}
 await pause(160);const renders=h.calls.filter(c=>c.name==='aerial_spray_layers');assert.equal(renders.length,1);assert.deepEqual(renders[0].args.selected_aps,['AP 1','AP 2']);
});
test('obsolete responses cannot replace the latest selection; leaving removes all module layers',async()=>{
 const pending=[];const h=harness(async name=>name==='aerial_spray_catalog'?catalog:new Promise(resolve=>pending.push(resolve)));
 h.view.refresh(h.state);await pause();const list=h.elements['aerial-aps'];list.inputs[0].checked=true;list.fire('change',{target:list.inputs[0]});await pause(150);
 list.inputs[1].checked=true;list.fire('change',{target:list.inputs[1]});await pause(150);assert.equal(pending.length,2);
 pending[0](prepared({total:99}));await pause();assert.deepEqual(selectedLayers(h),['base']);
 pending[1](prepared({total:22}));await pause();assert.equal(h.elements['aerial-total'].textContent,'22 ha');
 h.view.refresh({...h.state,currentTab:'plantio'});assert.equal(h.map.layers.size,0);
});
test('visibility toggles do not fetch data, move the map or change indicators',async()=>{
 const h=harness();h.view.refresh(h.state);await pause();h.elements['aerial-all'].fire('click');await pause();
 const before=[h.calls.length,h.map.fits.length,h.elements['aerial-total'].textContent];h.elements['aerial-show-tracks'].checked=false;h.elements['aerial-show-tracks'].fire('change');
 assert(!selectedLayers(h).includes('tracks'));assert.deepEqual([h.calls.length,h.map.fits.length,h.elements['aerial-total'].textContent],before);
});
