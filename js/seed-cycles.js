(function (root) {
    'use strict';
    const columns = 'id,variety_name,culture,cycle_days,version,updated_at';
    let rows = [], names = [], available = false, pending = null;
    const normalized = value => root.PlantingForecast.normalize(value).replace(/\s/g, '');
    function validate(input) {
        const name = String(input.variety_name || '').trim().replace(/\s+/g, ' ');
        const culture = String(input.culture || '').trim().replace(/\s+/g, ' ');
        const empty = input.cycle_days === '' || input.cycle_days == null;
        const days = empty ? null : Number(input.cycle_days);
        if (!name || name.length > 80) throw Error('Informe uma variedade com até 80 caracteres.');
        if (!culture || culture.length > 40) throw Error('Informe a cultura com até 40 caracteres.');
        if (!empty && (!Number.isInteger(days) || days < 1 || days > 730)) throw Error('O ciclo deve ter de 1 a 730 dias inteiros, ou ficar em branco.');
        return { variety_name: name, culture, cycle_days: days };
    }
    async function readAll(table, fields) {
        const result = []; let offset = 0;
        while (true) {
            const response = await root.supabaseClient.from(table).select(fields, { count: 'exact' }).order('id').range(offset, offset + 499);
            if (response.error) throw response.error;
            if (!Number.isInteger(response.count)) throw Error('A consulta do catálogo ficou incompleta.');
            const page = response.data || []; result.push(...page);
            if (result.length >= response.count) return result;
            if (!page.length) throw Error('A consulta do catálogo ficou incompleta.');
            offset += page.length;
        }
    }
    async function load() {
        if (pending) return pending;
        pending = (async () => {
            try {
                const [cycles, varieties] = await Promise.all([readAll('seed_variety_cycles', columns), readAll('seed_varieties', 'id,name')]);
                rows = cycles; names = [...new Set([...varieties.map(row => row.name), ...cycles.map(row => row.variety_name)])];
                root.PlantingForecast.configureCycles(rows); available = true;
                root.dispatchEvent(new CustomEvent('geoportal:seed-cycles-changed'));
                return true;
            } catch (error) {
                // Do not revert to hardcoded cycles after an authoritative lookup fails.
                root.PlantingForecast.configureCycles([]); available = false;
                root.dispatchEvent(new CustomEvent('geoportal:seed-cycles-changed'));
                console.warn('Não foi possível consultar os ciclos de variedades.', error);
                return false;
            } finally { pending = null; }
        })();
        return pending;
    }
    async function save(input, existing) {
        if (root.portalAccessRole !== 'admin') throw Error('Somente administradores podem alterar os ciclos.');
        const payload = validate(input);
        let query;
        if (existing?.id) {
            if (!Number.isInteger(existing.version)) throw Error('Recarregue o catálogo antes de editar.');
            query = root.supabaseClient.from('seed_variety_cycles').update(payload).eq('id', existing.id).eq('version', existing.version);
        } else query = root.supabaseClient.from('seed_variety_cycles').insert(payload);
        const { data, error } = await query.select(columns).maybeSingle();
        if (error?.code === '23505') throw Error('Já existe um ciclo desta variedade e cultura. Edite o cadastro existente.');
        if (error) throw Error(error.code === '42501' ? 'Seu perfil não permite alterar os ciclos.' : 'Não foi possível salvar o ciclo. A alteração não foi confirmada.');
        if (!data) throw Error('Este cadastro mudou ou sua permissão foi alterada. Recarregue o catálogo antes de salvar.');
        rows = rows.filter(row => row.id !== data.id).concat(data);
        names = [...new Set([...names, data.variety_name])];
        root.PlantingForecast.configureCycles(rows); available = true;
        root.dispatchEvent(new CustomEvent('geoportal:seed-cycles-changed'));
        return data;
    }
    root.SeedCycleCatalog = Object.freeze({ load, save, validate, get rows() { return rows.map(row => ({ ...row })); },
        get names() { return [...names]; }, get available() { return available; } });
    document.addEventListener('DOMContentLoaded', async () => {
        if (!await root.portalReady || root.portalAccessRole !== 'admin') return;
        const account = document.querySelector('.portal-account'); if (!account) return;
        const button = document.createElement('button'); button.type = 'button'; button.className = 'btn-logout'; button.textContent = 'Variedades e ciclos'; button.id = 'seed-cycles-open'; account.append(button);
        const dialog = document.createElement('dialog'); dialog.className = 'access-dialog members-dialog seed-cycles-dialog'; dialog.setAttribute('aria-labelledby', 'seed-cycles-title');
        dialog.innerHTML = '<header class="members-header"><div><span class="members-eyebrow">ADMINISTRAÇÃO</span><h2 id="seed-cycles-title">Variedades e ciclos</h2><p>Defina os dias após o plantio usados na previsão de colheita.</p></div><button type="button" id="seed-cycles-close" class="members-close">Fechar</button></header><div class="members-toolbar"><label>Pesquisar variedade<input type="search" id="seed-cycles-search" placeholder="Nome ou cultura"></label><button type="button" id="seed-cycles-add">Adicionar variedade</button></div><p id="seed-cycles-status" class="members-status" role="status" aria-live="polite"></p><form id="seed-cycles-form" class="member-form seed-cycles-form" hidden><h3 id="seed-cycles-form-title">Adicionar variedade</h3><label>Nome da variedade<input id="seed-cycles-name" required maxlength="80"></label><label>Cultura<input id="seed-cycles-culture" required maxlength="40" value="Soja" list="seed-cycles-cultures"></label><datalist id="seed-cycles-cultures"><option value="Soja"></option><option value="Milho"></option></datalist><label>Ciclo após o plantio (dias)<input id="seed-cycles-days" type="number" min="1" max="730" step="1" placeholder="Sem ciclo definido"></label><p>Deixe em branco para ficar sem previsão. Ao salvar, o novo ciclo será aplicado aos plantios registrados desta variedade e cultura.</p><div class="member-actions"><button type="submit" id="seed-cycles-save">Salvar ciclo</button><button type="button" id="seed-cycles-cancel">Cancelar</button></div></form><div class="members-table-wrap"><table class="members-table"><thead><tr><th>Variedade</th><th>Cultura</th><th>Ciclo após o plantio</th><th>Ações</th></tr></thead><tbody id="seed-cycles-rows"></tbody></table></div>';
        document.body.append(dialog);
        const $ = id => dialog.querySelector('#' + id);
        let editing = null, busy = false;
        const status = text => { $('seed-cycles-status').textContent = text; };
        function setBusy(value) {
            busy = value;
            dialog.querySelectorAll('button,input').forEach(element => { element.disabled = value; });
            if (!value && editing) { $('seed-cycles-name').disabled = !!editing.id; $('seed-cycles-culture').disabled = !!editing.id; }
        }
        function render() {
            const body = $('seed-cycles-rows'); body.replaceChildren();
            const listed = [...rows];
            for (const name of names) if (!rows.some(row => normalized(row.variety_name) === normalized(name) && normalized(row.culture) === 'SOJA')) listed.push({ variety_name: name, culture: 'Soja', cycle_days: null });
            const seen = new Set(), filter = $('seed-cycles-search').value.trim().toLocaleLowerCase('pt-BR');
            for (const item of listed.sort((a, b) => a.variety_name.localeCompare(b.variety_name, 'pt-BR') || a.culture.localeCompare(b.culture, 'pt-BR'))) {
                const key = JSON.stringify([normalized(item.variety_name), normalized(item.culture)]);
                if (seen.has(key) || !(item.variety_name + ' ' + item.culture).toLocaleLowerCase('pt-BR').includes(filter)) continue;
                seen.add(key); const row = document.createElement('tr');
                [item.variety_name, item.culture, item.cycle_days == null ? 'Não definido' : item.cycle_days + ' dias'].forEach((value, index) => {
                    const cell = document.createElement('td'); cell.dataset.label = ['Variedade', 'Cultura', 'Ciclo'][index]; cell.textContent = value; row.append(cell);
                });
                const actions = document.createElement('td'); actions.dataset.label = 'Ações'; const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = item.id ? 'Editar ciclo' : 'Definir ciclo'; edit.disabled = busy; edit.setAttribute('aria-label', edit.textContent + ' de ' + item.variety_name + ' (' + item.culture + ')');
                edit.addEventListener('click', () => showForm(item)); actions.append(edit); row.append(actions); body.append(row);
            }
            if (!body.children.length) { const row = document.createElement('tr'), cell = document.createElement('td'); cell.colSpan = 4; cell.textContent = 'Nenhuma variedade encontrada.'; row.append(cell); body.append(row); }
        }
        function showForm(item = null) {
            editing = item; $('seed-cycles-form').hidden = false; $('seed-cycles-form-title').textContent = item ? 'Definir ciclo da variedade' : 'Adicionar variedade';
            $('seed-cycles-name').value = item?.variety_name || ''; $('seed-cycles-culture').value = item?.culture || 'Soja'; $('seed-cycles-days').value = item?.cycle_days ?? '';
            $('seed-cycles-name').disabled = !!item?.id; $('seed-cycles-culture').disabled = !!item?.id;
            (item ? $('seed-cycles-days') : $('seed-cycles-name')).focus();
        }
        button.addEventListener('click', async () => {
            document.getElementById('account-menu')?.close(); dialog.showModal(); $('seed-cycles-form').hidden = true; editing = null;
            setBusy(true); status('Carregando variedades e ciclos…');
            const ok = await load(); setBusy(false); render(); status(ok ? '' : 'Não foi possível carregar o catálogo. Feche e tente novamente.');
        });
        $('seed-cycles-close').addEventListener('click', () => { if (!busy) dialog.close(); });
        dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
        $('seed-cycles-add').addEventListener('click', () => showForm());
        $('seed-cycles-search').addEventListener('input', render);
        $('seed-cycles-cancel').addEventListener('click', () => { $('seed-cycles-form').hidden = true; editing = null; });
        $('seed-cycles-form').addEventListener('submit', async event => {
            event.preventDefault(); if (busy) return;
            const input = { variety_name: $('seed-cycles-name').value, culture: $('seed-cycles-culture').value, cycle_days: $('seed-cycles-days').value };
            setBusy(true); status('Salvando ciclo…');
            try { await save(input, editing); $('seed-cycles-form').hidden = true; editing = null; status('Ciclo salvo. A previsão dos mapas foi atualizada.'); }
            catch (error) { status(error.message); }
            finally { setBusy(false); render(); }
        });
    });
})(typeof window !== 'undefined' ? window : globalThis);
