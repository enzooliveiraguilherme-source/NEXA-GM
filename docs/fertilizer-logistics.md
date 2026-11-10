# Logística de adubação

Primeira etapa implementada em 10/11/2026: Adubação → Logística.

- Fonte: `Montes.geojson`, 48 MultiPoints unitários em CRS84 (longitude, latitude): 35 FE e 13 FE2.
- `public.fertilizer_mounds` preserva nome, fazenda e gleba de origem (`FESP`). A gleba usada nos filtros é obtida de `farms` (`FE` para FE e FE2), sem alterar o cadastro das fazendas.
- Migração remota aplicada: `20261110133741_fertilizer_logistics`. PostGIS instalado no schema não exposto `gis`.
- Ajuste de abrangência aplicado: `20261110160720_fertilizer_logistics_gleba_scope`. FE/FE2 no arquivo agrupam locais de outras fazendas do cadastro; o cálculo usa a gleba canônica e separa a fazenda de origem do monte da fazenda de destino dos talhões.
- Exportação GeoJSON validada por `20261110161112_fertilizer_logistics_valid_geojson`, com redução topológica de precisão antes da serialização, evitando auto-interseções provocadas pelo arredondamento de coordenadas.
- `fertilizer_logistics(map_year)` executa com SECURITY INVOKER. Os montes e os talhões continuam sujeitos a `can_access_farm`, inclusive exigência de senha definitiva. A API anônima não pode ler a tabela nem executar a função.
- Não há escrita de montes ou de estoque pelo navegador nesta etapa.

## Cálculo e uso

Voronoi calculado por gleba em WGS84 / UTM 22S (EPSG:32722), entre os montes liberados para o acesso atual. O resultado é recortado pelos talhões de adubação de cada fazenda de destino na safra atual, preservando buracos e múltiplos polígonos. Talhões arquivados são excluídos; `MapOnlyContexts` e `MapContexts` respeitam operação e ano. A geometria original dos talhões não é modificada.

Um único local atende toda a máscara da gleba. Montes coincidentes compartilham a célula e permanecem individualmente consultáveis. Fazendas sem origens disponíveis na mesma gleba ficam sem cobertura, com aviso no painel. A área mostrada é geométrica, em hectares, e pode diferir do campo cadastral `Area`.

O filtro de fazenda escolhe o destino da aplicação; os montes que atendem esse destino podem ter outro código de origem na mesma gleba. A RLS de `fertilizer_mounds` continua exigindo acesso à fazenda de origem. Um usuário que tem acesso somente a RM, por exemplo, não ganha acesso automaticamente aos montes cadastrados na origem FE. As regiões são calculadas apenas entre as origens que sua sessão pode consultar.

Clique na área colorida para consultar a origem e a distância aproximada em linha reta desde o ponto clicado. Clique no monte ou selecione seu nome no painel para ver os dados. Os filtros de fazenda e gleba são os mesmos do portal. O painel informa a safra dos limites.

Ao selecionar uma origem, o painel se recolhe e o popup reserva espaço para o cabeçalho recolhido. Abra o título Logística de adubação para consultar outro monte ou reabrir os controles.

A análise não considera rotas rodoviárias, acessos, produto disponível, capacidade ou estoque. A ficha informa **estoque ainda não cadastrado**; isso não representa saldo zero. O futuro controle deverá permitir múltiplos produtos por monte e registrar entradas/saídas em toneladas, vinculadas ao ID estável do monte.

## Dados e manutenção

`node scripts/prepare-mounds-import.cjs` valida o arquivo e gera `supabase/maintenance/import-montes.sql`, com hash da origem. O script não conecta ao banco. A importação ignora nomes já existentes na mesma fazenda para preservar IDs e evitar sobrescrita silenciosa. Mudanças de nomes, coordenadas ou remoções precisam ser revisadas separadamente.

O botão Atualizar montes descarta o cache da sessão e consulta o Supabase novamente. Erros têm opção de tentar novamente; respostas atrasadas são ignoradas após a troca de aba ou filtro. O arquivo fonte não é publicado pelo build do site: a consulta ocorre pela sessão autenticada.

A publicação dos pontos e da função no Supabase é independente da implantação do frontend. A versão do frontend segue o histórico do repositório NEXA-GM e a implantação automática na Vercel.

## Validação

Os 48 registros importados correspondem ao arquivo fonte. O cálculo de 2026 retorna 60 recortes, associados aos 48 montes, nas fazendas FE, FE2, IPE, PA, RM, SH, SM e SMA, com área total de 22.555,6067 ha. Os 60 recortes são válidos após leitura do GeoJSON tanto em WGS84 quanto em UTM 22S, com áreas positivas e sem sobreposição por fazenda acima de 0,01 m². A diferença total de área após a conversão de coordenadas é de cerca de 5 m². Consulta reprodutível: `tests/fertilizer-logistics.sql`.

Sessões autenticadas sem identidade válida retornam zero montes e zero áreas. A função não é executável pelo papel anônimo. A suíte focada de código contém 49 testes aprovados, incluindo os mapas existentes, filtros de origem/destino, falha e nova tentativa de consulta e descarte de respostas atrasadas.

Na revisão de publicação, a suíte completa executou 393 testes: 384 passaram e nove falharam. A execução de comparação com `app.js` e `portal.html` da versão de produção `61066d257eff7786aaf54ed5856136f66ccb6991` apresentou exatamente os mesmos resultados e a mesma lista de falhas. As falhas anteriores pertencem a autenticação, identificação de glebas e arquivos locais de colheita ausentes; nenhuma nova falha foi introduzida pela Logística. Sintaxe dos scripts e build aprovados.

O componente foi exercitado no Chromium em desktop e em 390 px, com RPC e Leaflet simulados. Seleção, alternância de camadas e nomes, estado vazio, recuperação de erro e limpeza foram verificados. Esse ensaio não substitui a validação da navegação completa com sessão autenticada e Leaflet real, que permanece pendente.

Na revisão da publicação, o navegador bloqueou a prévia HTTP local e não havia sessão conectável. Foi possível carregar offline os módulos originais do Leaflet 1.9.4, obtidos da tag oficial pelo GitHub. A validação completa com sessão autenticada e a conferência visual em produção continuam limitadas pelo ambiente; os testes de código, build e geometrias foram concluídos.
