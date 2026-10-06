# Fazenda Esperança — Milho 2026

O original FE.geojson contém 2.619.944 pontos em 21 talhões, com produtividade corrigida no campo prod_corig, em sc/ha. O original permanece localmente, fora do controle de versão.

Cada arquivo fe-XX.geojson guarda as médias por células de 25 metros, com pontos_originais indicando quantos pontos contribuíram para cada célula. Nenhum ponto é descartado do cálculo: os 108.639 pontos de exibição resumem todos os pontos originais. A posição exibida é o centro médio dos pontos de cada célula. O agrupamento usa os campos projetados X/Y da exportação; a exibição usa longitude/latitude da geometria.

index.json guarda média, mínimo, máximo e quantidade de pontos da grade completa por talhão. São estatísticas da grade interpolada, não produção total ou resultado oficial ponderado por área colhida. As datas permanecem nulas.

A visão geral mostra os limites cadastrais de Talhoes.geojson. Os detalhes são carregados apenas após selecionar um talhão e removidos ao trocar de talhão, mudar o filtro ou sair de Colheita.

O portal consulta primeiro a versão ativa no Supabase. Na ausência de uma base ativa, utiliza os arquivos de teste publicados junto do site. A migration 202610060003_harvest_test.sql cria duas tabelas autenticadas: harvest_test_files e harvest_test_datasets. Só administradores enviam arquivos; a versão ativa é trocada somente após concluir todos os envios.

scripts/prepare-fe-harvest.cjs regenera os arquivos sem carregar o original inteiro na memória. tests/fe-harvest.test.cjs verifica os vínculos com os limites, as contagens, as médias e o carregamento por talhão.
