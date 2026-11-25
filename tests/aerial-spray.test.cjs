const test = require('node:test');
const assert = require('node:assert/strict');
const { createView, lineStyle, formatArea } = require('../js/aerial-spray.js');

function harness(rpc) {
  const ids = ['panel','status','reload','year','culture','aps','all','none','total','applied','unapplied',
    'show-boundaries','show-gaps','show-coverage','show-tracks'];
  const elements = Object.fromEntries(ids.map(id => ['aerial-'+id, new Element('aerial-'+id)]));
  for (const key of ['boundaries','gaps','coverage','tracks']) elements['aerial-show-'+key].checked = true;
  const document = {getElementById(id) { return elements[id]; }, createElement() { return new Element('option'); }};
  const calls = [];
  const map = {addLayer(layer) {calls.push(['add', layer.name]);}, removeLayer(layer) {calls.push(['remove', layer.name]);}, invalidateSize(){}, fitBounds(){}};
  const L = {
    canvas(){return {};},
    geoJSON(data, options) { const layer={name:data.name,options,addTo(target){target.addLayer(this);return this;}}; return layer; },
    featureGroup() {return {getBounds(){return {isValid(){return true;}};}};}
  };
  const client = {rpc: async (...args) => { calls.push(['rpc',args[0],args[1]]); return rpc(...args); }};
  const view = createView({document,L,client});
  const state = {currentTab:'aerea',currentFazenda:'F1',currentGleba:'G1',currentAno:'2026',currentCultura:'Soja',map};
  return {view,state,elements,calls,map};
}

class Element {
  constructor(id) {this.id=id;this.value='';this.textContent='';this.hidden=false;this.disabled=false;this.checked=false;this.listeners={};this.children=[];this._html='';}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
  fire(type,event={}){for(const fn of this.listeners[type]??[]) fn(event);}
  append(child){this.children.push(child);}
  replaceChildren(){this.children=[];}
  set innerHTML(html){this._html=html;this.inputs=[...html.matchAll(/<input type="checkbox" value="([^"]+)"( checked)?/g)].map(m=>({type:'checkbox',value:m[1],checked:!!m[2]}));}
  get innerHTML(){return this._html;}
  querySelectorAll(selector){if(selector==='input')return this.inputs??[];if(selector==='input:checked')return (this.inputs??[]).filter(i=>i.checked);return [];}
}

const catalog = {data:[{ano:2026,cultura:'Soja',ap:'AP 1'},{ano:2026,cultura:'Soja',ap:'AP 2'}]};
const mapData = {data:{total:10,applied:4,unapplied:6,boundaries:{name:'boundaries'},gaps:{name:'gaps'},coverage:{name:'coverage'},tracks:{name:'tracks'}}};
const tick = () => new Promise(resolve => setImmediate(resolve));

test('lineStyle classifica APLICANDO como 0/1 inclusive quando vem como string', () => {
  assert.equal(lineStyle({properties:{APLICANDO:1}}).color,'#16a34a');
  assert.equal(lineStyle({properties:{APLICANDO:'1'}}).color,'#16a34a');
  assert.equal(lineStyle({properties:{APLICANDO:0}}).color,'#dc2626');
  assert.equal(lineStyle({properties:{APLICANDO:'0'}}).color,'#dc2626');
});

test('formatArea distingue null de zero e formata valores em pt-BR', () => {
  assert.equal(formatArea(null),'—');
  assert.equal(formatArea(undefined),'—');
  assert.equal(formatArea(0),'0 ha');
  assert.equal(formatArea('1234.5'),'1.234,5 ha');
  assert.equal(formatArea('inválido'),'—');
});

test('seleção de múltiplas APs faz uma consulta com ambas e adiciona as camadas', async () => {
  const h=harness(async name => name==='aerial_spray_catalog'?catalog:mapData);
  h.view.refresh(h.state); await tick();
  h.elements['aerial-all'].fire('click'); await tick();
  const query=h.calls.find(c=>c[0]==='rpc'&&c[1]==='aerial_spray_map');
  assert.deepEqual(query[2].selected_aps,['AP 1','AP 2']);
  assert.equal(h.elements['aerial-total'].textContent,'10 ha');
  assert.deepEqual(h.calls.filter(c=>c[0]==='add').map(c=>c[1]),['boundaries','gaps','coverage','tracks']);
});

test('resposta assíncrona obsoleta não substitui a seleção mais recente', async () => {
  const resolvers=[];
  const h=harness(async name => {
    if(name==='aerial_spray_catalog')return catalog;
    return new Promise(resolve=>{resolvers.push(resolve);});
  });
  h.view.refresh(h.state); await tick();
  const aps=h.elements['aerial-aps']; aps.inputs[0].checked=true; aps.fire('change',{target:aps.inputs[0]});
  aps.inputs[1].checked=true; aps.fire('change',{target:aps.inputs[1]});
  assert.equal(resolvers.length,2);
  resolvers[0](mapData); await tick();
  assert.equal(h.elements['aerial-total'].textContent,'—');
});

test('sair da aba invalida consultas pendentes e remove camadas do mapa', async () => {
  const h=harness(async name => name==='aerial_spray_catalog'?catalog:mapData);
  h.view.refresh(h.state); await tick();
  h.elements['aerial-all'].fire('click'); await tick();
  const before=h.calls.filter(c=>c[0]==='remove').length;
  h.view.refresh({...h.state,currentTab:'plantio'});
  assert.equal(h.elements['aerial-panel'].hidden,true);
  assert.equal(h.calls.filter(c=>c[0]==='remove').length-before,4);
});

test('alternar circuito aéreo remove e restaura somente a camada, sem alterar KPIs', async () => {
  const h=harness(async name => name==='aerial_spray_catalog'?catalog:mapData);
  h.view.refresh(h.state); await tick();
  h.elements['aerial-all'].fire('click'); await tick();
  const kpis=['total','applied','unapplied'].map(name=>h.elements['aerial-'+name].textContent);
  h.elements['aerial-show-tracks'].checked=false; h.elements['aerial-show-tracks'].fire('change');
  assert.deepEqual(h.calls.filter(c=>c[0]==='remove').map(c=>c[1]),['tracks']);
  assert.deepEqual(['total','applied','unapplied'].map(name=>h.elements['aerial-'+name].textContent),kpis);
  h.elements['aerial-show-tracks'].checked=true; h.elements['aerial-show-tracks'].fire('change');
  assert.equal(h.calls.filter(c=>c[0]==='add').filter(c=>c[1]==='tracks').length,2);
  assert.deepEqual(['total','applied','unapplied'].map(name=>h.elements['aerial-'+name].textContent),kpis);
});
