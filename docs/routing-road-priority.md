# Preferência por estradas — perfil machine-road-v2

## Decisão e pesquisa

O objetivo passou a ser um percurso operacionalmente preferível para a máquina, aceitando mais distância em estrada para reduzir deslocamento por bordadura e lavoura. Bordadura continua disponível quando evitar um desvio excessivo.

As fontes primárias consultadas mostram a separação entre distância, tempo e preferência:

- [OSRM — profiles](https://project-osrm.org/docs/v6.0.0/api/profiles.html): o peso de roteamento pode favorecer classes de via sem falsificar a velocidade usada para estimar tempo.
- [Valhalla — dynamic costing](https://valhalla.github.io/valhalla/sif/dynamic-costing/): o melhor caminho minimiza custo configurável, considerando atributos das vias e, conforme o modelo, transições e superfície.
- [GraphHopper — custom models](https://docs.graphhopper.com/openapi): prioridade de vias, velocidade e influência da distância são parâmetros distintos.

Aplicamos essa separação ao grafo de estradas e talhões do projeto. Não foi contratado serviço externo de rotas nem substituída a malha privada pelos caminhos de um mapa público.

## Calibração inicial

O custo é a soma do comprimento físico de cada trecho multiplicado pelo peso de sua classe:

| Classe | Peso inicial |
| --- | ---: |
| Estrada cadastrada | 1 |
| Bordadura | 2 |
| Pequena ligação cadastral à estrada | 3 |
| Interior / atalho / acesso pela lavoura | 4 |

Uma rota só em estrada de 1,5 km pode vencer uma bordadura de 1 km. Se o acesso e os demais trechos forem iguais, estrada de 3 km perde para bordadura de 1 km. É uma regra gradual, sem proibir bordadura e sem preferir estrada a qualquer custo.

Os pesos são uma calibração de preferência, **não** medições de desgaste, velocidade, relevo ou tempo. Não são apresentados como ETA. Quando houver dados de superfície, declive, máquina e velocidade operacional, poderão ser calibrados com observações.

## Implementação

`FertilizerRouting.profile` é imutável. `rank` e `serviceCosts` usam o mesmo perfil e o mesmo cálculo dos acessos locais. O desempate usa distância física e ID do monte. O Dijkstra de múltiplas origens otimiza custo ponderado; mantém uma segunda distância em metros para apresentação e desempate.

Os trechos de entrada e saída têm seus comprimentos separados da parte percorrida na rede, evitando penalizar como lavoura a distância que já está em estrada. Uma reta dentro do talhão paga o custo do interior e só compete quando respeita os limites locais já validados. Os buracos e as restrições geométricas permanecem.

As rotas retornam `score`, `meters`, `metrics.roadMeters`, `metrics.borderMeters`, `metrics.fieldMeters` e `metrics.approachMeters`. O mapa mostra “Percurso recomendado” e as distâncias físicas por classe. Uma rota mais longa pode aparecer primeiro porque utiliza mais estrada.

Não existe penalidade fixa por vértice: isso faria a escolha depender da quantidade de pontos digitalizados. Penalidades por manobras dependentes da chegada e da saída exigem estado de chegada na busca, avaliação de ângulos e validação específica. Não foram simuladas como irregularidade medida do solo.

## Áreas e cache

O piloto espacial continua limitado a FE, PA e RM 01/RM 02, em malha de 100 m. As 9.154 células foram recalculadas com o custo ponderado. O resultado preparado tem 60 feições, sendo 14 regiões de percurso; 9.131 células atendidas e 13,227 ha sem ligação identificada.

`fertilizer_service_cached_profile` recebe explicitamente `route_model`. A versão `machine-road-v2` usa uma entrada própria na tabela de cache, protegida pela assinatura das fontes sob RLS. A RPC antiga da versão `network-grid-v1` permanece para leitores anteriores. O navegador não tem permissão de escrita no cache compartilhado.

Qualquer mudança nos pesos ou na fórmula deve receber versão nova, registro explícito em `model_version`, recálculo das regiões e atualização conjunta dos módulos/worker. Não reutilizar as áreas por distância da versão v1.

## Sentido de aplicação — próxima etapa

O usuário informou que o sentido de aplicação será necessário depois. Ainda não foi fornecido nem incorporado ao custo atual. Não inferir orientação a partir da forma do talhão ou de uma imagem.

A entrada futura deverá ser vinculada à operação, safra, talhão e trajeto de aplicação. Diferenciar azimute das linhas (eixo) do rumo atual da máquina (sentido de deslocamento). A busca poderá então considerar retorno à aplicação, entrada/saída, travessia das linhas e manobras. Qualquer contexto direcional também deverá compor a chave do cache; um polígono estático não deve ser apresentado como válido para todos os sentidos sem essa avaliação.

Estado de execução e pendências detalhados em `docs/routing-continuation.md`.

## Validação da versão v2

- 42 testes aprovados, incluindo estrada 30–50% mais longa preferida, bordadura diante de estrada três vezes maior, acesso local, independência da quantidade de vértices e rejeição do cache v1 quando o perfil ativo é v2. Sintaxe e build aprovados.
- Cinco amostras do lote real coincidiram com consultas `rank` em origem, custo e metros, dentro de tolerância de 2 cm. O lote levou 89 s após montagem de 12 s; o resultado compartilhado preparado evita repetir esse cálculo na abertura comum do mapa.
- No ponto já georreferenciado junto ao FE 02 03, a rota anterior de 532,56 m inteiramente no acesso pelo talhão passa a 686,58 m: 373,45 m de estrada e 313,13 m no interior. O deslocamento no interior diminui cerca de 41%.
- Amostra de célula no entorno FE 13 14: 3.044,98 → 5.102,14 m; o percurso novo tem 4.314,98 m em estrada, 744,03 m em bordadura, 38,21 m em interior e 4,92 m de ligação cadastral. Amostra no entorno FE 19 20: 589,07 → 1.447,94 m, com 1.088,18 m em estrada. São centros de células representativas, não os pontos exatos das últimas imagens, que não foram georreferenciados.
- Cache v2 consultado em 225 ms no banco. Todas as 60 geometrias são válidas em WGS84/UTM e não há sobreposição de área entre origens. Aproximadamente 350,35 ha em FE e 120,64 ha em PA mudaram de origem; RM não mudou nesta comparação.
- RM 03–RM 06 e as demais fazendas fora do piloto permanecem geometricamente idênticas à versão anterior. A RPC legada continua v1; modelo desconhecido, safra diferente e escopo incompatível não retornam o resultado v2.
- Migração remota e local: `20261111140032_fertilizer_service_road_priority_profile`. Cache sem escrita por authenticated, execução/read anônimos negados e RPC SECURITY INVOKER.
