(function (root) {
    'use strict';
    const BASE = 'dados/colheita/2026/milho/fe/';
    const SLUG = 'fe-milho-2026';
    async function localFile(name) {
        const response = await fetch(BASE + name);
        if (!response.ok) throw new Error('Arquivo da colheita indisponível.');
        return response.json();
    }
    function validateIndex(index) {
        if (index?.fazenda !== 'FE' || index.unit !== 'sc/ha' || !Array.isArray(index.records) || !index.records.length || index.records.some(r => !/^fe-[\d.]+\.geojson$/.test(r.file))) throw new Error('Índice de colheita inválido.');
        return index;
    }
    async function cloudFile(version, name) {
        const { data, error } = await root.supabaseClient.from('harvest_test_files').select('contents').eq('version_id', version).eq('path', name).single();
        if (error) throw new Error('Não foi possível carregar os dados de colheita no Supabase.');
        return data.contents;
    }
    async function load() {
        if (root.supabaseClient) {
            const { data, error } = await root.supabaseClient.from('harvest_test_datasets').select('active_version').eq('slug', SLUG).maybeSingle();
            if (!error && data) return { index: validateIndex(await cloudFile(data.active_version, 'index.json')), version: data.active_version, source: 'supabase' };
            if (error && !['42P01', 'PGRST205'].includes(error.code)) throw new Error('Não foi possível consultar a base de colheita.');
        }
        return { index: validateIndex(await localFile('index.json')), version: null, source: 'site' };
    }
    function loadField(dataset, name) {
        if (!/^fe-[\d.]+\.geojson$/.test(name)) throw new Error('Talhão inválido.');
        return dataset.source === 'supabase' ? cloudFile(dataset.version, name) : localFile(name);
    }
    async function publish(onProgress) {
        if (root.portalAccessRole !== 'admin' || !root.supabaseClient) throw new Error('Apenas administradores podem enviar esta base.');
        const index = validateIndex(await localFile('index.json'));
        const version = crypto.randomUUID();
        const files = ['index.json', ...index.records.map(r => r.file)];
        for (let i = 0; i < files.length; i++) {
            const contents = i === 0 ? index : await localFile(files[i]);
            const { error } = await root.supabaseClient.from('harvest_test_files').insert({ version_id: version, path: files[i], contents });
            if (error) throw new Error(['42P01', 'PGRST205'].includes(error.code) ? 'A estrutura de colheita precisa ser criada no Supabase antes do envio.' : 'Falha no envio. A base anterior continua ativa.');
            onProgress(i + 1, files.length);
        }
        const { error } = await root.supabaseClient.from('harvest_test_datasets').upsert({ slug: SLUG, active_version: version });
        if (error) throw new Error('O envio não foi ativado. A base anterior continua disponível.');
        return version;
    }
    root.HarvestStore = Object.freeze({ load, loadField, publish });
})(window);
