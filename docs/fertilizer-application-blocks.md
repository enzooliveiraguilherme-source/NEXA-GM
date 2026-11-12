# Logística por faixa completa do bloco

Revisão de 12/11/2026 após os exemplos de PA e FE. Modelo preparado `ab-blocks-v2`, com roteamento `machine-road-v2`.

## Problema corrigido

A primeira versão escolhia um monte para cada combinação de campo cadastral e pedaço conectado da faixa. Uma mesma AB podia atravessar subdivisões de variedades ou ser recortada por uma reentrância; suas partes recebiam origens diferentes. A geometria e os custos locais eram válidos, mas o planejamento produzia triângulos, línguas e trocas de monte dentro da mesma faixa de trabalho.

## Nova unidade de decisão

Os campos são reunidos pela fazenda, nome da guia de origem e eixo AB compatível, arredondado a 0,01 grau para agrupar as cópias da mesma direção. A máscara de cada bloco usa a união dos campos ativos da operação/safra. Uma única guia define o referencial das faixas de 50 m, amostradas a cada 100 m; as subdivisões cadastrais não reiniciam a grade nem a decisão de abastecimento.

O cálculo obtém custos por candidato em cada peça física. Depois escolhe o menor custo total ponderado pela área para a faixa inteira do bloco e atribui a mesma origem às suas partes acessíveis. Não há suavização de cores, alteração dos pesos de estrada ou distância inventada para trocar de monte.

Uma peça sem qualquer rota permanece neutra e não apaga as partes atendidas da faixa. Se redes fisicamente separadas não tiverem um fornecedor comum, preservam suas opções factíveis. Essa exceção não ocorreu como conflito de origem em nenhuma faixa do lote real revisado. Buracos e exclusões permanecem fora da máscara; compartilhar um monte não cria uma ligação reta entre as partes.

O clique mantém a origem planejada para a faixa e calcula o trajeto desde o ponto selecionado. Fora de FE, PA e RM 01/RM 02, a referência antiga em linha reta é exibida com preenchimento fraco e contorno tracejado. RM 05/RM 06 dos exemplos pertencem a essa referência, não ao estudo por estradas.

## Resultado e verificações

- 36 campos guiados reunidos em 19 blocos; a união das máscaras é idêntica à da versão anterior.
- 18.659 amostras; 1.525 peças de faixa, com 1.510 atendidas e 15 sem rota, somando 26,562 ha.
- Nenhuma faixa AB tem mais de uma origem atribuída às suas partes acessíveis.
- Nos exemplos, faixas com origens conflitantes: PA 54 → 0; guia FE03 28 → 0; guia FE07 75 → 0.
- Na PA, os blocos de origem agora formam três intervalos laterais contínuos. Em FE permanecem mudanças de origem entre faixas completas, conforme o custo dos acessos.
- 56 testes JavaScript focados aprovados por agentes Luna, incluindo regressões de peças distantes, bloco/índice, peça inacessível, redes desconectadas, empate e worker. As duas suítes de integração após os textos/estilos passaram 24/24; sintaxe e build aprovados.
- Finalização com 74 feições válidas em WGS84 e UTM, nenhuma vazia ou sobreposta. Área servida fora da máscara com tolerância de 5 mm: zero. Fora do piloto, diferença geométrica zero; área servida + não servida difere da máscara em apenas 0,405 m² de arredondamento. O resultado foi gravado no cache compartilhado `ab-blocks-v2`, assinatura `2523f508095d45dc9ad1d3375b06c3c9`.

As imagens de conferência foram geradas dos GeoJSONs reais antes e depois, com a mesma extensão de PA/FE. Dados intermediários permanecem em `tmp/routing`, fora do Git e da publicação.

## Implementação

`gis.fertilizer_block_fields`, `fertilizer_block_strips` e `fertilizer_block_samples` preparam a nova unidade geométrica. `FertilizerRouting.serviceBlockCosts` escolhe a origem comum pelo custo acumulado das peças da faixa. `fertilizer_block_grid` e `fertilizer_block_zones` mantêm o contrato de atribuições `f/c/s/m`.

As funções são `SECURITY INVOKER`, com `search_path` vazio e execução autenticada. As permissões por fazenda continuam controlando as fontes. A assinatura inclui as fontes originais e os nomes de guia que definem os blocos; mudança de agrupamento invalida o resultado preparado. O cache compartilhado usa `ab-blocks-v2`. Os endpoints e caches anteriores permanecem disponíveis para clientes já abertos.

Preparação administrativa: obter a grade em `tmp/routing/block-grid.json` e executar `node scripts/prepare-directional-service-areas.cjs --blocks`. A finalização valida novamente a assinatura antes da gravação administrativa do cache. Os arquivos brutos de guias e atribuições não fazem parte do bundle público.
