# Continuidade — preferência por estradas

## Pedido atual

O usuário passou a priorizar estradas para reduzir a exposição da máquina a bordaduras e terreno irregular. Aceita bordadura quando a estrada produz um desvio muito grande. Interior do talhão continua restrito a acessos/atalhos locais. O sentido de aplicação será usado futuramente; não foi fornecido e não deve ser inventado a partir dos polígonos.

Esta preferência substitui o critério anterior de sempre minimizar metros. Rotas e áreas de atendimento devem usar o mesmo perfil.

## Estado em 11/11/2026 — implementação v2 validada e resultado preparado

- Produção anterior a esta alteração: commit `16a0fd0967de3d41be41c85e22c39a5781f9f606`. A implantação desta alteração é identificada pelos scripts `machine-road-v2-20261111`; conferir o status Vercel do commit que contém este registro.
- `js/fertilizer-routing.js` contém o perfil `machine-road-v2`: road=1, border=2, approach=3, shortcut/access=4, snap=1. `rank` e `serviceCosts` otimizam `score`, com desempate por metros reais e ID. As rotas incluem `metrics` com metros de estrada, bordadura, interior e ligações de acesso.
- O algoritmo anterior foi preservado para comparação local em `tmp/routing/distance-routing-before-priority.js`. Os testes ponderados estão em `tests/fertilizer-road-priority.test.cjs`.
- 42 testes aprovados, sintaxe e build concluídos por agentes Luna. Lote v2 em `tmp/routing/service-assignments-machine-v2.json`: 9.154 células, 9.131 atendidas e 23 sem rota. O lote levou 89 s após montagem de 12 s. Comparações de `rank` e batch coincidiram nas amostras.
- O cache `machine-road-v2` já foi preparado e gravado administrativamente no Supabase: assinatura `55cd8066fadb880686a3a723ccbfc37a`, 60 feições/14 regiões de percurso, 13,227 ha sem ligação. A entrada v1 permanece para clientes anteriores.
- Migração `20261111140032_fertilizer_service_road_priority_profile` aplicada e registrada no projeto. Nova RPC `fertilizer_service_cached_profile` recebe explicitamente o modelo; versão antiga continua funcionando. Agente Luna validou as 60 geometrias, ausência de sobreposição, preservação fora do piloto e ACL. Consulta ao cache em 225 ms. Houve mudança de origem em aproximadamente 471 ha de FE/PA.
- Textos da interface e versões de worker/scripts foram atualizados para `machine-road-v2-20261111`. A versão remota de `portal.html` deve ser usada como base da publicação para preservar o restante do portal.
- Estudo atual: FE, PA e apenas RM 01/RM 02; 9.154 células de 100 m, 14 zonas por percurso. Outros talhões permanecem em linha reta.
- Dados de preparação privados: `tmp/routing/real-network.json`, `service-grid.json`, `service-assignments.json`, `service-zones.json`. Não versionar esses dados.
- Cache no Supabase `qdvlwszyehblmrjnqglx`: `fertilizer_service_area_cache`, versão `network-grid-v1`, consultado pela RPC `fertilizer_service_cached`. O novo perfil precisa de versão própria, sem reutilizar os polígonos antigos.
- Pesquisa primária: OSRM distingue distância física, velocidade e peso de preferência; Valhalla usa custo dinâmico com fatores de tipo/superfície e manobras. Fontes: https://project-osrm.org/docs/v6.0.0/api/profiles.html e https://valhalla.github.io/valhalla/sif/dynamic-costing/.

## Próximas etapas funcionais

1. Calibrar a intensidade da preferência com os próximos exemplos e observações de campo. Não representar os pesos como desgaste ou velocidade medidos.
2. Definir entrada do sentido de aplicação por operação/safra/talhão/trajeto. Diferenciar eixo das linhas e rumo atual da máquina; ainda não aplicado neste modelo.
3. Avaliar manobras dependentes de chegada/saída com estado de chegada na busca e dados de máquina. Não aplicar penalidade fixa por vértice digitalizado.
4. Para qualquer mudança de critério, gerar versão de perfil nova e recálculo correspondente dos polígonos/cache; não reutilizar a v2 com pesos diferentes.
5. Expandir a cobertura além de FE/PA/RM 01/RM 02 somente quando o usuário fornecer/autorizar a próxima etapa.

AGENTS.md exige agentes Luna para executar e ampliar os testes, em tarefas delimitadas. Usuário autorizou publicação nas etapas anteriores; não pedir a mesma autorização novamente.
