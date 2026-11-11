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
    assert.ok(result.routes[0].meters >= result.routes[0].accessMeters - 0.001);
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

test('origem próxima à estrada segue o acesso local, alcança FE02 03 e FE03, e não corta até FE04', () => {
    const broadField = polygon([[[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]]);
    const localRoad = line([0.002, 0.0051], [0.009, 0.0051]);
    const isolatedRoad = line([0.0045, 0.008], [0.0046, 0.008]);
    const g = graph({ fields: [broadField], network: [localRoad, isolatedRoad], roads: [localRoad, isolatedRoad] });
    const origin = [0.002, 0.005];
    const result = g.rank(origin, [
        mound('FE0203', 'FE', 0.0065, 0.0051),
        mound('FE03', 'FE', 0.0085, 0.0051),
        mound('FE04', 'FE', 0.00455, 0.008)
    ]);
    assert.deepEqual(Array.from(result.routes, route => route.mound.id), ['FE0203', 'FE03']);
    assert.equal(result.unreachable, 1);
    const route = result.routes[0];
    assert.ok(route.meters > 490 && route.meters < 530);
    assert.ok(route.accessMeters < 20);
    assert.ok(route.coordinates.length > 2);
    const firstLeg = route.coordinates[1];
    const distanceToLocalRoad = Math.abs(firstLeg[1] - 0.0051) * 111195;
    assert.ok(distanceToLocalRoad < 0.02);
});

test('monte FE03 continua acessível quando a estrada mapeada atravessa uma máscara de talhão', () => {
    const fieldWithHole = polygon([
        [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]],
        [[0.0028, 0.0048], [0.0032, 0.0048], [0.0032, 0.0052], [0.0028, 0.0052], [0.0028, 0.0048]]
    ]);
    const road = line([0.002, 0.005], [0.003, 0.005]);
    const g = graph({ fields: [fieldWithHole], roads: [road], network: [road] });
    const result = g.rank([0.002, 0.005], [mound('FE03', 'FE', 0.003, 0.005)]);
    assert.equal(result.routes.length, 1);
    assert.equal(result.routes[0].mound.id, 'FE03');
    assert.ok(Math.abs(result.routes[0].meters - 111.2) < 1);
    assert.ok(result.routes[0].coordinates.length <= 3);
});
