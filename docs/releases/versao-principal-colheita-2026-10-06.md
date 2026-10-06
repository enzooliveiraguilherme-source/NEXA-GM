# Versão principal — Colheita

Aprovada pelo usuário em 6 de outubro de 2026.

Marco: `codex/colheita-principal-2026-10-06`.
Código aprovado: `4b6596d24dad0792183599507f7743066d3b8137`.
Site: https://nexa-gm.vercel.app/portal?acesso=admin

## Comportamento aprovado

- Fazenda Esperança, milho 2026, com todos os talhões ou seleção individual.
- Pontos originais preservados; pirâmides ao afastar e detalhe original ao aproximar.
- Limites e furos reais respeitados, polígonos transparentes e camada sincronizada durante o zoom.
- Produtividade em sc/ha baseada em `prod_corig`; identificação “Média do talhão”, sem contagens técnicas na interface.
- Datas ausentes identificadas como “Dados não importados”.
- Legenda flutuante no canto inferior direito do mapa.
- Somente duas rampas disponíveis: vermelho a verde e Viridis invertida; Viridis invertida como padrão.
- Cinco limites numéricos editáveis, positivos e crescentes, inicialmente 120, 130, 140, 160 e 180 sc/ha. Textos das faixas gerados automaticamente para manter a escrita padronizada.
- Cores editáveis e legendas nomeadas salvas na conta do colaborador, disponíveis para carregar futuramente. Salvar novamente com o mesmo nome atualiza a legenda daquela conta.
- Preferências locais separadas por conta e legendas do banco protegidas por acesso individual.

## Reprodução e banco

O marco preserva o código, os blocos originais sem perdas e as imagens e grades numéricas de visualização em `dados/colheita/2026/milho/fe-original/`.

Índice original SHA-256: `498acfc3d79f6abb3465ef0bc8fc54d43c9aae96aa58e57cec4d2a1fdcc19e61`.

A base no Supabase é `fe-milho-2026`, formato `original-points-v1`, nas tabelas `harvest_test_files` e `harvest_test_datasets`. As legendas individuais usam `harvest_user_legends`. As migrations `202610060003_harvest_test.sql`, `202610060004_original_harvest_points.sql` e `202610060005_user_harvest_legends.sql` foram aplicadas.

O Git não congela o conteúdo do Supabase. Para recuperar esta referência, usar um checkout separado do marco, conferir a base ativa e as migrations e executar as verificações antes de publicar. Preservar os dados e as legendas pessoais existentes.

## Verificações realizadas

- Preservação dos valores originais, máscaras, continuidade das células e sincronização do zoom.
- Correspondência das 126 grades numéricas com as máscaras das imagens.
- Testes de limites, classificação, textos padronizados, duas rampas e separação de preferências por conta.
- Verificação no Supabase de que outra conta não pode ler ou alterar legendas privadas.
- Conferência no site publicado: salvar, recarregar e aplicar a legenda “Milho 2026”, com edição numérica e atualização das cores no mapa.

## Pendências preservadas

O cálculo da média permanece como estava; sua futura substituição precisa ser definida. As oito posições isoladas ausentes na origem do FE 14 continuam ausentes. Esta é a referência principal aprovada, sem representar o lançamento final do produto.

O marco anterior `codex/base-lancamento-colheita-2026-10-06` permanece preservado.
