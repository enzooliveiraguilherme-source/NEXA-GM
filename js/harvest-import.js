(function (root) {
    'use strict';
    const MISSING = 'Dados não importados';
    const key = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const hasValue = value => value !== null && value !== undefined && String(value).trim() !== '';
    function field(properties, names) {
        for (const name of names) {
            const match = Object.keys(properties).find(candidate => key(candidate) === key(name) && hasValue(properties[candidate]));
            if (match !== undefined) return properties[match];
        }
        return null;
    }
    function number(value, label) {
        if (!hasValue(value)) return null;
        const result = Number(String(value).trim().replace(',', '.'));
        if (!Number.isFinite(result) || result < 0) throw new Error(`${label}: informe um número não negativo, sem separador de milhar.`);
        return result;
    }
    function date(value, label) {
        if (!hasValue(value)) return null;
        const text = String(value).trim();
        const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
        const iso = match ? `${match[3]}-${match[2]}-${match[1]}` : text;
        const parsed = new Date(`${iso}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) {
            throw new Error(`${label}: use AAAA-MM-DD ou DD/MM/AAAA.`);
        }
        return iso;
    }
    function validateGeometry(geometry) {
        if (geometry?.type === 'Point') {
            const position = geometry.coordinates;
            if (!Array.isArray(position) || position.length < 2 || !position.every(Number.isFinite) || Math.abs(position[0]) > 180 || Math.abs(position[1]) > 90) throw new Error('Coordenadas inválidas. Exporte em WGS 84 (EPSG:4326).');
            return;
        }
        if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) throw new Error('Use pontos ou polígonos (Point, Polygon ou MultiPolygon).');
        const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
        if (!Array.isArray(polygons) || !polygons.length) throw new Error('Geometria vazia.');
        for (const polygon of polygons) {
            if (!Array.isArray(polygon) || !polygon.length) throw new Error('Polígono vazio.');
            for (const ring of polygon) {
                if (!Array.isArray(ring) || ring.length < 4) throw new Error('Contorno de talhão inválido.');
                for (const position of ring) {
                    if (!Array.isArray(position) || position.length < 2 || !position.every(Number.isFinite) || Math.abs(position[0]) > 180 || Math.abs(position[1]) > 90) {
                        throw new Error('Coordenadas inválidas. Exporte em WGS 84 (EPSG:4326), longitude e latitude.');
                    }
                }
                if (JSON.stringify(ring[0]) !== JSON.stringify(ring[ring.length - 1])) throw new Error('O contorno do talhão precisa estar fechado.');
            }
        }
    }
    function normalize(data) {
        if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features) || !data.features.length) throw new Error('Selecione um GeoJSON FeatureCollection com talhões.');
        if (data.crs && !/(4326|CRS84)/i.test(JSON.stringify(data.crs))) throw new Error('Exporte o GeoJSON em WGS 84 (EPSG:4326).');
        return { type: 'FeatureCollection', features: data.features.map((feature, index) => {
            try {
                if (feature?.type !== 'Feature' || !feature.properties || typeof feature.properties !== 'object' || Array.isArray(feature.properties)) throw new Error('Feição sem propriedades.');
                validateGeometry(feature.geometry);
                const p = feature.properties;
                const fazenda = field(p, ['fazenda', 'farm']);
                const campo = field(p, ['campo', 'talhao', 'talhao_id']);
                if (!hasValue(fazenda) || !hasValue(campo)) throw new Error('Os campos Fazenda e Campo (ou talhao) são necessários.');
                const culture = field(p, ['cultura', 'crop']);
                const year = field(p, ['ano', 'ano_referencia']);
                if (hasValue(culture) && key(culture) !== 'milho') throw new Error('Este teste aceita apenas cultura Milho.');
                if (hasValue(year) && String(year).trim() !== '2026') throw new Error('Este teste aceita apenas ano 2026.');
                const inicio = date(field(p, ['data_inicio', 'inicio_colheita', 'data_inicio_colheita']), 'Início da colheita');
                const fim = date(field(p, ['data_fim', 'fim_colheita', 'final_colheita', 'data_fim_colheita']), 'Fim da colheita');
                if (inicio && fim && fim < inicio) throw new Error('Fim da colheita anterior ao início.');
                return { ...feature, properties: { ...p,
                    Fazenda: String(fazenda).trim(), Campo: String(campo).trim(),
                    Gleba: hasValue(field(p, ['gleba'])) ? String(field(p, ['gleba'])).trim() : null,
                    Area: number(field(p, ['area_colhida_ha', 'area_ha', 'area']), 'Área'),
                    Variedade: field(p, ['variedade', 'variedade_semente', 'cultivar']),
                    ano: '2026', cultura: 'Milho', safra: field(p, ['safra']),
                    data_inicio: inicio, data_fim: fim,
                    produtividade: number(field(p, ['produtividade_kg_ha', 'produtividade_sc_ha', 'produtividade', 'media_real']), 'Produtividade'),
                    unidade_produtividade: field(p, ['unidade_produtividade', 'unidade']) ||
                        (hasValue(field(p, ['produtividade_kg_ha'])) ? 'kg/ha' : hasValue(field(p, ['produtividade_sc_ha'])) ? 'sc/ha' : null)
                }};
            } catch (error) { throw new Error(`Feição ${index + 1}: ${error.message}`); }
        }) };
    }
    function display(value) { return hasValue(value) ? String(value) : MISSING; }
    function displayNumber(value, unit) {
        if (!hasValue(value)) return MISSING;
        return `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}${hasValue(unit) ? ` ${unit}` : ' (unidade não importada)'}`;
    }
    root.HarvestImport = Object.freeze({ normalize, display, displayNumber, MISSING });
})(typeof window !== 'undefined' ? window : globalThis);
