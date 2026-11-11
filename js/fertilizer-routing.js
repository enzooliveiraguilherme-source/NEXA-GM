(function (root) {
    'use strict';
    const R = 6371008.8, rad = Math.PI / 180;
    const norm = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
    const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    function projectPoint(p, a, b) {
        const d = sub(b, a), l = d[0] ** 2 + d[1] ** 2;
        return mix(a, b, l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / l)) : 0);
    }
    function onSegment(p, a, b) { return norm(p, projectPoint(p, a, b)) < 0.005; }
    function inRing(p, ring) {
        if (ring.box && (p[0] < ring.box[0] - 0.005 || p[1] < ring.box[1] - 0.005 || p[0] > ring.box[2] + 0.005 || p[1] > ring.box[3] + 0.005)) return 0;
        let inside = false;
        const edges = ring.stripes ? ring.stripes.get(Math.floor(p[1] / 80)) || [] : ring.slice(1).map((b, i) => [ring[i], b]);
        for (const [a, b] of edges) {
            if (onSegment(p, a, b)) return 2;
            if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
        }
        return inside ? 1 : 0;
    }
    function inPolygon(p, polygon) {
        if (!inRing(p, polygon[0])) return false;
        return !polygon.slice(1).some(ring => inRing(p, ring) === 1);
    }
    const bounds = pts => [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
    const overlaps = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
    function indexPolygon(rings) {
        const grid = new Map();
        for (const ring of rings) {
            ring.box = bounds(ring); ring.stripes = new Map();
            for (let i = 1; i < ring.length; i++) {
                const edge = [ring[i - 1], ring[i]], box = bounds(edge);
                // Include the adjoining cell for points within the rounding tolerance.
                const x0 = Math.floor((box[0] - 0.005) / 80), x1 = Math.floor((box[2] + 0.005) / 80);
                const y0 = Math.floor((box[1] - 0.005) / 80), y1 = Math.floor((box[3] + 0.005) / 80);
                for (let y = y0; y <= y1; y++) {
                    if (!ring.stripes.has(y)) ring.stripes.set(y, []);
                    ring.stripes.get(y).push(edge);
                    for (let x = x0; x <= x1; x++) {
                        const key = `${x},${y}`;
                        if (!grid.has(key)) grid.set(key, []);
                        grid.get(key).push(edge);
                    }
                }
            }
        }
        return { rings, box: rings[0].box, grid };
    }
    function covered(a, b, polygons) {
        // Test every interval delimited by a boundary crossing, including tiny holes.
        const box = bounds([a, b]), candidates = polygons.filter(p => overlaps(box, p.box));
        if (!candidates.length) return false;
        const within = p => candidates.some(poly => inPolygon(p, poly.rings));
        if (!within(a) || !within(b)) return false;
        const ts = [0, 1], d = sub(b, a);
        for (const p of candidates) {
            const edges = new Set();
            for (let x = Math.floor(box[0] / 80); x <= Math.floor(box[2] / 80); x++) {
                for (let y = Math.floor(box[1] / 80); y <= Math.floor(box[3] / 80); y++) for (const e of p.grid.get(`${x},${y}`) || []) edges.add(e);
            }
            for (const [c, end] of edges) {
                const e = sub(end, c), denominator = cross(d, e);
                if (Math.abs(denominator) < 1e-10) continue;
                const t = cross(sub(c, a), e) / denominator, u = cross(sub(c, a), d) / denominator;
                if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
            }
        }
        ts.sort((x, y) => x - y);
        for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] > 1e-10 && !within(mix(a, b, (ts[i] + ts[i - 1]) / 2))) return false;
        return true;
    }
    function lines(geometry) {
        if (geometry?.type === 'LineString') return [geometry.coordinates];
        if (geometry?.type === 'MultiLineString') return geometry.coordinates;
        return [];
    }
    class Heap {
        constructor() { this.items = []; }
        push(item) {
            const a = this.items; a.push(item); let i = a.length - 1;
            while (i) { const p = (i - 1) >> 1; if (a[p][0] <= item[0]) break; a[i] = a[p]; i = p; } a[i] = item;
        }
        pop() {
            const a = this.items, first = a[0], last = a.pop();
            if (a.length) {
                let i = 0;
                while (i * 2 + 1 < a.length) {
                    let child = i * 2 + 1;
                    if (child + 1 < a.length && a[child + 1][0] < a[child][0]) child++;
                    if (last[0] <= a[child][0]) break;
                    a[i] = a[child]; i = child;
                } a[i] = last;
            } return first;
        }
    }
    function build(data) {
        if (!data?.network?.features || !data?.fields?.features || !data?.roads?.features) throw Error('Rede de caminhos incompleta.');
        const first = data.network.features.flatMap(f => lines(f.geometry))[0]?.[0] || [0, 0];
        const scale = Math.cos(first[1] * rad);
        const project = p => [(p[0] - first[0]) * rad * R * scale, (p[1] - first[1]) * rad * R];
        const unproject = p => [p[0] / (rad * R * scale) + first[0], p[1] / (rad * R) + first[1]];
        const polygons = data.fields.features.flatMap(f => {
            const g = f.geometry;
            return (g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : []).map(rings => {
                const projected = rings.map(r => r.map(project));
                return indexPolygon(projected);
            });
        });
        const nodes = [], edges = [], ids = new Map(), adjacency = [];
        function node(p) {
            const key = p.map(v => Math.round(v * 1000)).join(',');
            if (!ids.has(key)) { ids.set(key, nodes.length); nodes.push(p); adjacency.push([]); }
            return ids.get(key);
        }
        function edge(a, b, kind) {
            const meters = norm(nodes[a], nodes[b]);
            if (a === b || meters < 0.001) return;
            adjacency[a].push({ to: b, meters, kind }); adjacency[b].push({ to: a, meters, kind });
        }
        for (const feature of data.network.features) for (const line of lines(feature.geometry)) {
            for (let i = 1; i < line.length; i++) {
                const a = node(project(line[i - 1])), b = node(project(line[i]));
                edge(a, b, 'network'); edges.push([a, b]);
            }
        }
        const roads = data.roads.features.flatMap(f => lines(f.geometry)).flatMap(line => line.slice(1).map((p, i) => [project(line[i]), project(p)]));
        const shortcut = Math.min(80, Math.max(0, Number(data.shortcut_m) || 0));
        if (shortcut) {
            const grid = new Map(), size = shortcut;
            for (let i = 0; i < nodes.length; i++) {
                const p = nodes[i], x = Math.floor(p[0] / size), y = Math.floor(p[1] / size);
                for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
                    for (const j of grid.get(`${x + dx},${y + dy}`) || []) {
                        if (norm(p, nodes[j]) <= shortcut && !adjacency[i].some(e => e.to === j) && covered(p, nodes[j], polygons)) edge(i, j, 'shortcut');
                    }
                }
                const key = `${x},${y}`;
                if (!grid.has(key)) grid.set(key, []);
                grid.get(key).push(i);
            }
        }
        function connectors(coordinate) {
            const p = project(coordinate), containing = polygons.filter(poly => inPolygon(p, poly.rings));
            const result = new Map(), segments = [];
            function put(id, q, kind) {
                const meters = norm(p, q) + norm(q, nodes[id]);
                if (!result.has(id) || result.get(id).meters > meters) result.set(id, { to: id, meters, via: q, kind });
            }
            // Inside the application field, access to its border is necessary and is
            // reported separately from short cuts between network nodes.
            if (containing.length) {
                for (const [a, b] of edges) {
                    const q = projectPoint(p, nodes[a], nodes[b]);
                    if (covered(p, q, containing)) { put(a, q, 'access'); put(b, q, 'access'); segments.push({ key: `${a},${b}`, q }); }
                }
            }
            // Up to 2 m only for cartographic rounding at an explicitly mapped road.
            // Never snap across a hole or invent an unmapped access across open land.
            for (const [a, b] of edges) {
                const q = projectPoint(p, nodes[a], nodes[b]);
                if (norm(p, q) < 0.002 || (!containing.length && norm(p, q) <= 2 && roads.some(([c, d]) => norm(q, projectPoint(q, c, d)) < 0.01))) {
                    if (!polygons.some(poly => poly.rings.slice(1).some(r => inRing(p, r) === 1))) { put(a, q, 'snap'); put(b, q, 'snap'); segments.push({ key: `${a},${b}`, q }); }
                }
            }
            return { p, containing, links: [...result.values()], segments: new Map(segments.map(s => [s.key, s.q])) };
        }
        const moundCache = new Map();
        function rank(origin, mounds) {
            const start = connectors(origin), dist = Array(nodes.length).fill(Infinity), previous = [], starts = [], heap = new Heap();
            for (const c of start.links) if (c.meters < dist[c.to]) { dist[c.to] = c.meters; starts[c.to] = c; heap.push([c.meters, c.to]); }
            while (heap.items.length) {
                const [cost, id] = heap.pop();
                if (cost !== dist[id]) continue;
                for (const e of adjacency[id]) if (cost + e.meters < dist[e.to]) {
                    dist[e.to] = cost + e.meters; previous[e.to] = { from: id, ...e }; starts[e.to] = starts[id]; heap.push([dist[e.to], e.to]);
                }
            }
            const routes = [];
            for (const mound of mounds) {
                if (mound.gleba !== data.gleba) continue;
                const destination = [Number(mound.longitude), Number(mound.latitude)], key = destination.join(',');
                if (!moundCache.has(key)) moundCache.set(key, connectors(destination));
                const end = moundCache.get(key);
                let best = null;
                for (const c of end.links) if (Number.isFinite(dist[c.to]) && (!best || dist[c.to] + c.meters < best.meters)) best = { end: c, meters: dist[c.to] + c.meters };
                let direct = norm(start.p, end.p);
                // A mound in the application field can be reached directly within that
                // field. For all other fields only bounded network shortcuts are allowed.
                const directAllowed = start.containing.length && covered(start.p, end.p, start.containing);
                if (directAllowed && (!best || direct < best.meters)) {
                    routes.push({ mound, meters: direct, shortcutMeters: 0, accessMeters: direct, coordinates: [origin, destination] }); continue;
                }
                let sameSegment = null;
                for (const [key, a] of start.segments) {
                    const b = end.segments.get(key);
                    if (!b) continue;
                    const accessMeters = norm(start.p, a) + norm(end.p, b), meters = accessMeters + norm(a, b);
                    if (!sameSegment || meters < sameSegment.meters) {
                        const points = [start.p, a, b, end.p];
                        sameSegment = { meters, accessMeters, shortcutMeters: 0, coordinates: points.filter((p, i) => !i || norm(p, points[i - 1]) > 0.001).map(unproject) };
                    }
                }
                if (sameSegment && (!best || sameSegment.meters < best.meters)) { routes.push({ mound, ...sameSegment }); continue; }
                if (!best) continue;
                const reversed = [best.end.to]; let id = best.end.to, shortcutMeters = 0;
                while (previous[id]) { const e = previous[id]; if (e.kind === 'shortcut') shortcutMeters += e.meters; id = e.from; reversed.push(id); }
                reversed.reverse();
                const initial = starts[best.end.to];
                const path = [start.p, initial.via, ...reversed.map(i => nodes[i]), best.end.via, end.p];
                routes.push({ mound, meters: best.meters, shortcutMeters, accessMeters: norm(start.p, initial.via) + norm(end.p, best.end.via), coordinates: path.filter((p, i) => !i || norm(p, path[i - 1]) > 0.001).map(unproject) });
            }
            routes.sort((a, b) => a.meters - b.meters || String(a.mound.id).localeCompare(String(b.mound.id)));
            return { routes, unreachable: mounds.filter(m => m.gleba === data.gleba && !routes.some(r => r.mound.id === m.id)).length };
        }
        return { rank, nodeCount: nodes.length, shortcutMeters: shortcut };
    }
    const pending = new Map();
    const workers = new Set();
    function backgroundGraph(data) {
        if (!root.Worker) return build(data);
        const worker = new root.Worker('js/fertilizer-routing-worker.js?v=roads-20261111');
        workers.add(worker);
        let sequence = 0, failed = null;
        const requests = new Map();
        worker.onmessage = event => {
            const request = requests.get(event.data.id);
            if (!request) return;
            requests.delete(event.data.id);
            if (event.data.error) request.reject(Error(event.data.error)); else request.resolve(event.data.result);
        };
        function fail(error) {
            failed = error;
            for (const request of requests.values()) request.reject(error);
            requests.clear();
        }
        worker.onerror = () => { fail(Error('Falha ao processar a rede de caminhos.')); worker.terminate(); workers.delete(worker); };
        worker.dispose = () => { fail(Error('Consulta de caminhos cancelada.')); worker.terminate(); workers.delete(worker); };
        worker.postMessage({ data });
        return { rank(origin, mounds) {
            if (failed) return Promise.reject(failed);
            const id = ++sequence;
            return new Promise((resolve, reject) => { requests.set(id, { resolve, reject }); worker.postMessage({ id, origin, mounds }); });
        } };
    }
    async function load(client, year, gleba, scope) {
        const key = JSON.stringify([year, gleba, scope]);
        if (!pending.has(key)) {
            const task = (async () => {
                const { data, error } = await client.rpc('fertilizer_routing', { map_year: String(year), routing_gleba: gleba });
                if (error) throw error;
                if (data?.gleba !== gleba || data?.year !== String(year)) throw Error('Contexto da rede de caminhos inválido.');
                return { data, graph: backgroundGraph(data) };
            })();
            pending.set(key, task); task.catch(() => { if (pending.get(key) === task) pending.delete(key); });
        }
        return pending.get(key);
    }
    root.FertilizerRouting = { build, load, clearCache: () => { pending.clear(); for (const worker of [...workers]) worker.dispose(); } };
})(typeof window !== 'undefined' ? window : globalThis);
