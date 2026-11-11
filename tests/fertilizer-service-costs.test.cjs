const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');

const source = fs.readFileSync(require.resolve('../js/fertilizer-routing.js'), 'utf8');
function feature(geometry, properties = {}) { return { type: 'Feature', properties, geometry }; }
function line(...coordinates) { return feature({ type: 'LineString', coordinates }); }
function polygon(rings, farm_code = 'FE') { return feature({ type: 'Polygon', coordinates: rings }, { farm_code }); }
function collection(...features) { return { type: 'FeatureCollection', features }; }
function build({ fields = [], roads = [], network = [], gleba = 'FE', shortcut_m = 80 } = {}) {
    const window = {};
    vm.runInNewContext(source, vm.createContext({ window, Math, Map, Set, Number, String, JSON, Error, Float64Array }));
    return window.FertilizerRouting.build({ year: '2026', gleba, shortcut_m,
        fields: collection(...fields), roads: collection(...roads), network: collection(...network) });
}
function buildData(data) {
    const window = {};
    vm.runInNewContext(source, vm.createContext({ window, Math, Map, Set, Number, String, JSON, Error, Float64Array }));
    return window.FertilizerRouting.build(data);
}
const mound = (id, gleba, longitude, latitude = 0.0005) => ({ id, gleba, longitude, latitude });
function assertMatchesRank(graph, samples, mounds) {
    const batch = graph.serviceCosts(samples, mounds);
    assert.equal(batch.length, samples.length);
    for (let i = 0; i < samples.length; i++) {
        const ranked = graph.rank(samples[i].point, mounds);
        const winner = ranked.routes[0];
        assert.equal(batch[i].mound_id, winner?.mound.id ?? null, `sample ${i}`);
        if (winner) assert.ok(Math.abs(batch[i].meters - winner.meters) < 0.02, `sample ${i}: ${batch[i].meters} vs ${winner.meters}`);
        else assert.equal(batch[i].meters, null, `sample ${i}`);
        for (const key of ['farm_code', 'i', 'j', 'point']) assert.deepEqual(batch[i][key], samples[i][key]);
    }
    return batch;
}

test('serviceCosts matches rank for field access and local shortcut samples', () => {
    const field = polygon([[[0, 0], [0.002, 0], [0.002, 0.001], [0, 0.001], [0, 0]]]);
    const road = line([-0.0001, 0.0005], [0.0002, 0.0005], [0.0008, 0.0005]);
    const g = build({ fields: [field], roads: [road], network: [road] });
    const mounds = [mound('near', 'FE', 0.0007), mound('far', 'FE', 0.0018), mound('other-farm', 'PA', 0.0003)];
    const samples = [
        { farm_code: 'FE', i: 4, j: 8, point: [0.00025, 0.00055] },
        { farm_code: 'FE', i: 5, j: 8, point: [0.00045, 0.00055] },
        { farm_code: 'FE', i: 6, j: 8, point: [0.0011, 0.0005] }
    ];
    assertMatchesRank(g, samples, mounds);
});

test('serviceCosts matches rank across a field mask hole and on both sides', () => {
    const field = polygon([
        [[0, 0], [0.002, 0], [0.002, 0.001], [0, 0.001], [0, 0]],
        [[0.0008, 0.00035], [0.0012, 0.00035], [0.0012, 0.00065], [0.0008, 0.00065], [0.0008, 0.00035]]
    ]);
    const road = line([0.0001, 0.0002], [0.0019, 0.0002]);
    const g = build({ fields: [field], roads: [road], network: [road] });
    const samples = [
        { farm_code: 'FE', i: 8, j: 3, point: [0.0006, 0.0005] },
        { farm_code: 'FE', i: 12, j: 3, point: [0.0014, 0.0005] }
    ];
    assertMatchesRank(g, samples, [mound('west', 'FE', 0.0003), mound('east', 'FE', 0.0017)]);
});

test('serviceCosts shares the winner for samples on the same network edge and keeps ID tie break', () => {
    const road = line([0, 0], [0.002, 0]);
    const g = build({ roads: [road], network: [road] });
    const samples = [
        { farm_code: 'FE', i: 1, j: 1, point: [0.0005, 0] },
        { farm_code: 'FE', i: 2, j: 1, point: [0.0007, 0] }
    ];
    const mounds = [mound('z-id', 'FE', 0.0015, 0), mound('a-id', 'FE', 0.0015, 0)];
    const results = assertMatchesRank(g, samples, mounds);
    assert.deepEqual(results.map(result => result.mound_id), ['a-id', 'a-id']);
});

test('serviceCosts leaves samples without a connected route unassigned', () => {
    const roadA = line([0, 0], [0.0002, 0]);
    const roadB = line([0.002, 0], [0.0022, 0]);
    const g = build({ roads: [roadA, roadB], network: [roadA, roadB] });
    const sample = { farm_code: 'FE', i: 0, j: 0, point: [0, 0] };
    const result = assertMatchesRank(g, [sample], [mound('isolated', 'FE', 0.0022, 0)]);
    assert.equal(result[0].mound_id, null);
    assert.equal(result[0].meters, null);
});

function pointInRings(point, rings) {
    const insideRing = ring => {
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [xi, yi] = ring[i], [xj, yj] = ring[j];
            if ((yi > point[1]) !== (yj > point[1]) && point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
    };
    return insideRing(rings[0]) && !rings.slice(1).some(insideRing);
}

test('FE0203 image point follows machine-road-v2 and 200 FE cell centers can be batch-costed', () => {
    const fixture = JSON.parse(fs.readFileSync(require.resolve('../tmp/routing/real-network.json'), 'utf8'));
    const buildStart = performance.now();
    const g = buildData(fixture.data);
    const buildMs = Math.round(performance.now() - buildStart);
    const feMounds = fixture.mounds.filter(item => item.gleba === 'FE');
    const imagePoint = { farm_code: 'FE', i: -1, j: -1, point: [-52.241091, -10.361679] };
    const imageResult = assertMatchesRank(g, [imagePoint], feMounds)[0];
    assert.equal(imageResult.mound_id, '76240015-97bb-4a58-935e-4b7a54b94e15');
    assert.ok(imageResult.meters > 680 && imageResult.meters < 690, `${imageResult.meters} m`);

    let seed = 314159;
    const random = () => ((seed = (seed * 48271) % 2147483647) - 1) / 2147483646;
    const eligible = fixture.data.fields.features.filter(f => f.properties?.farm_code === 'FE' && !/^FE2\b/.test(f.properties?.campo || ''));
    const samples = [];
    for (let tries = 0; samples.length < 200 && tries < 100000; tries++) {
        const field = eligible[Math.floor(random() * eligible.length)];
        const rings = field.geometry.type === 'Polygon' ? field.geometry.coordinates : field.geometry.coordinates[0];
        const xs = rings[0].map(p => p[0]), ys = rings[0].map(p => p[1]);
        const point = [Math.min(...xs) + random() * (Math.max(...xs) - Math.min(...xs)), Math.min(...ys) + random() * (Math.max(...ys) - Math.min(...ys))];
        if (pointInRings(point, rings)) samples.push({ farm_code: 'FE', i: samples.length % 20, j: Math.floor(samples.length / 20), point });
    }
    assert.equal(samples.length, 200, 'fixture must yield 200 FE centers');
    const start = performance.now();
    const batch = g.serviceCosts(samples, feMounds);
    const elapsedMs = Math.round(performance.now() - start);
    assert.equal(batch.length, 200);
    assert.ok(batch.some(result => result.mound_id), 'at least some FE samples should be reachable');
    for (const index of [0, 49, 99, 149, 199]) {
        const ranked = g.rank(samples[index].point, feMounds).routes[0];
        assert.equal(batch[index].mound_id, ranked?.mound.id ?? null, `sample ${index}`);
        if (ranked) assert.ok(Math.abs(batch[index].meters - ranked.meters) < 0.02, `sample ${index}`);
    }
    console.log(`real fixture: build ${buildMs} ms; FE0203 image point ${imageResult.meters.toFixed(1)} m; serviceCosts 200 FE samples ${elapsedMs} ms`);
});
