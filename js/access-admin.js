(function () {
    'use strict';
    document.addEventListener('DOMContentLoaded', async () => {
        if (!await window.portalReady || window.portalAccessRole !== 'admin') return;
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'btn-logout'; button.textContent = 'Gerenciar acessos';
        document.querySelector('.portal-account').append(button);
        const dialog = document.createElement('dialog');
        dialog.className = 'access-dialog';
        const heading = document.createElement('h2'); heading.textContent = 'Acessos às fazendas';
        const help = document.createElement('p'); help.textContent = 'Libere as fazendas de cada colaborador. Contas sem fazendas liberadas aguardam sua aprovação.';
        const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Fechar';
        close.addEventListener('click', () => dialog.close());
        const status = document.createElement('p'); status.setAttribute('aria-live', 'polite');
        const list = document.createElement('div');
        dialog.append(heading, help, close, status, list); document.body.append(dialog);
        button.addEventListener('click', async () => {
            dialog.showModal(); list.replaceChildren(); status.textContent = 'Carregando colaboradores…';
            const [people, directory] = await Promise.all([
                window.supabaseClient.rpc('admin_list_access'),
                window.supabaseClient.from('farms').select('code,name').order('name')
            ]);
            if (people.error || directory.error) { status.textContent = 'Não foi possível consultar os acessos.'; return; }
            status.textContent = '';
            for (const person of people.data) {
                const form = document.createElement('form'); form.className = 'access-person';
                const title = document.createElement('h3'); title.textContent = person.full_name || person.email;
                const detail = document.createElement('p'); detail.textContent = `${person.email} · ${person.email_confirmed ? 'E-mail confirmado' : 'Aguardando confirmação do e-mail'}${person.requested_farm ? ` · Fazenda solicitada: ${person.requested_farm}` : ''}`;
                const roleLabel = document.createElement('label'); roleLabel.textContent = 'Permissão: ';
                const role = document.createElement('select');
                for (const [value, label] of [['visualizador','Somente visualizar'], ['projetista','Visualizar e editar'], ['admin','Administrador de todas as fazendas']]) role.add(new Option(label, value));
                role.value = person.role; roleLabel.append(role);
                const allLabel = document.createElement('label'); const all = document.createElement('input');
                all.type = 'checkbox'; all.checked = person.all_farms; allLabel.append(all, ' Acesso a todas as fazendas');
                const fieldset = document.createElement('fieldset'); const legend = document.createElement('legend'); legend.textContent = 'Fazendas liberadas'; fieldset.append(legend);
                const checkboxes = [];
                for (const farm of directory.data) {
                    const label = document.createElement('label'); const check = document.createElement('input');
                    check.type = 'checkbox'; check.value = farm.code; check.checked = person.farms.includes(farm.code);
                    checkboxes.push(check); label.append(check, ` ${farm.name} (${farm.code})`); fieldset.append(label);
                }
                const save = document.createElement('button'); save.type = 'submit'; save.textContent = 'Salvar acesso';
                const message = document.createElement('p'); message.setAttribute('aria-live', 'polite');
                form.append(title, detail, roleLabel, allLabel, fieldset, save, message);
                form.addEventListener('submit', async event => {
                    event.preventDefault(); save.disabled = true; message.textContent = 'Salvando…';
                    try {
                        const { error } = await window.supabaseClient.rpc('admin_set_access', { target: person.id, new_role: role.value,
                            all_access: all.checked, farm_codes: checkboxes.filter(check => check.checked).map(check => check.value) });
                        message.textContent = error ? 'Não foi possível salvar. Confira as permissões e tente novamente.' : 'Acesso salvo. O colaborador verá as fazendas liberadas no próximo login.';
                    } catch (_) { message.textContent = 'Não foi possível conectar ao banco.'; }
                    finally { save.disabled = false; }
                });
                list.append(form);
            }
        });
    });
})();
