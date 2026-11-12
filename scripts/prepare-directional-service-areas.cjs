// Administrative preparation only. Inputs/results stay in ignored tmp/routing.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const root = path.join(__dirname, '..');
const work = path.join(root,'tmp','routing');
const blocks = process.argv.includes('--blocks'), stem = blocks ? 'block' : 'directional';
const grid = JSON.parse(fs.readFileSync(path.join(work,stem+'-grid.json'),'utf8'));
const fixture = JSON.parse(fs.readFileSync(path.join(work,'real-network.json'),'utf8'));
if (grid.model_version !== (blocks ? 'ab-blocks-v2' : 'ab-strips-v1') || grid.routing_model !== 'machine-road-v2' ||
    fixture.data.year !== grid.year || fixture.data.gleba !== grid.gleba) throw Error('Entradas de estudo incompatíveis.');
const window = {};
vm.runInNewContext(fs.readFileSync(path.join(root,'js','fertilizer-routing.js'),'utf8'),
    vm.createContext({ window, Math, Map, Set, Number, String, JSON, Error, Float64Array }));
const start = performance.now(), graph = window.FertilizerRouting.build(fixture.data);
const built = performance.now();
let last = -1;
const costs = graph[blocks ? 'serviceBlockCosts' : 'serviceStripCosts'](grid.cells,fixture.mounds,progress => {
    if (progress.stage === 'cells') {
        const step = Math.floor(progress.done/1000);
        if (step !== last) { last=step; console.log(`Amostras: ${progress.done}/${progress.total}`); }
    }
});
fs.writeFileSync(path.join(work,stem+'-costs.json'),JSON.stringify(costs));
fs.writeFileSync(path.join(work,stem+'-assignments.json'),JSON.stringify({
    signature:grid.signature,year:grid.year,requested_farms:['FE','PA','RM'],model_version:grid.model_version,
    assignments:costs.filter(c=>c.mound_id).map(c=>({f:c.farm_code,c:c.campo,s:c.strip_id,m:c.mound_id}))
}));
console.log(JSON.stringify({ samples:grid.cells.length,strips:costs.length,served:costs.filter(c=>c.mound_id).length,
    unserved:costs.filter(c=>!c.mound_id).length,build_ms:Math.round(built-start),cost_ms:Math.round(performance.now()-built) }));
