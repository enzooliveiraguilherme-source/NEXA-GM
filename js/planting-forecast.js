(function (root) {
    'use strict';
    const DAY = 86400000;
    const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toUpperCase();
    let configuredCycles = null;
    const cycleKey = (variety, culture) => JSON.stringify([variety, culture].map(value => normalize(value).replace(/\s/g, '')));
    function configureCycles(rows) {
        configuredCycles = new Map(rows.filter(row => !row.archived).map(row => [cycleKey(row.variety_name, row.culture),
            Number.isInteger(row.cycle_days) && row.cycle_days > 0 ? row.cycle_days : null]));
    }
    function cycleDays(variety, culture = 'Soja') {
        if (configuredCycles !== null) return configuredCycles.get(cycleKey(variety, culture)) ?? null;
        if (normalize(culture) !== 'SOJA') return null;
        const name = normalize(variety).replace(/\s/g, '');
        return ['OLIMPO', 'NEO790'].includes(name) ? 114 : null;
    }
    function dateValue(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
        const time = Date.parse(value + 'T00:00:00Z');
        return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null;
    }
    function harvestDate(plantingDate, days) {
        const time = dateValue(plantingDate);
        return time !== null && Number.isInteger(days) && days > 0 ? new Date(time + days * DAY).toISOString().slice(0, 10) : null;
    }
    function key(farm, field, year, culture) {
        return JSON.stringify([farm, field, year, culture].map(normalize));
    }
    // Only execution records contribute. Geometry attributes and planning never imply planted area.
    function project(feature, record, culture) {
        const p = feature.properties || {};
        const totalArea = Math.max(0, Number(p.Area) || 0);
        const validStatus = ['concluido', 'em_andamento'].includes(record?.status);
        const rawArea = Number(record?.areaRealizada);
        const plantedArea = validStatus && Number.isFinite(rawArea) ? Math.min(totalArea, Math.max(0, rawArea)) : 0;
        const planted = plantedArea > 0;
        const variety = planted ? String(record.variedadeSemente || '').trim() : '';
        const plantingDate = planted && dateValue(record.dataPlantio) !== null ? record.dataPlantio : null;
        const days = cycleDays(variety, culture);
        const estimatedDate = planted && plantingDate ? harvestDate(plantingDate, days) : null;
        let reason = 'Sem plantio executado';
        if (planted) reason = !variety ? 'Variedade não informada' : !plantingDate ? 'Data de plantio não informada' : !days ? 'Ciclo da variedade não definido' : '';
        return { farm: p.Fazenda, field: p.Campo, totalArea, plantedArea, planted, variety, plantingDate,
            days, estimatedDate, reason, partial: planted && record.status === 'em_andamento' && plantedArea < totalArea, simulated: !!record?.simulated };
    }
    function weekStart(value) {
        const time = dateValue(value);
        if (time === null) return null;
        const date = new Date(time);
        return new Date(time - ((date.getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
    }
    function summarize(rows) {
        const weeks = new Map();
        let plantedArea = 0, estimatedArea = 0, plantedFields = 0, simulatedFields = 0;
        for (const row of rows) {
            plantedArea += row.plantedArea;
            if (row.planted) plantedFields++;
            if (row.simulated) simulatedFields++;
            if (row.estimatedDate) {
                estimatedArea += row.plantedArea;
                const week = weekStart(row.estimatedDate);
                weeks.set(week, (weeks.get(week) || 0) + row.plantedArea);
            }
        }
        const dates = rows.map(r => r.estimatedDate).filter(Boolean).sort();
        return { plantedArea, estimatedArea, plantedFields, simulatedFields, first: dates[0] || null,
            last: dates.at(-1) || null, weeks: [...weeks].sort(([a], [b]) => a.localeCompare(b)) };
    }
    function createSession() {
        const simulations = new Map();
        return Object.freeze({
            set(feature, year, culture, input) {
                const p = feature.properties || {};
                const area = Number(input.areaRealizada), total = Number(p.Area);
                if (!String(input.variedadeSemente || '').trim()) throw Error('Informe a variedade plantada.');
                if (dateValue(input.dataPlantio) === null) throw Error('Informe uma data de plantio válida.');
                if (!Number.isFinite(area) || area <= 0 || area > total) throw Error('A área plantada deve ser maior que zero e não pode ultrapassar a área do talhão.');
                simulations.set(key(p.Fazenda, p.Campo, year, culture), { variedadeSemente: input.variedadeSemente.trim(),
                    dataPlantio: input.dataPlantio, areaRealizada: area, status: area < total ? 'em_andamento' : 'concluido', simulated: true });
            },
            get: (feature, year, culture) => {
                const record = simulations.get(key(feature.properties.Fazenda, feature.properties.Campo, year, culture));
                return record ? { ...record } : undefined;
            },
            remove: (feature, year, culture) => simulations.delete(key(feature.properties.Fazenda, feature.properties.Campo, year, culture)),
            clear: () => simulations.clear(),
            get size() { return simulations.size; }
        });
    }
    const api = Object.freeze({ normalize, configureCycles, cycleDays, dateValue, harvestDate, key, project, weekStart, summarize, createSession });
    root.PlantingForecast = api;
    if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
