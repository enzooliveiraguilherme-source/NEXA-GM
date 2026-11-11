const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../js/fertilizer-routing.js'), 'utf8');

function feature(geometry, properties = {}) { return { type: 'Feature', properties, geometry }; }
function line(...coordinates) { return feature({ type: 'LineString', coordinates }); }
function polygon(coordinates) { return feature({ type: 'Polygon', coordinates }, { farm_code: 'FE' }); }
function collection(...features) { return { type: 'FeatureCollection', features }; }
function build({ fields = [], roads = [], network = [], shortcut_m = 0 } = {}) {
    const window = {};
    vm.runInNewContext(source, vm.createContext({ window, Math, Map, Set, Number, String, JSON, Error, Float64Array }));
    return { api: window.FertilizerRouting, graph: window.FertilizerRouting.build({
        gleba: 'FE', year: '2026', shortcut_m,
        fields: collection(...fields), roads: collection(...roads), network: collection(...network)
    }) };
}
const mound = (id, longitude, latitude = 0) => ({ id, gleba: 'FE', longitude, latitude });

function alternatives(roadPeakLatitude, fieldTop = 0.0016) {
    const from = [0, 0], to = [0.0008, 0];
    const road = line(from, [0.0004, roadPeakLatitude], to);
    const border = line(from, to);
    const area = polygon([[[0, 0], [0.0008, 0], [0.0008, fieldTop], [0, fieldTop], [0, 0]]]);
    const { api, graph } = build({ fields: [area], roads: [road], network: [road, border] });
    return { api, graph, from, to, road, border };
}

test('prefers a road 30–50% longer than the field border', () => {
    const { api, graph, from, to } = alternatives(0.0004);
    const result = graph.rank(from, [mound('target', to[0], to[1])]);
    const route = result.routes[0];

    assert.equal(api.profile.version, 'machine-road-v2');
    assert.deepEqual({ ...api.profile.factors }, { road: 1, border: 2, approach: 3, shortcut: 4, access: 4, snap: 1 });
    assert.ok(Object.isFrozen(api.profile) && Object.isFrozen(api.profile.factors));
    assert.ok(route, 'target should be reachable');
    const borderMeters = 0.0008 * 111195;
    assert.ok(route.metrics.roadMeters > 0, JSON.stringify(route.metrics));
    assert.ok(route.meters > borderMeters * 1.3, `${route.meters} vs ${borderMeters}`);
    assert.ok(route.meters < borderMeters * 1.5, `${route.meters} vs ${borderMeters}`);
    assert.ok(route.score < borderMeters * api.profile.factors.border);
});

test('a road detour three times as long yields to the border route', () => {
    const { graph, from, to } = alternatives(0.0015);
    const route = graph.rank(from, [mound('target', to[0], to[1])]).routes[0];

    assert.ok(route, 'target should be reachable');
    const borderMeters = 0.0008 * 111195;
    const roadDetourMeters = 2 * Math.hypot(0.0004 * 111195, 0.0015 * 111195);
    assert.ok(route.metrics.borderMeters > 0, JSON.stringify(route.metrics));
    assert.ok(roadDetourMeters >= borderMeters * 3, `${roadDetourMeters} vs ${borderMeters}`);
    assert.ok(Math.abs(route.score - route.metrics.borderMeters * 2) < 0.02);
    assert.ok(route.score < roadDetourMeters);
});

test('a short field interior approach does not outweigh the road preference', () => {
    const field = polygon([[[0, 0], [0.001, 0], [0.001, 0.0003], [0, 0.0003], [0, 0]]]);
    const road = line([0, 0.0001], [0.001, 0.0001]);
    const { graph } = build({ fields: [field], roads: [road], network: [road] });
    const origin = [0, 0.0002], destination = [0.001, 0.0001];
    const route = graph.rank(origin, [mound('target', destination[0], destination[1])]).routes[0];
    const directMeters = 0.001 * 111195;

    assert.ok(route, 'target should be reachable');
    assert.ok(route.metrics.roadMeters > 100, JSON.stringify(route.metrics));
    assert.ok(route.metrics.fieldMeters > 5 && route.metrics.fieldMeters < 20, JSON.stringify(route.metrics));
    assert.ok(route.meters > directMeters, `${route.meters} vs ${directMeters}`);
    assert.ok(route.score < directMeters * 4, `${route.score} vs direct access score ${directMeters * 4}`);
});

test('splitting a mapped road into more vertices does not change its score', () => {
    const points = [[0, 0], [0.0005, 0], [0.001, 0]];
    const oneSegment = line(points[0], points[2]);
    const splitSegments = [line(points[0], points[1]), line(points[1], points[2])];
    const origin = [0.0001, 0], target = mound('target', 0.0009, 0);
    const a = build({ roads: [oneSegment], network: [oneSegment] }).graph.rank(origin, [target]).routes[0];
    const b = build({ roads: splitSegments, network: splitSegments }).graph.rank(origin, [target]).routes[0];

    assert.ok(a && b, 'both representations should be reachable');
    assert.ok(Math.abs(a.meters - b.meters) < 0.02, `${a.meters} vs ${b.meters}`);
    assert.ok(Math.abs(a.score - b.score) < 0.02, `${a.score} vs ${b.score}`);
});

test('serviceCosts returns the same selected score and real meters as rank', () => {
    const { graph, from, to } = alternatives(0.0002);
    const mounds = [mound('target', to[0], to[1]), mound('other', 0.0007, 0.0001)];
    const samples = [
        { farm_code: 'FE', i: 0, j: 0, point: from },
        { farm_code: 'FE', i: 1, j: 0, point: [0.0001, 0.00005] }
    ];
    const rows = graph.serviceCosts(samples, mounds);

    assert.equal(rows.length, samples.length);
    for (let i = 0; i < samples.length; i++) {
        const winner = graph.rank(samples[i].point, mounds).routes[0];
        assert.equal(rows[i].mound_id, winner?.mound.id ?? null, `sample ${i}`);
        assert.equal(rows[i].score, winner?.score ?? null, `sample ${i}`);
        if (winner) assert.ok(Math.abs(rows[i].meters - winner.meters) < 0.02, `sample ${i}`);
        else assert.equal(rows[i].meters, null, `sample ${i}`);
    }
});
