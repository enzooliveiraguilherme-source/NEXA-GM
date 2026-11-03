(function (root) {
    'use strict';
    const S = root.SpraySchedule, F = root.PlantingForecast;
    const independentSteps=Object.freeze([
        Object.freeze({id:'pre',name:'Pré-emergente',short:'Pré-emergente'}),
        Object.freeze({id:'boro',name:'Boro',short:'Boro'}),
        Object.freeze({id:'desiccation',name:'Dessecação pré-plantio',short:'Dessecação pré-plantio'})
    ]);
    const isIndependent=stage=>independentSteps.some(step=>step.id===stage);
    const independentKey=(farm,field,year,culture,stage)=>'independent:'+JSON.stringify([farm,field,year,culture,stage]);
    const fieldKey = (farm, field) => JSON.stringify([farm, field]);
    const rowKey = row => row.plantingId ? `${row.plantingId}:${row.stage}` : isIndependent(row.stage)?independentKey(row.farm,row.field,row.year,row.culture,row.stage):row.id;
    const isCompleted = row => !!(row.actual || row.completedWithoutDate);
    // Calculated dates are a reference, not a confirmed work plan.
    function tableStatus(row, current = S.today()) {
        if (isCompleted(row)) return 'completed';
        if (row.started) return 'in_progress';
        if (row.optional) return 'unplanned';
        if (row.planned && row.planned < current) return 'overdue';
        if (row.planned && !row.autoDate) return 'planned';
        return 'unplanned';
    }
    const status = (planned, actual, current = S.today(), completedWithoutDate = false) => actual || completedWithoutDate ? 'completed' : !planned?'unplanned':
        planned < current ? 'overdue' : (S.time(planned) - S.time(current)) / 86400000 <= 2 ? 'attention' : 'scheduled';
    function build(features, plantingRecords, schedules, saved, context, current = S.today()) {
        const planting = new Map(plantingRecords.filter(row => row.operationType === 'plantio' || row.produto === 'Plantio')
            .map(row => [F.key(row.fazenda, row.campo, row.ano, row.cultura), row]));
        const scheduleIndex = new Map(schedules.map(row => [row.plantingId, row]));
        const metadata = new Map(saved.filter(row => row.plantingId).map(row => [rowKey(row), row]));
        const independentMetadata=new Map(saved.filter(row=>isIndependent(row.stage)).map(row=>[rowKey(row),row]));
        const fields = new Map(), applications = [];
        for (const feature of features) {
            const p = feature.properties || {}, key = fieldKey(p.Fazenda, p.Campo);
            if (fields.has(key)) continue;
            const record = planting.get(F.key(p.Fazenda, p.Campo, context.year, context.culture));
            const projected = F.project(feature, record, context.culture);
            const field = { key, farm: p.Fazenda, field: p.Campo, area: Number(p.Area) || 0,
                culture: context.culture, year: context.year, plantingId: record?.id || null,
                plantingDate: projected.plantingDate, plantedArea: projected.plantedArea, variety: record?.variedadeSemente || '' };
            fields.set(key, field);
            for(const step of independentSteps){
                const id=independentKey(field.farm,field.field,context.year,context.culture,step.id),extra=independentMetadata.get(id)||{};
                applications.push({...extra,key:id,plantingId:null,stage:step.id,independent:true,
                    farm:field.farm,field:field.field,fieldKey:key,year:context.year,culture:context.culture,
                    name:step.name,area:extra.area??field.area,planned:extra.planned||null,actual:extra.actual||null,
                    unplanned:!extra.planned&&!extra.actual&&!extra.started&&!extra.completedWithoutDate,autoDate:false,provisional:false,
                    product:extra.product||'',dose:extra.dose??null,doseUnit:extra.doseUnit||'L/ha',responsible:extra.responsible||'',notes:extra.notes||'',
                    status:status(extra.planned,extra.actual,current,extra.completedWithoutDate)});
            }
            if (!record?.id || !projected.planted || !projected.plantingDate) continue;
            const schedule = scheduleIndex.get(record.id) || { actuals: {}, fourth: false };
            let base = projected.plantingDate, provisional = false;
            const fourth = schedule.fourth || metadata.has(`${record.id}:fung4`);
            for (const step of S.steps) {
                const extra = metadata.get(`${record.id}:${step.id}`) || {};
                const optional = step.id === 'fung4' && !fourth;
                const planned = extra.planned || S.addDays(base, step.days), actual = schedule.actuals[step.id] || null;
                applications.push({ ...extra, key: `${record.id}:${step.id}`, plantingId: record.id, stage: step.id,
                    farm: field.farm, field: field.field, fieldKey: key, culture: context.culture, year: context.year,
                    name: step.name, area: extra.area ?? projected.plantedArea, planned, actual,
                    autoDate: !extra.planned, provisional: !actual && provisional, optional,
                    scheduleVersion: schedule.version ?? null, plantingDate: projected.plantingDate,
                    product: extra.product || '', dose: extra.dose ?? null, doseUnit: extra.doseUnit || 'L/ha',
                    responsible: extra.responsible || '', notes: extra.notes || '', status: optional ? 'optional' : status(planned, actual, current,extra.completedWithoutDate) });
                base = actual || planned; provisional = !actual;
            }
        }
        for (const row of saved.filter(row => !row.plantingId&&!isIndependent(row.stage))) {
            if (row.year !== context.year || row.culture !== context.culture || !fields.has(fieldKey(row.farm, row.field))) continue;
            applications.push({ ...row, key: row.id, fieldKey: fieldKey(row.farm, row.field), status: status(row.planned, row.actual, current,row.completedWithoutDate) });
        }
        return { fields: [...fields.values()], applications };
    }
    const normalize = value => F.normalize(value);
    function applicationKey(row) { return row.stage || 'manual:' + normalize(row.name); }
    function matchesApplication(row, value) {
        if (!value || value === 'all') return true;
        if (value === 'fungicide') return /^fung/.test(row.stage || '') || /FUNGIC/.test(normalize(row.name));
        if (value === 'insecticide') return /INSETIC|INSECTIC/.test(normalize(row.name));
        return applicationKey(row) === value;
    }
    function applicationOptions(rows) {
        const unique = new Map();
        for (const row of rows) unique.set(applicationKey(row), row.name);
        return [{ key:'all', label:'Todas' }, { key:'fungicide', label:'Fungicidas' }, { key:'insecticide', label:'Inseticidas' },
            ...[...unique].sort(([a], [b]) => {
                const order=[...independentSteps,...S.steps],ai=order.findIndex(step=>step.id===a),bi=order.findIndex(step=>step.id===b);
                return (ai<0?99:ai)-(bi<0?99:bi)||a.localeCompare(b,'pt-BR');
            }).map(([key,label])=>({key,label}))];
    }
    function matrix(rows) {
        const columns=applicationOptions(rows).filter(option=>!['all','fungicide','insecticide'].includes(option.key));
        const fields=new Map();
        for(const row of rows){
            if(!fields.has(row.fieldKey))fields.set(row.fieldKey,{key:row.fieldKey,farm:row.farm,field:row.field,cells:new Map()});
            const cells=fields.get(row.fieldKey).cells,key=applicationKey(row);
            if(!cells.has(key))cells.set(key,[]);
            cells.get(key).push(row);
        }
        return {columns,rows:[...fields.values()]};
    }
    function filter(rows, filters = {}) {
        const query = normalize(filters.search);
        return rows.filter(row => (filters.deleted ? row.deleted : !row.deleted) &&
            (!filters.farm || row.farm === filters.farm) && (!filters.field || row.fieldKey === filters.field) &&
            (!filters.status || (filters.table ? tableStatus(row) : row.status) === filters.status) && (!filters.from || row.planned >= filters.from) &&
            matchesApplication(row, filters.application) &&
            (!filters.to || row.planned <= filters.to) && (!query || normalize([row.farm, row.field, row.culture, row.name, row.product, row.responsible, row.notes].join(' ')).includes(query)));
    }
    function sort(rows, column = 'planned', direction = 1) {
        return [...rows].sort((a, b) => direction * (['area', 'dose'].includes(column) ? Number(a[column] || 0) - Number(b[column] || 0) :
            String(a[column] || '').localeCompare(String(b[column] || ''), 'pt-BR', { numeric: true })) || a.key.localeCompare(b.key));
    }
    function summarize(rows) {
        const active = rows.filter(row => !row.deleted && !row.optional && !row.unplanned);
        return { total: active.length, completed: active.filter(isCompleted).length,
            pending: active.filter(row => !isCompleted(row)).length, overdue: active.filter(row => row.status === 'overdue').length,
            attention: active.filter(row => row.status === 'attention').length,
            scheduled: active.filter(row => row.status === 'scheduled').length,
            plannedArea: active.reduce((total, row) => total + Number(row.area), 0),
            appliedArea: active.reduce((total, row) => total + (isCompleted(row) ? Number(row.area) : 0), 0) };
    }
    function mapStatus(rows, key) {
        const apps = rows.filter(row => row.fieldKey === key && !row.deleted && !row.optional && !row.unplanned);
        if (!apps.length) return 'empty';
        if (apps.every(isCompleted)) return 'completed';
        if (apps.some(row => row.status === 'overdue')) return 'pending';
        if (apps.some(row => row.status === 'attention')) return 'attention';
        return 'scheduled';
    }
    function areaSummary(rows) {
        const active=rows.filter(row=>!row.deleted&&!row.optional&&!row.unplanned),totals=summarize(active);
        const overdue=active.filter(row=>!isCompleted(row)&&row.status==='overdue');
        const onTime=active.filter(row=>!isCompleted(row)&&['scheduled','attention'].includes(row.status));
        const attention=onTime.filter(row=>row.status==='attention');
        const area=items=>items.reduce((sum,row)=>sum+Number(row.area),0);
        return {...totals,overdueArea:area(overdue),onTimeArea:area(onTime),attentionArea:area(attention),
            onTimeCount:onTime.length,progress:totals.plannedArea?100*totals.appliedArea/totals.plannedArea:0};
    }
    function validate(row, field, current = S.today()) {
        if (!field || row.farm !== field.farm || row.field !== field.field) throw Error('Escolha um talhão cadastrado.');
        if (!String(row.name || '').trim()) throw Error('Informe a aplicação.');
        if ((!isIndependent(row.stage)||row.planned) && S.time(row.planned) === null) throw Error('Informe uma data programada válida.');
        if (row.actual && (S.time(row.actual) === null || row.actual > current)) throw Error('A data realizada deve ser válida e não pode estar no futuro.');
        if (row.started && (S.time(row.started) === null || row.started > current)) throw Error('A data de início deve ser válida e não pode estar no futuro.');
        if (row.started && row.plantingId && row.started < field.plantingDate) throw Error('O início não pode ser anterior ao plantio.');
        if (row.started && row.actual && row.actual < row.started) throw Error('A conclusão não pode ser anterior ao início.');
        if (!Number.isFinite(Number(row.area)) || Number(row.area) <= 0 || Number(row.area) > field.area) throw Error('A área deve ser maior que zero e não pode ultrapassar o talhão.');
        if (row.dose !== null && row.dose !== '' && row.dose !== undefined && (!Number.isFinite(Number(row.dose)) || Number(row.dose) < 0 || Number(row.dose)>1000000)) throw Error('Informe uma dose válida entre zero e 1.000.000.');
        if(row.doseUnit===''||String(row.doseUnit||'L/ha').length>30)throw Error('Informe uma unidade de dose com até 30 caracteres.');
        if (String(row.product || '').length > 150 || String(row.responsible || '').length > 150 || String(row.notes || '').length > 2000) throw Error('Confira o tamanho dos textos informados.');
        return true;
    }
    const api = Object.freeze({ fieldKey, rowKey, status, tableStatus, isCompleted, build, filter, sort, summarize, areaSummary, mapStatus, validate, applicationKey, matchesApplication, applicationOptions, matrix,independentSteps,isIndependent,independentKey });
    root.SprayOperations = api;
    if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
