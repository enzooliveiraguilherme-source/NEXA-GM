(function (root) {
    'use strict';
    const S = root.SpraySchedule, F = root.PlantingForecast;
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const date = value => value ? value.split('-').reverse().join('/') : '—';
    const ha = value => Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' ha';
    const statusNames = { completed: '✓ Concluída', overdue: 'Atrasada', attention: 'Atenção', scheduled: 'No prazo' };
    let state, features = [], fields = [], selected = '', loadedKey = '', generation = 0, loading = false, saving = false, error = '', message = '', clockDay = '';
    const records = new Map(), drafts = new Map();
    const el = name => document.getElementById('spray-' + name);
    const editable = () => state?.userRole === 'editor' && ['admin', 'projetista'].includes(root.portalAccessRole);
    const repository = () => root.SprayRepository.create(root.supabaseClient);
    function sourceFields() {
        const planting = new Map(Object.values(state.cloudStore?.getRecords() || {})
            .filter(record => record.operationType === 'plantio' || record.produto === 'Plantio')
            .map(record => [F.key(record.fazenda, record.campo, record.ano, record.cultura), record]));
        const unique = new Map();
        for (const feature of features) {
            const p = feature.properties || {}, record = planting.get(F.key(p.Fazenda, p.Campo, state.currentAno, state.currentCultura));
            const projected = F.project(feature, record, state.currentCultura);
            if (!record?.id || !projected.planted || !projected.plantingDate || unique.has(record.id)) continue;
            unique.set(record.id, { plantingId: record.id, field: p.Campo, farm: p.Fazenda, variety: projected.variety,
                area: projected.plantedArea, plantingDate: projected.plantingDate, partial: projected.partial });
        }
        return [...unique.values()].sort((a, b) => a.farm.localeCompare(b.farm, 'pt-BR') || a.field.localeCompare(b.field, 'pt-BR', { numeric: true }));
    }
    function values(field) {
        return (editable() && drafts.get(field.plantingId)) || records.get(field.plantingId) || { plantingId: field.plantingId, fourth: false, actuals: {} };
    }
    function prepare() {
        fields = sourceFields().map(field => {
            const value = values(field);
            return { ...field, schedule: S.calculate(field.plantingDate, value.actuals, value.fourth) };
        });
        if (!fields.some(field => field.plantingId === selected)) selected = fields[0]?.plantingId || '';
    }
    function daysText(application) {
        if (application.actual) return 'Concluída';
        if (application.daysLeft < 0) return `${Math.abs(application.daysLeft)} ${application.daysLeft === -1 ? 'dia de atraso' : 'dias de atraso'}`;
        return application.daysLeft === 0 ? 'Hoje' : `${application.daysLeft} ${application.daysLeft === 1 ? 'dia' : 'dias'}`;
    }
    function render() {
        if (!el('panel') || state?.currentTab !== 'pulverizacao') return;
        prepare();
        const summary = S.summarize(fields), disabled = loading || saving || !!error || !editable();
        el('status').textContent = error || (loading ? 'Carregando aplicações registradas…' : message || (drafts.size && editable() ? 'Prévia com alterações não salvas. Salve cada talhão para confirmar no banco.' : 'Cronogramas atualizados. As previsões usam a realização anterior quando registrada.'));
        el('status').classList.toggle('is-error', !!error);
        el('reload').disabled = loading || saving;
        if (loading || error) {
            el('summary').innerHTML = '';
            el('next').textContent = loading ? 'Consultando o cronograma…' : 'Cronograma indisponível. Recarregue os dados para tentar novamente.';
            el('overview').innerHTML = '';
            el('scope').textContent = '';
            el('field').disabled = true;
            el('editor').hidden = true;
            return;
        }
        const cards = [['Aplicações previstas', summary.total], ['Concluídas', summary.completed], ['Pendentes', summary.pending], ['Em atenção', summary.attention], ['Atrasadas', summary.overdue], ['Cronograma concluído', summary.percent.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%']];
        el('summary').innerHTML = cards.map(([title, value], index) => `<div class="spray-kpi${index === 3 ? ' attention' : index === 4 ? ' overdue' : ''}"><span>${title}</span><strong>${value}</strong></div>`).join('');
        const next = summary.next;
        el('next').innerHTML = next ? `<strong>Próxima pendência: ${escape(next.short)}</strong><span>${escape(next.field)} · ${escape(next.farm)} · ${date(next.expected)} · ${escape(daysText(next))}</span>` : '<strong>Nenhuma aplicação pendente neste filtro.</strong>';
        el('scope').textContent = `${fields.length} talhões com plantio e data registrados · Safra ${state.currentAno} · ${state.currentCultura}. ${Math.max(0, new Set(features.map(feature => F.key(feature.properties.Fazenda, feature.properties.Campo, state.currentAno, state.currentCultura))).size - fields.length)} talhões sem cronograma por falta de execução ou data de plantio.`;
        el('field').innerHTML = fields.map(field => `<option value="${escape(field.plantingId)}"${field.plantingId === selected ? ' selected' : ''}>${escape(field.field)} · ${escape(field.farm)}</option>`).join('') || '<option value="">Nenhum talhão com plantio registrado</option>';
        el('field').disabled = !fields.length || saving;
        el('overview').innerHTML = fields.length ? `<table class="spray-overview"><caption>Panorama dos talhões · clique no nome para editar o cronograma</caption><thead><tr><th scope="col">Talhão / fazenda</th><th scope="col">Variedade / hectares</th><th scope="col">Plantio</th>${S.steps.map(step => `<th scope="col">${escape(step.short)}</th>`).join('')}</tr></thead><tbody>` + fields.map(field => `<tr${field.plantingId === selected ? ' class="selected"' : ''}><th scope="row"><button type="button" data-spray-field="${escape(field.plantingId)}"${saving ? ' disabled' : ''}>${escape(field.field)}<small>${escape(field.farm)}${drafts.has(field.plantingId) && editable() ? ' · Não salvo' : ''}</small></button></th><td>${escape(field.variety || 'Não informada')}<small>${ha(field.area)}${field.partial ? ' · Plantio parcial' : ''}</small></td><td>${date(field.plantingDate)}</td>` + S.steps.map(step => {
            const application = field.schedule.find(item => item.id === step.id);
            return application ? `<td class="spray-cell ${application.status}"><b>${date(application.actual || application.expected)}</b><small>${application.actual ? 'Realizada' : statusNames[application.status]}</small></td>` : '<td class="spray-cell optional">Opcional</td>';
        }).join('') + '</tr>').join('') + '</tbody></table>' : '<p class="spray-empty">Não há plantio com data registrada neste filtro. Atualize a execução no módulo Plantio para gerar os cronogramas.</p>';
        const field = fields.find(item => item.plantingId === selected);
        el('editor').hidden = !field;
        if (!field) return;
        const value = values(field), ownSummary = S.summarize([field]);
        el('detail-title').textContent = `${field.field} · ${field.farm}`;
        el('detail-meta').textContent = `Plantio: ${date(field.plantingDate)} · ${ha(field.area)} · ${ownSummary.completed}/${ownSummary.total} aplicações concluídas (${Math.round(ownSummary.percent)}%).`;
        el('fourth').checked = value.fourth;
        el('fourth').disabled = disabled;
        el('rows').innerHTML = field.schedule.map(application => `<tr><th scope="row">${escape(application.name)}</th><td>${date(application.expected)}${application.provisional ? '<small>Provisória</small>' : ''}</td><td><input type="date" data-spray-date="${application.id}" aria-label="Data realizada: ${escape(application.name)}" min="${escape(field.plantingDate)}" max="${S.today()}" value="${escape(value.actuals[application.id] || '')}"${disabled ? ' disabled' : ''}></td><td>${escape(daysText(application))}</td><td><span class="spray-status ${application.status}">${statusNames[application.status]}</span></td></tr>`).join('');
        let validation = '';
        try { S.validate(field.plantingDate, value.actuals, value.fourth); } catch (failure) { validation = failure.message; }
        el('validation').textContent = validation;
        el('save').disabled = disabled || !drafts.has(selected) || !!validation;
        el('save').textContent = saving ? 'Salvando…' : 'Salvar aplicações do talhão';
        el('discard').disabled = saving || !drafts.has(selected);
        el('permission').textContent = editable() ? 'Preencha as datas realizadas em sequência. Alterações aparecem na prévia e são confirmadas ao salvar.' : 'Modo de consulta: seu perfil não permite alterar as aplicações.';
    }
    async function load() {
        const ids = sourceFields().map(field => field.plantingId);
        const key = JSON.stringify([state.currentAno, state.currentCultura, ids]);
        if (key === loadedKey) return;
        loadedKey = key; const request = ++generation;
        loading = true; error = ''; message = ''; render();
        try {
            const saved = await repository().list(ids);
            if (request !== generation) return;
            ids.forEach(id => records.delete(id));
            saved.forEach(record => records.set(record.plantingId, record));
        } catch (failure) { if (request === generation) error = failure.message; }
        finally { if (request === generation) { loading = false; render(); } }
    }
    function refresh(nextState, nextFeatures = features) {
        state = nextState; features = nextFeatures;
        const panel = el('panel');
        if (!panel) return;
        const active = state.currentTab === 'pulverizacao';
        panel.hidden = !active;
        if (!active) return;
        if (!panel.dataset.initialized) {
            panel.dataset.initialized = 'true';
            el('field').onchange = event => { selected = event.target.value; message = ''; render(); };
            el('overview').onclick = event => {
                const button = event.target.closest?.('[data-spray-field]');
                if (!button || saving) return;
                selected = button.dataset.sprayField; message = ''; render();
                el('detail-title').focus({ preventScroll: true });
                el('editor').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            };
            panel.onchange = event => {
                if (!editable() || loading || saving || error) return;
                const field = fields.find(item => item.plantingId === selected);
                if (!field || (!event.target.dataset.sprayDate && event.target !== el('fourth'))) return;
                const original = values(field), draft = { ...original, actuals: { ...original.actuals } };
                if (event.target === el('fourth')) draft.fourth = event.target.checked;
                else draft.actuals[event.target.dataset.sprayDate] = event.target.value;
                drafts.set(selected, draft); message = ''; render();
            };
            el('save').onclick = async () => {
                const field = fields.find(item => item.plantingId === selected), draft = drafts.get(selected);
                if (!field || !draft || !editable() || saving || loading || error) return;
                saving = true; message = ''; render();
                try {
                    const saved = await repository().save(draft, field.plantingDate);
                    records.set(field.plantingId, saved); drafts.delete(field.plantingId);
                    message = `Aplicações de ${field.field} salvas e confirmadas no banco.`;
                } catch (failure) { message = failure.message; }
                finally { saving = false; render(); }
            };
            el('discard').onclick = () => { if (saving) return; drafts.delete(selected); message = ''; render(); };
            el('reload').onclick = () => {
                if (loading || saving) return;
                if (drafts.size) { message = 'Salve ou descarte as alterações dos talhões antes de recarregar.'; render(); return; }
                loadedKey = ''; load();
            };
        }
        render(); load();
    }
    root.setInterval?.(() => {
        const current = S.today();
        if (state?.currentTab === 'pulverizacao' && current !== clockDay) { clockDay = current; render(); }
    }, 60000);
    root.SprayView = Object.freeze({ refresh });
})(typeof window !== 'undefined' ? window : globalThis);
