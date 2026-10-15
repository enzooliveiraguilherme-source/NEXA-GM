// Geometries and records are entirely synthetic; no network or official datasets.
(function () {
    'use strict';
    const features = Array.from({ length: 8 }, (_, index) => {
        const col = index % 4, row = Math.floor(index / 4);
        const x = -52.45 + col * .017 + row * .003, y = -13.15 + row * .018;
        return { type: 'Feature', properties: { Fazenda: 'DEMO', Campo: `Talhão ${String(index + 1).padStart(2, '0')}`, Area: [85, 102, 76, 91, 63, 120, 98, 80][index] },
            geometry: { type: 'Polygon', coordinates: [[[x, y], [x + .014, y + .001], [x + .015, y + .014], [x + .001, y + .015], [x, y]]] } };
    });
    const records = features.slice(0, 6).map((feature, index) => ({ operationType: 'plantio', fazenda: 'DEMO', campo: feature.properties.Campo,
        ano: '2026', cultura: 'Soja', produto: 'Plantio', status: index === 5 ? 'em_andamento' : 'concluido',
        areaRealizada: index === 5 ? 50 : feature.properties.Area, variedadeSemente: ['Olimpo', 'NEO 790', 'Olimpo', 'NEO 790', 'Outra variedade', 'Olimpo'][index],
        dataPlantio: ['2026-10-01', '2026-10-06', '2026-10-12', '2026-10-18', '2026-10-20', '2026-10-25'][index] }));
    window.NexaForecastDemo = { features, records, farms: [{ code: 'DEMO', name: 'Fazenda demonstrativa' }] };
})();
