(function (root) {
    'use strict';
    const DAY = 86400000;
    const steps = Object.freeze([
        { id: 'post1', name: '1ª Pós-Emergente', short: '1ª Pós', days: 15 },
        { id: 'post2', name: '2ª Pós-Emergente', short: '2ª Pós', days: 10 },
        { id: 'fung1', name: '1º Fungicida', short: '1º Fungicida', days: 10 },
        { id: 'fung2', name: '2º Fungicida', short: '2º Fungicida', days: 15 },
        { id: 'fung3', name: '3º Fungicida', short: '3º Fungicida', days: 15 },
        { id: 'fung4', name: '4º Fungicida', short: '4º Fungicida', days: 15 }
    ].map(Object.freeze));
    function time(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
        const result = Date.parse(value + 'T00:00:00Z');
        return Number.isFinite(result) && new Date(result).toISOString().slice(0, 10) === value ? result : null;
    }
    function today(value = new Date()) {
        return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
    }
    function addDays(value, days) {
        const start = time(value);
        return start === null ? null : new Date(start + days * DAY).toISOString().slice(0, 10);
    }
    function validate(plantingDate, actuals = {}, fourth = false, current = today()) {
        if (time(plantingDate) === null) throw Error('Informe uma data de plantio válida no módulo Plantio.');
        if (time(current) === null) throw Error('Data de referência inválida.');
        if (!fourth && actuals.fung4) throw Error('Remova a data realizada do 4º fungicida antes de desativá-lo.');
        // O histórico pode confirmar aplicações anteriores sem informar suas datas.
        // Compare as datas conhecidas, sem criar datas fictícias para preencher lacunas.
        let previous = plantingDate;
        for (const step of steps.slice(0, fourth ? 6 : 5)) {
            const value = actuals[step.id];
            if (!value) continue;
            if (time(value) === null) throw Error(`${step.short}: informe uma data válida.`);
            if (value > current) throw Error(`${step.short}: a data realizada não pode estar no futuro.`);
            if (value < previous) throw Error(`${step.short}: a data realizada não pode ser anterior ao plantio ou à aplicação anterior.`);
            previous = value;
        }
        return true;
    }
    function calculate(plantingDate, actuals = {}, fourth = false, current = today()) {
        if (time(plantingDate) === null || time(current) === null) return [];
        let base = plantingDate, provisional = false;
        return steps.slice(0, fourth ? 6 : 5).map((step, index) => {
            const expected = addDays(base, step.days);
            const actual = time(actuals[step.id]) !== null ? actuals[step.id] : null;
            const daysLeft = Math.round((time(expected) - time(current)) / DAY);
            const status = actual ? 'completed' : daysLeft < 0 ? 'overdue' : daysLeft <= 2 ? 'attention' : 'scheduled';
            const result = { ...step, expected, actual, daysLeft: actual ? null : daysLeft, status,
                provisional: !actual && provisional, canRecord: index === 0 || !!actuals[steps[index - 1].id] };
            base = actual || expected;
            provisional = !actual;
            return result;
        });
    }
    function summarize(fields) {
        const all = fields.flatMap(field => field.schedule.map(application => ({ ...application, field: field.field, farm: field.farm, plantingId: field.plantingId })));
        const completed = all.filter(item => item.status === 'completed').length;
        const pending = all.filter(item => item.status !== 'completed').sort((a, b) => a.expected.localeCompare(b.expected) || a.field.localeCompare(b.field));
        return { total: all.length, completed, pending: pending.length,
            attention: all.filter(item => item.status === 'attention').length,
            overdue: all.filter(item => item.status === 'overdue').length,
            percent: all.length ? completed / all.length * 100 : 0, next: pending[0] || null };
    }
    const api = Object.freeze({ steps, time, today, addDays, validate, calculate, summarize });
    root.SpraySchedule = api;
    if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
