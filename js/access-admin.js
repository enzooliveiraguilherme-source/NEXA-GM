(function () {
    'use strict';
    document.addEventListener('DOMContentLoaded', async () => {
        if (!await window.portalReady || window.portalAccessRole !== 'admin') return;
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'btn-logout'; button.textContent = 'Membros e acessos';
        document.querySelector('.portal-account').append(button);
        const dialog = document.createElement('dialog'); dialog.className = 'access-dialog members-dialog';
        dialog.setAttribute('aria-labelledby', 'members-heading');
        dialog.innerHTML = '<header class="members-header"><div><span class="members-eyebrow">ADMINISTRAÇÃO</span><h2 id="members-heading">Membros</h2><p>Convide pessoas e decida quais fazendas elas podem acessar.</p></div><button type="button" class="members-close">Fechar</button></header><div class="members-toolbar"><label>Pesquisar membros<input type="search" placeholder="Nome ou e-mail" id="members-search"></label><button type="button" id="members-add">Adicionar membro +</button></div><p class="members-status" role="status" aria-live="polite"></p><section class="member-editor" hidden></section><div class="members-table-wrap"><table class="members-table"><thead><tr><th>Nome</th><th>E-mail</th><th>Status</th><th>Cargo</th><th>Fazendas</th><th>Ações</th></tr></thead><tbody></tbody></table></div>';
        document.body.append(dialog);
        const status = dialog.querySelector('.members-status'), editor = dialog.querySelector('.member-editor');
        const list = dialog.querySelector('tbody'), search = dialog.querySelector('#members-search'), add = dialog.querySelector('#members-add');
        const roles = { visualizador: 'Visualizador', projetista: 'Projetista', admin: 'Administrador' };
        let directory = [], members = [], busy = false;
        dialog.querySelector('.members-close').addEventListener('click', () => { if (!busy) dialog.close(); });
        dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
        function render() {
            list.replaceChildren();
            const filter = search.value.trim().toLocaleLowerCase('pt-BR');
            const visible = members.filter(p => ((p.full_name || '') + ' ' + p.email).toLocaleLowerCase('pt-BR').includes(filter));
            for (const person of visible) {
                const row = document.createElement('tr');
                const values = [person.full_name || person.email, person.email,
                    !person.email_confirmed ? 'Aguardando aceite' : person.role === 'admin' || person.all_farms || person.farms.length ? 'Ativo' : 'Sem fazendas liberadas',
                    roles[person.role], person.role === 'admin' || person.all_farms ? 'Todas as fazendas' : person.farms.map(code => directory.find(f => f.code === code)?.name || code).join(', ') || 'Nenhuma'];
                values.forEach((value, i) => {
                    const cell = document.createElement('td'); cell.dataset.label = ['Nome','E-mail','Status','Cargo','Fazendas'][i];
                    if (i === 2) { const badge = document.createElement('span'); badge.className = 'member-badge' + (value === 'Ativo' ? ' is-active' : ''); badge.textContent = value; cell.append(badge); }
                    else cell.textContent = value;
                    row.append(cell);
                });
                const cell = document.createElement('td'); cell.dataset.label = 'Ações';
                const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Editar acesso';
                edit.setAttribute('aria-label', 'Editar acesso de ' + person.email); edit.disabled = busy;
                edit.addEventListener('click', () => showEditor(person)); cell.append(edit); row.append(cell); list.append(row);
            }
            if (!visible.length) { const row = document.createElement('tr'), cell = document.createElement('td'); cell.colSpan = 6;
                cell.textContent = members.length ? 'Nenhum membro encontrado.' : 'Nenhum membro cadastrado.'; row.append(cell); list.append(row); }
        }
        async function load() {
            const [people, farms] = await Promise.all([window.supabaseClient.rpc('admin_list_access'), window.supabaseClient.from('farms').select('code,name,gleba').order('name')]);
            if (people.error || farms.error) throw Error('Não foi possível consultar os membros e as fazendas. Tente novamente.');
            members = people.data; directory = farms.data; render();
        }
        function showEditor(person) {
            if (busy) return;
            editor.replaceChildren(); editor.hidden = false;
            const form = document.createElement('form'); form.className = 'member-form';
            const heading = document.createElement('h3'); heading.textContent = person ? 'Editar permissões' : 'Adicionar membro';
            const help = document.createElement('p'); help.textContent = person ? 'Atualize o cargo e as fazendas liberadas para este membro.' : 'A pessoa receberá um convite por e-mail para criar sua própria senha.';
            function field(title, input) { const label = document.createElement('label'); label.textContent = title; label.append(input); return label; }
            const name = document.createElement('input'); name.autocomplete = 'name'; name.maxLength = 100; name.value = person?.full_name || '';
            const email = document.createElement('input'); email.type = 'email'; email.autocomplete = 'email'; email.required = true; email.maxLength = 254; email.value = person?.email || ''; email.disabled = !!person;
            const role = document.createElement('select'); Object.entries(roles).forEach(([value, label]) => role.add(new Option(label, value))); role.value = person?.role || 'visualizador';
            if (person?.id === window.portalProfile.id) role.disabled = true;
            const all = document.createElement('input'); all.type = 'checkbox'; all.checked = !!person?.all_farms || person?.role === 'admin';
            const allLabel = field('Todas as fazendas', all); allLabel.className = 'member-all-farms';
            const fieldset = document.createElement('fieldset'), legend = document.createElement('legend'); legend.textContent = 'Selecione as fazendas permitidas'; fieldset.append(legend);
            const checks = directory.map(farm => { const input = document.createElement('input'); input.type = 'checkbox'; input.value = farm.code; input.checked = person?.farms.includes(farm.code) || false;
                const label = field(farm.name + ' (' + farm.code + ')' + (farm.gleba ? ' · Gleba ' + farm.gleba : ''), input); label.className = 'member-farm-option'; fieldset.append(label); return input; });
            const scopeHelp = document.createElement('p'); scopeHelp.className = 'member-scope-help';
            function scope() { if (role.value === 'admin') all.checked = true; all.disabled = role.value === 'admin'; fieldset.disabled = all.checked; fieldset.classList.toggle('hidden', all.checked);
                scopeHelp.textContent = role.value === 'admin' ? 'Administradores podem gerenciar membros e acessar todas as fazendas.' : all.checked ? 'Inclui as fazendas atuais e as que forem adicionadas no futuro.' : 'O membro verá apenas as fazendas que você marcar.'; }
            all.addEventListener('change', scope); role.addEventListener('change', scope); scope();
            const actions = document.createElement('div'); actions.className = 'member-actions';
            const save = document.createElement('button'); save.type = 'submit'; save.textContent = person ? 'Salvar permissões' : 'Enviar convite';
            const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancelar'; cancel.addEventListener('click', () => { if (!busy) editor.hidden = true; }); actions.append(save, cancel);
            const message = document.createElement('p'); message.setAttribute('role','status');
            form.append(heading, help); if (!person) form.append(field('Nome (opcional)', name));
            form.append(field('E-mail', email), field('Cargo', role), allLabel, scopeHelp, fieldset, actions, message); editor.append(form);
            (person ? role : email).focus();
            form.addEventListener('submit', async event => {
                event.preventDefault(); if (busy) return;
                const selected = checks.filter(c => c.checked).map(c => c.value);
                if (!all.checked && !selected.length) { message.textContent = 'Selecione ao menos uma fazenda ou marque Todas as fazendas.'; return; }
                const payload = { email: email.value.trim(), name: name.value.trim(), role: role.value, all_farms: all.checked, farms: all.checked ? [] : selected };
                busy = true; save.disabled = cancel.disabled = add.disabled = true; render(); message.textContent = person ? 'Salvando permissões…' : 'Enviando convite…';
                try {
                    if (person) {
                        const { error } = await window.supabaseClient.rpc('admin_set_access', { target: person.id, new_role: payload.role, all_access: payload.all_farms, farm_codes: payload.farms });
                        if (error) throw Error('Não foi possível salvar as permissões. Tente novamente.');
                        status.textContent = 'Permissões salvas. O membro verá as fazendas liberadas no próximo login.';
                    } else {
                        const { data, error } = await window.supabaseClient.functions.invoke('invite-member', { body: payload });
                        if (error) { let detail; try { detail = await error.context?.json(); } catch (_) {} throw Error(detail?.error || 'Não foi possível enviar o convite. Confira sua conexão e tente novamente.'); }
                        if (!data?.invited) throw Error('O convite não foi confirmado pelo serviço de acesso. Tente novamente.');
                        status.textContent = data.message;
                    }
                    editor.hidden = true;
                    try { await load(); } catch (_) { status.textContent += ' Atualize a lista para conferir o resultado.'; }
                } catch (error) { message.textContent = error.message; }
                finally { busy = false; save.disabled = cancel.disabled = add.disabled = false; render(); }
            });
        }
        search.addEventListener('input', render); add.addEventListener('click', () => showEditor());
        button.addEventListener('click', async () => {
            document.getElementById('account-menu')?.close(); dialog.showModal(); editor.hidden = true; search.value = ''; add.disabled = true; list.replaceChildren(); status.textContent = 'Carregando membros…';
            try { await load(); status.textContent = ''; add.disabled = false; } catch (error) { status.textContent = error.message; }
        });
    });
})();
