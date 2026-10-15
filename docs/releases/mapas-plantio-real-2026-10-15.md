# Mapas reais no menu Plantio

Implementação preparada em 15/10/2026 para o NEXA oficial. Acrescenta “Data estimada de colheita” e “Variedades plantadas” ao submenu Plantio, preservando “Atualizar Mapa de Plantio”.

As consultas usam o cache de operações já carregado pela sessão autenticada. Os mapas respeitam fazenda, gleba, safra e cultura; somente execução com hectares realizados positivos alimenta as variedades e as previsões. Olimpo e NEO 790 usam 114 dias corridos para soja. NEO780 continua distinta e sem ciclo definido. Área parcial é identificada por contorno tracejado e soma somente os hectares executados. Faltas de data, variedade ou ciclo aparecem sem previsão. A colheita pode ocorrer no ano seguinte sem mudar a safra do registro.

As duas abas são de consulta, inclusive para editores. Clique mostra os dados do talhão. Alterações de execução continuam no formulário original, no banco e nas regras de acesso existentes. Não há importação de registros fictícios, gravação de previsões, migration nem modificação das permissões.

Base oficial: `aac3292b001d1f629c86075f4c08ad6894d946b3`. Cópia de retorno: branch `codex/antes-mapas-plantio-2026-10-15`. A branch anterior de demonstração continua independente.

Verificações: 43 testes de previsão, mapas integrados, operações, seleção em lote e filtros aprovados. Outros 42 testes de autenticação, colheita e exportação passaram; o teste antigo `harvest-detail.test.cjs` não pôde executar porque seu arquivo de dados `dados/colheita/2026/milho/fe-original/index.json` não está disponível neste checkout. Nenhum arquivo de colheita foi alterado por esta implementação.

Conferência visual local com dados sintéticos isolados: três itens do submenu visíveis; previsão de 06/02/2027 para Olimpo plantada em 15/10/2026; 140 ha executados, dos quais 100 ha com previsão e 40 ha de NEO780 sem ciclo; legenda de variedades; troca para safra sem dados; retorno ao formulário original com ocultação dos painéis derivados. O build padrão de produção passou. Os arquivos locais de conferência em `.publish/planting-real/` não fazem parte da publicação.
