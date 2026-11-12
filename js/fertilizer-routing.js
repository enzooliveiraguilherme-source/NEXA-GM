(function (root) {
    'use strict';
    const profile = Object.freeze({ version: 'machine-road-v2', factors: Object.freeze({ road: 1, border: 2, approach: 3, shortcut: 4, access: 4, snap: 1 }) });
    const factor = kind => profile.factors[kind] ?? profile.factors.access;
    const better = (score, meters, oldScore, oldMeters) => score < oldScore || (score === oldScore && meters < oldMeters);
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
        const roadGrid = new Map();
        for (const road of roads) {
            const box = bounds(road);
            for (let x = Math.floor((box[0] - 2) / 80); x <= Math.floor((box[2] + 2) / 80); x++) {
                for (let y = Math.floor((box[1] - 2) / 80); y <= Math.floor((box[3] + 2) / 80); y++) {
                    const key = `${x},${y}`;
                    if (!roadGrid.has(key)) roadGrid.set(key, []);
                    roadGrid.get(key).push(road);
                }
            }
        }
        const isRoad = p => (roadGrid.get(`${Math.floor(p[0] / 80)},${Math.floor(p[1] / 80)}`) || [])
            .some(([a, b]) => norm(p, projectPoint(p, a, b)) <= 2);
        const roadNodes = nodes.map(isRoad);
        const holePolygons = polygons.flatMap(p => p.rings.slice(1).map(ring => indexPolygon([ring])));
        function crossesHole(a, b) {
            // Road data is authoritative on its own centerline. A newly inferred
            // approach, however, must never cut through an excluded field island.
            const box = bounds([a, b]), d = sub(b, a), ts = [0, 1];
            for (const poly of holePolygons.filter(p => overlaps(box, p.box))) {
                const ring = poly.rings[0];
                if (inRing(a, ring) === 1 || inRing(b, ring) === 1) return true;
                for (let i = 1; i < ring.length; i++) {
                    const c = ring[i - 1], e = sub(ring[i], c), denominator = cross(d, e);
                    if (Math.abs(denominator) < 1e-10) continue;
                    const t = cross(sub(c, a), e) / denominator, u = cross(sub(c, a), d) / denominator;
                    if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
                }
                ts.sort((x, y) => x - y);
                for (let i = 1; i < ts.length; i++) if (inRing(mix(a, b, (ts[i - 1] + ts[i]) / 2), ring) === 1) return true;
            }
            return false;
        }
        function accessCovered(a, b, available, toRoad = false) {
            if (covered(a, b, available)) return true;
            if (!toRoad || !available.length || crossesHole(a, b)) return false;
            // Centerlines and crop polygons have different survey offsets. Permit
            // only the final <=40 m from a field edge to an explicitly mapped road.
            const length = norm(a, b), inset = mix(a, b, Math.max(0, 1 - 40 / Math.max(length, 0.001)));
            return covered(a, inset, available);
        }
        for (const [a, b] of edges) {
            const road = roadNodes[a] && roadNodes[b] && isRoad(mix(nodes[a], nodes[b], 0.5));
            for (const e of adjacency[a]) if (e.to === b) e.kind = road ? 'road' : 'border';
            for (const e of adjacency[b]) if (e.to === a) e.kind = road ? 'road' : 'border';
        }
        const segmentKinds = new Map(edges.map(([a, b]) => [`${a},${b}`, roadNodes[a] && roadNodes[b] && isRoad(mix(nodes[a], nodes[b], 0.5)) ? 'road' : 'border']));
        // Query nearby edges instead of sorting the whole gleba for every cell.
        const edgeGrid = new Map(), roadEdgeGrid = new Map(), edgeBoxes = edges.map(([a, b]) => bounds([nodes[a], nodes[b]]));
        edges.forEach((item, index) => {
            const [a, b] = item, box = edgeBoxes[index];
            item.road = roadNodes[a] && roadNodes[b] && isRoad(mix(nodes[a], nodes[b], 0.5));
            for (let x = Math.floor(box[0] / 200); x <= Math.floor(box[2] / 200); x++) {
                for (let y = Math.floor(box[1] / 200); y <= Math.floor(box[3] / 200); y++) {
                    const key = `${x},${y}`;
                    if (!edgeGrid.has(key)) edgeGrid.set(key, []);
                    edgeGrid.get(key).push(index);
                    if (item.road) {
                        if (!roadEdgeGrid.has(key)) roadEdgeGrid.set(key, []);
                        roadEdgeGrid.get(key).push(index);
                    }
                }
            }
        });
        function nearby(p, radius, roadsOnly = false) {
            const index = roadsOnly ? roadEdgeGrid : edgeGrid, found = new Set();
            for (let x = Math.floor((p[0] - radius) / 200); x <= Math.floor((p[0] + radius) / 200); x++) {
                for (let y = Math.floor((p[1] - radius) / 200); y <= Math.floor((p[1] + radius) / 200); y++) {
                    for (const id of index.get(`${x},${y}`) || []) found.add(id);
                }
            }
            return [...found].map(id => {
                const [a, b] = edges[id], q = projectPoint(p, nodes[a], nodes[b]);
                return { a, b, q, meters: norm(p, q), road: edges[id].road };
            }).filter(c => c.meters <= radius).sort((a, b) => a.meters - b.meters || a.a - b.a || a.b - b.b);
        }
        const shortcut = Math.min(80, Math.max(0, Number(data.shortcut_m) || 0));
        if (shortcut) {
            const grid = new Map(), size = shortcut;
            for (let i = 0; i < nodes.length; i++) {
                const p = nodes[i], x = Math.floor(p[0] / size), y = Math.floor(p[1] / size);
                for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
                    for (const j of grid.get(`${x + dx},${y + dy}`) || []) {
                        const meters = norm(p, nodes[j]);
                        if (meters > shortcut || adjacency[i].some(e => e.to === j)) continue;
                        if (meters <= 2 && roadNodes[i] && roadNodes[j] && !crossesHole(p, nodes[j])) edge(i, j, 'road');
                        else if (covered(p, nodes[j], polygons)) edge(i, j, 'shortcut');
                        else if (meters <= 40 && ((roadNodes[i] && accessCovered(nodes[j], p, polygons, true)) ||
                            (roadNodes[j] && accessCovered(p, nodes[j], polygons, true)))) edge(i, j, 'approach');
                    }
                }
                const key = `${x},${y}`;
                if (!grid.has(key)) grid.set(key, []);
                grid.get(key).push(i);
            }
        }
        for (const outgoing of adjacency) for (const e of outgoing) e.cost = e.meters * factor(e.kind);
        function connectors(coordinate) {
            const p = project(coordinate), containing = polygons.filter(poly => inPolygon(p, poly.rings));
            const result = new Map(), segments = [];
            function put(id, q, kind, road) {
                const access = norm(p, q), along = norm(q, nodes[id]), meters = access + along, networkKind = road ? 'road' : 'border';
                const score = access * factor(kind) + along * factor(networkKind), previous = result.get(id);
                if (!previous || better(score, meters, previous.score, previous.meters)) result.set(id, { to: id, meters, score, via: q, kind, networkKind });
            }
            // First locate genuine road access; do not attach an interior point to
            // every visible edge of its field, which allowed kilometre-long cuts.
            const pinned = nearby(p, 2, true).filter(c => isRoad(c.q));
            let limit = 0;
            if (pinned.length) {
                // A mapped road remains usable even when a crop mask excludes it.
                // This is not permission to create a new cut through that exclusion.
                for (const c of pinned) { put(c.a, c.q, 'snap', true); put(c.b, c.q, 'snap', true); segments.push({ key: `${c.a},${c.b}`, q: c.q }); }
            } else {
                let nearestRoad = Infinity, nearestBorder = Infinity;
                // A valid straight field approach cannot end outside this box+40m.
                const reach = containing.length ? Math.max(...containing.flatMap(poly => [
                    norm(p, [poly.box[0], poly.box[1]]), norm(p, [poly.box[2], poly.box[3]]),
                    norm(p, [poly.box[0], poly.box[3]]), norm(p, [poly.box[2], poly.box[1]])])) + 40 : 2;
                for (let radius = Math.min(80, reach); ; radius = Math.min(reach, radius * 2)) {
                    if (!Number.isFinite(nearestRoad)) {
                        const c = nearby(p, radius, true).find(c => accessCovered(p, c.q, containing, true));
                        if (c) nearestRoad = c.meters;
                    }
                    if (Number.isFinite(nearestRoad) || radius >= reach) break;
                }
                if (!Number.isFinite(nearestRoad)) {
                    for (let radius = Math.min(80, reach); ; radius = Math.min(reach, radius * 2)) {
                        const c = nearby(p, radius).find(c => c.meters < 0.002 || covered(p, c.q, containing));
                        if (c) { nearestBorder = c.meters; break; }
                        if (radius >= reach) break;
                    }
                }
                const nearest = Number.isFinite(nearestRoad) ? nearestRoad : nearestBorder;
                limit = Number.isFinite(nearest) ? 2 * nearest + shortcut : 0;
                for (const c of nearby(p, limit)) {
                    if (c.meters < 0.002 || accessCovered(p, c.q, containing, c.road)) {
                        put(c.a, c.q, 'access', c.road); put(c.b, c.q, 'access', c.road); segments.push({ key: `${c.a},${c.b}`, q: c.q });
                    }
                }
            }
            return { p, containing, limit, onRoad: !!pinned.length, links: [...result.values()], segments: new Map(segments.map(s => [s.key, s.q])) };
        }
        const moundCache = new Map();
        function destination(mound) {
            const coordinate = [Number(mound.longitude), Number(mound.latitude)], key = coordinate.join(',');
            if (!moundCache.has(key)) moundCache.set(key, connectors(coordinate));
            return moundCache.get(key);
        }
        function localCandidate(start, end, bound = Infinity) {
            let best = null;
            const direct = norm(start.p, end.p), directKind = start.onRoad && end.onRoad ? 'shortcut' : 'access';
            const directScore = direct * factor(directKind);
            if (directScore <= bound && direct <= Math.max(shortcut, start.limit + end.limit) && (
                accessCovered(start.p, end.p, start.containing, end.onRoad) ||
                accessCovered(end.p, start.p, end.containing, start.onRoad))) {
                best = { type: 'direct', kind: directKind, score: directScore, meters: direct };
            }
            for (const [segment, b] of end.segments) {
                const a = start.segments.get(segment);
                if (!a) continue;
                const kind = segmentKinds.get(segment) || 'border';
                const accessA = norm(start.p, a), along = norm(a, b), accessB = norm(b, end.p);
                const score = accessA * factor(start.onRoad ? 'snap' : 'access') + along * factor(kind) + accessB * factor(end.onRoad ? 'snap' : 'access');
                const meters = accessA + along + accessB;
                if (score <= bound && (!best || better(score, meters, best.score, best.meters))) best = { type: 'segment', a, b, kind, score, meters };
            }
            return best;
        }
        function localLegs(start, end, choice) {
            if (choice.type === 'direct') return [{ a: start.p, b: end.p, kind: choice.kind }];
            return [
                { a: start.p, b: choice.a, kind: start.onRoad ? 'snap' : 'access' },
                { a: choice.a, b: choice.b, kind: choice.kind },
                { a: choice.b, b: end.p, kind: end.onRoad ? 'snap' : 'access' }
            ];
        }
        function connectionLegs(endpoint, link, reverse = false) {
            const legs = [
                { a: endpoint.p, b: link.via, kind: link.kind },
                { a: link.via, b: nodes[link.to], kind: link.networkKind }
            ];
            return reverse ? legs.reverse().map(leg => ({ a: leg.b, b: leg.a, kind: leg.kind })) : legs;
        }
        function finish(mound, legs, score) {
            const metrics = { roadMeters: 0, borderMeters: 0, fieldMeters: 0, approachMeters: 0 };
            let meters = 0, shortcutMeters = 0, accessMeters = 0;
            const points = [];
            for (const leg of legs) {
                const length = norm(leg.a, leg.b);
                meters += length;
                if (leg.kind === 'road' || leg.kind === 'snap') metrics.roadMeters += length;
                else if (leg.kind === 'border') metrics.borderMeters += length;
                else if (leg.kind === 'approach') metrics.approachMeters += length;
                else metrics.fieldMeters += length;
                if (leg.kind === 'shortcut') shortcutMeters += length;
                if (leg.kind === 'access' || leg.kind === 'snap') accessMeters += length;
                for (const p of [leg.a, leg.b]) if (!points.length || norm(p, points[points.length - 1]) > 0.001) points.push(p);
            }
            return { mound, score, meters, metrics, shortcutMeters, accessMeters, model: profile.version, coordinates: points.map(unproject) };
        }
        let costCache = null;
        function serviceCosts(samples, mounds, progress = () => {}) {
            if (!Array.isArray(samples) || samples.length > 30000) throw Error('Malha de atendimento inválida.');
            const permitted = mounds.filter(m => m.gleba === data.gleba).sort((a, b) => String(a.id).localeCompare(String(b.id)));
            const key = JSON.stringify(permitted.map(m => [m.id, m.longitude, m.latitude]));
            if (costCache?.key !== key) {
                const destinations = permitted.map((mound, index) => {
                    const end = destination(mound);
                    progress({ stage: 'mounds', done: index + 1, total: permitted.length });
                    return { mound, end };
                });
                const dist = new Float64Array(nodes.length).fill(Infinity), lengths = new Float64Array(nodes.length).fill(Infinity);
                const owners = new Int32Array(nodes.length).fill(-1), heap = new Heap();
                function relax(id, score, meters, owner) {
                    if (better(score, meters, dist[id], lengths[id]) || (score === dist[id] && meters === lengths[id] && owner < owners[id])) {
                        dist[id] = score; lengths[id] = meters; owners[id] = owner; heap.push([score, id, owner, meters]);
                    }
                }
                destinations.forEach(({ end }, owner) => {
                    for (const c of end.links) relax(c.to, c.score, c.meters, owner);
                });
                while (heap.items.length) {
                    const [cost, id, owner, meters] = heap.pop();
                    if (cost !== dist[id] || owner !== owners[id] || meters !== lengths[id]) continue;
                    for (const e of adjacency[id]) relax(e.to, cost + e.cost, meters + e.meters, owner);
                }
                costCache = { key, destinations, dist, lengths, owners };
            }
            return samples.map((sample, index) => {
                const start = connectors(sample.point);
                let bestScore = Infinity, bestMeters = Infinity, bestOwner = -1;
                function choose(score, meters, owner) {
                    if (owner < 0 || !Number.isFinite(score)) return;
                    if (better(score, meters, bestScore, bestMeters) || (score === bestScore && meters === bestMeters && owner < bestOwner)) {
                        bestScore = score; bestMeters = meters; bestOwner = owner;
                    }
                }
                for (const c of start.links) choose(c.score + costCache.dist[c.to], c.meters + costCache.lengths[c.to], costCache.owners[c.to]);
                costCache.destinations.forEach(({ end }, owner) => {
                    const local = localCandidate(start, end, bestScore);
                    if (local) choose(local.score, local.meters, owner);
                });
                if (index % 50 === 0 || index + 1 === samples.length) progress({ stage: 'cells', done: index + 1, total: samples.length });
                return { ...sample, mound_id: bestOwner < 0 ? null : costCache.destinations[bestOwner].mound.id,
                    score: Number.isFinite(bestScore) ? bestScore : null, meters: Number.isFinite(bestMeters) ? bestMeters : null };
            });
        }
        // One supplier for the complete, connected pass strip. Keep the road
        // preference unchanged; average its cost by sampled area, not by votes.
        let stripCache = null;
        function serviceStripCosts(samples, mounds, progress = () => {}) {
            if (!Array.isArray(samples) || samples.length > 30000 || samples.some(s =>
                typeof s.strip_id !== 'string' || !s.strip_id || !Number.isFinite(s.area_ha) || s.area_ha <= 0 ||
                !Array.isArray(s.point) || s.point.length !== 2 || s.point.some(v => !Number.isFinite(v)))) throw Error('Amostras das faixas inválidas.');
            const permitted = mounds.filter(m => m.gleba === data.gleba).sort((a, b) => String(a.id).localeCompare(String(b.id)));
            const key = JSON.stringify(permitted.map(m => [m.id, m.longitude, m.latitude]));
            if (stripCache?.key !== key) {
                const sites = new Set();
                const destinations = permitted.filter(m => {
                    const site = JSON.stringify([m.longitude, m.latitude]);
                    if (sites.has(site)) return false;
                    sites.add(site); return true;
                }).map((mound, index) => {
                    const end = destination(mound), dist = new Float64Array(nodes.length).fill(Infinity);
                    const lengths = new Float64Array(nodes.length).fill(Infinity), heap = new Heap();
                    function relax(id, score, meters) {
                        if (better(score, meters, dist[id], lengths[id])) {
                            dist[id] = score; lengths[id] = meters; heap.push([score, id, meters]);
                        }
                    }
                    for (const c of end.links) relax(c.to, c.score, c.meters);
                    while (heap.items.length) {
                        const [score, id, meters] = heap.pop();
                        if (score !== dist[id] || meters !== lengths[id]) continue;
                        for (const e of adjacency[id]) relax(e.to, score + e.cost, meters + e.meters);
                    }
                    progress({ stage: 'mounds', done: index + 1, total: sites.size });
                    return { mound, end, dist, lengths };
                });
                stripCache = { key, destinations };
            }
            const groups = new Map();
            for (const [index, sample] of samples.entries()) {
                const groupKey = JSON.stringify([sample.farm_code, sample.campo, sample.strip_id]);
                if (!groups.has(groupKey)) groups.set(groupKey, { farm_code: sample.farm_code, campo: sample.campo,
                    strip_id: sample.strip_id, area_ha: 0, samples: 0,
                    candidates: stripCache.destinations.map(() => ({ score: 0, meters: 0, reachable: true })) });
                const group = groups.get(groupKey), start = connectors(sample.point);
                group.area_ha += sample.area_ha; group.samples++;
                stripCache.destinations.forEach(({ end, dist, lengths }, owner) => {
                    const candidate = group.candidates[owner];
                    if (!candidate.reachable) return;
                    let score = Infinity, meters = Infinity;
                    for (const c of start.links) {
                        const cost = c.score + dist[c.to], length = c.meters + lengths[c.to];
                        if (better(cost, length, score, meters)) { score = cost; meters = length; }
                    }
                    const local = localCandidate(start, end, score);
                    if (local && better(local.score, local.meters, score, meters)) { score = local.score; meters = local.meters; }
                    if (!Number.isFinite(score)) candidate.reachable = false;
                    else { candidate.score += score * sample.area_ha; candidate.meters += meters * sample.area_ha; }
                });
                if (index % 50 === 0 || index + 1 === samples.length) progress({ stage: 'cells', done: index + 1, total: samples.length });
            }
            return [...groups.values()].map(group => {
                let winner = -1;
                group.candidates.forEach((candidate, index) => {
                    if (candidate.reachable && (winner < 0 || better(candidate.score, candidate.meters,
                        group.candidates[winner].score, group.candidates[winner].meters))) winner = index;
                });
                const { candidates, ...result } = group;
                return { ...result, mound_id: winner < 0 ? null : stripCache.destinations[winner].mound.id,
                    score: winner < 0 ? null : candidates[winner].score / group.area_ha,
                    meters: winner < 0 ? null : candidates[winner].meters / group.area_ha };
            });
        }
        function rank(origin, mounds) {
            const start = connectors(origin), dist = new Float64Array(nodes.length).fill(Infinity);
            const lengths = new Float64Array(nodes.length).fill(Infinity), previous = [], starts = [], heap = new Heap();
            for (const c of start.links) if (better(c.score, c.meters, dist[c.to], lengths[c.to])) {
                dist[c.to] = c.score; lengths[c.to] = c.meters; starts[c.to] = c; heap.push([c.score, c.to, c.meters]);
            }
            while (heap.items.length) {
                const [cost, id, meters] = heap.pop();
                if (cost !== dist[id] || meters !== lengths[id]) continue;
                for (const e of adjacency[id]) {
                    const score = cost + e.cost, length = meters + e.meters;
                    if (better(score, length, dist[e.to], lengths[e.to])) {
                        dist[e.to] = score; lengths[e.to] = length;
                        previous[e.to] = { from: id, ...e }; starts[e.to] = starts[id]; heap.push([score, e.to, length]);
                    }
                }
            }
            const routes = [];
            for (const mound of mounds) {
                if (mound.gleba !== data.gleba) continue;
                const end = destination(mound);
                let best = null;
                for (const c of end.links) {
                    if (!Number.isFinite(dist[c.to])) continue;
                    const score = dist[c.to] + c.score, meters = lengths[c.to] + c.meters;
                    if (!best || better(score, meters, best.score, best.meters)) best = { end: c, score, meters };
                }
                const local = localCandidate(start, end, best?.score ?? Infinity);
                if (local && (!best || better(local.score, local.meters, best.score, best.meters))) {
                    routes.push(finish(mound, localLegs(start, end, local), local.score)); continue;
                }
                if (!best) continue;
                const path = []; let id = best.end.to;
                while (previous[id]) {
                    const e = previous[id];
                    path.push({ a: nodes[e.from], b: nodes[id], kind: e.kind }); id = e.from;
                }
                path.reverse();
                const legs = [...connectionLegs(start, starts[best.end.to]), ...path, ...connectionLegs(end, best.end, true)];
                routes.push(finish(mound, legs, best.score));
            }
            routes.sort((a, b) => a.score - b.score || a.meters - b.meters || String(a.mound.id).localeCompare(String(b.mound.id)));
            return { routes, unreachable: mounds.filter(m => m.gleba === data.gleba && !routes.some(r => r.mound.id === m.id)).length, model: profile.version };
        }
        return { rank, serviceCosts, serviceStripCosts, nodeCount: nodes.length, shortcutMeters: shortcut, profile };
    }
    const pending = new Map();
    const workers = new Set();
    let cacheGeneration = 0;
    function backgroundGraph(data) {
        if (!root.Worker) return build(data);
        const worker = new root.Worker('js/fertilizer-routing-worker.js?v=ab-strips-v1-20261112');
        workers.add(worker);
        let sequence = 0, failed = null;
        const requests = new Map();
        worker.onmessage = event => {
            const request = requests.get(event.data.id);
            if (!request) return;
            if (event.data.progress) { request.progress?.(event.data.progress); return; }
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
        function call(operation, args, progress) {
            if (failed) return Promise.reject(failed);
            const id = ++sequence;
            return new Promise((resolve, reject) => { requests.set(id, { resolve, reject, progress }); worker.postMessage({ id, operation, ...args }); });
        }
        return { profile, rank: (origin, mounds) => call('rank', { origin, mounds }),
            serviceCosts: (samples, mounds, progress) => call('costs', { samples, mounds }, progress),
            serviceStripCosts: (samples, mounds, progress) => call('strips', { samples, mounds }, progress) };
    }
    async function load(client, year, gleba, scope) {
        const key = JSON.stringify([year, gleba, scope]);
        if (!pending.has(key)) {
            const token = cacheGeneration;
            const task = (async () => {
                const { data, error } = await client.rpc('fertilizer_routing', { map_year: String(year), routing_gleba: gleba });
                if (error) throw error;
                if (token !== cacheGeneration) throw Error('Consulta de caminhos cancelada.');
                if (data?.gleba !== gleba || data?.year !== String(year)) throw Error('Contexto da rede de caminhos inválido.');
                return { data, graph: backgroundGraph(data) };
            })();
            pending.set(key, task); task.catch(() => { if (pending.get(key) === task) pending.delete(key); });
        }
        return pending.get(key);
    }
    root.FertilizerRouting = { build, load, profile, clearCache: () => { cacheGeneration++; pending.clear(); for (const worker of [...workers]) worker.dispose(); } };
})(typeof window !== 'undefined' ? window : globalThis);
