(function (root) {
    'use strict';
    const R = 6378137;
    const mercator = (lon, lat) => [R * lon * Math.PI / 180, R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
    const colors = ['#d73027', '#fc8d59', '#fee08b', '#d9ef8b', '#91cf60', '#1a9850'];
    const category = value => value < 120 ? 0 : value < 130 ? 1 : value < 140 ? 2 : value < 160 ? 3 : value <= 180 ? 4 : 5;
    function shader(gl, type, source) {
        const result = gl.createShader(type); gl.shaderSource(result, source); gl.compileShader(result);
        if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error('Falha ao preparar o desenho da produtividade.');
        return result;
    }
    function create(origin, features) {
        const Layer = L.Layer.extend({
            initialize() { this.parts = []; this.origin = origin; this.center = mercator(...origin); this.frame = null; },
            onAdd(map) {
                this.map = map;
                const pane = map.getPane('harvest-original') || map.createPane('harvest-original');
                pane.style.zIndex = '350'; pane.style.pointerEvents = 'none';
                this.canvas = L.DomUtil.create('canvas', 'harvest-original-canvas', pane);
                this.canvas.style.pointerEvents = 'none';
                this.ctx = this.canvas.getContext('2d');
                this.gpuCanvas = document.createElement('canvas');
                this.gl = this.gpuCanvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: false });
                if (this.gl) {
                    const gl = this.gl;
                    this.program = gl.createProgram();
                    gl.attachShader(this.program, shader(gl, gl.VERTEX_SHADER, 'attribute vec3 p; uniform vec2 viewport; uniform vec2 offset; uniform float scale; uniform float size; varying float c; void main(){ vec2 screen=offset+p.xy*vec2(scale,-scale); gl_Position=vec4(screen.x/viewport.x*2.0-1.0,1.0-screen.y/viewport.y*2.0,0.0,1.0); gl_PointSize=size; c=p.z; }'));
                    gl.attachShader(this.program, shader(gl, gl.FRAGMENT_SHADER, 'precision mediump float; varying float c; void main(){vec3 rgb=c<0.5?vec3(0.843,0.188,0.153):c<1.5?vec3(0.988,0.553,0.349):c<2.5?vec3(0.996,0.878,0.545):c<3.5?vec3(0.851,0.937,0.545):c<4.5?vec3(0.569,0.812,0.376):vec3(0.102,0.596,0.314); gl_FragColor=vec4(rgb,1.0);}'));
                    gl.linkProgram(this.program);
                    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error('Falha ao iniciar o mapa de produtividade.');
                    this.locations = { p: gl.getAttribLocation(this.program, 'p'), viewport: gl.getUniformLocation(this.program, 'viewport'), offset: gl.getUniformLocation(this.program, 'offset'), scale: gl.getUniformLocation(this.program, 'scale'), size: gl.getUniformLocation(this.program, 'size') };
                }
                map.on('move zoom resize', this.schedule, this);
                this.draw();
            },
            addPoints(points, stride) {
                const count = points.length / stride;
                // Desenhe a célula real da grade, com orientação e escala
                // derivadas dos X/Y originais, em vez de quadrados em pixels.
                const first=mercator(points[0],points[1]),x0=points[4],y0=points[5];
                let east,north;
                for(let i=1;i<count&&!east;i++)if(Math.abs(points[i*stride+5]-y0)<0.001&&Math.abs(points[i*stride+4]-x0)>1){const p=mercator(points[i*stride],points[i*stride+1]),dx=points[i*stride+4]-x0;east=[(p[0]-first[0])/dx,(p[1]-first[1])/dx];}
                east ||= [1/Math.cos(points[1]*Math.PI/180),0];
                for(let i=1;i<count&&!north;i++)if(Math.abs(points[i*stride+5]-y0)>1){const p=mercator(points[i*stride],points[i*stride+1]),dx=points[i*stride+4]-x0,dy=points[i*stride+5]-y0;north=[(p[0]-first[0]-east[0]*dx)/dy,(p[1]-first[1]-east[1]*dx)/dy];}
                north ||= [0,1/Math.cos(points[1]*Math.PI/180)];
                const corners=[[-1,-1],[1,-1],[1,1],[-1,-1],[1,1],[-1,1]],half=2.505;
                const vertices = new Float32Array(count * 18);
                for (let i = 0; i < count; i++) {
                    const pos = mercator(points[i * stride], points[i * stride + 1]);
                    for(let j=0;j<6;j++){const at=i*18+j*3,[a,b]=corners[j];vertices[at]=pos[0]-this.center[0]+half*(a*east[0]+b*north[0]);vertices[at+1]=pos[1]-this.center[1]+half*(a*east[1]+b*north[1]);vertices[at+2]=category(points[i*stride+2]);}
                }
                const part = { vertices, count:count*6 };
                if (this.gl) { part.buffer = this.gl.createBuffer(); this.gl.bindBuffer(this.gl.ARRAY_BUFFER, part.buffer); this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW); }
                this.parts.push(part); this.schedule();
            },
            schedule() { if (this.frame === null) this.frame = requestAnimationFrame(() => { this.frame = null; this.draw(); }); },
            draw() {
                if (!this.map) return;
                const viewport = this.map.getSize();
                const ratio = Math.min(root.devicePixelRatio || 1, 2);
                const w = Math.round(viewport.x * ratio), h = Math.round(viewport.y * ratio);
                if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
                this.canvas.style.width = `${viewport.x}px`; this.canvas.style.height = `${viewport.y}px`;
                L.DomUtil.setPosition(this.canvas, this.map.containerPointToLayerPoint([0,0]));
                const pos = this.map.latLngToContainerPoint([this.origin[1], this.origin[0]]);
                const scale = 256 * Math.pow(2, this.map.getZoom()) / (2 * Math.PI * R);
                const size = Math.max(1.5, Math.min(12, 5 * scale * 1.05));
                const ctx=this.ctx;ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,viewport.x,viewport.y);
                if(this.map.getZoom()<16) return;
                ctx.save();root.HarvestPyramid.clip(ctx,this.map,features);
                if (this.gl) {
                    if(this.gpuCanvas.width!==w||this.gpuCanvas.height!==h){this.gpuCanvas.width=w;this.gpuCanvas.height=h;}
                    const gl = this.gl; gl.viewport(0,0,w,h); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT); gl.useProgram(this.program);
                    gl.uniform2f(this.locations.viewport, w, h); gl.uniform2f(this.locations.offset, pos.x * ratio, pos.y * ratio);
                    gl.uniform1f(this.locations.scale, scale * ratio); gl.uniform1f(this.locations.size, size * ratio);
                    gl.enableVertexAttribArray(this.locations.p);
                    for (const part of this.parts) { gl.bindBuffer(gl.ARRAY_BUFFER, part.buffer); gl.vertexAttribPointer(this.locations.p,3,gl.FLOAT,false,0,0); gl.drawArrays(gl.TRIANGLES,0,part.count); }
                    ctx.drawImage(this.gpuCanvas,0,0,viewport.x,viewport.y);
                } else {
                    for (const part of this.parts) for (let i=0; i<part.count; i+=6) {
                        const x=pos.x+part.vertices[i*3]*scale, y=pos.y-part.vertices[i*3+1]*scale;
                        if(x< -size||y< -size||x>viewport.x+size||y>viewport.y+size) continue;
                        ctx.fillStyle=colors[part.vertices[i*3+2]];ctx.beginPath();for(const j of [0,1,2,5]){const px=pos.x+part.vertices[(i+j)*3]*scale,py=pos.y-part.vertices[(i+j)*3+1]*scale;if(j===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);}ctx.closePath();ctx.fill();
                    }
                }
                ctx.restore();
            },
            onRemove(map) {
                map.off('move zoom resize', this.schedule, this);
                if (this.frame !== null) cancelAnimationFrame(this.frame);
                if (this.gl) { for (const part of this.parts) this.gl.deleteBuffer(part.buffer); this.gl.deleteProgram(this.program); }
                this.parts = []; this.canvas.remove(); this.map = null;
            }
        });
        return new Layer();
    }
    root.HarvestPoints = Object.freeze({ create });
})(window);
