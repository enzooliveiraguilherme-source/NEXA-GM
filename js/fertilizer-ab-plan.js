(function (root) {
    'use strict';
    // A guide defines a coordinate frame, rather than merely rotating pixels.
    // Every decision is a continuous rectangle cut parallel to the guide or,
    // when the local supplier changes along it, across the complete section.
    const policy = Object.freeze({ version: 'ab-plan-v4', relativeRegret: 0, absoluteRegret: 500, nearMoundMeters: 250, nearMoundRegret: 50 });
    function partition(samples) {
        if (!Array.isArray(samples) || samples.length > 30000) throw Error('Amostras do planejamento AB inválidas.');
        const groups = new Map(), result = new Array(samples.length), ids = new Set();
        for (const [index, sample] of samples.entries()) {
            const key = JSON.stringify([sample.farm_code, sample.campo, sample.strip_id]);
            if (ids.has(key) || !Number.isFinite(sample.area_ha) || sample.area_ha <= 0) throw Error('Amostra AB inválida ou repetida.');
            ids.add(key);
            const match = /^ab:(-?\d+):[^:]*:x:(-?\d+):[^:]*$/.exec(sample.strip_id);
            const candidates = (sample.candidates || []).filter(c => c.mound_id && Number.isFinite(c.score) && c.score >= 0 &&
                Number.isFinite(c.meters) && c.meters >= 0).sort((a, b) => a.score - b.score || a.meters - b.meters || String(a.mound_id).localeCompare(String(b.mound_id)));
            const best = candidates[0];
            if (!match || !best) {
                result[index] = { ...sample, mound_id: best?.mound_id || null, score: best?.score ?? null, meters: best?.meters ?? null,
                    plan_id: null, plan_bounds: null };
                delete result[index].candidates;
                continue;
            }
            const group = JSON.stringify([sample.farm_code, sample.campo]);
            if (!groups.has(group)) groups.set(group, []);
            const cap = best.meters <= policy.nearMoundMeters ? policy.nearMoundRegret : policy.absoluteRegret;
            groups.get(group).push({ index, sample, i: Number(match[1]), j: Number(match[2]), best, cap,
                candidates: new Map(candidates.map(c => [c.mound_id, c])) });
        }
        for (const cells of groups.values()) {
            const levels = [...new Set(cells.map(c => c.j))].sort((a, b) => a - b);
            const at = new Map(levels.map(j => [j, cells.filter(c => c.j === j)]));
            const bandKey = c => c.sample.strip_id.split(':').slice(0, 3).join(':');
            const admissible = c => [...c.candidates].filter(([, v]) => v.score <= c.best.score + c.cap + 1e-6);
            // Incompatible physical pieces inside one sample interval do not
            // become a fabricated common route. Keep those pieces independent.
            const excluded = new Set();
            for (const list of at.values()) {
                const bands = new Map();
                for (const c of list) {
                    const k = bandKey(c);
                    if (!bands.has(k)) bands.set(k, []);
                    bands.get(k).push(c);
                }
                for (const pieces of bands.values()) {
                    if (!admissible(pieces[0]).some(([id]) => pieces.every(c => admissible(c).some(([other]) => other === id)))) {
                        for (const c of pieces) excluded.add(c.index);
                    }
                }
            }
            function add(states, c) {
                const k = bandKey(c), allowed = new Map(admissible(c));
                if (!states.has(k)) states.set(k, { key: k, i: c.i, candidates: new Map([...allowed].map(([id]) => [id, { cost: 0, meters: 0 }])) });
                const state = states.get(k);
                for (const [id, sum] of state.candidates) {
                    const v = allowed.get(id);
                    if (!v) state.candidates.delete(id);
                    else { sum.cost += v.score * c.sample.area_ha; sum.meters += v.meters * c.sample.area_ha; }
                }
            }
            // Across the AB, minimize supplier changes before comparing access
            // costs. This creates long, neighboring parallel bands, not pixels.
            function lanes(states) {
                const bands = [...states.values()].sort((a, b) => a.i - b.i || a.key.localeCompare(b.key));
                let previous = new Map();
                for (const band of bands) {
                    if (!band.candidates.size) return null;
                    const next = new Map();
                    for (const [id, cost] of [...band.candidates].sort(([a], [b]) => a.localeCompare(b))) {
                        let best = null;
                        for (const [last, p] of previous.size ? previous : [[null, { runs: 0, cost: 0, meters: 0, path: null }]]) {
                            const choice = { runs: p.runs + (last === id ? 0 : 1), cost: p.cost + cost.cost,
                                meters: p.meters + cost.meters, path: { key: band.key, id, previous: p.path } };
                            if (!best || less(choice, best, ['runs', 'cost', 'meters'])) best = choice;
                        }
                        next.set(id, best);
                    }
                    previous = next;
                }
                let best = null;
                for (const value of previous.values()) if (!best || less(value, best, ['runs', 'cost', 'meters'])) best = value;
                return best || { runs: 0, cost: 0, meters: 0, path: null };
            }
            function less(a, b, fields) {
                for (const field of fields) if (Math.abs(a[field] - b[field]) > 1e-6) return a[field] < b[field];
                return false;
            }
            // All bands share transverse section limits. Minimize the number of
            // such cuts FIRST, then parallel supplier changes, then route cost.
            // A separate breakpoint for each band would recreate stair steps.
            const dp = new Array(levels.length + 1); dp[0] = { sections: 0, runs: 0, cost: 0, meters: 0 };
            for (let from = 0; from < levels.length; from++) {
                if (!dp[from]) continue;
                const states = new Map();
                for (let to = from; to < levels.length; to++) {
                    for (const c of at.get(levels[to])) if (!excluded.has(c.index)) add(states, c);
                    const lane = lanes(states);
                    if (!lane) break;
                    const choice = { sections: dp[from].sections + 1, runs: dp[from].runs + lane.runs,
                        cost: dp[from].cost + lane.cost, meters: dp[from].meters + lane.meters, from, lane };
                    if (!dp[to + 1] || less(choice, dp[to + 1], ['sections', 'runs', 'cost', 'meters'])) dp[to + 1] = choice;
                }
            }
            if (!dp[levels.length]) throw Error('Não foi possível planejar as seções AB.');
            const sections = [];
            for (let end = levels.length; end > 0;) {
                const step = dp[end]; sections.push({ from: step.from, to: end, lane: step.lane }); end = step.from;
            }
            sections.reverse();
            for (const [section, range] of sections.entries()) {
                const owners = new Map();
                for (let p = range.lane.path; p; p = p.previous) owners.set(p.key, p.id);
                for (let n = range.from; n < range.to; n++) for (const c of at.get(levels[n])) {
                    const id = excluded.has(c.index) ? c.best.mound_id : owners.get(bandKey(c));
                    const chosen = c.candidates.get(id), { candidates, ...sample } = c.sample;
                    result[c.index] = { ...sample, ...chosen,
                        section_id: excluded.has(c.index) ? null : section,
                        plan_id: excluded.has(c.index) ? null : 'section:' + section + ':' + bandKey(c),
                        plan_bounds: excluded.has(c.index) ? null : [levels[range.from] * 100, c.i * 50, (levels[range.to - 1] + 1) * 100, (c.i + 1) * 50],
                        local_mound_id: c.best.mound_id, local_score: c.best.score };
                }
            }
        }
        return result;
    }
    root.FertilizerABPlan = { partition, policy };
})(typeof window !== 'undefined' ? window : globalThis);
