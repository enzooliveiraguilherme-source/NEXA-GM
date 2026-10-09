const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const zlib = require('node:zlib');

test('resolução nova não sobrescreve a imagem provisória durante o zoom', async () => {
    const pending = new Map();
    const logs = [];
    const small = { valuesFile: 'fe-01-1.json', width: 1, height: 1, bounds: [[0,0],[1,1]] };
    const large = { ...small, valuesFile: 'fe-01-0.json', width: 2 };
    const manifest = { records: [{ campo: 'FE 01', levels: [large, small, small, small, small, small] }] };
    const context2d = () => ({ setTransform(){}, save(){}, restore(){}, beginPath(){}, clip(){}, drawImage(){},
        createImageData(w,h){ return { data: new Uint8ClampedArray(w*h*4) }; }, putImageData(){} });
    const canvas = () => ({ style:{}, getContext: context2d, remove(){} });
    const style = {colors:['#d73027','#fc8d59','#fee08b','#d9ef8b','#91cf60','#1a9850'], breaks:[120,130,140,160,180]};
    const context = vm.createContext({window:{}, document:{createElement:canvas}, Blob, Response, DecompressionStream, atob,
        console:{error(...args){logs.push(args);}}, L:{
            Layer:{extend(methods){return class {constructor(){Object.assign(this,methods);this.initialize();}};}},
            DomUtil:{create:canvas,addClass(){},setPosition(){}},
        }
    });
    context.window.HarvestStyle = {get:()=>style, subscribe:()=>()=>{}};
    context.window.HarvestStore = {loadRaster(_dataset,name){
        if(name==='index.json') return Promise.resolve(manifest);
        return new Promise(resolve => pending.set(name,resolve));
    }};
    vm.runInContext(fs.readFileSync(require.resolve('../js/harvest-pyramid.js'),'utf8'),context);
    const layer = await context.window.HarvestPyramid.create([{campo:'FE 01'}],[],{version:'test'});
    let zoom = 14;
    const map = {getPane:()=>({style:{}}),getSize:()=>({x:360,y:600}),containerPointToLayerPoint:()=>({x:0,y:0}),
        containerPointToLatLng:()=>({}),getZoom:()=>zoom,latLngToContainerPoint:()=>({x:0,y:0}),
        on(){return this;},off(){return this;}};
    layer.onAdd(map);
    async function resolveFile(item,values) {
        const bytes = Buffer.alloc(values.length*8); values.forEach((v,i)=>bytes.writeDoubleLE(v,i*8));
        pending.get(item.valuesFile)({format:'harvest-values-f64-v1',width:item.width,height:item.height,gzip_base64:zlib.gzipSync(bytes).toString('base64')});
        for(let i=0;i<30 && !layer.images.get(item.valuesFile).values;i++) await new Promise(resolve=>setTimeout(resolve,5));
        assert.ok(layer.images.get(item.valuesFile).values,'A resolução deve terminar de carregar');
    }
    await resolveFile(small,[130]);
    zoom = 15; layer.draw();
    await resolveFile(large,[120,160]);
    assert.equal(layer.images.get(small.valuesFile).values.length,1);
    assert.equal(layer.images.get(large.valuesFile).values.length,2);
    assert.deepEqual(logs,[],'O zoom não deve produzir erros de tamanho de imagem');
    context.window.HarvestStyle.get = () => ({...style,breaks:[110,125,135,150,175]});
    layer.colored.clear();
    assert.doesNotThrow(()=>layer.draw(),'Alterar a legenda depois do zoom deve continuar funcionando');
});
