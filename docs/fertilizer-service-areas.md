# Áreas de atendimento por percurso

Piloto de 11/11/2026: todas as áreas de adubação da fazenda **FE**, todas da **PA** e somente os talhões **RM 01 e RM 02**. FE2 e RM 03–RM 06 permanecem no método anterior, em linha reta. Não são alterados os cadastros dos talhões, montes ou estradas.

O perfil atual é **machine-road-v2**, que prioriza estradas por custo ponderado e mantém metros físicos separados. O cache e os polígonos foram recalculados para essa versão. Pesquisa, pesos, exemplos e continuidade: `docs/routing-road-priority.md` e `docs/routing-continuation.md`.

## Cálculo

Uma grade fixa de 100 m em EPSG:32722 é recortada pelas máscaras da operação/safra. As máscaras respeitam arquivamento, `MapContexts`, `MapOnlyContexts` e RLS. Cada célula tem uma amostra em seu interior, preservando buracos e fragmentos nos recortes. As partes do mesmo índice são unidas após `ST_Subdivide`, evitando processar uma geometria extensa em cada interseção.

`FertilizerRouting.build(data).serviceCosts(samples,mounds)` classifica cada amostra com os mesmos critérios de `rank`: estradas, bordas, atalhos locais, acesso limitado pela estrada próxima e pequenas ligações cadastrais. Um Dijkstra com múltiplas origens encontra o monte de menor custo ponderado em cada nó. As amostras também comparam o acesso local direto e o caso de dois pontos no mesmo segmento. Isso produz o mesmo vencedor/custo que consultar as rotas individualmente, sem repetir a busca para cada célula.

As células são dissolvidas por monte e fazenda, formando polígonos recortados nos limites agrícolas. A resolução de 100 m é uma aproximação: um clique perto de uma divisão pode indicar outra origem quando a rota do ponto exato é conferida. Partes sem ligação ficam neutras, sem preencher automaticamente com a origem em linha reta. Montes coincidentes compartilham o polígono.

## Disponibilização e acesso

O navegador consulta `fertilizer_service_cached_profile(map_year,requested_farms,route_model)`, pedindo explicitamente `machine-road-v2`. O resultado preparado está em `fertilizer_service_area_cache`, cuja escrita não é concedida ao navegador. A RLS exige identidade válida e uma assinatura igual à dos dados de entrada visíveis sob as permissões do próprio usuário. A assinatura inclui a safra, o escopo solicitado, os limites/contextos, as estradas e os montes. Uma mudança de dados ou permissões invalida o resultado preparado. A RPC antiga continua servindo exclusivamente a versão v1 para leitores antigos.

Se não houver resultado compatível com o acesso atual, o navegador pode calcular o estudo em worker: `fertilizer_service_grid` → `serviceCosts` → `fertilizer_service_zones`. As duas RPCs são somente leitura e `SECURITY INVOKER`. A finalização confere a assinatura novamente e só aceita montes legíveis da mesma gleba. A interface informa o progresso e descarta respostas canceladas.

Resultados preparados são publicados administrativamente depois da validação; não são gravados pelo navegador nem compartilhados a partir de cálculos enviados por usuários. Ao alterar a regra de rotas, é necessário versionar `network-grid-v1` e gerar outro resultado, mesmo que os dados de entrada não tenham mudado.

O método está indicado no painel e no tooltip de cada área: **por percurso / malha 100 m** ou **referência em linha reta**. A consulta pontual continua usando o grafo da sessão e compara todos os montes liberados da mesma gleba.

## Validação inicial do piloto de 2026 (v1 por distância)

- 9.154 células: 7.233 FE, 1.078 PA e 843 RM 01/RM 02.
- 9.131 células atendidas. As demais somam **13,227 ha** sem ligação identificada.
- 14 regiões por percurso: 10 FE, 3 PA e 1 RM. Incluindo as referências preservadas fora do piloto, o resultado possui 60 feições.
- Máscaras e células têm as mesmas áreas antes da serialização; sem sobreposição, área faltante ou preenchimento fora das máscaras.
- 60/60 geometrias finais válidas em WGS84 e UTM. Sem sobreposição entre origens. Após serialização WGS84 com oito casas e conversão para UTM, a diferença residual total de contorno nas 14 regiões é 27,52 m², compatível com arredondamento milimétrico.
- Comparação espacial: diferença zero nas RM 03–RM 06 e nas demais fazendas fora do piloto. A remoção de referências antigas em FE/PA evita restos milimétricos do GeoJSON anterior.
- 36 testes focados aprovados, além de sintaxe e build. Nove amostras estratificadas da malha real coincidiram com `rank` em origem e distância. O ponto da imagem do usuário continua indicando FE 02 03, aproximadamente 533 m.

A consulta ao resultado preparado levou **85 ms** no banco. A geração da malha leva **1,41 s**, abaixo do timeout autenticado de 8 s. Recalcular todo o estudo sem resultado preparado exige cerca de 12 s para montar o grafo e 92 s para classificar as células no ambiente de teste; por isso o piloto é servido já calculado. O botão Atualizar montes limpa o cache da sessão e volta a verificar os dados atuais.

As RPCs não são executáveis por `anon`. O cache tem RLS e não permite INSERT, UPDATE ou DELETE por `authenticated`. Não foi simulada identidade de usuário nem alterado qualquer perfil durante a verificação.

As migrações remotas e suas cópias versionadas são: `20261111131034`, `20261111131722`, `20261111132522`, `20261111132643` e `20261111133049`. Os arquivos de dados e de preparação em `tmp/routing` não fazem parte da publicação do site nem do repositório.
