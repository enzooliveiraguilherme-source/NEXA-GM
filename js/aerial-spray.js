(function(root) {
 'use strict';
 const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const formatArea=v=>v==null||!Number.isFinite(Number(v))?'-':Number(v).toLocaleString('pt-BR',{maximumFractionDigits:2})+' ha';
 const formatDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)?v.split('-').reverse().join('/'):'Todos os dias';
 const lineStyle=()=>({color:'#718096',weight:1,opacity:.6});
 function baseFeatures(state,year) {
  return ((state.fieldData||state.geojsonData)?.features||[]).flatMap(f=>{
   const p=f.properties||{},match=c=>c.operationType==='pulverizacao'&&String(c.ano)===String(year);
   if(p.OperationalArchived===true||(state.currentFazenda!=='ALL'&&p.Fazenda!==state.currentFazenda)||(state.currentGleba!=='ALL'&&p.Gleba!==state.currentGleba))return [];
   if(p.MapOnlyContexts&&!p.MapOnlyContexts.some(match))return [];
   const c=p.MapContexts?.find(match);return c?.hidden?[]:[{...f,geometry:c?.geometry||f.geometry}];
  });
 }
 function targetBounds(rows) {
  const b=rows.map(r=>r.bounds).filter(b=>Array.isArray(b)&&b.length===4&&b.every(Number.isFinite));
  return b.length?[[Math.min(...b.map(x=>x[1])),Math.min(...b.map(x=>x[0]))],[Math.max(...b.map(x=>x[3])),Math.max(...b.map(x=>x[2]))]]:null;
 }
 function summary(rows,date) {
  const stats=rows.map(r=>r.stats?.[date]).filter(Boolean),sum=k=>stats.reduce((n,s)=>n+(Number(s[k])||0),0);
  return stats.length?{total:sum('total'),applied:sum('applied'),overlap:sum('overlap'),unapplied:stats.some(s=>s.gaps_available)?sum('unapplied'):null,
   eligible_fields:sum('eligible_fields'),gaps_date:stats.map(s=>s.gaps_date).filter(Boolean).sort().at(-1)}:null;
 }
 function createView({document,L,client}) {
  const el=n=>document.getElementById('aerial-'+n),modes=['coverage','overlap','gaps'];
  let state,active=false,initialized=false,scope='',catalog=[],mode='coverage',epoch=0,request=0,controller,base,baseRef,baseKey='',renderer;
  const layers={},responses=new Map();
  const rows=()=>catalog.filter(r=>r.ap===el('ap').value&&r.ano===el('year').value&&r.cultura===el('culture').value);
  const status=t=>el('status').textContent=t;
  function remove(name){if(layers[name])state?.map?.removeLayer(layers[name]);delete layers[name];}
  function clear(){for(const name of Object.keys(layers))remove(name);}
  function cancel(){++request;controller?.abort();controller=null;}
  function clearBase(){if(base)state?.map?.removeLayer(base);base=null;baseRef=null;baseKey='';}
  function remember(key,data){responses.delete(key);responses.set(key,data);while(responses.size>18)responses.delete(responses.keys().next().value);}
  function baseMap(force=false){
   const data=state.fieldData||state.geojsonData,key=JSON.stringify([scope,el('year').value]);
   if(!force&&base&&baseRef===data&&baseKey===key){if(el('show-boundaries').checked)base.addTo(state.map);else state.map.removeLayer(base);return;}
   clearBase();baseRef=data;baseKey=key;
   renderer??=L.canvas({padding:.3});
   base=L.geoJSON({type:'FeatureCollection',features:baseFeatures(state,el('year').value)},{renderer,style:{color:'#d7e5dd',weight:1,fillOpacity:.015},onEachFeature(f,l){l.bindTooltip?.(escape(f.properties?.Campo),{className:'aerial-field-label',sticky:true});}});
   if(el('show-boundaries').checked)base.addTo(state.map);
  }
  function focus(){const b=targetBounds(rows());if(b)state.map.fitBounds(b,{padding:[24,24],maxZoom:15});}
  function options(name,values,selected,label=v=>v){
   const select=el(name);select.replaceChildren();
   for(const value of values){const o=document.createElement('option');o.value=value;o.textContent=label(value);select.append(o);}
   select.value=values.includes(selected)?selected:(values[0]||'');select.disabled=!values.length;
  }
  function dates(){options('date',['*',...new Set(rows().flatMap(r=>r.dates||[]))].sort((a,b)=>a==='*'?-1:b==='*'?1:b.localeCompare(a)),el('date').value,formatDate);}
  function aps(){
   const visible=catalog.filter(r=>r.ano===el('year').value&&r.cultura===el('culture').value);
   const names=[...new Set(visible.map(r=>r.ap))].sort((a,b)=>{
    const latest=ap=>visible.filter(r=>r.ap===ap).flatMap(r=>r.dates||[]).sort().at(-1)||'';
    return latest(b).localeCompare(latest(a))||a.localeCompare(b,'pt-BR',{numeric:true});
   });
   options('ap',names,el('ap').value);dates();el('focus').disabled=!names.length;
  }
  function cultures(){options('culture',[...new Set(catalog.filter(r=>r.ano===el('year').value).map(r=>r.cultura))],el('culture').value||state.currentCultura);aps();}
  function stats(){const s=summary(rows(),el('date').value);for(const n of ['applied','overlap','unapplied','total'])el(n).textContent=formatArea(s?.[n]);return s;}
  const params=kind=>({map_year:el('year').value,map_culture:el('culture').value,map_farm:state.currentFazenda,map_gleba:state.currentGleba,selected_ap:el('ap').value,map_date:kind==='boundaries'?'*':el('date').value,map_kind:kind});
  async function rpc(name,args,signal){let result=client.rpc(name,args);if(signal&&result.abortSignal)result=result.abortSignal(signal);const r=await result;if(r.error)throw r.error;return r.data;}
  function add(kind,data){
   remove(kind);const colors={coverage:'#16a36a',overlap:'#dd5272',gaps:'#f3ad3b',nominal:'#409fd1',boundaries:'#f6e9ad'};
   const layer=L.geoJSON(data,{renderer,style:kind==='tracks'?lineStyle:{color:colors[kind],weight:kind==='boundaries'?1.6:.55,fillOpacity:kind==='boundaries'?0:kind==='nominal'?.15:.65},
    onEachFeature(f,l){const p=f.properties||{};l.bindPopup?.('<strong>'+escape(p.Campo||p.AP)+'</strong><br>'+escape(p.AP)+' � '+escape(formatDate(p.data_aplicacao))+(p.area_ha!=null?'<br>'+escape(formatArea(p.area_ha)):''));}});
   layers[kind]=layer;layer.addTo(state.map);
  }
  async function draw({fit=false}={}){
   cancel();clear();baseMap();const version=request,generation=epoch,s=stats();
   for(const n of modes)el('mode-'+n).setAttribute('aria-pressed',String(n===mode));
   el('final').hidden=!(mode==='gaps'&&el('date').value!=='*');
   if(!el('ap').value){status('Nenhuma AP dispon�vel para esta fazenda e safra.');return;}
   if(fit)focus();
   controller=new AbortController();const signal=controller.signal;
   const kinds=['boundaries',...(mode==='gaps'&&el('date').value!=='*'?[]:[mode]),...['tracks','nominal'].filter(k=>el('show-'+k).checked)];
   const finalNote=mode==='gaps'?'Restante final da AP � somente talh�es com pelo menos 50% de cobertura.':'';
   status('Carregando mapa.');el('panel').setAttribute('aria-busy','true');
   const results=await Promise.allSettled(kinds.map(async kind=>{
    const args=params(kind),key=JSON.stringify(args);let data=responses.get(key);
    if(!data){data=await rpc('aerial_v2_layer',args,signal);if(data)remember(key,data);}
    if(version!==request||generation!==epoch||!active||signal.aborted)return;
    if(!data)throw Error('Camada indispon�vel');add(kind,data);
   }));
   if(version!==request||generation!==epoch||!active||signal.aborted)return;
   el('panel').setAttribute('aria-busy','false');
   if(results.some(r=>r.status==='rejected')){status('N�o foi poss�vel carregar parte do mapa. Toque em atualizar para tentar novamente.');return;}
   status(mode==='gaps'&&el('date').value!=='*'?'O restante � avaliado ap�s todos os voos da AP. Toque em "Ver restante final".':finalNote||'');
  }
  async function loadCatalog(reload=false){
   cancel();clear();++epoch;const generation=epoch;catalog=[];el('focus').disabled=true;
   for(const n of ['ap','date','year','culture'])options(n,[],'');stats();baseMap(true);
   if(reload)responses.clear();status('Buscando aplica��es.');
   try{
    const data=await rpc('aerial_v2_catalog',{map_farm:state.currentFazenda,map_gleba:state.currentGleba});
    if(generation!==epoch||!active)return;
    catalog=data||[];options('year',[...new Set(catalog.map(r=>r.ano))].sort().reverse(),String(state.currentAno||''));cultures();await draw({fit:true});
   }catch(e){if(generation===epoch&&active)status('N�o foi poss�vel buscar as APs. Toque em atualizar para tentar novamente.');}
  }
  function init(){
   initialized=true;el('reload').addEventListener('click',()=>loadCatalog(true));el('focus').addEventListener('click',focus);
   el('year').addEventListener('change',()=>{cultures();baseMap(true);draw({fit:true});});
   el('culture').addEventListener('change',()=>{aps();draw({fit:true});});
   el('ap').addEventListener('change',()=>{el('date').value='*';dates();draw({fit:true});});
   el('date').addEventListener('change',()=>draw());
   for(const n of modes)el('mode-'+n).addEventListener('click',()=>{mode=n;draw();});
   for(const n of ['tracks','nominal'])el('show-'+n).addEventListener('change',()=>draw());
   el('show-boundaries').addEventListener('change',()=>baseMap());
   el('final').addEventListener('click',()=>{el('date').value='*';draw();});
   el('close-options').addEventListener('click',()=>{el('options').open=false;});
  }
  function refresh(next){
   if(!el('panel'))return;if(!initialized)init();
   const enabled=next.currentTab==='aerea';el('panel').hidden=!enabled;
   if(!enabled){if(active){cancel();++epoch;clear();clearBase();}active=false;state=next;return;}
   const wasActive=active;state=next;active=true;
   const key=JSON.stringify([root.portalUser?.id,state.currentFazenda,state.currentGleba]);
   state.map?.invalidateSize();
   if(key!==scope||!catalog.length){scope=key;loadCatalog();}
   else{baseMap();if(!wasActive)draw();}
  }
  return {refresh};
 }
 let view;root.AerialSpray={createView,lineStyle,formatArea,formatDate,baseFeatures,targetBounds,summary,refresh(state){if(!view)view=createView({document:root.document,L:root.L,client:root.supabaseClient});view.refresh(state);}};
 if(typeof module!=='undefined')module.exports={createView,lineStyle,formatArea,formatDate,baseFeatures,targetBounds,summary};
})(typeof window!=='undefined'?window:globalThis);
