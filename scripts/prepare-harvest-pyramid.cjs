const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const base=path.resolve(__dirname,'../dados/colheita/2026/milho/fe-original'),out=path.join(base,'pyramid');
const index=JSON.parse(fs.readFileSync(path.join(base,'index.json'))),fields=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../Talhoes.geojson'))).features;
const R=6378137, project=([x,y])=>[R*x*Math.PI/180,R*Math.log(Math.tan(Math.PI/4+y*Math.PI/360))];
const inverse=([x,y])=>[x/R*180/Math.PI,(2*Math.atan(Math.exp(y/R))-Math.PI/2)*180/Math.PI];
const palette=[[215,48,39],[252,141,89],[254,224,139],[217,239,139],[145,207,96],[26,152,80]];
const category=v=>v<120?0:v<130?1:v<140?2:v<160?3:v<=180?4:5;
function ringContains(p,ring){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;}
function contains(p,polygons){return polygons.some(rings=>ringContains(p,rings[0])&&!rings.slice(1).some(r=>ringContains(p,r)));}
const table=Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc(bytes){let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function chunk(type,data){const t=Buffer.from(type),b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);t.copy(b,4);data.copy(b,8);b.writeUInt32BE(crc(Buffer.concat([t,data])),b.length-4);return b;}
function png(w,h,rgba){const header=Buffer.alloc(13);header.writeUInt32BE(w);header.writeUInt32BE(h,4);header[8]=8;header[9]=6;const scan=Buffer.alloc(h*(w*4+1));for(let y=0;y<h;y++)rgba.copy(scan,y*(w*4+1)+1,y*w*4,(y+1)*w*4);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(scan)),chunk('IEND',Buffer.alloc(0))]);}
fs.mkdirSync(out,{recursive:true});const records=[];
for(const record of index.records){
 const polygons=fields.filter(f=>f.properties.Campo===record.campo).flatMap(f=>f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates).map(rings=>rings.map(r=>r.map(project)));
 const coords=polygons.flat(2),xs=coords.map(p=>p[0]),ys=coords.map(p=>p[1]);
 const minX=Math.floor(Math.min(...xs)/5)*5,maxY=Math.ceil(Math.max(...ys)/5)*5,w=Math.ceil((Math.max(...xs)-minX)/5),h=Math.ceil((maxY-Math.min(...ys))/5);
 let sums=new Float64Array(w*h),counts=new Uint32Array(w*h);
 for(const name of record.chunks){const p=JSON.parse(fs.readFileSync(path.join(base,name))),b=zlib.gunzipSync(Buffer.from(p.gzip_base64,'base64'));for(let i=0;i<p.count;i++){const [x,y]=project([b.readDoubleLE(i*64),b.readDoubleLE(i*64+8)]),cx=Math.floor((x-minX)/5),cy=Math.floor((maxY-y)/5);if(cx>=0&&cx<w&&cy>=0&&cy<h){const at=cy*w+cx;sums[at]+=b.readDoubleLE(i*64+16);counts[at]++;}}}
 let masked=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const at=y*w+x;if(counts[at]&&!contains([minX+(x+.5)*5,maxY-(y+.5)*5],polygons)){counts[at]=0;sums[at]=0;masked++;}}
 const levels=[];let width=w,height=h;
 for(let level=0;level<6;level++){
  const rgba=Buffer.alloc(width*height*4);for(let i=0;i<counts.length;i++)if(counts[i]){const col=palette[category(sums[i]/counts[i])];rgba[i*4]=col[0];rgba[i*4+1]=col[1];rgba[i*4+2]=col[2];rgba[i*4+3]=255;}
  const resolution=5*2**level,swLevel=inverse([minX,maxY-height*resolution]),neLevel=inverse([minX+width*resolution,maxY]);
  const file=record.campo.replace(/\s+/g,'-').toLowerCase()+'-'+level+'.png';fs.writeFileSync(path.join(out,file),png(width,height,rgba));levels.push({file,width,height,resolution,bounds:[[swLevel[1],swLevel[0]],[neLevel[1],neLevel[0]]]});
  const nw=Math.ceil(width/2),nh=Math.ceil(height/2),ns=new Float64Array(nw*nh),nc=new Uint32Array(nw*nh);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const at=y*width+x,to=Math.floor(y/2)*nw+Math.floor(x/2);ns[to]+=sums[at];nc[to]+=counts[at];}sums=ns;counts=nc;width=nw;height=nh;
 }
 const sw=inverse([minX,maxY-h*5]),ne=inverse([minX+w*5,maxY]);records.push({campo:record.campo,bounds:[[sw[1],sw[0]],[ne[1],ne[0]]],levels,maskedCells:masked});console.log(record.campo+': '+masked+' células fora dos limites ocultadas.');
}
fs.writeFileSync(path.join(out,'index.json'),JSON.stringify({representation:'display-pyramid-v1',source:'original-points-v1',unit:'sc/ha',records},null,2));
module.exports={contains,category};
