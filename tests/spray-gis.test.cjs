const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function harness({tileSize=256}={}){
    const elements=new Map(),geoJSONCalls=[],refreshCalls=[],addedLayers=[],removedLayers=[];
    function classList(){const names=new Set();return{add(name){names.add(name);},remove(name){names.delete(name);},contains(name){return names.has(name);},toggle(name,force){if(force??!names.has(name))names.add(name);else names.delete(name);return names.has(name);}};}
    const sprayNavButtons=['tabela-pulverizacao','mapa-pulverizacao'].map(view=>({dataset:{sprayView:view},classList:classList()}));
    const sprayHeaderButtons=[];
    const document={body:{classList:classList()},addEventListener(){},querySelector(){return null;},querySelectorAll(selector){return selector==='[data-spray-view]'?[...sprayNavButtons,...sprayHeaderButtons]:[];},getElementById(id){
        if(!elements.has(id)) elements.set(id,{id,hidden:false,textContent:'',innerHTML:'',disabled:false,style:{},closest(){return{classList:classList()};},classList:classList()});
        return elements.get(id);
    }};
    const sprayCalls={styles:[],selected:[],popups:[]};
    const sprayControl={
        refresh(state,features){refreshCalls.push({state,features:[...features]});},
        style(feature){const style={fillColor:`spray-${feature.properties.Campo}`,fillOpacity:.7,color:'#123'};sprayCalls.styles.push({feature,style});return style;},
        selectFeature(feature){sprayCalls.selected.push(feature);},
        popup(feature){sprayCalls.popups.push(feature);return `<div>${feature.properties.Campo} spray details</div>`;}
    };
    const window={SprayControl:sprayControl,PlantingMaps:{clearLabels(){},refresh(){},refreshLabels(){}},setInterval(){return 1;}};
    let api;
    const basemapTiles=[];
    const L={DomEvent:{stopPropagation(){},preventDefault(){}},map(){return{setView(coords,zoom){this.view={coords,zoom};return this;}};},
        control:{zoom(options){return{addTo(map){return{options,map};}};}},tileLayer(url,options){
            const handlers={};const layer={url,options,handlers,on(name,handler){handlers[name]=handler;return this;},
                getTileSize(){return{x:tileSize,y:tileSize};},addTo(map){this.map=map;return this;}};basemapTiles.push(layer);return layer;
        },layerGroup(){return{addTo(map){this.map=map;return this;}};},geoJSON(data,options){
        const layer={data,options,children:[],added:false,eachLayer(fn){this.children.forEach(fn);},getBounds(){return{};},addTo(map){this.map=map;this.added=true;addedLayers.push(this);
            for(const feature of data.features){const child={feature,style:options.style(feature),handlers:{},tooltip:null,popup:null,
                on(name,fn){this.handlers[name]=fn;},getTooltip(){return this.tooltip;},bindTooltip(html){this.tooltip=html;return this;},setTooltipContent(html){this.tooltip=html;},unbindTooltip(){this.tooltip=null;},closeTooltip(){this.tooltip=null;},
                bindPopup(html){this.popup=html;return this;},openPopup(){this.popupOpen=true;this.handlers.popupopen?.();return this;},closePopup(){this.popupOpen=false;this.handlers.popupclose?.();},
                setStyle(style){this.style=style;},bringToFront(){this.front=true;}};
                this.children.push(child);options.onEachFeature(feature,child);
            }
            return this;
        }};
        geoJSONCalls.push({data,options,layer});return layer;
    }};
    const context=vm.createContext({window,document,console,Date,L,HarvestImport:{displayNumber(value){return String(value??'—');}},
        HarvestView:{clear(){},refreshFilters(){},select(){},fieldKey(){},scopeLabel(){return'';},showAll(){}},setTimeout(){return 1;}});
    vm.runInContext(fs.readFileSync(require.resolve('../app.js'),'utf8'),context);
    api=vm.runInContext('({state,renderMap,onEachFeature,getFeatureStyle,AdubacaoModal,updateOperationUI,initMap})',context);
    api.state.currentTab='pulverizacao';api.state.currentSubTab='mapa-pulverizacao';api.state.currentFazenda='FE';api.state.currentGleba='A';api.state.userRole='editor';api.state.operationalMode='aplicacao';
    api.state.map={closeTooltip(){},removeLayer(layer){removedLayers.push(layer);},invalidateSize(){},closePopup(){},fitBounds(bounds,options){this.bounds={bounds,options};}};
    const features=[
        {properties:{Fazenda:'FE',Campo:'FE 01',Area:100,Gleba:'A'}},
        {properties:{Fazenda:'FE',Campo:'FE 02',Area:80,Gleba:'A'}},
        {properties:{Fazenda:'FE',Campo:'FE 03',Area:75,Gleba:'B'}},
        {properties:{Fazenda:'FE2',Campo:'FE 04',Area:60,Gleba:'A'}}
    ];
    api.state.geojsonData={type:'FeatureCollection',features};
    api.state.cloudStore={getRecords(){return{};},getPlanning(){return{};}};
    return{...api,window,document,elements,features,geoJSONCalls,refreshCalls,addedLayers,removedLayers,sprayCalls,sprayNavButtons,sprayHeaderButtons,basemapTiles};
}

test('tileloadstart adds one pixel to 256 and 512 tiles without changing coordinates or accumulating size',()=>{
    for(const size of [256,512]){
        const h=harness({tileSize:size});h.initMap();
        const layer=h.state.basemapLayers.esri,handler=layer.handlers.tileloadstart;
        const tile={style:{width:`${size}px`,height:`${size}px`,left:'17px',top:'29px'},coords:{x:12,y:7,z:5}};
        handler.call(layer,{tile});
        assert.equal(tile.style.width,`${size+1}px`);assert.equal(tile.style.height,`${size+1}px`);
        assert.equal(tile.style.left,'17px');assert.equal(tile.style.top,'29px');
        assert.deepEqual(tile.coords,{x:12,y:7,z:5});
        handler.call(layer,{tile});
        assert.equal(tile.style.width,`${size+1}px`);assert.equal(tile.style.height,`${size+1}px`);
        assert.equal(tile.style.left,'17px');assert.equal(tile.style.top,'29px');
        assert.deepEqual(tile.coords,{x:12,y:7,z:5});
    }
});

test('estilo GIS e clique usam SprayControl, abrem popup e não abrem edição legada',()=>{
    const h=harness(),feature=h.features[0];
    const expected=h.window.SprayControl.style(feature);
    assert.deepEqual(h.getFeatureStyle(feature),expected);
    let edited=0;h.AdubacaoModal.open=()=>{edited++;};
    h.renderMap(false);
    assert.equal(h.geoJSONCalls.length,1);
    const layer=h.state.geojsonLayer.children[0];
    assert.equal(layer.style.fillColor,'spray-FE 01');
    assert.equal(h.refreshCalls.at(-1).features.length,2);
    layer.handlers.click({originalEvent:{}});
    assert.deepEqual(h.sprayCalls.selected,[feature]);
    assert.deepEqual(h.sprayCalls.popups,[feature]);
    assert.match(layer.popup,/FE 01 spray details/);
    assert.equal(layer.popupOpen,true);
    assert.equal(edited,0);
});

test('mouseover não apaga o tema; popup suspende tooltip e restaura no fechamento',()=>{
    const h=harness();h.renderMap(false);
    const layer=h.state.geojsonLayer.children[0];
    const original=layer.style;
    assert.ok(layer.tooltip);
    layer.handlers.mouseover();
    assert.equal(layer.style,original);
    layer.handlers.click({originalEvent:{}});
    assert.equal(layer.tooltip,null);
    layer.handlers.popupclose();
    assert.ok(layer.tooltip);
    layer.handlers.mouseout();
    assert.equal(layer.style.fillColor,'spray-FE 01');
});

test('renderMap cria camada com os talhões dos filtros mesmo sem aplicações de pulverização',()=>{
    const h=harness();h.renderMap(false);
    assert.equal(h.geoJSONCalls.length,1);
    assert.equal(h.state.geojsonLayer.added,true);
    assert.deepEqual(h.geoJSONCalls[0].data.features.map(feature=>feature.properties.Campo),['FE 01','FE 02']);
    assert.deepEqual(h.refreshCalls.at(-1).features.map(feature=>feature.properties.Campo),['FE 01','FE 02']);
    assert.equal(h.state.geojsonLayer.children.length,2);
    assert.equal(h.state.geojsonLayer.children[0].style.fillColor,'spray-FE 01');
    assert.equal(h.state.geojsonLayer.children[1].style.fillColor,'spray-FE 02');
    h.state.currentGleba='B';h.renderMap(false);
    assert.equal(h.geoJSONCalls.length,2);
    assert.deepEqual(h.geoJSONCalls.at(-1).data.features.map(feature=>feature.properties.Campo),['FE 03']);
    assert.equal(h.removedLayers.length,1);
});

test('subaba Tabela atualiza o controle sem criar camada GIS e a subaba Mapa cria todas as geometrias filtradas',()=>{
    const h=harness();h.state.currentSubTab='tabela-pulverizacao';h.renderMap(false);
    assert.equal(h.geoJSONCalls.length,0);
    assert.equal(h.state.geojsonLayer,null);
    assert.deepEqual(h.refreshCalls.at(-1).features.map(feature=>feature.properties.Campo),['FE 01','FE 02']);
    h.state.currentSubTab='mapa-pulverizacao';h.renderMap(false);
    assert.equal(h.geoJSONCalls.length,1);
    assert.deepEqual(h.geoJSONCalls.at(-1).data.features.map(feature=>feature.properties.Campo),['FE 01','FE 02']);
    assert.equal(h.state.geojsonLayer.children.length,2);
});

test('updateOperationUI mostra exclusivamente tabela ou mapa e marca todos os botões da subaba ativa',()=>{
    const h=harness();h.state.currentSubTab='tabela-pulverizacao';h.updateOperationUI();
    const map=h.elements.get('map-container'),panel=h.elements.get('spray-panel'),mapFilter=h.elements.get('spray-map-filter-group'),dashboard=h.elements.get('spray-map-dashboard');
    assert.equal(panel.hidden,false);assert.equal(map.classList.contains('hidden'),true);
    assert.equal(h.document.body.classList.contains('spray-table-view'),true);
    assert.equal(h.document.body.classList.contains('spray-map-view'),false);
    assert.equal(mapFilter.classList.contains('hidden'),true);assert.equal(dashboard.classList.contains('hidden'),true);
    for(const button of h.sprayNavButtons)assert.equal(button.classList.contains('active'),button.dataset.sprayView==='tabela-pulverizacao');
    h.state.currentSubTab='mapa-pulverizacao';h.updateOperationUI();
    assert.equal(panel.hidden,true);assert.equal(map.classList.contains('hidden'),false);
    assert.equal(h.document.body.classList.contains('spray-table-view'),false);
    assert.equal(h.document.body.classList.contains('spray-map-view'),true);
    assert.equal(mapFilter.classList.contains('hidden'),false);assert.equal(dashboard.classList.contains('hidden'),false);
    for(const button of h.sprayNavButtons)assert.equal(button.classList.contains('active'),button.dataset.sprayView==='mapa-pulverizacao');
    h.state.currentTab='adubacao';h.state.currentSubTab='calcario';h.updateOperationUI();
    assert.equal(panel.hidden,true);assert.equal(map.classList.contains('hidden'),false);
    assert.equal(mapFilter.classList.contains('hidden'),true);assert.equal(dashboard.classList.contains('hidden'),true);
    assert.equal(h.document.body.classList.contains('spraying'),false);
    assert.equal(h.document.body.classList.contains('spray-table-view'),false);
    assert.equal(h.document.body.classList.contains('spray-map-view'),false);
});

test('HTML agrupa o painel e mapa da pulverização sem incluir o painel de plantio; CSS adapta desktop e mobile',()=>{
    const html=fs.readFileSync(require.resolve('../portal.html'),'utf8');
    const css=fs.readFileSync(require.resolve('../brand.css'),'utf8');
    const leafletCssIndex=html.indexOf('href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css');
    const brandCssIndex=html.indexOf('href="brand.css');
    assert.ok(leafletCssIndex>=0&&brandCssIndex>leafletCssIndex,'brand.css loads after Leaflet CSS');
    const tileRule=css.match(/#map\.leaflet-container img\.leaflet-tile\s*\{([^}]*)\}/);
    assert.ok(tileRule,'raster-tile blending override is scoped to images inside #map');
    assert.match(tileRule[1],/mix-blend-mode:\s*normal\s*;/);
    assert.doesNotMatch(tileRule[1],/width|height|transform/i,'the compositing override does not alter tile geometry');
    assert.doesNotMatch(css,/(^|,\s*)img\.leaflet-tile\s*\{/m,'no unscoped raster tile override');
    const start=html.indexOf('<div id="operation-workspace"');
    assert.notEqual(start,-1,'operation-workspace existe');
    const tags=[...html.slice(start).matchAll(/<div\b[^>]*>|<\/div>/g)];
    let depth=0,close=-1;
    for(const tag of tags){depth+=tag[0].startsWith('</')?-1:1;if(depth===0){close=start+tag.index+tag[0].length;break;}}
    assert.notEqual(close,-1,'operation-workspace fecha');
    const contents=html.slice(start,close);
    assert.match(contents,/<section id="spray-panel"/);
    assert.match(contents,/<div id="map-container"/);
    assert.doesNotMatch(contents,/plantio-panel/);
    const sidebar=html.match(/<div class="nav-group" id="nav-pulverizacao-group">([\s\S]*?)<\/div>\s*<\/div>/)?.[1]||'';
    assert.match(sidebar,/data-spray-view="tabela-pulverizacao"/);assert.match(sidebar,/data-spray-view="mapa-pulverizacao"/);
    assert.doesNotMatch(html,/id="spray-view-switch"/,'não existe uma navegação duplicada no cabeçalho');
    assert.equal((html.match(/data-spray-view="(?:tabela-pulverizacao|mapa-pulverizacao)"/g)||[]).length,4);
    const mobileViews=html.match(/<nav class="spray-mobile-views"[\s\S]*?>([\s\S]*?)<\/nav>/)?.[1]||'';
    assert.match(mobileViews,/data-spray-view="tabela-pulverizacao"/);
    assert.match(mobileViews,/data-spray-view="mapa-pulverizacao"/);
    const mapFilterIndex=html.indexOf('id="spray-map-filter-group"');
    assert.ok(mapFilterIndex>html.indexOf('id="filter-cultura"')&&mapFilterIndex<html.indexOf('id="operation-product-filter-group"'));
    const dashboard=html.match(/<section id="spray-map-dashboard"[\s\S]*?<\/section>/)?.[0]||'';
    assert.match(dashboard,/id="spray-op-map-toggle"[^>]*aria-expanded="true"/);
    assert.match(dashboard,/id="spray-op-map-content"/);assert.match(dashboard,/id="spray-report-actions"/);
    assert.equal((html.match(/id="spray-report-button"/g)||[]).length,1);
    assert.doesNotMatch(html,/id="spray-map-key"/,'legenda antiga do mapa removida');
    assert.match(css,/body\.spray-table-view #map-container,body\.spray-map-view #spray-panel\s*\{\s*display:none!important/);
    assert.match(css,/body\.spraying\.spray-map-view #map-container\s*\{\s*flex:1;\s*height:100%;/);
    assert.match(css,/body\.spraying\.spray-table-view \.spray-control-panel\s*\{\s*display:flex;\s*flex:1;/);
    assert.match(css,/@media\(max-width:820px\)\s*\{\s*body\.spray-table-view \.spray-control-panel/);
});
