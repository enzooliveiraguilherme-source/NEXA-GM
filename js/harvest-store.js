(function (root) {
    'use strict';
    const BASE = 'dados/colheita/2026/milho/fe-original/';
    const SLUG = 'fe-milho-2026';
    const BUCKET = 'harvest-kriged';
    const COLUMNS = ['longitude','latitude','prod_corig','No','X','Y','Predicted','SE_Pred'];
    const allowedFarms = () => (root.portalFarms || [root.portalFarm]).map(farm=>farm?.code).filter(Boolean);
    const fieldKey = (farm,campo) => JSON.stringify([farm,campo]);
    function checkStorageDataset(row) {
        const manifest=row.manifest, index=manifest?.index;
        if (!allowedFarms().includes(row.farm_code) || manifest.farm!==row.farm_code || manifest.version!==row.id ||
            !/^[a-f0-9-]{36}$/.test(row.id) || !/^[A-Z0-9]+$/.test(row.gleba) ||
            index?.representation!=='original-points-v1' || index.fazenda!==row.farm_code || index.ano!==2026 ||
            index.cultura!=='Milho' || index.unit!=='sc/ha' || JSON.stringify(index.columns)!==JSON.stringify(COLUMNS) ||
            !Array.isArray(index.records) || !index.records.length || !Array.isArray(manifest.files) ||
            index.records.some(record=>record.fazenda!==row.farm_code || !Array.isArray(record.chunks) || !record.chunks.length ||
                record.chunks.some(name=>!/^original\/[a-z0-9.-]+\.bin\.gz$/.test(name))) ||
            (index.features||[]).some(feature=>feature.properties?.Fazenda!==row.farm_code)) {
            throw new Error('Base de colheita inválida ou fora das fazendas autorizadas.');
        }
        return {version:row.id,farm:row.farm_code,source:'storage',prefix:`${row.gleba}/${row.farm_code}/${row.id}/`,
            index,rasters:manifest.rasters,files:manifest.files};
    }
    async function storageBuffer(dataset,name,kind,signal) {
        if(!allowedFarms().includes(dataset.farm) || dataset.source!=='storage' || signal?.aborted) throw new Error('Colheita indisponível para este acesso.');
        const file=dataset.files.find(file=>file.path===name && file.kind===kind);
        if(!file || !/^(original|raster)\/[a-z0-9.-]+\.bin\.gz$/.test(name)) throw new Error('Arquivo de colheita inválido.');
        const {data,error}=await root.supabaseClient.storage.from(BUCKET).download(dataset.prefix+name);
        if(error||!data)throw new Error('Não foi possível carregar a colheita.');
        if(signal?.aborted)throw new Error('Consulta de colheita cancelada.');
        const buffer=await new Response(data.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
        const expected=kind==='original'?file.count*COLUMNS.length*8:file.width*file.height*8;
        if(buffer.byteLength!==expected)throw new Error('Arquivo de colheita incompleto.');
        const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),b=>b.toString(16).padStart(2,'0')).join('');
        if(hash!==file.sha256)throw new Error('A integridade da colheita não foi confirmada.');
        return {buffer,file};
    }
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
        if(!root.supabaseClient)throw new Error('A conexão autenticada está indisponível.');
        const datasets=[];
        if (allowedFarms().includes('FE')) {
            const { data, error } = await root.supabaseClient.from('harvest_test_datasets').select('active_version').eq('slug', SLUG).maybeSingle();
            if (!error && data) {
                const index = await cloudFile(data.active_version, 'index.json');
                if (index.representation === 'original-points-v1') datasets.push({ index: validateIndex(index), version: data.active_version, farm:'FE', source: 'supabase' });
            }
            if (error && !['42P01', 'PGRST205'].includes(error.code)) throw new Error('Não foi possível consultar a base de colheita.');
        }
        const {data:rows,error}=await root.supabaseClient.from('harvest_farm_datasets').select('farm_code,active_version')
            .in('farm_code',allowedFarms()).eq('ano',2026).eq('cultura','Milho');
        if(error&&!['42P01','PGRST205'].includes(error.code))throw new Error('Não foi possível consultar as colheitas.');
        if(rows?.length){
            const {data:versions,error:versionError}=await root.supabaseClient.from('harvest_farm_versions')
                .select('id,farm_code,gleba,manifest').in('id',rows.map(row=>row.active_version)).eq('ready',true);
            if(versionError||versions?.length!==rows.length)throw new Error('A consulta das colheitas ficou incompleta.');
            for(const row of versions){
                if(!rows.some(dataset=>dataset.farm_code===row.farm_code && dataset.active_version===row.id))throw new Error('Versão de colheita inesperada.');
                datasets.push(checkStorageDataset(row));
            }
        }
        if(!datasets.length)throw new Error('Dados de colheita não importados para estas fazendas.');
        const records=datasets.flatMap(dataset=>dataset.index.records.map(record=>({...record,dataset})));
        const bounds=[Math.min(...datasets.map(d=>d.index.bounds[0])),Math.min(...datasets.map(d=>d.index.bounds[1])),
            Math.max(...datasets.map(d=>d.index.bounds[2])),Math.max(...datasets.map(d=>d.index.bounds[3]))];
        return {source:'mixed',version:datasets.map(d=>d.version).join(':'),datasets,index:{records,bounds,ano:2026,cultura:'Milho',unit:'sc/ha'}};
    }
    async function loadChunk(dataset, name, signal) {
        if(dataset.source==='storage'){
            const {buffer,file}=await storageBuffer(dataset,name,'original',signal);
            return {values:new Float64Array(buffer),count:file.count,stride:COLUMNS.length};
        }
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
    async function loadRaster(dataset, name, signal) {
        if(dataset.source==='storage'){
            if(!allowedFarms().includes(dataset.farm))throw new Error('Colheita fora do acesso autorizado.');
            if(name==='index.json')return dataset.rasters;
            const {buffer,file}=await storageBuffer(dataset,name,'raster',signal);
            return {format:'harvest-values-f64-v1',width:file.width,height:file.height,buffer};
        }
        if (!(root.portalFarms || [root.portalFarm]).some(farm => farm?.code === 'FE') || dataset?.source !== 'supabase' ||
            !/^(index\.json|fe-[\d.]+-[0-5]\.json)$/.test(name)) throw new Error('Resolução de colheita inválida.');
        let query = root.supabaseClient.from('harvest_raster_files').select('contents').eq('version_id', dataset.version).eq('path', name);
        if (signal) query = query.abortSignal(signal);
        const { data, error } = await query.single();
        if (error || !data) throw new Error('Não foi possível carregar a resolução da colheita no banco.');
        return data.contents;
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
    root.HarvestStore = Object.freeze({ load, loadChunk, loadRaster, publish, fieldKey });
})(window);
