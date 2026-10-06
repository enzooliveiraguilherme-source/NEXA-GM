# Colheita — Milho 2026

A versão principal aprovada usa Fazenda Esperança (FE), com 21 talhões e 2.619.944 pontos originais. O portal permite ver todos os talhões ou selecionar um.

## Arquivos em uso

- `fe-original/index.json` e os 63 blocos JSON: coordenadas e valores originais, compactados sem perdas.
- `fe-original/pyramid/`: grades numéricas para as resoluções de visualização. Os PNGs são referências para verificação e reprodução das máscaras.
- `FE.geojson` e `FE.qmd`: origem da importação e metadados do QGIS, mantidos localmente.
- `TESTE_MILHO.geojson`: origem de todas as fazendas, preservada para futuras importações. Esse arquivo não é carregado pelo portal atual.

O campo de produtividade é `prod_corig`, em sc/ha. Datas ausentes permanecem nulas e aparecem como “Dados não importados”. A média atual foi preservada até definição do novo cálculo.

## Preparação e publicação

`scripts/prepare-fe-original.cjs` prepara os blocos originais da FE. `scripts/prepare-harvest-pyramid.cjs` prepara as grades e imagens de visualização. A base ativa `fe-milho-2026` está no Supabase; os arquivos publicados no site permitem reprodução e carregamento alternativo.

`scripts/prepare-harvest.cjs` é uma ferramenta de análise do arquivo de todas as fazendas, preservada para trabalho futuro. Sua amostra antiga não é a base do portal atual.

As legendas usam somente vermelho a verde ou Viridis invertida, com limites numéricos e textos padronizados. Cada colaborador pode guardar suas próprias legendas na conta.

A pasta antiga `fe/`, que continha médias de células de 25 metros, e seu gerador e teste foram removidos na limpeza de 6 de outubro de 2026. A referência histórica continua disponível nos marcos do Git.
