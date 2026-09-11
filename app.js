/**
 * Geoportal Profissional - Grupo Michels
 * Módulo: Acompanhamento da Aplicação de Calcário (Adubação)
 */

// ==========================================================================
// ESTADO GLOBAL DA APLICAÇÃO
// ==========================================================================
const state = {
    map: null,
    geojsonData: null,
    geojsonLayer: null,
    basemapLayers: {},
    
    // Navegação
    currentTab: 'adubacao',
    currentSubTab: 'calcario',
    
    // Filtros
    currentFazenda: 'FE',
    currentAno: '2026',
    currentCultura: 'Soja',
    currentProduto: 'Calcário PRNT 80',
    
    // Perfil / Permissão ('editor' | 'viewer')
    userRole: 'editor',
    currentUser: 'Enzo Oliveira',
    
    // Configurações Dinâmicas (Persistidas)
    anos: ['2026', '2027'],
    culturas: ['Soja', 'Milho'],
    produtos: [
        'Calcário PRNT 80',
        'Calcário 2026',
        'Calcário Dolomítico 75',
        'Produto ABC 90'
    ],
    
    // Talhão atualmente selecionado para edição
    selectedFeature: null,
    selectedTalhaoRecord: null,

    // Modo Operacional ('aplicacao' | 'planejamento')
    operationalMode: 'aplicacao'
};

// Cores Oficiais de Status (RGB Especificado)
const STATUS_COLORS = {
    concluido: {
        fillColor: 'rgb(6, 178, 0)',       // #06B200
        label: 'Concluído'
    },
    em_andamento: {
        fillColor: 'rgb(255, 165, 0)',   // #FFA500
        label: 'Em Andamento'
    },
    nao_iniciado: {
        fillColor: 'rgb(227, 26, 28)',   // #E31A1C
        label: 'Não Iniciado'
    }
};

// ==========================================================================
// INICIALIZAÇÃO DO SISTEMA
// ==========================================================================
document.addEventListener('DOMContentLoaded', async () => {
    const authenticated = await (window.portalReady || Promise.resolve(true));
    if (!authenticated) return;
    const accessRole = window.portalAccessRole;
    state.userRole = accessRole === 'visualizador' ? 'viewer' : 'editor';
    state.currentUser = window.portalProfile?.full_name || window.portalUser?.email || 'Usuário';
    loadListsFromStorage();
    initMap();
    setupEventListeners();
    AdubacaoModal.init();
    updateRoleUI();
    loadData();
});

// Inicialização do Mapa Leaflet
function initMap() {
    state.map = L.map('map', {
        zoomControl: false,
        attributionControl: false
    }).setView([-10.35, -52.25], 11);
    
    L.control.zoom({ position: 'topright' }).addTo(state.map);

    // Definição dos mapas base
    state.basemapLayers = {
        esri: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri',
            maxZoom: 19
        }),
        blank: L.layerGroup()
    };

    state.basemapLayers.esri.addTo(state.map);
}

// ==========================================================================
// PERSISTÊNCIA & MODELO DE DADOS (LOCALSTORAGE)
// ==========================================================================
const STORAGE_KEYS = {
    RECORDS: 'geoportal_calcario_records_v1',
    PRODUTOS: 'geoportal_calcario_produtos_v1',
    ANOS: 'geoportal_calcario_anos_v1',
    CULTURAS: 'geoportal_calcario_culturas_v1',
    ROLE: 'geoportal_calcario_role_v1',
    PLANNING: 'geoportal_calcario_planning_v1'
};

// ==========================================================================
// GERENCIADOR DE PLANEJAMENTO DE TALHÕES POR PRODUTO
// ==========================================================================
const PlanningManager = {
    getAllPlanning() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.PLANNING);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    },

    saveAllPlanning(data) {
        try {
            localStorage.setItem(STORAGE_KEYS.PLANNING, JSON.stringify(data));
        } catch (e) {
            console.error('Erro ao salvar planejamento no LocalStorage:', e);
        }
    },

    getKey(fazenda, ano, cultura, produto) {
        const f = (fazenda && fazenda !== 'ALL' ? fazenda : state.currentFazenda).trim().toUpperCase();
        const a = (ano || state.currentAno).trim();
        const c = (cultura || state.currentCultura).trim().toUpperCase();
        const p = (produto || state.currentProduto).trim().toUpperCase();
        return `${f}__${a}__${c}__${p}`;
    },

    getPlannedFields(fazenda, ano, cultura, produto) {
        const all = this.getAllPlanning();
        const key = this.getKey(fazenda, ano, cultura, produto);
        if (all && Array.isArray(all[key])) {
            return all[key];
        }
        
        // Se ainda não tem planejamento customizado para este produto, inclui inicialmente todos os talhões da fazenda
        if (state.geojsonData) {
            const currentF = (fazenda && fazenda !== 'ALL') ? fazenda : state.currentFazenda;
            const fMatch = (currentF === 'ALL') ? () => true : (f) => f.properties && f.properties.Fazenda === currentF;
            const defaultList = state.geojsonData.features
                .filter(fMatch)
                .map(f => f.properties.Campo);
            return defaultList;
        }
        return [];
    },

    setPlannedFields(fazenda, ano, cultura, produto, fieldList) {
        let all = this.getAllPlanning();
        const key = this.getKey(fazenda, ano, cultura, produto);
        all[key] = fieldList;
        this.saveAllPlanning(all);
    },

    isTalhaoPlanned(fazenda, campo, ano, cultura, produto) {
        const planned = this.getPlannedFields(fazenda, ano, cultura, produto);
        return planned.includes(campo);
    },

    toggleTalhao(fazenda, campo, ano, cultura, produto) {
        let planned = [...this.getPlannedFields(fazenda, ano, cultura, produto)];
        const idx = planned.indexOf(campo);
        if (idx >= 0) {
            planned.splice(idx, 1);
        } else {
            planned.push(campo);
        }
        this.setPlannedFields(fazenda, ano, cultura, produto, planned);
        return planned.includes(campo);
    },

    selectAll(fazenda, ano, cultura, produto) {
        if (!state.geojsonData) return;
        const currentF = (fazenda && fazenda !== 'ALL') ? fazenda : state.currentFazenda;
        const fMatch = (currentF === 'ALL') ? () => true : (f) => f.properties && f.properties.Fazenda === currentF;
        const allFields = state.geojsonData.features
            .filter(fMatch)
            .map(f => f.properties.Campo);
        this.setPlannedFields(fazenda, ano, cultura, produto, allFields);
    },

    clearAll(fazenda, ano, cultura, produto) {
        this.setPlannedFields(fazenda, ano, cultura, produto, []);
    }
};

function loadListsFromStorage() {
    try {
        const storedProds = localStorage.getItem(STORAGE_KEYS.PRODUTOS);
        if (storedProds) state.produtos = JSON.parse(storedProds);

        const storedAnos = localStorage.getItem(STORAGE_KEYS.ANOS);
        if (storedAnos) state.anos = JSON.parse(storedAnos);

        const storedCulturas = localStorage.getItem(STORAGE_KEYS.CULTURAS);
        if (storedCulturas) state.culturas = JSON.parse(storedCulturas);

        // O perfil vem do Supabase. O navegador não é fonte de permissão.
    } catch (e) {
        console.warn('Aviso ao carregar dados do LocalStorage:', e);
        state.userRole = 'editor';
    }
}

function saveListsToStorage() {
    try {
        localStorage.setItem(STORAGE_KEYS.PRODUTOS, JSON.stringify(state.produtos));
        localStorage.setItem(STORAGE_KEYS.ANOS, JSON.stringify(state.anos));
        localStorage.setItem(STORAGE_KEYS.CULTURAS, JSON.stringify(state.culturas));
        localStorage.setItem(STORAGE_KEYS.ROLE, state.userRole);
    } catch (e) {
        console.error('Erro ao salvar no LocalStorage:', e);
    }
}

// Chave única para persistência por talhão + safra + cultura + produto
function getRecordKey(fazenda, campo, ano, cultura, produto) {
    const f = (fazenda || 'SEM_FAZENDA').trim().toUpperCase();
    const c = (campo || 'SEM_CAMPO').trim().toUpperCase();
    const a = (ano || state.currentAno).trim();
    const cu = (cultura || state.currentCultura).trim().toUpperCase();
    const p = (produto || state.currentProduto).trim().toUpperCase();
    return `${f}__${c}__${a}__${cu}__${p}`;
}

function getAllRecords() {
    try {
        const raw = localStorage.getItem(STORAGE_KEYS.RECORDS);
        return raw ? JSON.parse(raw) : {};
    } catch (e) {
        return {};
    }
}

function getTalhaoRecord(fazenda, campo, ano, cultura, produto, areaTotal = 0) {
    const records = getAllRecords();
    const key = getRecordKey(fazenda, campo, ano, cultura, produto);
    
    if (records[key]) {
        return records[key];
    }
    
    return {
        fazenda: fazenda,
        campo: campo,
        ano: ano,
        cultura: cultura,
        produto: produto,
        status: 'nao_iniciado',
        areaTotal: parseFloat(areaTotal) || 0,
        areaRealizada: 0,
        percentualRealizado: 0,
        taxaAplicada: null,
        tipoProgresso: 'percentual',
        usuario: 'Sistema',
        ultimaAlteracao: new Date().toISOString(),
        historico: []
    };
}

function saveTalhaoRecord(record) {
    const records = getAllRecords();
    const key = getRecordKey(record.fazenda, record.campo, record.ano, record.cultura, record.produto);
    records[key] = record;
    try {
        localStorage.setItem(STORAGE_KEYS.RECORDS, JSON.stringify(records));
    } catch (e) {
        console.error('Erro ao salvar registro de talhão:', e);
    }
}

// Semeia dados demonstrativos realistas caso não haja registros para a fazenda FE
function seedSampleDataIfEmpty() {
    const records = getAllRecords();
    const sampleKey = getRecordKey('FE', 'FE 02', '2026', 'Soja', 'Calcário PRNT 80');
    
    if (!records[sampleKey] && state.geojsonData) {
        const feFeatures = state.geojsonData.features.filter(f => f.properties && f.properties.Fazenda === 'FE');
        
        feFeatures.forEach((f, idx) => {
            const campo = f.properties.Campo;
            const area = parseFloat(f.properties.Area) || 100;
            let status = 'nao_iniciado';
            let taxa = null;
            let areaReal = 0;
            let pctReal = 0;
            let tipoProgresso = 'percentual';
            
            if (idx % 3 === 0) {
                status = 'concluido';
                taxa = 2.50;
                areaReal = area;
                pctReal = 100;
            } else if (idx % 3 === 1) {
                status = 'em_andamento';
                pctReal = 60;
                areaReal = parseFloat((area * 0.6).toFixed(2));
                tipoProgresso = 'percentual';
            }
            
            const rec = {
                fazenda: 'FE',
                campo: campo,
                ano: '2026',
                cultura: 'Soja',
                produto: 'Calcário PRNT 80',
                status: status,
                areaTotal: area,
                areaRealizada: areaReal,
                percentualRealizado: pctReal,
                taxaAplicada: taxa,
                tipoProgresso: tipoProgresso,
                usuario: 'Operador Inicial',
                ultimaAlteracao: new Date(Date.now() - (idx * 86400000)).toISOString(),
                historico: [
                    {
                        data: new Date(Date.now() - (idx * 86400000)).toLocaleString('pt-BR'),
                        usuario: 'Enzo Oliveira',
                        status: status === 'concluido' ? 'Concluído' : (status === 'em_andamento' ? 'Em Andamento' : 'Não Iniciado'),
                        detalhe: status === 'concluido' ? `Taxa: ${taxa} t/ha` : (status === 'em_andamento' ? `${pctReal}% (${areaReal} ha)` : 'Inicializado')
                    }
                ]
            };
            
            const key = getRecordKey('FE', campo, '2026', 'Soja', 'Calcário PRNT 80');
            records[key] = rec;
        });
        
        localStorage.setItem(STORAGE_KEYS.RECORDS, JSON.stringify(records));
    }
}

// ==========================================================================
// CONTROLE DE PERMISSÕES (EDITOR VS VISUALIZADOR)
// ==========================================================================
function updateRoleUI() {
    const isViewer = (state.userRole === 'viewer');
    
    const btnEditor = document.getElementById('role-editor-btn');
    const btnViewer = document.getElementById('role-viewer-btn');
    if (btnEditor) btnEditor.classList.toggle('active', !isViewer);
    if (btnViewer) btnViewer.classList.toggle('active', isViewer);

    const btnAddAno = document.getElementById('btn-add-ano');
    const btnAddCultura = document.getElementById('btn-add-cultura');
    const btnAddProduto = document.getElementById('btn-add-produto');
    
    if (btnAddAno) btnAddAno.classList.toggle('hidden', isViewer);
    if (btnAddCultura) btnAddCultura.classList.toggle('hidden', isViewer);
    if (btnAddProduto) btnAddProduto.classList.toggle('hidden', isViewer);

    const modalBackdrop = document.getElementById('adubacao-modal-backdrop');
    if (modalBackdrop && !modalBackdrop.classList.contains('hidden') && state.selectedFeature) {
        AdubacaoModal.open(state.selectedFeature);
    }
}

// ==========================================================================
// CARREGAMENTO DOS DADOS GEOJSON
// ==========================================================================
async function loadData() {
    try {
        const response = await fetch('Talhoes.geojson');
        if (!response.ok) throw new Error('Falha ao carregar o arquivo GeoJSON');
        
        state.geojsonData = await response.json();
        
        populateFazendaFilter(state.geojsonData);
        populateDropdowns();
        seedSampleDataIfEmpty();
        renderMap(true);
        
        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.classList.add('hidden');
        
    } catch (error) {
        console.error('Erro ao carregar dados espaciais:', error);
        const overlayText = document.querySelector('.loading-overlay p');
        if (overlayText) overlayText.textContent = 'Erro ao carregar os dados. Verifique o console.';
        const spinner = document.querySelector('.spinner');
        if (spinner) spinner.style.display = 'none';
    }
}

// ==========================================================================
// POPULAÇÃO DE FILTROS & DROPDOWNS
// ==========================================================================
function populateFazendaFilter(data) {
    const fazendas = new Set();
    data.features.forEach(feature => {
        if (feature.properties && feature.properties.Fazenda) {
            fazendas.add(feature.properties.Fazenda);
        }
    });
    
    const select = document.getElementById('fazenda-filter');
    if (!select) return;
    
    select.innerHTML = '<option value="ALL">Todas as Fazendas</option>';
    
    const sorted = Array.from(fazendas).sort();
    sorted.forEach(fazenda => {
        const option = document.createElement('option');
        option.value = fazenda;
        option.textContent = fazenda === 'FE2' ? 'Esperança 2 (FE2)' : `Fazenda ${fazenda}`;
        select.appendChild(option);
    });
    
    if (fazendas.has('FE')) {
        select.value = 'FE';
        state.currentFazenda = 'FE';
    }
}

function populateDropdowns() {
    // Anos
    const selectAno = document.getElementById('filter-ano');
    if (selectAno) {
        selectAno.innerHTML = '';
        state.anos.forEach(ano => {
            const opt = document.createElement('option');
            opt.value = ano;
            opt.textContent = ano;
            selectAno.appendChild(opt);
        });
        selectAno.value = state.currentAno;
    }

    // Culturas
    const selectCultura = document.getElementById('filter-cultura');
    if (selectCultura) {
        selectCultura.innerHTML = '';
        state.culturas.forEach(cultura => {
            const opt = document.createElement('option');
            opt.value = cultura;
            opt.textContent = cultura;
            selectCultura.appendChild(opt);
        });
        selectCultura.value = state.currentCultura;
    }

    // Produtos
    const selectProduto = document.getElementById('filter-produto');
    if (selectProduto) {
        selectProduto.innerHTML = '';
        state.produtos.forEach(prod => {
            const opt = document.createElement('option');
            opt.value = prod;
            opt.textContent = prod;
            selectProduto.appendChild(opt);
        });
        selectProduto.value = state.currentProduto;
    }

    updateFilterTag();
}

function updateFilterTag() {
    const fazendaLabel = state.currentFazenda === 'ALL' ? 'Todas' : state.currentFazenda;
    const tagFaz = document.getElementById('tag-fazenda');
    const tagAno = document.getElementById('tag-ano');
    const tagCul = document.getElementById('tag-cultura');
    const tagPro = document.getElementById('tag-produto');
    const dashFaz = document.getElementById('dash-fazenda-name');

    if (tagFaz) tagFaz.textContent = fazendaLabel;
    if (tagAno) tagAno.textContent = state.currentAno;
    if (tagCul) tagCul.textContent = state.currentCultura;
    if (tagPro) tagPro.textContent = state.currentProduto;
    if (dashFaz) dashFaz.textContent = `Fazenda: ${fazendaLabel}`;
}

// ==========================================================================
// CONFIGURAÇÃO VISUAL DAS OPERAÇÕES
// ==========================================================================
const OPERACOES_CONFIG = {
    colheita: {
        name: 'Colheita',
        icon: 'fa-solid fa-wheat-awn',
        color: '#f59e0b',
        fillColor: '#d97706',
        borderColor: '#b45309'
    },
    savefarm: {
        name: 'Save Farm',
        icon: 'fa-solid fa-leaf',
        color: '#3b82f6',
        fillColor: '#2563eb',
        borderColor: '#1d4ed8'
    },
    adubacao: {
        name: 'Adubação',
        icon: 'fa-solid fa-seedling',
        color: '#10b981',
        fillColor: '#059669',
        borderColor: '#047857'
    },
    pulverizacao: {
        name: 'Pulverização',
        icon: 'fa-solid fa-spray-can',
        color: '#8b5cf6',
        fillColor: '#7c3aed',
        borderColor: '#6d28d9'
    },
    linhas: {
        name: 'Projetos de Linha',
        icon: 'fa-solid fa-route',
        color: '#ec4899',
        fillColor: '#db2777',
        borderColor: '#be185d'
    }
};

// ==========================================================================
// RENDERIZAÇÃO DO MAPA & POLÍGONOS (BORDA PRETA FINA NORMAL)
// ==========================================================================
function isCalcarioMode() {
    return state.currentTab === 'adubacao';
}

function getFeatureStyle(feature) {
    if (!isCalcarioMode()) {
        return {
            fillColor: 'transparent',
            weight: 0.8,
            opacity: 1,
            color: '#000000',
            fillOpacity: 0
        };
    }

    const p = feature.properties || {};
    const isPlanned = PlanningManager.isTalhaoPlanned(p.Fazenda, p.Campo, state.currentAno, state.currentCultura, state.currentProduto);

    if (state.operationalMode === 'planejamento') {
        if (isPlanned) {
            return {
                fillColor: '#0284c7',
                fillOpacity: 0.70,
                weight: 2.5,
                opacity: 1,
                color: '#0369a1'
            };
        } else {
            return {
                fillColor: '#94a3b8',
                fillOpacity: 0.12,
                weight: 1,
                opacity: 0.6,
                color: '#64748b',
                dashArray: '4, 4'
            };
        }
    }

    // Modo Aplicação (Execução)
    if (!isPlanned) {
        return {
            fillColor: '#94a3b8',
            fillOpacity: 0.10,
            weight: 0.8,
            opacity: 0.4,
            color: '#94a3b8',
            dashArray: '3, 3'
        };
    }

    const record = getTalhaoRecord(p.Fazenda, p.Campo, state.currentAno, state.currentCultura, state.currentProduto, p.Area);
    const statusCfg = STATUS_COLORS[record.status] || STATUS_COLORS.nao_iniciado;

    return {
        fillColor: statusCfg.fillColor,
        fillOpacity: 0.75,
        weight: 0.8,
        opacity: 1,
        color: '#000000'
    };
}

function getTalhaoTooltipHtml(feature) {
    const p = feature.properties || {};
    const area = p.Area ? parseFloat(p.Area).toFixed(2) : '0.00';
    const campo = p.Campo || 'Sem nome';
    const fazenda = p.Fazenda || 'N/A';
    const isPlanned = PlanningManager.isTalhaoPlanned(fazenda, campo, state.currentAno, state.currentCultura, state.currentProduto);

    if (state.operationalMode === 'planejamento') {
        return `
            <div class="talhao-tooltip-inner">
                <div class="talhao-tooltip-title">${campo} (${fazenda})</div>
                <div>Área: <strong>${area} ha</strong></div>
                <div>Produto: <strong>${state.currentProduto}</strong></div>
                <span class="talhao-tooltip-badge ${isPlanned ? 'badge-concluido' : 'badge-nao-iniciado'}">
                    ${isPlanned ? '✓ Planejado' : '✗ Não Planejado'}
                </span>
            </div>
        `;
    }

    if (!isPlanned) {
        return `
            <div class="talhao-tooltip-inner">
                <div class="talhao-tooltip-title">${campo} (${fazenda})</div>
                <div>Área: <strong>${area} ha</strong></div>
                <span class="talhao-tooltip-badge" style="background:#64748b;color:#fff;">Não Planejado para ${state.currentProduto}</span>
            </div>
        `;
    }

    const record = getTalhaoRecord(fazenda, campo, state.currentAno, state.currentCultura, state.currentProduto, area);
    const statusCfg = STATUS_COLORS[record.status] || STATUS_COLORS.nao_iniciado;
    
    let extraInfo = '';
    if (record.status === 'concluido' && record.taxaAplicada) {
        extraInfo = `<div>Taxa: <strong>${record.taxaAplicada} t/ha</strong></div>`;
    } else if (record.status === 'em_andamento') {
        extraInfo = `<div>Progresso: <strong>${record.percentualRealizado}% (${record.areaRealizada.toFixed(2)} ha)</strong></div>`;
    }

    return `
        <div class="talhao-tooltip-inner">
            <div class="talhao-tooltip-title">${campo} (${fazenda})</div>
            <div>Área Total: <strong>${area} ha</strong></div>
            ${extraInfo}
            <span class="talhao-tooltip-badge badge-${record.status.replace('_', '-')}">${statusCfg.label}</span>
        </div>
    `;
}

function bindTalhaoTooltip(layer, feature) {
    if (isCalcarioMode()) {
        const content = getTalhaoTooltipHtml(feature);
        const existingTooltip = layer.getTooltip();
        if (existingTooltip) {
            layer.setTooltipContent(content);
        } else {
            layer.bindTooltip(content, {
                className: 'talhao-tooltip',
                sticky: true,
                direction: 'top',
                interactive: false
            });
        }
    } else {
        const p = feature.properties || {};
        const campo = p.Campo || 'Sem nome';
        const fazenda = p.Fazenda || 'N/A';
        const area = p.Area ? `${parseFloat(p.Area).toFixed(2)} ha` : '0.00 ha';
        const content = `
            <div class="talhao-tooltip-inner">
                <div class="talhao-tooltip-title">${campo} (${fazenda})</div>
                <div>Área: <strong>${area}</strong></div>
                <div style="font-size: 0.72rem; color: #64748b; margin-top: 2px;">Clique para ver detalhes</div>
            </div>
        `;
        const existingTooltip = layer.getTooltip();
        if (existingTooltip) {
            layer.setTooltipContent(content);
        } else {
            layer.bindTooltip(content, {
                className: 'talhao-tooltip',
                sticky: true,
                direction: 'top',
                interactive: false
            });
        }
    }
}

function onEachFeature(feature, layer) {
    bindTalhaoTooltip(layer, feature);

    layer.on('mouseover', function() {
        if (!isCalcarioMode()) {
            layer.setStyle({
                weight: 1.8,
                color: '#000000',
                fillOpacity: 0
            });
        }
    });

    layer.on('mouseout', function() {
        if (!isCalcarioMode()) {
            layer.setStyle(getFeatureStyle(feature));
        }
    });

    layer.on('click', function(e) {
        if (e) {
            L.DomEvent.stopPropagation(e);
        }
        
        if (state.map) {
            try { state.map.closeTooltip(); } catch(err){}
        }

        if (isCalcarioMode()) {
            if (state.operationalMode === 'planejamento') {
                if (state.userRole === 'viewer') return;
                
                const p = feature.properties || {};
                PlanningManager.toggleTalhao(p.Fazenda, p.Campo, state.currentAno, state.currentCultura, state.currentProduto);
                updateMapStylesAndKPIs();
                updatePlanningBannerUI();
            } else {
                AdubacaoModal.open(feature);
            }
        } else {
            const p = feature.properties || {};
            let colheitaVal = p['Início Colheita'];
            if (!colheitaVal) {
                for (const k of Object.keys(p)) {
                    if (k.toLowerCase().includes('colheita')) {
                        colheitaVal = p[k];
                        break;
                    }
                }
            }
            const colheita = colheitaVal || 'N/A';
            const infoTitle = document.getElementById('info-title');
            const infoFaz = document.getElementById('info-fazenda');
            const infoArea = document.getElementById('info-area');
            const infoVar = document.getElementById('info-variedade');
            const infoCol = document.getElementById('info-colheita');
            const infoPanel = document.getElementById('info-panel');

            if (infoTitle) infoTitle.textContent = `Talhão: ${p.Campo || 'Sem nome'}`;
            if (infoFaz) infoFaz.textContent = p.Fazenda || 'N/A';
            if (infoArea) infoArea.textContent = p.Area ? `${parseFloat(p.Area).toFixed(2)} ha` : '0.00 ha';
            if (infoVar) infoVar.textContent = p.Variedade || 'N/A';
            if (infoCol) infoCol.textContent = colheita;
            if (infoPanel) infoPanel.classList.remove('hidden');
        }
    });
}

// Atualização de estilos e KPIs sem destruir o GeoJSON Layer
function updateMapStylesAndKPIs() {
    try {
        if (state.geojsonLayer) {
            state.geojsonLayer.setStyle(getFeatureStyle);
            state.geojsonLayer.eachLayer(layer => {
                if (layer.feature) {
                    bindTalhaoTooltip(layer, layer.feature);
                }
            });
        }
        
        if (state.geojsonData && isCalcarioMode()) {
            const filteredFeatures = state.geojsonData.features.filter(feature => {
                if (state.currentFazenda === 'ALL') return true;
                return feature.properties && feature.properties.Fazenda === state.currentFazenda;
            });
            updateDashboardKPIs(filteredFeatures);
        }
    } catch (err) {
        console.error('Erro ao atualizar estilos/KPIs:', err);
    }
}

function renderMap(shouldFitBounds = true) {
    if (state.geojsonLayer && state.map) {
        state.map.removeLayer(state.geojsonLayer);
        state.geojsonLayer = null;
    }
    
    if (!state.geojsonData) return;
    
    const filteredFeatures = state.geojsonData.features.filter(feature => {
        if (state.currentFazenda === 'ALL') return true;
        return feature.properties && feature.properties.Fazenda === state.currentFazenda;
    });
    
    const filteredData = {
        type: "FeatureCollection",
        features: filteredFeatures
    };
    
    const statsCount = document.getElementById('stats-count');
    if (statsCount) statsCount.textContent = filteredFeatures.length;
    
    const calcarioFilterBar = document.getElementById('calcario-filter-bar');
    const calcarioDashboard = document.getElementById('calcario-dashboard');
    const genericOpBar = document.getElementById('generic-op-bar');
    const planningBanner = document.getElementById('planning-banner-bar');
    const infoPanel = document.getElementById('info-panel');

    if (isCalcarioMode()) {
        if (calcarioFilterBar) calcarioFilterBar.classList.remove('hidden');
        if (calcarioDashboard) calcarioDashboard.classList.remove('hidden');
        if (genericOpBar) genericOpBar.classList.add('hidden');
        if (infoPanel) infoPanel.classList.add('hidden');
        updateDashboardKPIs(filteredFeatures);
        updatePlanningBannerUI();
    } else {
        if (calcarioFilterBar) calcarioFilterBar.classList.add('hidden');
        if (calcarioDashboard) calcarioDashboard.classList.add('hidden');
        if (planningBanner) planningBanner.classList.add('hidden');
        
        if (genericOpBar) {
            genericOpBar.classList.remove('hidden');
            const opCfg = OPERACOES_CONFIG[state.currentTab] || OPERACOES_CONFIG.colheita;
            const opIcon = document.getElementById('generic-op-icon');
            const opName = document.getElementById('generic-op-name');
            const opFaz = document.getElementById('generic-op-fazenda');
            const opCount = document.getElementById('generic-op-count');

            if (opIcon) {
                opIcon.className = opCfg.icon;
                opIcon.style.color = opCfg.color;
            }
            if (opName) opName.textContent = `Operação: ${opCfg.name}`;
            if (opFaz) opFaz.textContent = state.currentFazenda === 'ALL' ? 'Todas as Fazendas' : `Fazenda ${state.currentFazenda}`;
            if (opCount) opCount.textContent = `${filteredFeatures.length} talhõe${filteredFeatures.length === 1 ? '' : 's'}`;
        }
    }

    if (filteredFeatures.length === 0) return;
    
    state.geojsonLayer = L.geoJSON(filteredData, {
        style: getFeatureStyle,
        onEachFeature: onEachFeature
    }).addTo(state.map);
    
    if (shouldFitBounds && filteredFeatures.length > 0) {
        try {
            state.map.fitBounds(state.geojsonLayer.getBounds(), { padding: [50, 50] });
        } catch (e) {
            console.warn('Bounds zoom warning:', e);
        }
    }

    updatePlanningBannerUI();

    if (state.map) {
        setTimeout(() => {
            try { state.map.invalidateSize(); } catch(e){}
        }, 80);
    }
}

// ==========================================================================
// CÁLCULOS DO DASHBOARD OPERACIONAL DE CALCÁRIO (BASEADO NO PLANEJAMENTO REAL)
// ==========================================================================
function updateDashboardKPIs(features) {
    const plannedFields = PlanningManager.getPlannedFields(state.currentFazenda, state.currentAno, state.currentCultura, state.currentProduto);

    let areaPlanejada = 0;
    let areaRealizada = 0;
    
    let areaConcluido = 0;
    let countConcluido = 0;
    
    let areaAndamentoTotal = 0;
    let areaAndamentoRealizada = 0;
    let countAndamento = 0;
    
    let areaNaoIniciado = 0;
    let countNaoIniciado = 0;

    features.forEach(f => {
        const p = f.properties || {};
        const areaTalhao = parseFloat(p.Area) || 0;
        const campo = p.Campo;

        // Apenas talhões planejados para o produto atual compõem os KPIs operacionais
        if (!plannedFields.includes(campo)) {
            return;
        }

        areaPlanejada += areaTalhao;

        const record = getTalhaoRecord(p.Fazenda, campo, state.currentAno, state.currentCultura, state.currentProduto, areaTalhao);
        
        if (record.status === 'concluido') {
            areaConcluido += areaTalhao;
            areaRealizada += areaTalhao;
            countConcluido++;
        } else if (record.status === 'em_andamento') {
            const realizado = parseFloat(record.areaRealizada) || 0;
            areaAndamentoTotal += areaTalhao;
            areaAndamentoRealizada += realizado;
            areaRealizada += realizado;
            countAndamento++;
        } else {
            areaNaoIniciado += areaTalhao;
            countNaoIniciado++;
        }
    });

    const progressoPct = areaPlanejada > 0 ? (areaRealizada / areaPlanejada) * 100 : 0;
    const concluidoPct = areaPlanejada > 0 ? (areaConcluido / areaPlanejada) * 100 : 0;
    const andamentoPct = areaPlanejada > 0 ? (areaAndamentoTotal / areaPlanejada) * 100 : 0;
    const naoIniciadoPct = areaPlanejada > 0 ? (areaNaoIniciado / areaPlanejada) * 100 : 0;

    const setTxt = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    setTxt('kpi-area-planejada', formatHectares(areaPlanejada));
    setTxt('kpi-area-realizada', formatHectares(areaRealizada));
    setTxt('kpi-progresso', `${progressoPct.toFixed(1)}%`);
    setTxt('kpi-progresso-sub', `${formatHectares(areaRealizada)} de ${formatHectares(areaPlanejada)} aplicados`);

    setTxt('progress-total-badge', `${progressoPct.toFixed(1)}% Realizado`);
    
    const segC = document.getElementById('seg-concluido');
    const segA = document.getElementById('seg-andamento');
    const segN = document.getElementById('seg-nao-iniciado');
    if (segC) segC.style.width = `${concluidoPct.toFixed(1)}%`;
    if (segA) segA.style.width = `${andamentoPct.toFixed(1)}%`;
    if (segN) segN.style.width = `${naoIniciadoPct.toFixed(1)}%`;

    setTxt('sum-concluido-ha', formatHectares(areaConcluido));
    setTxt('sum-concluido-pct', `(${concluidoPct.toFixed(1)}%)`);
    setTxt('sum-concluido-count', `${countConcluido} talhõe${countConcluido === 1 ? '' : 's'}`);

    setTxt('sum-andamento-ha', formatHectares(areaAndamentoRealizada));
    setTxt('sum-andamento-pct', `(${((areaAndamentoRealizada / (areaPlanejada || 1)) * 100).toFixed(1)}%)`);
    setTxt('sum-andamento-count', `${countAndamento} talhõe${countAndamento === 1 ? '' : 's'}`);

    setTxt('sum-nao-iniciado-ha', formatHectares(areaNaoIniciado));
    setTxt('sum-nao-iniciado-pct', `(${naoIniciadoPct.toFixed(1)}%)`);
    setTxt('sum-nao-iniciado-count', `${countNaoIniciado} talhõe${countNaoIniciado === 1 ? '' : 's'}`);

    updatePlanningBannerUI();
}

function updatePlanningBannerUI() {
    const banner = document.getElementById('planning-banner-bar');
    if (!banner) return;

    if (state.operationalMode === 'planejamento' && state.userRole === 'editor' && isCalcarioMode()) {
        banner.classList.remove('hidden');
    } else {
        banner.classList.add('hidden');
    }

    const prodTitle = document.getElementById('plan-prod-title');
    if (prodTitle) prodTitle.textContent = state.currentProduto;

    if (!state.geojsonData) return;
    const filteredFeatures = state.geojsonData.features.filter(feature => {
        if (state.currentFazenda === 'ALL') return true;
        return feature.properties && feature.properties.Fazenda === state.currentFazenda;
    });

    const plannedFields = PlanningManager.getPlannedFields(state.currentFazenda, state.currentAno, state.currentCultura, state.currentProduto);
    
    let totalHa = 0;
    let count = 0;
    filteredFeatures.forEach(f => {
        if (plannedFields.includes(f.properties?.Campo)) {
            totalHa += parseFloat(f.properties?.Area) || 0;
            count++;
        }
    });

    const banHa = document.getElementById('plan-banner-ha');
    const banCount = document.getElementById('plan-banner-count');
    if (banHa) banHa.textContent = formatHectares(totalHa);
    if (banCount) banCount.textContent = `(${count} talhõe${count === 1 ? '' : 's'})`;
}

function formatHectares(num) {
    if (isNaN(num)) return '0 ha';
    return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ha';
}

// ==========================================================================
// CONTROLADOR MODULAR DO POP-UP DE ADUBAÇÃO (RECONSTRUÍDO DO ZERO)
// ==========================================================================
const AdubacaoModal = {
    elements: {},
    currentFeature: null,
    currentRecord: null,
    currentArea: 0,
    currentStatus: 'nao_iniciado',
    currentProgressMode: 'percentual',

    init() {
        this.cacheDom();
        this.bindEvents();
    },

    cacheDom() {
        this.elements.backdrop = document.getElementById('adubacao-modal-backdrop');
        this.elements.title = document.getElementById('adubacao-modal-title');
        this.elements.tagText = document.getElementById('adubacao-modal-tag-text');
        this.elements.cadastralFazenda = document.getElementById('cadastral-fazenda');
        this.elements.cadastralTalhao = document.getElementById('cadastral-talhao');
        this.elements.cadastralArea = document.getElementById('cadastral-area');
        this.elements.cadastralAno = document.getElementById('cadastral-ano');
        this.elements.cadastralCultura = document.getElementById('cadastral-cultura');
        this.elements.cadastralProduto = document.getElementById('cadastral-produto');
        
        this.elements.viewerView = document.getElementById('adubacao-viewer-view');
        this.elements.viewerBadge = document.getElementById('viewer-status-badge');
        this.elements.viewerTime = document.getElementById('viewer-status-time');
        this.elements.viewerProgresso = document.getElementById('viewer-detail-progresso');
        this.elements.viewerRowTaxa = document.getElementById('viewer-row-taxa');
        this.elements.viewerTaxa = document.getElementById('viewer-detail-taxa');
        this.elements.btnFecharViewer = document.getElementById('btn-fechar-adubacao-viewer');

        this.elements.formEdit = document.getElementById('form-adubacao-edit');
        this.elements.statusCards = document.querySelectorAll('.status-card');
        this.elements.dynamicPanel = document.getElementById('adubacao-dynamic-panel');
        this.elements.condConcluido = document.getElementById('cond-block-concluido');
        this.elements.condAndamento = document.getElementById('cond-block-andamento');
        this.elements.condNaoIniciado = document.getElementById('cond-block-nao-iniciado');
        this.elements.inputTaxa = document.getElementById('input-taxa-adubacao');
        this.elements.radiosProgressMode = document.querySelectorAll('input[name="adubacao-progress-mode"]');
        this.elements.fieldGroupPct = document.getElementById('field-group-pct');
        this.elements.fieldGroupHa = document.getElementById('field-group-ha');
        this.elements.inputPct = document.getElementById('input-pct-adubacao');
        this.elements.inputHa = document.getElementById('input-ha-adubacao');
        this.elements.previewCalcHa = document.getElementById('preview-calc-ha');
        this.elements.previewTotalHa = document.getElementById('preview-total-ha');
        this.elements.previewCalcPct = document.getElementById('preview-calc-pct');

        this.elements.errorBox = document.getElementById('adubacao-form-error');
        this.elements.errorText = document.getElementById('adubacao-error-text');
        this.elements.historyAccordion = document.getElementById('history-accordion');
        this.elements.btnToggleHistory = document.getElementById('btn-toggle-history');
        this.elements.historyList = document.getElementById('adubacao-history-list');

        this.elements.btnClose = document.getElementById('btn-close-adubacao-modal');
        this.elements.btnCancel = document.getElementById('btn-cancel-adubacao');
        this.elements.btnSave = document.getElementById('btn-save-adubacao');
    },

    bindEvents() {
        if (this.elements.btnClose) {
            this.elements.btnClose.addEventListener('click', () => this.close());
        }
        if (this.elements.btnCancel) {
            this.elements.btnCancel.addEventListener('click', () => this.close());
        }
        if (this.elements.btnFecharViewer) {
            this.elements.btnFecharViewer.addEventListener('click', () => this.close());
        }
        if (this.elements.backdrop) {
            this.elements.backdrop.addEventListener('click', (e) => {
                if (e.target.id === 'adubacao-modal-backdrop') {
                    this.close();
                }
            });
        }

        // Seleção de Status
        this.elements.statusCards.forEach(card => {
            card.addEventListener('click', () => {
                const st = card.dataset.status;
                if (st) {
                    this.setStatus(st);
                }
            });
        });

        // Alternância do Tipo de Progresso
        this.elements.radiosProgressMode.forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.setProgressMode(e.target.value);
            });
        });

        // Cálculo dinâmico em tempo real
        if (this.elements.inputPct) {
            this.elements.inputPct.addEventListener('input', () => {
                this.updatePreviewFromPct();
            });
        }
        if (this.elements.inputHa) {
            this.elements.inputHa.addEventListener('input', () => {
                this.updatePreviewFromHa();
            });
        }

        // Toggle do Histórico
        if (this.elements.btnToggleHistory) {
            this.elements.btnToggleHistory.addEventListener('click', () => {
                if (this.elements.historyAccordion) {
                    this.elements.historyAccordion.classList.toggle('expanded');
                }
            });
        }

        // Submissão
        if (this.elements.formEdit) {
            this.elements.formEdit.addEventListener('submit', (e) => {
                e.preventDefault();
                this.save();
            });
        }
    },

    open(feature) {
        if (!feature || !feature.properties) return;

        this.cacheDom();

        const p = feature.properties;
        const campo = p.Campo || 'Sem nome';
        const fazenda = p.Fazenda || 'N/A';
        const area = parseFloat(p.Area) || 0;

        this.currentFeature = feature;
        this.currentArea = area;
        this.currentRecord = getTalhaoRecord(fazenda, campo, state.currentAno, state.currentCultura, state.currentProduto, area);

        state.selectedFeature = feature;
        state.selectedTalhaoRecord = this.currentRecord;

        this.hideError();

        // Dados cadastrais
        if (this.elements.title) this.elements.title.textContent = `Talhão: ${campo}`;
        if (this.elements.cadastralFazenda) this.elements.cadastralFazenda.textContent = fazenda;
        if (this.elements.cadastralTalhao) this.elements.cadastralTalhao.textContent = campo;
        if (this.elements.cadastralArea) this.elements.cadastralArea.textContent = `${area.toFixed(2)} ha`;
        if (this.elements.previewTotalHa) this.elements.previewTotalHa.textContent = `${area.toFixed(2)} ha`;
        if (this.elements.cadastralAno) this.elements.cadastralAno.textContent = state.currentAno;
        if (this.elements.cadastralCultura) this.elements.cadastralCultura.textContent = state.currentCultura;
        if (this.elements.cadastralProduto) this.elements.cadastralProduto.textContent = state.currentProduto;

        // Histórico
        this.renderHistory(this.currentRecord.historico);
        if (this.elements.historyAccordion) {
            this.elements.historyAccordion.classList.remove('expanded');
        }

        const isViewer = (state.userRole === 'viewer');

        if (isViewer) {
            if (this.elements.tagText) this.elements.tagText.textContent = 'CONSULTA DE APLICAÇÃO';
            if (this.elements.viewerView) {
                this.elements.viewerView.classList.remove('hidden');
                this.elements.viewerView.style.display = 'flex';
            }
            if (this.elements.formEdit) {
                this.elements.formEdit.classList.add('hidden');
                this.elements.formEdit.style.display = 'none';
            }
            this.renderViewerMode();
        } else {
            if (this.elements.tagText) this.elements.tagText.textContent = 'ATUALIZAR APLICAÇÃO';
            if (this.elements.viewerView) {
                this.elements.viewerView.classList.add('hidden');
                this.elements.viewerView.style.display = 'none';
            }
            if (this.elements.formEdit) {
                this.elements.formEdit.classList.remove('hidden');
                this.elements.formEdit.style.display = 'flex';
            }
            this.renderEditorMode();
        }

        if (this.elements.backdrop) {
            this.elements.backdrop.classList.remove('hidden');
            this.elements.backdrop.style.display = 'flex';
        }
    },

    renderViewerMode() {
        const rec = this.currentRecord;
        const st = rec.status || 'nao_iniciado';

        if (this.elements.viewerBadge) {
            this.elements.viewerBadge.className = `viewer-status-badge badge-${st.replace('_', '-')}`;
            if (st === 'concluido') this.elements.viewerBadge.textContent = '🟢 Concluído';
            else if (st === 'em_andamento') this.elements.viewerBadge.textContent = '🟠 Em Andamento';
            else this.elements.viewerBadge.textContent = '🔴 Não Iniciado';
        }

        if (this.elements.viewerTime) {
            this.elements.viewerTime.textContent = rec.ultimaAlteracao ? `Atualizado em ${new Date(rec.ultimaAlteracao).toLocaleString('pt-BR')}` : 'Sem registros';
        }

        if (this.elements.viewerProgresso) {
            if (st === 'concluido') {
                this.elements.viewerProgresso.textContent = `100% (${this.currentArea.toFixed(2)} ha)`;
            } else if (st === 'em_andamento') {
                this.elements.viewerProgresso.textContent = `${rec.percentualRealizado || 0}% (${(rec.areaRealizada || 0).toFixed(2)} ha)`;
            } else {
                this.elements.viewerProgresso.textContent = `0% (0.00 ha de ${this.currentArea.toFixed(2)} ha)`;
            }
        }

        if (this.elements.viewerRowTaxa) {
            if (st === 'concluido') {
                this.elements.viewerRowTaxa.style.display = 'flex';
                if (this.elements.viewerTaxa) this.elements.viewerTaxa.textContent = rec.taxaAplicada ? `${rec.taxaAplicada} t/ha` : 'Não informada';
            } else {
                this.elements.viewerRowTaxa.style.display = 'none';
            }
        }
    },

    renderEditorMode() {
        const rec = this.currentRecord;
        const initialStatus = rec.status || 'nao_iniciado';
        const initialMode = rec.tipoProgresso || 'percentual';

        if (this.elements.inputTaxa) this.elements.inputTaxa.value = (rec.taxaAplicada != null) ? rec.taxaAplicada : '';
        if (this.elements.inputPct) this.elements.inputPct.value = (rec.percentualRealizado != null && rec.percentualRealizado > 0) ? rec.percentualRealizado : '';
        if (this.elements.inputHa) this.elements.inputHa.value = (rec.areaRealizada != null && rec.areaRealizada > 0) ? rec.areaRealizada : '';

        this.elements.radiosProgressMode.forEach(r => {
            r.checked = (r.value === initialMode);
        });

        this.currentProgressMode = initialMode;
        this.setStatus(initialStatus);
    },

    setStatus(status) {
        this.currentStatus = status;
        this.hideError();

        this.elements.statusCards.forEach(card => {
            card.classList.toggle('active', card.dataset.status === status);
        });

        if (this.elements.condConcluido) this.elements.condConcluido.classList.add('hidden');
        if (this.elements.condAndamento) this.elements.condAndamento.classList.add('hidden');
        if (this.elements.condNaoIniciado) this.elements.condNaoIniciado.classList.add('hidden');

        if (status === 'concluido') {
            if (this.elements.condConcluido) this.elements.condConcluido.classList.remove('hidden');
        } else if (status === 'em_andamento') {
            if (this.elements.condAndamento) this.elements.condAndamento.classList.remove('hidden');
            this.setProgressMode(this.currentProgressMode);
        } else {
            if (this.elements.condNaoIniciado) this.elements.condNaoIniciado.classList.remove('hidden');
        }
    },

    setProgressMode(mode) {
        this.currentProgressMode = mode;
        this.hideError();

        if (mode === 'percentual') {
            if (this.elements.fieldGroupPct) this.elements.fieldGroupPct.classList.remove('hidden');
            if (this.elements.fieldGroupHa) this.elements.fieldGroupHa.classList.add('hidden');
            this.updatePreviewFromPct();
        } else {
            if (this.elements.fieldGroupPct) this.elements.fieldGroupPct.classList.add('hidden');
            if (this.elements.fieldGroupHa) this.elements.fieldGroupHa.classList.remove('hidden');
            this.updatePreviewFromHa();
        }
    },

    updatePreviewFromPct() {
        const val = this.elements.inputPct ? (parseFloat(this.elements.inputPct.value) || 0) : 0;
        const calcHa = (this.currentArea * (val / 100)).toFixed(2);
        if (this.elements.previewCalcHa) this.elements.previewCalcHa.textContent = `${calcHa} ha`;
    },

    updatePreviewFromHa() {
        const val = this.elements.inputHa ? (parseFloat(this.elements.inputHa.value) || 0) : 0;
        const calcPct = this.currentArea > 0 ? ((val / this.currentArea) * 100).toFixed(1) : '0.0';
        if (this.elements.previewCalcPct) this.elements.previewCalcPct.textContent = `${calcPct}%`;
    },

    renderHistory(historico) {
        if (!this.elements.historyList) return;
        if (!Array.isArray(historico) || historico.length === 0) {
            this.elements.historyList.innerHTML = '<p class="history-empty-msg">Nenhuma alteração registrada ainda para este talhão.</p>';
            return;
        }

        this.elements.historyList.innerHTML = '';
        [...historico].reverse().forEach(item => {
            if (!item) return;
            const div = document.createElement('div');
            div.className = 'history-record-item';
            div.innerHTML = `
                <span class="history-record-meta">${item.data || ''} &bull; ${item.usuario || ''}</span>
                <span class="history-record-detail"><strong>${item.status || ''}</strong> &mdash; ${item.detalhe || ''}</span>
            `;
            this.elements.historyList.appendChild(div);
        });
    },

    showError(msg) {
        if (this.elements.errorText) this.elements.errorText.textContent = msg;
        if (this.elements.errorBox) this.elements.errorBox.classList.remove('hidden');
    },

    hideError() {
        if (this.elements.errorBox) this.elements.errorBox.classList.add('hidden');
    },

    close() {
        try {
            if (this.elements && this.elements.backdrop) {
                this.elements.backdrop.classList.add('hidden');
                this.elements.backdrop.style.display = 'none';
            }

            this.currentFeature = null;
            this.currentRecord = null;
            state.selectedFeature = null;
            state.selectedTalhaoRecord = null;
            this.hideError();

            if (this.elements && this.elements.formEdit) this.elements.formEdit.reset();
            if (this.elements && this.elements.inputTaxa) this.elements.inputTaxa.value = '';
            if (this.elements && this.elements.inputPct) this.elements.inputPct.value = '';
            if (this.elements && this.elements.inputHa) this.elements.inputHa.value = '';
            if (this.elements && this.elements.historyAccordion) this.elements.historyAccordion.classList.remove('expanded');

            if (state.map) {
                try { state.map.closeTooltip(); } catch(e){}
            }
        } catch(e) {
            console.warn('Aviso ao fechar modal de adubação:', e);
        }
    },

    save() {
        if (state.userRole === 'viewer' || !this.currentRecord) {
            this.close();
            return;
        }

        const status = this.currentStatus;
        const totalArea = this.currentArea;
        let taxaAplicada = null;
        let areaRealizada = 0;
        let percentualRealizado = 0;
        let tipoProgresso = this.currentProgressMode;
        let historicoDetalhe = '';

        if (status === 'concluido') {
            const taxaVal = this.elements.inputTaxa ? parseFloat(this.elements.inputTaxa.value) : NaN;
            if (isNaN(taxaVal) || taxaVal <= 0) {
                this.showError('A Taxa Aplicada (t/ha) é obrigatória para talhões concluídos e deve ser maior que zero.');
                return;
            }
            taxaAplicada = taxaVal;
            areaRealizada = totalArea;
            percentualRealizado = 100;
            historicoDetalhe = `Taxa aplicada: ${taxaAplicada} t/ha (100% concluído)`;

        } else if (status === 'em_andamento') {
            if (tipoProgresso === 'percentual') {
                const pctVal = this.elements.inputPct ? parseFloat(this.elements.inputPct.value) : NaN;
                if (isNaN(pctVal) || pctVal <= 0 || pctVal >= 100) {
                    this.showError('O percentual de progresso deve ser um valor entre 0,1% e 99,9%.');
                    return;
                }
                percentualRealizado = pctVal;
                areaRealizada = parseFloat((totalArea * (pctVal / 100)).toFixed(2));
                historicoDetalhe = `Progresso informado: ${pctVal}% (${areaRealizada} ha)`;
            } else {
                const haVal = this.elements.inputHa ? parseFloat(this.elements.inputHa.value) : NaN;
                if (isNaN(haVal) || haVal <= 0) {
                    this.showError('A área concluída em hectares deve ser maior que zero.');
                    return;
                }
                if (haVal > totalArea) {
                    this.showError(`A área concluída (${haVal} ha) não pode exceder a área total do talhão (${totalArea} ha).`);
                    return;
                }
                areaRealizada = haVal;
                percentualRealizado = totalArea > 0 ? parseFloat(((haVal / totalArea) * 100).toFixed(1)) : 0;
                historicoDetalhe = `Área informada: ${haVal} ha (${percentualRealizado}%)`;
            }
        } else {
            areaRealizada = 0;
            percentualRealizado = 0;
            historicoDetalhe = 'Aplicação marcada como Não Iniciada';
        }

        const now = new Date();
        const historyEntry = {
            data: now.toLocaleString('pt-BR'),
            usuario: `${state.currentUser} (Editor)`,
            status: status === 'concluido' ? 'Concluído' : (status === 'em_andamento' ? 'Em Andamento' : 'Não Iniciado'),
            detalhe: historicoDetalhe
        };

        const historicoAtual = Array.isArray(this.currentRecord.historico) ? this.currentRecord.historico : [];
        historicoAtual.push(historyEntry);

        const updatedRecord = {
            ...this.currentRecord,
            status: status,
            areaRealizada: areaRealizada,
            percentualRealizado: percentualRealizado,
            taxaAplicada: taxaAplicada,
            tipoProgresso: tipoProgresso,
            usuario: state.currentUser,
            ultimaAlteracao: now.toISOString(),
            historico: historicoAtual
        };

        saveTalhaoRecord(updatedRecord);
        this.close();
        updateMapStylesAndKPIs();
    }
};

// ==========================================================================
// GESTÃO DE PRODUTOS, SAFRAS & CULTURAS
// ==========================================================================
function openProdutoModal() {
    if (state.userRole === 'viewer') return;
    const input = document.getElementById('input-nome-produto');
    if (input) input.value = '';
    const err = document.getElementById('produto-error-alert');
    if (err) err.classList.add('hidden');
    const backdrop = document.getElementById('produto-modal-backdrop');
    if (backdrop) {
        backdrop.classList.remove('hidden');
        backdrop.style.display = 'flex';
    }
}

function handleNovoProdutoSubmit(e) {
    e.preventDefault();
    if (state.userRole === 'viewer') return;

    const input = document.getElementById('input-nome-produto');
    const nome = input ? input.value.trim() : '';

    if (!nome) return;

    const exists = state.produtos.some(p => p.toLowerCase() === nome.toLowerCase());
    if (exists) {
        const err = document.getElementById('produto-error-alert');
        if (err) {
            err.classList.remove('hidden');
            err.style.display = 'flex';
        }
        return;
    }

    state.produtos.push(nome);
    saveListsToStorage();
    state.currentProduto = nome;
    populateDropdowns();

    const backdrop = document.getElementById('produto-modal-backdrop');
    if (backdrop) {
        backdrop.classList.add('hidden');
        backdrop.style.display = 'none';
    }
    updateMapStylesAndKPIs();
}

function openAnoModal() {
    if (state.userRole === 'viewer') return;
    const input = document.getElementById('input-novo-ano');
    if (input) input.value = '';
    const err = document.getElementById('ano-error-alert');
    if (err) err.classList.add('hidden');
    const backdrop = document.getElementById('ano-modal-backdrop');
    if (backdrop) {
        backdrop.classList.remove('hidden');
        backdrop.style.display = 'flex';
    }
}

function handleNovoAnoSubmit(e) {
    e.preventDefault();
    if (state.userRole === 'viewer') return;

    const input = document.getElementById('input-novo-ano');
    const ano = input ? input.value.trim() : '';
    if (!ano) return;

    if (state.anos.includes(ano)) {
        const err = document.getElementById('ano-error-alert');
        if (err) {
            err.classList.remove('hidden');
            err.style.display = 'flex';
        }
        return;
    }

    state.anos.push(ano);
    state.anos.sort();
    saveListsToStorage();
    state.currentAno = ano;
    populateDropdowns();

    const backdrop = document.getElementById('ano-modal-backdrop');
    if (backdrop) {
        backdrop.classList.add('hidden');
        backdrop.style.display = 'none';
    }
    updateMapStylesAndKPIs();
}

function openCulturaModal() {
    if (state.userRole === 'viewer') return;
    const input = document.getElementById('input-nova-cultura');
    if (input) input.value = '';
    const err = document.getElementById('cultura-error-alert');
    if (err) err.classList.add('hidden');
    const backdrop = document.getElementById('cultura-modal-backdrop');
    if (backdrop) {
        backdrop.classList.remove('hidden');
        backdrop.style.display = 'flex';
    }
}

function handleNovaCulturaSubmit(e) {
    e.preventDefault();
    if (state.userRole === 'viewer') return;

    const input = document.getElementById('input-nova-cultura');
    const cultura = input ? input.value.trim() : '';
    if (!cultura) return;

    const exists = state.culturas.some(c => c.toLowerCase() === cultura.toLowerCase());
    if (exists) {
        const err = document.getElementById('cultura-error-alert');
        if (err) {
            err.classList.remove('hidden');
            err.style.display = 'flex';
        }
        return;
    }

    state.culturas.push(cultura);
    saveListsToStorage();
    state.currentCultura = cultura;
    populateDropdowns();

    const backdrop = document.getElementById('cultura-modal-backdrop');
    if (backdrop) {
        backdrop.classList.add('hidden');
        backdrop.style.display = 'none';
    }
    updateMapStylesAndKPIs();
}

// ==========================================================================
// CONFIGURAÇÃO DOS EVENT LISTENERS
// ==========================================================================
function setupEventListeners() {
    // 1. Filtro de Fazenda Principal
    const fazendaFilter = document.getElementById('fazenda-filter');
    if (fazendaFilter) {
        fazendaFilter.addEventListener('change', (e) => {
            state.currentFazenda = e.target.value;
            updateFilterTag();
            renderMap(true);
        });
    }

    // 2. Filtros Operacionais do Calcário
    const filterAno = document.getElementById('filter-ano');
    if (filterAno) {
        filterAno.addEventListener('change', (e) => {
            state.currentAno = e.target.value;
            updateFilterTag();
            updateMapStylesAndKPIs();
        });
    }

    const filterCultura = document.getElementById('filter-cultura');
    if (filterCultura) {
        filterCultura.addEventListener('change', (e) => {
            state.currentCultura = e.target.value;
            updateFilterTag();
            updateMapStylesAndKPIs();
        });
    }

    const filterProduto = document.getElementById('filter-produto');
    if (filterProduto) {
        filterProduto.addEventListener('change', (e) => {
            state.currentProduto = e.target.value;
            updateFilterTag();
            updateMapStylesAndKPIs();
        });
    }

    // 3. Controle de Permissões (Editor / Visualizador)
    const btnEditor = document.getElementById('role-editor-btn');
    if (btnEditor) {
        btnEditor.addEventListener('click', () => {
            state.userRole = 'editor';
            saveListsToStorage();
            updateRoleUI();
        });
    }

    const btnViewer = document.getElementById('role-viewer-btn');
    if (btnViewer) {
        btnViewer.addEventListener('click', () => {
            state.userRole = 'viewer';
            saveListsToStorage();
            updateRoleUI();
        });
    }

    // 4. Navegação Lateral
    const adubacaoGroup = document.getElementById('nav-adubacao-group');
    const subtabCalcario = document.getElementById('subtab-calcario-btn');

    function switchMainTab(tabKey, subtabKey = null) {
        if (!tabKey) return;
        state.currentTab = tabKey;

        const infoPanel = document.getElementById('info-panel');
        const calcarioFilterBar = document.getElementById('calcario-filter-bar');
        const calcarioDashboard = document.getElementById('calcario-dashboard');
        const planningBanner = document.getElementById('planning-banner-bar');
        const genericOpBar = document.getElementById('generic-op-bar');

        if (tabKey === 'adubacao') {
            state.currentSubTab = subtabKey || 'calcario';
            if (subtabCalcario) subtabCalcario.classList.add('active');
            if (adubacaoGroup) adubacaoGroup.classList.add('expanded');
            if (infoPanel) infoPanel.classList.add('hidden');
        } else {
            state.currentSubTab = null;
            if (subtabCalcario) subtabCalcario.classList.remove('active');
            if (adubacaoGroup) adubacaoGroup.classList.remove('expanded');
            if (calcarioFilterBar) calcarioFilterBar.classList.add('hidden');
            if (calcarioDashboard) calcarioDashboard.classList.add('hidden');
            if (planningBanner) planningBanner.classList.add('hidden');
            if (infoPanel) infoPanel.classList.add('hidden');

            try {
                if (typeof AdubacaoModal !== 'undefined' && AdubacaoModal.close) {
                    AdubacaoModal.close();
                }
            } catch (e) {
                console.warn('Erro ao fechar modal de adubacao:', e);
            }
        }

        // Atualiza imediatamente o estado visual dos botões da sidebar
        document.querySelectorAll('.sidebar-nav .tab-btn').forEach(btn => {
            const isCurrent = (btn.dataset.tab === tabKey);
            btn.classList.toggle('active', isCurrent);
        });

        try {
            renderMap(false);
        } catch (e) {
            console.error('Erro ao renderizar mapa ao trocar de aba:', e);
        }
    }

    document.querySelectorAll('.sidebar-nav .tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const currentBtn = e.target.closest('.tab-btn');
            const tabKey = currentBtn ? currentBtn.dataset.tab : null;
            if (!tabKey) return;

            if (tabKey === 'adubacao') {
                if (state.currentTab === 'adubacao') {
                    if (adubacaoGroup) adubacaoGroup.classList.toggle('expanded');
                } else {
                    switchMainTab('adubacao', 'calcario');
                }
            } else {
                switchMainTab(tabKey);
            }
        });
    });

    // Subitem Atualizar Mapa de Calcário
    if (subtabCalcario) {
        subtabCalcario.addEventListener('click', (e) => {
            e.stopPropagation();
            switchMainTab('adubacao', 'calcario');
        });
    }

    // Alternância de Modos (Aplicação vs Planejamento)
    const btnModeAplicacao = document.getElementById('btn-mode-aplicacao');
    const btnModePlanejamento = document.getElementById('btn-mode-planejamento');

    if (btnModeAplicacao) {
        btnModeAplicacao.addEventListener('click', () => {
            state.operationalMode = 'aplicacao';
            btnModeAplicacao.classList.add('active');
            if (btnModePlanejamento) btnModePlanejamento.classList.remove('active');
            updateMapStylesAndKPIs();
            updatePlanningBannerUI();
        });
    }

    if (btnModePlanejamento) {
        btnModePlanejamento.addEventListener('click', () => {
            state.operationalMode = 'planejamento';
            btnModePlanejamento.classList.add('active');
            if (btnModeAplicacao) btnModeAplicacao.classList.remove('active');
            updateMapStylesAndKPIs();
            updatePlanningBannerUI();
        });
    }

    const btnPlanSelectAll = document.getElementById('btn-plan-select-all');
    if (btnPlanSelectAll) {
        btnPlanSelectAll.addEventListener('click', () => {
            PlanningManager.selectAll(state.currentFazenda, state.currentAno, state.currentCultura, state.currentProduto);
            updateMapStylesAndKPIs();
            updatePlanningBannerUI();
        });
    }

    const btnPlanClearAll = document.getElementById('btn-plan-clear-all');
    if (btnPlanClearAll) {
        btnPlanClearAll.addEventListener('click', () => {
            PlanningManager.clearAll(state.currentFazenda, state.currentAno, state.currentCultura, state.currentProduto);
            updateMapStylesAndKPIs();
            updatePlanningBannerUI();
        });
    }

    // 5. Botões de Adicionar Novos Insumos / Filtros
    const btnAddProd = document.getElementById('btn-add-produto');
    if (btnAddProd) btnAddProd.addEventListener('click', openProdutoModal);
    const btnCloseProd = document.getElementById('btn-close-produto-modal');
    if (btnCloseProd) btnCloseProd.addEventListener('click', () => {
        const b = document.getElementById('produto-modal-backdrop');
        if (b) { b.classList.add('hidden'); b.style.display = 'none'; }
    });
    const btnCancProd = document.getElementById('btn-cancelar-produto');
    if (btnCancProd) btnCancProd.addEventListener('click', () => {
        const b = document.getElementById('produto-modal-backdrop');
        if (b) { b.classList.add('hidden'); b.style.display = 'none'; }
    });
    const formProd = document.getElementById('form-novo-produto');
    if (formProd) formProd.addEventListener('submit', handleNovoProdutoSubmit);

    const btnAddAno = document.getElementById('btn-add-ano');
    if (btnAddAno) btnAddAno.addEventListener('click', openAnoModal);
    const btnCloseAno = document.getElementById('btn-close-ano-modal');
    if (btnCloseAno) btnCloseAno.addEventListener('click', () => {
        const b = document.getElementById('ano-modal-backdrop');
        if (b) { b.classList.add('hidden'); b.style.display = 'none'; }
    });
    const btnCancAno = document.getElementById('btn-cancelar-ano');
    if (btnCancAno) btnCancAno.addEventListener('click', () => {
        const b = document.getElementById('ano-modal-backdrop');
        if (b) { b.classList.add('hidden'); b.style.display = 'none'; }
    });
    const formAno = document.getElementById('form-novo-ano');
    if (formAno) formAno.addEventListener('submit', handleNovoAnoSubmit);

    const btnAddCult = document.getElementById('btn-add-cultura');
    if (btnAddCult) btnAddCult.addEventListener('click', openCulturaModal);
    const btnCloseCult = document.getElementById('btn-close-cultura-modal');
    if (btnCloseCult) btnCloseCult.addEventListener('click', () => {
        const b = document.getElementById('cultura-modal-backdrop');
        if (b) { b.classList.add('hidden'); b.style.display = 'none'; }
    });
    const btnCancCult = document.getElementById('btn-cancelar-cultura');
    if (btnCancCult) btnCancCult.addEventListener('click', () => {
        const b = document.getElementById('cultura-modal-backdrop');
        if (b) { b.classList.add('hidden'); b.style.display = 'none'; }
    });
    const formCult = document.getElementById('form-nova-cultura');
    if (formCult) formCult.addEventListener('submit', handleNovaCulturaSubmit);

    // 6. Toggle de Minimização do Dashboard no Topo do Mapa
    const btnToggleDash = document.getElementById('btn-toggle-dash');
    if (btnToggleDash) {
        btnToggleDash.addEventListener('click', () => {
            const dash = document.getElementById('calcario-dashboard');
            if (dash) dash.classList.toggle('collapsed');
        });
    }

    // 8. Botão Fechar Painel Informativo Fixo
    const btnCloseInfo = document.getElementById('btn-close-info');
    if (btnCloseInfo) {
        btnCloseInfo.addEventListener('click', () => {
            const infoPanel = document.getElementById('info-panel');
            if (infoPanel) infoPanel.classList.add('hidden');
        });
    }

    // 9. Mapa Base (Satélite vs Fundo Branco)
    document.querySelectorAll('input[name="basemap"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const selected = e.target.value;
            Object.values(state.basemapLayers).forEach(layer => {
                if (state.map.hasLayer(layer)) {
                    state.map.removeLayer(layer);
                }
            });
            state.basemapLayers[selected].addTo(state.map);
        });
    });
}
