# Rotas dos montes de adubo

Implementação de 11/11/2026, autorizada para publicação pelo usuário. Schema instalado no projeto Geoportal Grupo Michels pela migração `20261111122224_fertilizer_routing_network`; as 56 estradas foram importadas e são válidas. O frontend deve ser publicado junto dos módulos de rotas.

## Comportamento

O clique em uma área de Logística compara os montes autorizados da mesma gleba canônica pelo comprimento do percurso. O fornecedor pode ser diferente daquele indicado pela cor do Voronoi. As cores e suas áreas continuam representando distância em linha reta e estão identificadas assim no painel; não são áreas recalculadas por estradas.

A rede combina as estradas cadastradas com os anéis externos e internos dos talhões de adubação da safra. O PostGIS une e cria nós nas interseções antes de dividir os segmentos em trechos de até 40 m. As geometrias originais dos talhões e dos montes permanecem intactas.

Atalhos de até **80 m por ligação** entre nós da rede são aceitos somente quando todo o segmento estiver dentro da união dos talhões disponíveis, incluindo suas bordas. O peso é a distância em metros, sem penalidade para lavoura. A validação subdivide o segmento em cada cruzamento de borda e verifica todos os intervalos, preservando buracos estreitos. A tolerância de posição na borda é de 5 mm.

Para sair do ponto de aplicação ou chegar a um monte dentro de um talhão, pode ser necessário percorrer mais de 80 m dentro daquele próprio polígono. Esses acessos são calculados separadamente e informados em metros no popup. Um monte no mesmo talhão pode ser alcançado diretamente se a reta permanecer dentro do polígono, sem atravessar seus buracos.

Pontos fora dos talhões precisam estar sobre uma estrada cadastrada, com tolerância cartográfica de 2 m. Essa tolerância não aceita pontos dentro de buracos dos polígonos. Ausência de conexão produz aviso, sem substituir a rota por uma reta. Nenhuma passagem por uma área não cadastrada é presumida. Vegetação ou obstáculos sem representação nos recortes dos talhões ainda não são conhecidos pelo cálculo.

Dijkstra encontra o menor percurso **na rede construída**, com distância aproximada em projeção local em metros. A amostragem de 40 m e as ligações de 80 m tornam o resultado uma estimativa, não o ótimo contínuo sobre todo o terreno. O mapa permanece responsivo com cálculo em Web Worker. Pedidos antigos são descartados após troca de aba, filtro, seleção de monte ou novo clique.

## Dados e permissões

`Estradas.geojson` contém 56 feições MultiLineString em CRS84, sem código de fazenda nos atributos. `node scripts/prepare-roads-import.cjs` valida a geometria e gera `supabase/maintenance/import-estradas.sql`, incluindo SHA256 da origem, sem conectar ao banco.

A importação preserva cada linha integralmente para não interromper pontes e ligações entre talhões. Associa cada estrada às fazendas cujos limites ficam a até 100 m da linha. Se nenhuma estiver próxima, usa a fazenda mais próxima. Uma sessão só pode ler a estrada se tiver acesso a **todas** as fazendas associadas. Essa regra é conservadora: um usuário com acesso parcial pode encontrar componentes desconectados.

`supabase/maintenance/fertilizer-routing-schema.sql` prepara a tabela `fertilizer_roads`, RLS sem escrita pelo navegador e a RPC `fertilizer_routing(map_year,routing_gleba)`, com `SECURITY INVOKER`, `search_path` vazio e execução apenas para `authenticated`. `can_access_farm` continua controlando as permissões. A seleção dos talhões respeita `OperationalArchived`, `MapOnlyContexts`, `MapContexts`, safra e operação, como a logística existente.

Os GeoJSON originais e os SQL de manutenção não entram em `site-dist`. Reimportações com geometrias diferentes exigem revisão; o SQL inicial usa `ON CONFLICT DO NOTHING`, preservando o cadastro já existente.

## Implantação

1. Schema instalado no projeto **Geoportal Grupo Michels**, ref `qdvlwszyehblmrjnqglx`.
2. Importação inicial concluída: 41 linhas associadas a FE, 6 a PA, 8 a RM e 1 a PA/RM. Nenhuma linha cortada. Geometrias inválidas dos limites de referência são reparadas somente na consulta de associação, sem alterar os talhões.
3. RPC real de 2026/FE retornou 114 talhões e 442 linhas nodadas, com 54.356 coordenadas de rede. A revisão de permissões confirmou RLS, função invoker, ausência de acesso anônimo e ausência de escrita pelo navegador.
4. Migração registrada localmente com o mesmo identificador retornado pelo banco. Publicar apenas os arquivos relacionados, preservando os demais módulos da versão atual de produção.

Não publicar o frontend isoladamente: ele passa a usar a RPC de rotas no clique.

## Verificação local

Os testes `tests/fertilizer-routing.test.cjs` cobrem escolhas de caminho, atalhos, buracos, desconexões, glebas e acessos. A regressão de interface fica em `tests/fertilizer-logistics.test.cjs`. A suíte focada passou 23/23 testes, com sintaxe e build aprovados. A otimização por índices espaciais reduziu o benchmark sintético FE (12.388 nós, sem noding) de 23,2 s para 1,6 s; esse número não substitui a medição da rede real.

A API pública é `FertilizerRouting.build(data).rank(origin,mounds)`; o carregador remoto usa `FertilizerRouting.load(client,year,gleba,scope)` e `rank` assíncrono quando há Web Worker. A primeira montagem da rede fica em cache por usuário, safra, gleba e escopo de fazendas. Atualizar montes descarta esse cache e encerra seus workers.

A medição com a resposta real da RPC (114 campos, 53.777 nós únicos) levou 11,4 s para a montagem inicial no worker. Consultas seguintes de origens FE, PA e RM levaram 17–741 ms. A partir dos montes amostrados, foram alcançáveis respectivamente 9, 5 e 1 dos 48 montes da gleba; a amostra de RM alcançou apenas sua própria origem. Os demais foram declarados sem ligação, sem desenhar atalhos por áreas não mapeadas. Portanto, as 56 estradas desta primeira carga ainda não formam uma rede conectada de toda a gleba. Os resultados não são uma confirmação de transitabilidade em campo.

Produto, estoque, tráfego, sentido de circulação e restrições operacionais não participam desta etapa.
