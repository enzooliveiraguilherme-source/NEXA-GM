# Logística orientada pelas guias de milho

Revisão posterior: o modelo ativo de decisão passa a ser `ab-blocks-v2`, descrito em `docs/fertilizer-application-blocks.md`. Ele reúne as subdivisões do mesmo bloco e escolhe uma origem comum para as partes da mesma faixa. O registro abaixo descreve a etapa inicial `ab-strips-v1`.

Atualização de 12/11/2026, com instalação e publicação autorizadas pelo usuário. As guias e funções foram instaladas no Supabase pela migração `20261112130550_fertilizer_directional_strips`. O resultado direcional foi recalculado para o piloto de 2026.

O arquivo fornecido, `Sentido_plantio_milho.geojson`, contém 84 registros: 82 linhas AB válidas de dois pontos e dois registros vazios. A importação usa somente o piloto existente: FE, PA e RM 01/RM 02, na safra de mapa 2026. As geometrias originais ficam fora do bundle público e do Git.

## Comportamento

As fronteiras internas entre origens passam a acompanhar o eixo das ABs. Cada faixa completa recebe um único monte, escolhido pelo custo médio ponderado pela área das amostras. O custo continua usando o perfil `machine-road-v2`, com preferência por estradas, depois bordadura e acessos locais. A distância física permanece separada do custo de escolha.

As faixas de análise têm 50 m de largura e amostras a cada 100 m ao longo do eixo. Isso é uma resolução de cálculo; não define largura de máquina nem capacidade ou autonomia do distribuidor. O estudo compara abastecimento por faixa e não simula esvaziamento do tanque.

As guias são relacionadas aos talhões pela interseção espacial, com tolerância de 10 m para linhas na borda. O candidato com maior comprimento de interseção é escolhido; nomes repetidos não decidem a associação. Os talhões subdivididos podem herdar uma guia do pai explicitamente cadastrado em `ReplacedBy`. Uma AB é um eixo sem sentido obrigatório de ida/volta: inverter A/B mantém as divisões. Não se exige que o corte coincida com a posição original da guia.

Buracos, ilhas e limites da operação são preservados. Partes desconectadas de uma faixa são analisadas separadamente. Um monte só pode receber uma faixa quando alcança todas as suas amostras; faixas sem candidato conectado ficam sem preenchimento. Campos sem guia mantêm a análise por percurso em malha de 100 m. Fora do piloto, permanece a referência anterior em linha reta.

Ao clicar numa região direcional colorida, o popup e o trajeto indicam o monte atribuído à faixa. As alternativas apresentadas são comparações do ponto clicado. O sistema não troca silenciosamente a origem da faixa pelo vencedor de uma única amostra.

## Arquivos e instalação

- `supabase/maintenance/fertilizer-directional-strips.sql`: nova tabela de guias, RPCs de faixas/amostras/finalização e cache `ab-strips-v1`.
- `scripts/prepare-planting-guides-import.cjs`: valida o GeoJSON e prepara uma importação privada em `tmp/routing/planting-guide-import.sql`.
- `scripts/prepare-directional-service-areas.cjs`: calcula o lote usando `tmp/routing/directional-grid.json` e o retrato atual da rede; grava custos e atribuições somente na pasta temporária.
- `js/fertilizer-routing.js` e worker: cálculo de custos médios por faixa, mantendo a busca pontual anterior.
- `js/fertilizer-service-areas.js`: consulta o novo cache, ou calcula no worker e finaliza o recorte por RPC.
- `js/fertilizer-logistics.js` e `portal.html`: identificação do método, seleção da origem da faixa e versões dos scripts.

A instalação deve preceder a publicação do frontend. Depois de instalar o SQL, importar as guias e recalcular o lote, a finalização usa `fertilizer_direction_zones`. O resultado validado pode ser gravado administrativamente em `fertilizer_service_area_cache` com `model_version='ab-strips-v1'`. A versão antiga continua disponível para clientes anteriores.

Se a RPC direcional ainda não estiver instalada (`PGRST202`), o frontend consulta exclusivamente o estudo anterior `machine-road-v2`, identificado na interface como malha de 100 m. Falhas de rede, autorização ou dados inválidos não acionam essa compatibilidade. Assim, a preparação local não interrompe a logística antes da liberação do banco.

As funções novas são `SECURITY INVOKER`, com `search_path` vazio. O navegador só lê guias autorizadas por fazenda; não escreve na tabela de guias nem no cache compartilhado. A assinatura do resultado inclui as guias, safra, método e fontes visíveis sob as permissões do próprio usuário. Mudanças de guia invalidam o resultado anterior.

## Verificação

Testes de custo, integração e geometria estão em `tests/fertilizer-direction-costs.test.cjs`, `tests/fertilizer-service-areas.test.cjs`, `tests/fertilizer-logistics.test.cjs` e `tests/fertilizer-direction-geometry.sql`. Os testes SQL são executados em uma única transação com `ROLLBACK`; não deixam guias ou DDL instalados no banco compartilhado.

A validação real em transação encontrou 36 campos guiados, com quatro associações herdadas de pais cadastrados. Preservação de área/máscara, ausência de sobreposição, eixo paralelo e reversão angular A/B passaram; a diferença relativa máxima de área foi `8,85e-13`. Também passaram as conferências de ACL e das seis funções novas como invoker. O teste foi ajustado para relatar campos totais e sem guia, sem pressupor uma contagem fixa.

O lote real processou **18.791 amostras em 1.589 faixas**: 1.574 atendidas e 15 sem rota confirmada, somando **26,562 ha** sem preenchimento. Foram produzidas 100 feições finais: 55 direcionais no piloto e 45 referências preservadas fora dele. O cálculo de custos levou 173,9 segundos após a montagem da rede em 11,8 segundos. A rede e os 48 montes locais foram conferidos contra o retrato atual do Supabase antes do processamento.

A finalização elimina geometrias vazias após a redução de precisão e resolve pequenas sobreposições de cadastro por uma ordem estável de campo e origem. Isso evita contar ou preencher duas vezes a área comum entre FE 06 e FE 07, sem modificar os cadastros dos talhões. A sobreposição e a serialização usam a mesma grade de precisão. PA 05 integra a área sem rota confirmada: suas oito faixas somam 10,685 ha.

Os 100 polígonos finais passaram nas verificações de validade em WGS84 e UTM; nenhum ficou vazio. O excesso residual de área por reprojeção foi inferior a 0,14 m² por fazenda. Fora do piloto, a diferença geométrica agregada foi zero. A área externa de arredondamento foi 28,26 m² sobre aproximadamente 82,2 milhões de m², compatível com a precisão milimétrica de serialização. As propriedades de área coincidem com as geometrias entregues. O resultado foi gravado no cache compartilhado `ab-strips-v1`; sua escrita permanece exclusivamente administrativa.

Duas faixas reais foram comparadas com custos recalculados por candidato; as origens atribuídas permaneceram em primeiro lugar e as diferenças de custo foram zero. A assinatura do resultado completo é `1728bcbd63883c80955032545675c783`. Os dados originais, amostras e atribuições intermediárias permanecem somente em `tmp/routing`, fora do Git e do bundle público.

Resultado final dos testes JavaScript por agentes Luna: **51/51 aprovados**, incluindo média por faixa, conectividade, isolamento de escopo, clique mantendo a origem da faixa, compatibilidade anterior e dispatch do worker. Sintaxe dos quatro módulos e dois scripts de preparação aprovada. Build local concluído; 50 arquivos permitidos, sem GeoJSONs, SQL ou pasta de dados brutos. A publicação usa como base a versão atual de `portal.html` do GitHub, alterando somente as três referências da logística para preservar as demais telas.
