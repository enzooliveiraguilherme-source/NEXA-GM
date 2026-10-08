(function (root) {
    'use strict';
    root.GeoLegacyImport = {
        prepare(data, features, existing, farm) {
            const farms = Array.isArray(farm) ? farm : [farm];
            const allowed = new Set(features.filter(feature => farms.includes(feature.properties?.Fazenda)).map(feature => `${feature.properties.Fazenda}__${feature.properties.Campo}`));
            const seen = new Set(Object.keys(existing));
            const records = [];
            let skipped = 0;
            for (const source of Object.values(data)) {
                if (!source || !farms.includes(source.fazenda) || !allowed.has(`${source.fazenda}__${source.campo}`)) { skipped++; continue; }
                const record = { ...source, operationType: source.produto === 'Plantio' ? 'plantio' : 'adubacao' };
                const key = root.GeoCloudStore.recordKey(record);
                if (seen.has(key)) { skipped++; continue; }
                // A importação cria um registro novo. Não reutiliza identificadores ou versões locais.
                delete record.id; delete record.version;
                seen.add(key); records.push(record);
            }
            return { records, skipped };
        },
        async restore(state, original, onProgress = () => {}) {
            const preview = this.prepare(original, state.geojsonData.features, state.cloudStore.getRecords(), (root.portalFarms || [root.portalFarm]).map(farm => farm.code));
            let saved = 0;
            for (const type of ['plantio', 'adubacao']) {
                const records = preview.records.filter(record => record.operationType === type);
                for (let offset = 0; offset < records.length; offset += 500) {
                    const batch = records.slice(offset, offset + 500);
                    await state.cloudStore.saveRecords(batch, type);
                    saved += batch.length; onProgress(saved, preview.records.length);
                }
            }
            return saved;
        },
        mount(state, onSaved) {
            if (state.userRole !== 'editor') return;
            const open = document.createElement('button'); open.type = 'button'; open.className = 'btn-logout';
            open.textContent = 'Importar registros deste navegador';
            document.querySelector('.portal-account').append(open);
            const recoveryStatus = document.createElement('p'); recoveryStatus.className = 'legacy-restore-status';
            recoveryStatus.setAttribute('role', 'status');
            document.querySelector('.portal-account').append(recoveryStatus);
            // Recupera o trabalho anterior neste navegador; nunca apaga a cópia local nem substitui registros do banco.
            let original;
            try { original = JSON.parse(localStorage.getItem('geoportal_calcario_records_v1') || '{}'); }
            catch (_) { recoveryStatus.textContent = 'Os registros antigos precisam ser revisados. Use Importar registros deste navegador.'; }
            if (original && this.prepare(original, state.geojsonData.features, state.cloudStore.getRecords(), (root.portalFarms || [root.portalFarm]).map(farm => farm.code)).records.length) {
                open.disabled = true; recoveryStatus.textContent = 'Recuperando os registros anteriores deste navegador…';
                this.restore(state, original, (done, total) => {
                    onSaved(); recoveryStatus.textContent = `Recuperando registros: ${done} de ${total}.`;
                }).then(saved => {
                    recoveryStatus.textContent = `${saved} registros anteriores recuperados e compartilhados. A cópia local foi preservada.`;
                    onSaved();
                }).catch(error => {
                    recoveryStatus.textContent = `Não foi possível recuperar todos os registros: ${error.message} Use Importar registros deste navegador para tentar novamente.`;
                    onSaved();
                }).finally(() => { open.disabled = false; });
            }
            open.addEventListener('click', () => {
                let original;
                try { original = JSON.parse(localStorage.getItem('geoportal_calcario_records_v1') || '{}'); }
                catch (_) { window.alert('Não foi possível ler os registros antigos deste navegador.'); return; }
                const preview = this.prepare(original, state.geojsonData.features, state.cloudStore.getRecords(), (root.portalFarms || [root.portalFarm]).map(farm => farm.code));
                const dialog = document.createElement('dialog'); dialog.className = 'access-dialog';
                const title = document.createElement('h2'); title.textContent = 'Revisar importação';
                const description = document.createElement('p'); description.textContent = `${preview.records.length} registros das fazendas liberadas podem ser importados. ${preview.skipped} foram ignorados por serem de outra fazenda, talhões inválidos ou já existirem no banco. Os dados deste navegador serão preservados.`;
                const list = document.createElement('ul');
                preview.records.forEach(record => { const item = document.createElement('li'); item.textContent = `${record.campo} · ${record.ano} · ${record.cultura} · ${record.produto} · ${record.status}`; list.append(item); });
                const status = document.createElement('p'); status.setAttribute('aria-live','polite');
                const backup = document.createElement('button'); backup.type = 'button'; backup.textContent = 'Baixar cópia dos registros antigos';
                backup.addEventListener('click', () => {
                    const url = URL.createObjectURL(new Blob([JSON.stringify(original,null,2)], {type:'application/json'}));
                    const link = document.createElement('a'); link.href = url; link.download = 'registros-anteriores-geoportal.json'; link.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                });
                const save = document.createElement('button'); save.type = 'button'; save.textContent = 'Salvar estes registros no banco'; save.disabled = !preview.records.length;
                const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Fechar';
                close.addEventListener('click', () => dialog.close());
                dialog.addEventListener('close', () => dialog.remove());
                save.addEventListener('click', async () => {
                    save.disabled = true; close.disabled = true;
                    try {
                        for (const type of ['plantio','adubacao']) {
                            const records = preview.records.filter(record => record.operationType === type);
                            for (let offset=0;offset<records.length;offset+=500) await state.cloudStore.saveRecords(records.slice(offset,offset+500),type);
                        }
                        onSaved(); status.textContent = 'Importação confirmada no banco. A cópia local foi preservada. O histórico anterior permanece na cópia baixada.';
                    } catch (error) {
                        status.textContent = `${error.message} Reabra a revisão para verificar os registros que ainda não foram importados.`;
                        onSaved();
                    } finally { close.disabled = false; }
                });
                dialog.append(title,description,list,backup,save,close,status); document.body.append(dialog); dialog.showModal();
            });
        }
    };
})(typeof window !== 'undefined' ? window : globalThis);
