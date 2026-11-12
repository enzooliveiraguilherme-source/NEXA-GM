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
const sample = (strip_id, longitude, area_ha, { farm_code = 'FE', campo = 'FE01', latitude = 0 } = {}) =>
    ({ farm_code, campo, strip_id, point: [longitude, latitude], area_ha });

function weightedMean(rows, key, totalArea) {
    return rows.reduce((sum, row) => sum + row[key] * row.area_ha, 0) / totalArea;
}

test('serviceStripCosts chooses one mound for the whole strip and computes area-weighted means', () => {
    const road = line([0, 0], [0.002, 0]);
    const graph = build([road]);
    const samples = [sample('strip-1', 0.0002, 1), sample('strip-1', 0.0018, 3)];
    const mounds = [mound('west', 'FE', 0.0002), mound('east', 'FE', 0.0018)];

    const results = graph.serviceStripCosts(samples, mounds);
    assert.equal(results.length, 1);
    const result = results[0];
    assert.deepEqual([result.farm_code, result.campo, result.strip_id], ['FE', 'FE01', 'strip-1']);
    assert.equal(result.mound_id, 'east');
    assert.equal(result.area_ha, 4);
    assert.equal(result.samples, 2);

    const pointCosts = graph.serviceCosts(samples, mounds);
    const winnerCosts = samples.map((item, i) => graph.serviceCosts([item], [mounds[1]])[0]);
    assert.equal(pointCosts[0].mound_id, 'west');
    assert.equal(pointCosts[1].mound_id, 'east');
    assert.ok(Math.abs(result.score - weightedMean(winnerCosts, 'score', 4)) < 1e-8);
    assert.ok(Math.abs(result.meters - weightedMean(winnerCosts, 'meters', 4)) < 0.02);
});

test('serviceStripCosts uses weighted strip totals even when point winners differ', () => {
    const road = line([0, 0], [0.002, 0]);
    const graph = build([road]);
    const samples = [sample('wide-east', 0.0002, 1), sample('wide-east', 0.0018, 9)];
    const mounds = [mound('west', 'FE', 0.0002), mound('east', 'FE', 0.0018)];
    const result = graph.serviceStripCosts(samples, mounds)[0];
    assert.equal(result.mound_id, 'east');
    assert.equal(result.area_ha, 10);
    assert.equal(result.samples, 2);
});

test('serviceStripCosts requires one candidate to reach every sample in the strip', () => {
    const west = line([0, 0], [0.0002, 0]);
    const east = line([0.002, 0], [0.0022, 0]);
    const graph = build([west, east]);
    const samples = [sample('split', 0, 2), sample('split', 0.0022, 1)];
    const result = graph.serviceStripCosts(samples, [mound('west', 'FE', 0, 0), mound('east', 'FE', 0.0022, 0)])[0];
    assert.equal(result.mound_id, null);
    assert.equal(result.score, null);
    assert.equal(result.meters, null);
});

test('serviceStripCosts keeps strips separate by gleba and excludes other-gleba mounds', () => {
    const road = line([0, 0], [0.002, 0]);
    const graph = build([road]);
    const samples = [
        sample('same-id', 0.0003, 1, { campo: 'FE01' }),
        sample('same-id', 0.0017, 2, { campo: 'FE02' })
    ];
    const mounds = [mound('fe-mound', 'FE', 0.0003), mound('pa-mound', 'PA', 0.0017)];
    const results = graph.serviceStripCosts(samples, mounds);
    assert.equal(results.length, 2);
    assert.deepEqual(Array.from(results, item => item.campo), ['FE01', 'FE02']);
    assert.deepEqual(Array.from(results, item => item.mound_id), ['fe-mound', 'fe-mound']);
});

test('serviceStripCosts breaks equal aggregate costs by stable mound ID', () => {
    const road = line([0, 0], [0.002, 0]);
    const graph = build([road]);
    const samples = [sample('tie', 0.001, 2)];
    const result = graph.serviceStripCosts(samples, [mound('z-id', 'FE', 0.0005), mound('a-id', 'FE', 0.0015)])[0];
    assert.equal(result.mound_id, 'a-id');
});
