const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../js/fertilizer-routing.js'), 'utf8');
function feature(geometry, properties = {}) { return { type: 'Feature', properties, geometry }; }
function line(...coordinates) { return feature({ type: 'LineString', coordinates }); }
function collection(...features) { return { type: 'FeatureCollection', features }; }
function build(network, roads = network) {
    const window = {};
    vm.runInNewContext(source, vm.createContext({ window, Math, Map, Set, Number, String, JSON, Error, Float64Array }));
    return window.FertilizerRouting.build({ year: '2026', gleba: 'FE', shortcut_m: 80,
        fields: collection(), roads: collection(...roads), network: collection(...network) });
}
const mound = (id, gleba, longitude, latitude = 0) => ({ id, gleba, longitude, latitude });
const sample = (campo, strip_id, longitude, area_ha = 1, farm_code = 'FE') =>
    ({ farm_code, campo, strip_id, point: [longitude, 0], area_ha });

test('serviceBlockCosts assigns one origin across distant pieces using total area-weighted cost', () => {
    const road = line([0, 0], [0.002, 0]);
    const graph = build([road]);
    const samples = [
        sample('Block-A', 'ab:5:1', 0.0002, 1),
        sample('Block-A', 'ab:5:2', 0.0018, 4)
    ];
    const mounds = [mound('west', 'FE', 0.0002), mound('east', 'FE', 0.0018)];
    const local = graph.serviceStripCosts(samples, mounds);
    assert.deepEqual(Array.from(local, item => item.mound_id), ['west', 'east']);

    const result = graph.serviceBlockCosts(samples, mounds);
    assert.deepEqual(Array.from(result, item => item.mound_id), ['east', 'east']);
    assert.deepEqual(Array.from(result, item => item.campo), ['Block-A', 'Block-A']);
});

test('serviceBlockCosts keeps separate fields and AB indices independent', () => {
    const road = line([0, 0], [0.003, 0]);
    const graph = build([road]);
    const samples = [
        sample('Block-A', 'ab:7:1', 0.0002, 2), sample('Block-A', 'ab:7:2', 0.0018, 1),
        sample('Block-B', 'ab:7:1', 0.0018, 2), sample('Block-B', 'ab:7:2', 0.0002, 1),
        sample('Block-A', 'ab:8:1', 0.0018, 2), sample('Block-A', 'ab:8:2', 0.0002, 1)
    ];
    const mounds = [mound('west', 'FE', 0.0002), mound('east', 'FE', 0.0018)];
    const results = graph.serviceBlockCosts(samples, mounds);
    assert.deepEqual(Array.from(results, item => item.mound_id), ['west', 'west', 'east', 'east', 'east', 'east']);
});

test('serviceBlockCosts leaves an inaccessible piece null without erasing accessible assignments', () => {
    const west = line([0, 0], [0.0002, 0]);
    const isolated = line([0.002, 0], [0.0022, 0]);
    const graph = build([west, isolated]);
    const samples = [sample('Block-A', 'ab:2:1', 0.0001), sample('Block-A', 'ab:2:2', 0.0021)];
    const result = graph.serviceBlockCosts(samples, [mound('west', 'FE', 0.0002)]);
    assert.equal(result[0].mound_id, 'west');
    assert.equal(result[1].mound_id, null);
    assert.equal(result[1].score, null);
    assert.equal(result[1].meters, null);
});

test('serviceBlockCosts preserves local winners when disjoint networks have no common supplier', () => {
    const west = line([0, 0], [0.0002, 0]);
    const east = line([0.002, 0], [0.0022, 0]);
    const graph = build([west, east]);
    const samples = [sample('Block-A', 'ab:3:1', 0.0001), sample('Block-A', 'ab:3:2', 0.0021)];
    const result = graph.serviceBlockCosts(samples, [mound('west', 'FE', 0.0002), mound('east', 'FE', 0.0022)]);
    assert.deepEqual(Array.from(result, item => item.mound_id), ['west', 'east']);
    assert.ok(result.every(item => Number.isFinite(item.score) && Number.isFinite(item.meters)));
});

test('serviceBlockCosts breaks equal-cost ties by stable mound ID', () => {
    const road = line([0, 0], [0.002, 0]);
    const graph = build([road]);
    const samples = [sample('Block-A', 'ab:9:1', 0.0005), sample('Block-A', 'ab:9:2', 0.0015)];
    const result = graph.serviceBlockCosts(samples, [mound('z-id', 'FE', 0.001), mound('a-id', 'FE', 0.001)]);
    assert.deepEqual(Array.from(result, item => item.mound_id), ['a-id', 'a-id']);
});
