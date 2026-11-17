(function (root) {
    'use strict';
    const policy = Object.freeze({ version: 'ab-guided-exits-v9', nearMeters: 250, nearRegret: 50, cutCostPerHa: 100, cutAxis: 'orthogonal' });
    function plan(samples, fields) {
        if (!Array.isArray(samples) || !Array.isArray(fields)) throw Error('Referencial AB inválido.');
        const frames = new Map(), groups = new Map(), ids = new Set(), unserved = [], regions = [], diagnostics = [];
        for (const f of fields) {
            const key = JSON.stringify([f.farm_code, f.campo]);
            if (frames.has(key) || !Array.isArray(f.bounds) || f.bounds.length !== 4 || f.bounds.some(x => !Number.isFinite(x)) ||
                f.bounds[0] >= f.bounds[2] || f.bounds[1] >= f.bounds[3]) throw Error('Referencial AB inválido.');
            frames.set(key, f); groups.set(key, []);
        }
        for (const sample of samples) {
            const key = JSON.stringify([sample.farm_code, sample.campo]), f = frames.get(key), id = JSON.stringify([key, sample.strip_id]);
            if (!f || ids.has(id) || typeof sample.strip_id !== 'string' || !sample.strip_id || !Number.isFinite(sample.u) || !Number.isFinite(sample.v) ||
                !Number.isFinite(sample.area_ha) || sample.area_ha <= 0 || sample.u < f.bounds[0] - 0.01 || sample.u > f.bounds[2] + 0.01 ||
                sample.v < f.bounds[1] - 0.01 || sample.v > f.bounds[3] + 0.01) throw Error('Posição AB inválida ou repetida.');
            ids.add(id);
            const candidates = (sample.candidates || []).filter(c => c.mound_id && Number.isFinite(c.score) && c.score >= 0 && Number.isFinite(c.meters) && c.meters >= 0)
                .sort((a, b) => a.score - b.score || a.meters - b.meters || String(a.mound_id).localeCompare(String(b.mound_id)));
            if (!candidates.length) { unserved.push({ f: sample.farm_code, c: sample.campo, s: sample.strip_id }); continue; }
            const best = candidates[0], near = best.meters <= policy.nearMeters;
            groups.get(key).push({ ...sample, best, near, candidates: new Map(candidates.filter(c => !near || c.score <= best.score + policy.nearRegret + 1e-6).map(c => [c.mound_id, c])) });
        }
        function stripes(cells, f, axis, maxRuns = Infinity) {
            const coord = axis === 0 ? 'u' : 'v', buckets = new Map();
            for (const c of cells) {
                const match = /^ab:(-?\d+):[^:]*:x:(-?\d+):[^:]*$/.exec(c.strip_id);
                const index = f.gridAligned && match ? Number(match[axis === 0 ? 2 : 1]) : c[coord];
                if (!buckets.has(index)) buckets.set(index, []);
                buckets.get(index).push(c);
            }
            let bins = [...buckets.values()].sort((a, b) => Math.min(...a.map(c => c[coord])) - Math.min(...b.map(c => c[coord])));
            // A legal cut must lie strictly between all sample positions of its neighbors.
            const merged = [];
            for (const bin of bins) {
                const previous = merged.at(-1);
                if (previous && Math.max(...previous.map(c => c[coord])) >= Math.min(...bin.map(c => c[coord])) - 1e-7) previous.push(...bin);
                else merged.push(bin);
            }
            bins = merged;
            const owners = [...new Set(cells.flatMap(c => [...c.candidates.keys()]))].sort(), n = bins.length;
            const conflicts = bins.map(bin => !owners.some(owner => bin.every(c => c.candidates.has(owner))));
            const prefixes = owners.map(owner => {
                const costs = [0], bad = [0];
                for (const bin of bins) {
                    costs.push(costs.at(-1) + bin.reduce((sum, c) => sum + (c.candidates.get(owner)?.score || 0) * c.area_ha, 0));
                    bad.push(bad.at(-1) + bin.filter(c => !c.candidates.has(owner)).length);
                }
                return { owner, costs, bad };
            });
            const penalty = cells.reduce((sum, c) => sum + c.area_ha, 0) * policy.cutCostPerHa;
            // An incompatible complete stripe stays neutral. The other legal
            // orientation is evaluated separately; no mosaic of sample cells.
            prefixes.push({ owner: null, costs: Array(n + 1).fill(0), bad: [0] });
            for (let i = 0; i < n; i++) prefixes.at(-1).bad.push(prefixes.at(-1).bad.at(-1) + (conflicts[i] ? 0 : 1));
            const dp = Array.from({ length: n + 1 }, () => []); dp[0][0] = { score: 0, runs: 0 };
            for (let end = 1; end <= n; end++) for (let start = 0; start < end; start++) {
                for (const previous of dp[start].filter(Boolean)) for (const p of prefixes) {
                    if (p.bad[end] !== p.bad[start]) continue;
                    const choice = { score: previous.score + p.costs[end] - p.costs[start] + (start ? penalty : 0), runs: previous.runs + 1, start, owner: p.owner, previous };
                    if (choice.runs > maxRuns) continue;
                    const slot = Number.isFinite(maxRuns) ? choice.runs : 0, old = dp[end][slot];
                    if (!old || choice.score < old.score - 1e-6 || (Math.abs(choice.score - old.score) <= 1e-6 && choice.runs < old.runs)) dp[end][slot] = choice;
                }
            }
            const best = dp[n].filter(Boolean).sort((a, b) => a.score - b.score || a.runs - b.runs)[0];
            if (!best) return null;
            const segments = [];
            for (let end = n, d = best; end > 0;) { segments.push({ start: d.start, end, owner: d.owner }); end = d.start; d = d.previous; }
            segments.reverse();
            const cuts = [f.bounds[axis]];
            for (let i = 1; i < n; i++) cuts.push((Math.max(...bins[i - 1].map(c => c[coord])) + Math.min(...bins[i].map(c => c[coord]))) / 2);
            cuts.push(f.bounds[axis + 2]);
            return { axis, reviewArea: segments.filter(s => !s.owner).reduce((sum, s) => sum + bins.slice(s.start, s.end).flat().reduce((a, c) => a + c.area_ha, 0), 0), score: best.score, runs: segments.length, regions: segments.map(s => {
                const rect = [...f.bounds]; rect[axis] = cuts[s.start]; rect[axis + 2] = cuts[s.end];
                return { farm_code: f.farm_code, campo: f.campo, mound_id: s.owner, axis, rect };
            }) };
        }
        for (const [key, f] of frames) {
            const cells = groups.get(key);
            if (!cells.length) continue;
            // u follows the exact supplied AB. A change of supplier can cut
            // across the pass (constant u) as well as alongside it (constant v).
            // First form complete bands. A band can then receive ONE cross-cut
            // when its two ends have different suppliers. This bounded two-level
            // partition creates straight T-junctions, never a cell mosaic.
            const alternatives = [stripes(cells, f, 1), stripes(cells, f, 0)].filter(Boolean);
            if (!alternatives.length) throw Error('Não há abastecimento compatível com cortes retos pela guia: ' + f.farm_code + ' / ' + f.campo);
            for (const alternative of alternatives) {
                const refined = [], mainAxis = alternative.axis;
                for (const parent of alternative.regions) {
                    const subset = cells.filter(c => {
                        const value = mainAxis === 0 ? c.u : c.v;
                        return value >= parent.rect[mainAxis] - 1e-7 && value <= parent.rect[mainAxis + 2] + 1e-7;
                    });
                    const subfield = { ...f, bounds: parent.rect }, split = stripes(subset, subfield, 1 - mainAxis, 2);
                    const oldReview = parent.mound_id ? 0 : subset.reduce((sum, c) => sum + c.area_ha, 0);
                    const oldCost = parent.mound_id ? subset.reduce((sum, c) => sum + c.candidates.get(parent.mound_id).score * c.area_ha, 0) : 0;
                    if (split && (split.reviewArea < oldReview - 1e-7 ||
                        (Math.abs(split.reviewArea - oldReview) < 1e-7 && split.score < oldCost - 1e-6))) {
                        refined.push(...split.regions.map(r => ({ ...r, parent_rect: [...parent.rect], parent_axis: mainAxis })));
                        alternative.reviewArea += split.reviewArea - oldReview;
                        alternative.score += split.score - oldCost;
                    } else refined.push(parent);
                }
                alternative.regions = refined;
                alternative.runs = refined.length;
            }
            alternatives.sort((a, b) => a.reviewArea - b.reviewArea || a.score - b.score || a.runs - b.runs || b.axis - a.axis);
            const chosen = alternatives[0]; regions.push(...chosen.regions.filter(r => r.mound_id));
            let regret = 0, maxRegret = 0;
            for (const c of cells) {
                const region = chosen.regions.find(r => c.u >= r.rect[0] - 1e-7 && c.u <= r.rect[2] + 1e-7 &&
                    c.v >= r.rect[1] - 1e-7 && c.v <= r.rect[3] + 1e-7);
                if (!region.mound_id) {
                    unserved.push({ f: c.farm_code, c: c.campo, s: c.strip_id, reason: 'guide_conflict' });
                    continue;
                }
                const candidate = c.candidates.get(region.mound_id), excess = candidate.score - c.best.score;
                regret += excess * c.area_ha; maxRegret = Math.max(maxRegret, excess);
            }
            diagnostics.push({ farm_code: f.farm_code, campo: f.campo, axis: chosen.axis, regions: chosen.regions.length,
                samples: cells.length, protected_samples: cells.filter(c => c.near).length, review_stripes: chosen.regions.filter(r => !r.mound_id).length,
                weighted_regret: regret, max_weighted_regret: maxRegret });
        }
        return { regions, unserved, diagnostics, policy };
    }
    root.FertilizerABStraight = { plan, policy };
})(typeof window !== 'undefined' ? window : globalThis);
