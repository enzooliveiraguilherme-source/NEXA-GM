const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const A = require('../js/aerial-spray.js');
const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

class Element {
  constructor(id) { this.id=id; this.value=''; this.checked=false; this.disabled=false; this.hidden=false; this.textContent=''; this.events={}; this.children=[]; this.attrs={}; this.open=false; this.style={}; }
  addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
  fire(type, event={}) { for (const fn of this.events[type] || []) fn(event); }
  setAttribute(k,v) { this.attrs[k]=v; }
  replaceChildren() { this.children=[]; this.value=''; }
  append(child) { this.children.push(child); if (!this.value) this.value=child.value; }
}
const row = (ap, date, stats, extra={}) => ({ano:'2026', cultura:'Soja', ap, dates:[date], bounds:[10,20,11,21], stats:{[date]:stats}, ...extra});
const stats = (total, applied, unapplied, gaps_available=true) => ({total, applied, overlap:0, unapplied, gaps_available, eligible_fields:1});
const fc = (tag='layer') => ({type:'FeatureCollection', features:[{type:'Feature',properties:{tag},geometry:{type:'Polygon',coordinates:[]}}]});
const catalog = [
  row('AP 1','2026-01-01',stats(0,0,0)), row('AP 1','2026-01-02',stats(10,4,6)),
  row('AP 2','2026-01-03',stats(20,8,null,false)), row('AP 2','2026-01-04',stats(20,12,null,false))
];
catalog[0].stats['*']=stats(0,0,0); catalog[1].stats['*']=stats(10,4,6);
catalog[2].stats['*']=stats(0,0,null,false); catalog[3].stats['*']=stats(20,12,null,false);
function harness(rpc=async name => name==='aerial_v2_catalog' ? catalog : fc(name)) {
  const ids=['panel','status','reload','focus','year','culture','ap','date','total','applied','overlap','unapplied','coverage-percent','overlap-percent','gaps-percent','coverage-bar','overlap-bar','gaps-bar','daily-chart','field-count','gaps-note','show-boundaries','show-tracks','show-nominal','mode-coverage','mode-overlap','mode-gaps','final','options','close-options'];
  const elements=Object.fromEntries(ids.map(id=>['aerial-'+id,new Element(id)]));
  elements['aerial-show-boundaries'].checked=true;
  const calls=[];
  const map={layers:new Set(),fits:[],panes:{},addLayer(l){this.layers.add(l);},removeLayer(l){this.layers.delete(l);},fitBounds(b){this.fits.push(b);},invalidateSize(){},createPane(name){this.panes[name]={style:{}};return this.panes[name];},getPane(name){return this.panes[name];}};
  const L={canvas(opts={}){return {opts};},geoJSON(data,opts){const l={data,opts,addTo(m){m.addLayer(this);return this;},bindTooltip(){},bindPopup(){}};return l;}};
  const document={getElementById:id=>elements[id],createElement:()=>new Element('option')};
  const client={rpc(name,args){calls.push({name,args});return Promise.resolve(rpc(name,args)).then(data=>data&&Object.hasOwn(data,'data')?data:{data,error:null});}};
  const state={currentTab:'aerea',currentFazenda:'F1',currentGleba:'G1',currentAno:'2026',currentCultura:'Soja',fieldData:{features:[]},map};
  return {elements,calls,map,state,view:A.createView({document,L,client})};
}
const waitReady=async h=>{h.view.refresh(h.state);await tick(20);};
const calls=(h,name)=>h.calls.filter(c=>c.name===name);

test('formatters preserve zero and distinguish null',()=>{
  assert.equal(A.formatArea(0),'0 ha'); assert.equal(A.formatArea(null),'—');
  assert.equal(A.formatDate('2026-01-03'),'03/01/2026');
});

test('AP and date selections never mix summaries or layer requests',async()=>{
  const h=harness(); await waitReady(h);
  h.elements['aerial-ap'].value='AP 1'; h.elements['aerial-ap'].fire('change'); await tick(5);
  assert.equal(h.elements['aerial-applied'].textContent,'4 ha');
  h.elements['aerial-ap'].value='AP 2'; h.elements['aerial-ap'].fire('change'); await tick(10);
  assert.equal(h.elements['aerial-date'].value,'*');
  assert.equal(h.elements['aerial-applied'].textContent,'12 ha');
  h.elements['aerial-date'].value='2026-01-04'; h.elements['aerial-date'].fire('change'); await tick(10);
  const request=calls(h,'aerial_v2_layer').at(-1).args;
  assert.equal(request.selected_ap,'AP 2'); assert.equal(request.map_date,'2026-01-04');
  assert.equal(h.elements['aerial-applied'].textContent,'12 ha');
});

test('independent result toggles start enabled and can be combined or disabled',async()=>{
  const h=harness(); await waitReady(h);
  for(const n of ['coverage','overlap','gaps']) assert.equal(h.elements[`aerial-mode-${n}`].attrs['aria-pressed'],'true');
  const kinds=()=>[...h.map.layers].map(l=>l.opts.pane).filter(Boolean);
  assert(kinds().includes('aerial-coverage')); assert(kinds().includes('aerial-overlap')); assert(kinds().includes('aerial-gaps'));
  h.elements['aerial-mode-overlap'].fire('click'); await tick(5);
  assert.equal(h.elements['aerial-mode-overlap'].attrs['aria-pressed'],'false');
  assert(![...h.map.layers].some(l=>l.opts.pane==='aerial-overlap'));
  assert([...h.map.layers].some(l=>l.opts.pane==='aerial-coverage'));
  h.elements['aerial-mode-overlap'].fire('click'); await tick(5);
  assert([...h.map.layers].some(l=>l.opts.pane==='aerial-overlap'));
});

test('stale request responses and old scopes are ignored',async()=>{
  const pending=[];
  const h=harness((name,args)=>name==='aerial_v2_catalog'?Promise.resolve(catalog):new Promise(resolve=>pending.push({args,resolve})));
  await waitReady(h); await tick(5);
  h.elements['aerial-mode-overlap'].fire('click'); await tick(2);
  h.elements['aerial-mode-coverage'].fire('click'); await tick(2);
  assert(pending.length>=2);
  pending[0].resolve(fc('stale')); await tick(5);
  assert(![...h.map.layers].some(l=>l.data.features?.[0]?.properties?.tag==='stale'));
  const before=calls(h,'aerial_v2_catalog').length;
  h.view.refresh({...h.state,currentGleba:'G2'}); await tick(5);
  assert.equal(calls(h,'aerial_v2_catalog').length,before+1);
  const oldScope=pending[0]; oldScope.resolve(fc('late-scope')); await tick(5);
  assert(![...h.map.layers].some(l=>l.data.features?.[0]?.properties?.tag==='late-scope'));
});

test('catalog and layer requests carry farm and gleba scope',async()=>{
  const h=harness(); await waitReady(h);
  assert.deepEqual(calls(h,'aerial_v2_catalog')[0].args,{map_farm:'F1',map_gleba:'G1'});
  const layer=calls(h,'aerial_v2_layer')[0].args;
  assert.equal(layer.map_farm,'F1'); assert.equal(layer.map_gleba,'G1');
});

test('daily stats and final remaining gaps use separate dates',async()=>{
  const h=harness(); await waitReady(h);
  h.elements['aerial-ap'].value='AP 1'; h.elements['aerial-ap'].fire('change'); await tick(5);
  h.elements['aerial-date'].value='2026-01-02'; h.elements['aerial-date'].fire('change'); await tick(5);
  assert.equal(h.elements['aerial-final'].hidden,false);
  assert(!calls(h,'aerial_v2_layer').some(c=>c.args.map_kind==='gaps'&&c.args.map_date!=='*'));
  assert(calls(h,'aerial_v2_layer').some(c=>c.args.map_kind==='gaps'&&c.args.map_date==='*'));
  assert.equal(h.elements['aerial-applied'].textContent,'4 ha');
  assert.equal(h.elements['aerial-unapplied'].textContent,'6 ha');
  assert.match(h.elements['aerial-gaps-note'].textContent,/final/i);
  h.elements['aerial-final'].fire('click'); await tick(5);
  assert.equal(h.elements['aerial-date'].value,'*');
  assert.equal(h.elements['aerial-final'].hidden,true);
});

test('all enabled layers have stable dedicated panes regardless of response order',async()=>{
  const pending=[];
  const h=harness((name,args)=>name==='aerial_v2_catalog'?Promise.resolve(catalog):new Promise(resolve=>pending.push({args,resolve})));
  h.view.refresh(h.state); await tick(10);
  assert(pending.length>=4);
  const order=['overlap','gaps','coverage','boundaries'];
  for(const kind of order){const i=pending.findIndex(p=>p.args.map_kind===kind); assert(i>=0); pending[i].resolve(fc(kind)); await tick(2);}
  await tick(10);
  const layers=[...h.map.layers].filter(l=>l.opts.pane);
  assert.equal(layers.length,4);
  for(const kind of ['coverage','overlap','gaps','boundaries']){
    const layer=layers.find(l=>l.opts.pane===`aerial-${kind}`);
    assert(layer,`${kind} layer should render`);
    assert.equal(layer.opts.renderer.opts.pane,`aerial-${kind}`);
  }
  for(const [kind,z] of Object.entries({coverage:420,gaps:430,overlap:440,boundaries:460})) assert.equal(h.map.panes[`aerial-${kind}`]?.style.zIndex,String(z));
});

test('cache avoids duplicate layer RPCs and reload clears it',async()=>{
  const h=harness(); await waitReady(h);
  const count=calls(h,'aerial_v2_layer').length;
  h.elements['aerial-mode-coverage'].fire('click'); await tick(5);
  h.elements['aerial-mode-coverage'].fire('click'); await tick(5);
  assert.equal(calls(h,'aerial_v2_layer').length,count);
  h.elements['aerial-reload'].fire('click'); await tick(10);
  assert(calls(h,'aerial_v2_layer').length>count);
});

test('zero remains a measured value while null remains unavailable',async()=>{
  const h=harness(); await waitReady(h);
  h.elements['aerial-ap'].value='AP 1'; h.elements['aerial-ap'].fire('change'); await tick(5);
  h.elements['aerial-date'].value='2026-01-01'; h.elements['aerial-date'].fire('change'); await tick(5);
  assert.equal(h.elements['aerial-total'].textContent,'0 ha');
  assert.equal(h.elements['aerial-applied'].textContent,'0 ha');
  h.elements['aerial-ap'].value='AP 2'; h.elements['aerial-ap'].fire('change'); await tick(5);
  assert.equal(h.elements['aerial-unapplied'].textContent,'—');
});

test('percentages handle nulls, zero denominators, and genuine zero',()=>{
  assert.equal(A.formatPercent(0,10),'0%');
  assert.equal(A.formatPercent(null,10),'—');
  assert.equal(A.formatPercent(1,0),'—');
  assert.equal(A.formatPercent(0,0),'—');
});

test('user facing copy has valid Portuguese characters',async()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','portal.html'),'utf8');
  const js=fs.readFileSync(path.join(__dirname,'..','js','aerial-spray.js'),'utf8');
  assert(!/[�]|Ã[\x80-\xBF]|Â[\x80-\xBF]/.test(html+js),'portal and aerial spray copy should be UTF-8 without mojibake');
});

test('tracks and nominal layers are lazy and optional',async()=>{
  const h=harness(); await waitReady(h);
  assert(!calls(h,'aerial_v2_layer').some(c=>['tracks','nominal'].includes(c.args.map_kind)));
  h.elements['aerial-show-nominal'].checked=true; h.elements['aerial-show-nominal'].fire('change'); await tick(5);
  assert(calls(h,'aerial_v2_layer').some(c=>c.args.map_kind==='nominal'));
  h.elements['aerial-show-tracks'].checked=true; h.elements['aerial-show-tracks'].fire('change'); await tick(5);
  assert(calls(h,'aerial_v2_layer').some(c=>c.args.map_kind==='tracks'));
});

test('local field map context is retained when building base polygons',()=>{
  const feature={type:'Feature',properties:{Campo:'T1',Fazenda:'F1',Gleba:'G1',MapContexts:[{operationType:'pulverizacao',ano:'2026',geometry:{type:'Polygon',coordinates:[[1,2,3]]}}]},geometry:{type:'Polygon',coordinates:[]}};
  const out=A.baseFeatures({currentFazenda:'F1',currentGleba:'G1',fieldData:{features:[feature]}},'2026');
  assert.equal(out.length,1); assert.deepEqual(out[0].geometry.coordinates,[[1,2,3]]);
});
