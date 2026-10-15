const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function setup(options = {}) {
    let stored = [{ id: 1, variety_name: 'Olimpo', culture: 'Soja', cycle_days: 114, version: 1 }];
    let writes = 0, events = 0, failure = false, conflict = false;
    const context = { document: { addEventListener() {} }, console: { warn() {} }, CustomEvent: function(name) { this.type = name; } };
    context.window = context; context.portalAccessRole = options.role || 'admin'; context.dispatchEvent = () => { events++; };
    context.supabaseClient = { from(table) {
        let payload = null, updating = false;
        const query = { select() { return this; }, order() { return this; }, eq() { return this; },
            async range() { return failure ? { error: Error('offline') } : { data: table === 'seed_varieties' ? [{ name: 'NEO780' }] : stored.map(row => ({ ...row })), count: table === 'seed_varieties' ? 1 : stored.length }; },
            insert(input) { payload = input; return this; }, update(input) { payload = input; updating = true; return this; },
            async maybeSingle() { writes++; if (failure) return { error: { code: '42501' } }; if (conflict) return { data: null };
                const row = { ...payload, id: 1, version: updating ? 2 : 1 }; stored = [row]; return { data: row }; }
        }; return query;
    } };
    vm.createContext(context);
    for (const path of ['../js/planting-forecast.js','../js/seed-cycles.js']) vm.runInContext(fs.readFileSync(require.resolve(path), 'utf8'), context);
    return { api: context.SeedCycleCatalog, F: context.PlantingForecast, writes: () => writes, events: () => events, fail: () => { failure = true; }, conflict: () => { conflict = true; } };
}
test('catálogo carregado substitui ciclos fixos, inclusive ciclo removido', async () => {
    const h = setup(); await h.api.load();
    assert.equal(h.F.cycleDays('Olimpo'), 114); assert.equal(h.F.cycleDays('NEO 790'), null);
    h.F.configureCycles([{ variety_name: 'Olimpo', culture: 'Soja', cycle_days: 120 }, { variety_name: 'NEO790', culture: 'Soja', cycle_days: 110 }]);
    assert.equal(h.F.harvestDate('2026-10-15', h.F.cycleDays('Olimpo')), '2027-02-12');
    assert.equal(h.F.cycleDays('neo 790'), 110); assert.equal(h.F.cycleDays('Olimpo','Milho'), null);
    h.F.configureCycles([{ variety_name: 'Olimpo', culture: 'Soja', cycle_days: null }]); assert.equal(h.F.cycleDays('Olimpo'), null);
});
test('admin salva ciclo e recalcula imediatamente sem alterar data de plantio', async () => {
    const h = setup(); await h.api.load();
    const record = { status: 'concluido', areaRealizada: 10, variedadeSemente: 'Olimpo', dataPlantio: '2026-10-15' };
    await h.api.save({ variety_name: 'Olimpo', culture: 'Soja', cycle_days: '120' }, h.api.rows[0]);
    assert.equal(h.F.project({ properties: { Area: 10 } }, record, 'Soja').estimatedDate, '2027-02-12');
    assert.equal(record.dataPlantio, '2026-10-15'); assert.equal(h.writes(), 1); assert.ok(h.events() >= 2);
});
test('projetista e visualizador não enviam gravação; validação rejeita ciclo inválido', async () => {
    for (const role of ['projetista','visualizador']) { const h = setup({role}); await assert.rejects(h.api.save({variety_name:'X',culture:'Soja',cycle_days:114}), /Somente administradores/); assert.equal(h.writes(),0); }
    const h = setup(); for (const days of ['0','-1','1.5','731','abc']) assert.throws(() => h.api.validate({variety_name:'X',culture:'Soja',cycle_days:days}));
    assert.throws(() => h.api.validate({variety_name:' ',culture:'Soja',cycle_days:114}));
    assert.equal(h.api.validate({variety_name:'X',culture:'Soja',cycle_days:''}).cycle_days,null);
});
test('falha de consulta não reutiliza prazos fixos ou dados antigos', async () => {
    const h = setup(); await h.api.load(); h.fail(); assert.equal(await h.api.load(), false);
    assert.equal(h.api.available, false); assert.equal(h.F.cycleDays('Olimpo'), null); assert.equal(h.F.cycleDays('NEO 790'), null);
});
test('falha e conflito não confirmam ciclo nem sobrescrevem cache', async () => {
    const h = setup(); await h.api.load(); h.conflict();
    await assert.rejects(h.api.save({variety_name:'Olimpo',culture:'Soja',cycle_days:120},h.api.rows[0]), /cadastro mudou/);
    assert.equal(h.F.cycleDays('Olimpo'),114);
    const denied=setup(); await denied.api.load(); denied.fail();
    await assert.rejects(denied.api.save({variety_name:'Olimpo',culture:'Soja',cycle_days:120},denied.api.rows[0]), /perfil/);
    assert.equal(denied.F.cycleDays('Olimpo'),114);
});
