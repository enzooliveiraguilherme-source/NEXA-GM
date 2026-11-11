const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../js/fertilizer-routing.js'), 'utf8');

function feature(geometry, properties = {}) {
    return { type: 'Feature', properties, geometry };
}
function line(...coordinates) { return feature({ type: 'LineString', coordinates }); }
function polygon(rings, gleba = 'FE') { return feature({ type: 'Polygon', coordinates: rings }, { gleba }); }
function collection(...features) { return { type: 'FeatureCollection', features }; }
function graph({ fields = [], roads = [], network = [], gleba = 'FE', shortcut_m = 80 } = {}) {
    const window = {};
    vm.runInNewContext(source, vm.createContext({ window, Math, Map, Set, Number, String, JSON, Error }));
    return window.FertilizerRouting.build({
        gleba, year: '2026', shortcut_m,
        fields: collection(...fields), roads: collection(...roads), network: collection(...network)
    });
}
const mound = (id, gleba, longitude, latitude = 0.0005) => ({ id, gleba, longitude, latitude });

const field = polygon([
    [[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]
]);

test('atalho coberto de até 80 m vence o desvio e não recebe penalidade', () => {
    const g = graph({ fields: [field], network: [
        line([-0.0001, 0.0005], [0.0002, 0.0005]),
        line([0.0006, 0.0005], [0.0011, 0.0005])
    ], roads: [line([-0.0001, 0.0005], [0.0002, 0.0005]), line([0.0006, 0.0005], [0.0011, 0.0005])] });
    const result = g.rank([-0.0001, 0.0005], [mound('m1', 'FE', 0.0011)]);
    assert.equal(result.unreachable, 0);
    assert.equal(result.routes.length, 1);
    assert.ok(result.routes[0].shortcutMeters > 0, JSON.stringify(result.routes[0]));
    assert.ok(result.routes[0].meters < 140);
});

test('atalho não atravessa buraco estreito no talhão', () => {
    const withHole = polygon([
        [[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]],
        [[0.00038, 0.0004], [0.00042, 0.0004], [0.00042, 0.0006], [0.00038, 0.0006], [0.00038, 0.0004]]
    ]);
    const g = graph({ fields: [withHole], network: [
        line([-0.0001, 0.0005], [0.0002, 0.0005], [0.0002, 0.0009], [0.0006, 0.0009], [0.0006, 0.0005]),
        line([0.0006, 0.0005], [0.0011, 0.0005])
    ], roads: [line([-0.0001, 0.0005], [0.0002, 0.0005]), line([0.0006, 0.0005], [0.0011, 0.0005])] });
    const result = g.rank([-0.0001, 0.0005], [mound('m-hole', 'FE', 0.0011)]);
    assert.equal(result.routes.length, 1);
    assert.equal(result.unreachable, 0);
    assert.ok(result.routes[0].meters > 100);
    assert.ok(result.routes[0].coordinates.length > 2);
});

test('atalho acima de 80 m não é criado', () => {
    const g = graph({ fields: [field], network: [
        line([-0.0001, 0.0005], [0.0001, 0.0005]),
        line([0.0009, 0.0005], [0.0011, 0.0005])
    ], roads: [line([-0.0001, 0.0005], [0.0002, 0.0005]), line([0.0009, 0.0005], [0.0011, 0.0005])] });
    const result = g.rank([-0.0001, 0.0005], [mound('m-limite', 'FE', 0.0011)]);
    assert.equal(result.routes.length, 0);
    assert.equal(result.unreachable, 1);
});

test('componentes separados sem conexão elegível retornam monte inalcançável', () => {
    const g = graph({ fields: [], network: [line([0, 0], [0.0001, 0]), line([0.001, 0], [0.0011, 0])] });
    const result = g.rank([0, 0], [mound('isolado', 'FE', 0.0011, 0)]);
    assert.equal(result.routes.length, 0);
    assert.equal(result.unreachable, 1);
});

test('rank considera somente montes da gleba solicitada', () => {
    const g = graph({ fields: [field], network: [line([0.0002, 0.0005], [0.0008, 0.0005])] });
    const result = g.rank([0.0002, 0.0005], [
        mound('FE-1', 'FE', 0.0007, 0.0005), mound('RM-1', 'RM', 0.0008, 0.0005)
    ]);
    assert.deepEqual(Array.from(result.routes, route => route.mound.id), ['FE-1']);
    assert.equal(result.unreachable, 0);
});

test('origem no interior conecta à rede e mede o acesso separadamente', () => {
    const g = graph({ fields: [field], network: [
        line([0.0001, 0.0005], [0.0008, 0.0005]), line([0.0008, 0.0005], [0.0011, 0.0005])
    ], roads: [line([0.0008, 0.0005], [0.0011, 0.0005])] });
    const result = g.rank([0.0003, 0.0006], [mound('externo', 'FE', 0.0011)]);
    assert.equal(result.routes.length, 1);
    assert.ok(result.routes[0].accessMeters > 10);
    assert.ok(result.routes[0].meters > result.routes[0].accessMeters);
});

test('monte no mesmo talhão usa percurso direto coberto', () => {
    const g = graph({ fields: [field], network: [line([0.0001, 0.0001], [0.0009, 0.0001])] });
    const result = g.rank([0.0002, 0.0005], [mound('interno', 'FE', 0.0008, 0.0005)]);
    assert.equal(result.routes.length, 1);
    assert.equal(result.routes[0].shortcutMeters, 0);
    assert.ok(Math.abs(result.routes[0].meters - 66.7) < 1);
    assert.deepEqual(Array.from(result.routes[0].coordinates, point => Array.from(point)), [[0.0002, 0.0005], [0.0008, 0.0005]]);
});

test('interseção compartilhada na rede nodada conecta os braços', () => {
    const g = graph({ fields: [], roads: [], network: [
        line([0, 0], [0.0005, 0]), line([0.0005, 0], [0.001, 0]),
        line([0.0005, -0.0005], [0.0005, 0]), line([0.0005, 0], [0.0005, 0.0005])
    ] });
    const result = g.rank([0, 0], [mound('cross', 'FE', 0.0005, 0.0005)]);
    assert.equal(result.routes.length, 1);
    assert.ok(result.routes[0].meters > 110 && result.routes[0].meters < 112);
    assert.equal(g.nodeCount, 5);
});

test('origem e monte no meio do mesmo segmento usam o trecho direto', () => {
    const road = line([0, 0], [0.001, 0]);
    const g = graph({ fields: [], roads: [road], network: [road] });
    const result = g.rank([0.0002, 0], [mound('meio', 'FE', 0.0007, 0)]);
    assert.equal(result.routes.length, 1);
    assert.ok(Math.abs(result.routes[0].meters - 55.6) < 0.2);
    const coordinates = Array.from(result.routes[0].coordinates, point => Array.from(point));
    assert.ok(coordinates.every(point => Math.abs(point[1]) < 1e-12 && point[0] >= 0.0002 - 1e-12 && point[0] <= 0.0007 + 1e-12));
});
