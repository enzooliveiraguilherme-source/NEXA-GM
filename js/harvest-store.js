(function (root) {
    'use strict';
    const BASE = 'dados/colheita/2026/milho/fe-original/';
    const SLUG = 'fe-milho-2026';
    async function localFile(name, signal) {
        const response = await fetch(BASE + name, { signal });
        if (!response.ok) throw new Error('Arquivo da colheita indisponível.');
        return response.json();
    }
    function validateIndex(index) {
        if (index?.representation !== 'original-points-v1' || index.fazenda !== 'FE' || index.unit !== 'sc/ha' || !Array.isArray(index.records) || !index.records.length || index.records.some(r => !Array.isArray(r.chunks) || !r.chunks.length || r.chunks.some(name => !/^fe-[\d.]+\.json$/.test(name)))) throw new Error('Índice de colheita inválido.');
        return index;
    }
    async function cloudFile(version, name, signal) {
        let query = root.supabaseClient.from('harvest_test_files').select('contents').eq('version_id', version).eq('path', name);
        if (signal) query = query.abortSignal(signal);
        const { data, error } = await query.single();
        if (error) throw new Error('Não foi possível carregar os dados de colheita no Supabase.');
        return data.contents;
    }
    async function load() {
        if (root.portalFarm?.code !== 'FE') throw new Error('Colheita disponível somente na Fazenda Esperança.');
        if (root.supabaseClient) {
            const { data, error } = await root.supabaseClient.from('harvest_test_datasets').select('active_version').eq('slug', SLUG).maybeSingle();
            if (!error && data) {
                const index = await cloudFile(data.active_version, 'index.json');
                if (index.representation === 'original-points-v1') return { index: validateIndex(index), version: data.active_version, source: 'supabase' };
            }
            if (error && !['42P01', 'PGRST205'].includes(error.code)) throw new Error('Não foi possível consultar a base de colheita.');
        }
        throw new Error('A base de colheita ainda não está disponível no banco.');
    }
    async function loadChunk(dataset, name, signal) {
        if (!/^fe-[\d.]+\.json$/.test(name)) throw new Error('Talhão inválido.');
        const payload = await (dataset.source === 'supabase' ? cloudFile(dataset.version, name, signal) : localFile(name, signal));
        if (payload.format !== 'original-float64-v1' || !Number.isInteger(payload.count) || payload.count < 1 || payload.count > 50000 || JSON.stringify(payload.columns) !== JSON.stringify(dataset.index.columns)) throw new Error('Bloco de pontos inválido.');
        const compressed = Uint8Array.from(atob(payload.gzip_base64), char => char.charCodeAt(0));
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
        const buffer = await new Response(stream).arrayBuffer();
        if (buffer.byteLength !== payload.count * payload.columns.length * 8) throw new Error('Bloco de pontos incompleto.');
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), byte => byte.toString(16).padStart(2,'0')).join('');
        if (hash !== payload.sha256) throw new Error('A integridade dos pontos não foi confirmada.');
        return { values: new Float64Array(buffer), count: payload.count, stride: payload.columns.length };
    }
    async function publish(onProgress) {
        if (root.portalAccessRole !== 'admin' || !root.supabaseClient) throw new Error('Apenas administradores podem enviar esta base.');
        const index = validateIndex(await localFile('index.json'));
        const version = crypto.randomUUID();
        const files = ['index.json', ...index.records.flatMap(r => r.chunks)];
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
    root.HarvestStore = Object.freeze({ load, loadChunk, publish });
})(window);
