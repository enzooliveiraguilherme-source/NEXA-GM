const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),vm=require('node:vm');
const base=path.resolve(__dirname,'../dados/colheita/2026/milho/fe-original/pyramid'),index=JSON.parse(fs.readFileSync(path.join(base,'index.json')));
assert.equal(index.records.length,21);
let bytes=0;
for(const record of index.records){assert.equal(record.levels.length,6);for(const item of record.levels){const b=fs.readFileSync(path.join(base,item.file));bytes+=b.length;assert.deepEqual([...b.subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.equal(b.readUInt32BE(16),item.width);assert.equal(b.readUInt32BE(20),item.height);}}
const field=index.records.find(r=>r.campo==='FE 19'),level=field.levels[0],png=fs.readFileSync(path.join(base,level.file));let idat=[];
for(let at=8;at<png.length;){const n=png.readUInt32BE(at),type=png.toString('ascii',at+4,at+8);if(type==='IDAT')idat.push(png.subarray(at+8,at+8+n));at+=n+12;}
const pixels=zlib.inflateSync(Buffer.concat(idat)),R=6378137,project=([x,y])=>[R*x*Math.PI/180,R*Math.log(Math.tan(Math.PI/4+y*Math.PI/360))];
const feature=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../Talhoes.geojson'))).features.find(f=>f.properties.Campo==='FE 19'),rings=feature.geometry.coordinates[0].map(r=>r.map(project));
assert.ok(rings.length>1,'FE 19 deve ter furos');
function inside([x,y],ring){let n=0;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])n++;}return n%2===1;}
const [minX,maxY]=project([level.bounds[0][1],level.bounds[1][0]]);let holes=0,shown=0;
for(let y=0;y<level.height;y++)for(let x=0;x<level.width;x++){const p=[minX+(x+.5)*5,maxY-(y+.5)*5],alpha=pixels[y*(level.width*4+1)+1+x*4+3],hole=rings.slice(1).some(r=>inside(p,r));if(hole){assert.equal(alpha,0,'Nenhum pixel dentro de furo pode ter cor');holes++;}if(alpha)shown++;}
assert.ok(holes>100);assert.ok(shown>10000);
const fe12=index.records.find(r=>r.campo==='FE 12').levels[0],image12=fs.readFileSync(path.join(base,fe12.file));let data12=[];
for(let at=8;at<image12.length;){const n=image12.readUInt32BE(at);if(image12.toString('ascii',at+4,at+8)==='IDAT')data12.push(image12.subarray(at+8,at+8+n));at+=n+12;}
const pixels12=zlib.inflateSync(Buffer.concat(data12)),alpha12=(x,y)=>pixels12[y*(fe12.width*4+1)+x*4+4];
let isolated=0;for(let y=1;y<fe12.height-1;y++)for(let x=1;x<fe12.width-1;x++)if(!alpha12(x,y)&&[[1,0],[-1,0],[0,1],[0,-1]].every(([u,v])=>alpha12(x+u,y+v)))isolated++;
assert.equal(isolated,0,'A reprojeção não deve criar pequenos furos isolados no FE 12');
const context=vm.createContext({window:{}});vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../js/harvest-view.js'),'utf8'),context);
const color=context.window.HarvestView.color;assert.equal(color(119.99),'#d73027');assert.equal(color(120),'#fc8d59');assert.equal(color(130),'#fee08b');assert.equal(color(140),'#d9ef8b');assert.equal(color(160),'#91cf60');assert.equal(color(180),'#91cf60');assert.equal(color(180.01),'#1a9850');
console.log('126 imagens da pirâmide verificadas; '+holes+' células em furos do FE 19 transparentes; limites das seis classes conferidos; '+bytes+' bytes de imagens.');
