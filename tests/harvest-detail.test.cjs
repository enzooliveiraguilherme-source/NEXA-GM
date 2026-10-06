const fs=require('node:fs'),zlib=require('node:zlib'),vm=require('node:vm'),assert=require('node:assert/strict');
const root='dados/colheita/2026/milho/fe-original/',index=JSON.parse(fs.readFileSync(root+'index.json')),record=index.records.find(r=>r.campo==='FE 12'),chunk=JSON.parse(fs.readFileSync(root+record.chunks[0]));
const bytes=zlib.gunzipSync(Buffer.from(chunk.gzip_base64,'base64')),points=new Float64Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/8);
const context=vm.createContext({window:{},L:{Layer:{extend(methods){function Layer(){methods.initialize.call(this);}Layer.prototype=methods;return Layer;}}},Float32Array,requestAnimationFrame:()=>1});
vm.runInContext(fs.readFileSync('js/harvest-points.js','utf8'),context);const layer=context.window.HarvestPoints.create([points[0],points[1]],[]);
layer.addPoints(points.subarray(0,64),8);const part=layer.parts[0];assert.equal(part.count,48);
const v=part.vertices;
// Os dois primeiros pontos são vizinhos na mesma linha da grade original.
assert.equal(points[5],points[13]);assert.equal(points[12]-points[4],5);
// A aresta direita da primeira célula e a esquerda da seguinte devem
// se encontrar, mesmo com a rotação e a mudança de escala da projeção.
for(const [a,b] of [[1,6],[2,11]]){const gap=Math.hypot(v[a*3]-v[b*3],v[a*3+1]-v[b*3+1]);assert.ok(gap<0.03,'Não deve haver vão entre células adjacentes: '+gap);}
const horizontal=Math.hypot(v[3]-v[0],v[4]-v[1]);assert.ok(horizontal>5,'Escala de Mercator deve ser respeitada');assert.notEqual(v[4],v[1],'Orientação da grade deve ser respeitada');
console.log('Detalhe original: células vizinhas contínuas, escala e rotação da grade verificadas no FE 12.');
