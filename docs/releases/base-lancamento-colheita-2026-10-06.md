# Referência aprovada para o lançamento — Colheita

Versão aprovada pelo usuário em 6 de outubro de 2026.

Marco no Git: `codex/base-lancamento-colheita-2026-10-06`.
Código aprovado: `c585baa5dd100aed557d4b88a24ae9902da86c24`.
Site de conferência: https://nexa-gm.vercel.app/portal?acesso=admin

## Comportamento a preservar

- Fazenda Esperança (FE), milho, safra 2026: 21 talhões e 2.619.944 pontos originais.
- Visão de todos os talhões e seleção individual.
- Polígonos transparentes, inclusive ao passar o mouse; recorte dos limites e furos reais.
- Pirâmides de visualização, nível de 5 metros a partir do zoom 15 e detalhe original a partir do zoom 16.
- Detalhe desenhado em células orientadas pelos X/Y originais, sem linhas artificiais entre as células.
- Lacunas da imagem corrigidas somente quando a grade original cobre a posição; dados ausentes não devem ser inventados.
- Imagem e recorte sincronizados durante o zoom; resolução já carregada mantida enquanto a próxima chega.
- Produtividade baseada em `prod_corig`, em sc/ha.
- Legenda: 0 a menos de 120; 120 a menos de 130; 130 a menos de 140; 140 a menos de 160; 160 a 180; acima de 180 sc/ha.
- Datas ausentes exibidas como “Dados não importados”.

## Dados e reprodução

O marco inclui o código, os blocos sem perdas de todos os pontos e as imagens de visualização em `dados/colheita/2026/milho/fe-original/`. O GeoJSON bruto local não é necessário para reproduzir o mapa a partir desses blocos.

SHA-256 do índice original: `498acfc3d79f6abb3465ef0bc8fc54d43c9aae96aa58e57cec4d2a1fdcc19e61`.

No Supabase, a base usa `harvest_test_files` e `harvest_test_datasets`, identificada por `fe-milho-2026`, com formato `original-points-v1`. As migrations necessárias estão incluídas no marco. O Git preserva os arquivos de dados desta versão, mas não congela o banco de dados: se a versão ativa no Supabase for alterada, a reprodução deve usar os blocos deste marco e ativá-los pelo fluxo de importação administrativa existente.

Para recuperar, abrir um checkout separado a partir deste marco, verificar os dados ativos no Supabase e executar os testes listados abaixo antes da publicação. Não substituir um checkout com alterações em andamento.

## Verificações

- `tests/fe-original.test.cjs`: comparação dos valores e coordenadas com o GeoJSON bruto, quando disponível.
- `tests/harvest-pyramid.test.cjs`: imagens, furos reais, classes e ausência de lacunas artificiais isoladas no FE 12.
- `tests/harvest-detail.test.cjs`: continuidade, escala e orientação das células originais.
- `tests/harvest-zoom.test.cjs`: sincronização ao aproximar e afastar e limpeza dos eventos.
- Conferência visual no site: todos os talhões, FE 12 com detalhe original e FE 19 com furos.

## Ajustes ainda previstos

A média da grade interpolada foi mantida por solicitação do usuário; sua substituição ainda precisa ser definida. A origem tem oito posições isoladas ausentes no FE 14. Este marco salva a referência aprovada e não constitui o lançamento final do produto.
