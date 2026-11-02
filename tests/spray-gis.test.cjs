const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function harness(){
    const elements=new Map(),geoJSONCalls=[],refreshCalls=[],addedLayers=[],removedLayers=[];
    const document={body:{classList:{toggle(){},add(){},remove(){}}},addEventListener(){},querySelectorAll(){return[];},getElementById(id){
        if(!elements.has(id)) elements.set(id,{id,hidden:false,textContent:'',innerHTML:'',disabled:false,style:{},closest(){return{classList:{toggle(){}}};},classList:{toggle(){},add(){},remove(){}}});
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
    const L={DomEvent:{stopPropagation(){},preventDefault(){}},geoJSON(data,options){
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
    api=vm.runInContext('({state,renderMap,onEachFeature,getFeatureStyle,AdubacaoModal})',context);
    api.state.currentTab='pulverizacao';api.state.currentFazenda='FE';api.state.currentGleba='A';api.state.userRole='editor';api.state.operationalMode='aplicacao';
    api.state.map={closeTooltip(){},removeLayer(layer){removedLayers.push(layer);},invalidateSize(){},closePopup(){},fitBounds(bounds,options){this.bounds={bounds,options};}};
    const features=[
        {properties:{Fazenda:'FE',Campo:'FE 01',Area:100,Gleba:'A'}},
        {properties:{Fazenda:'FE',Campo:'FE 02',Area:80,Gleba:'A'}},
        {properties:{Fazenda:'FE',Campo:'FE 03',Area:75,Gleba:'B'}},
        {properties:{Fazenda:'FE2',Campo:'FE 04',Area:60,Gleba:'A'}}
    ];
    api.state.geojsonData={type:'FeatureCollection',features};
    api.state.cloudStore={getRecords(){return{};},getPlanning(){return{};}};
    return{...api,window,document,elements,features,geoJSONCalls,refreshCalls,addedLayers,removedLayers,sprayCalls};
}

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

test('HTML agrupa o painel e mapa da pulverização sem incluir o painel de plantio; CSS adapta desktop e mobile',()=>{
    const html=fs.readFileSync(require.resolve('../portal.html'),'utf8');
    const css=fs.readFileSync(require.resolve('../brand.css'),'utf8');
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
    assert.match(css,/body\.spraying \.operation-workspace\s*\{\s*display:grid;\s*grid-template-columns:minmax\(0,1\.3fr\) minmax\(320px,1fr\)/);
    assert.match(css,/@media\(max-width:820px\)\s*\{\s*body\.spraying \.operation-workspace\s*\{\s*display:flex;\s*flex-direction:column/);
    assert.match(css,/body\.spraying #map-container\s*\{\s*flex:none;\s*height:55dvh;\s*min-height:340px/);
});
