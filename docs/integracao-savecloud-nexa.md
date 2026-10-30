# Integração SaveCloud / Save Farm no NEXA

Pesquisa em 30/10/2026. Fonte principal: `apoio/Savecloud API - Manual de uso v2.pdf`, 14 páginas, datado de 27/10/2026.

Atualização de implementação: por decisão do usuário, o intermediário foi implementado como **Supabase Edge Function**, e não rota Vercel. A função `savecloud` v2 está publicada com autenticação obrigatória. O usuário salvou `SAVECLOUD_TOKEN` diretamente no painel protegido; `SAVECLOUD_TIME_ZONE` e `SAVECLOUD_ACCOUNT_MODE` também estão configurados. O fuso America/Sao_Paulo é provisório, a confirmar com o fornecedor. A configuração dos segredos ainda não comprova consulta operacional: falta a verificação pelo NEXA autenticado. Dados externos passam apenas pela memória da função e do navegador, sem armazenar geometrias ou aplicações.

Após login na documentação online (`https://savecloud.savefarm.com.br/api/docs/`), foram confirmadas diferenças do PDF: `full=1` no lugar de `full=true`; filtros `campos_ids`/`poligonos_ids` no catálogo; geometria `mpoly`; área estatística `hectareas` em minúsculas. A versão de implementação dá prioridade ao contrato online. A consulta autenticada via navegador retornou duas máquinas e `count=0` na listagem de talhões. Por isso existe um modo administrativo por máquina, explicitamente sem vínculo de talhão. Isso não comprova ausência de aplicações.

Detalhes de implantação e limites da primeira etapa: `supabase/functions/savecloud/README.md`. As recomendações da pesquisa original abaixo registram o desenho anterior à decisão de usar exclusivamente o Supabase.

## Conclusão

É viável consultar talhões, aplicações e estatísticas na SaveCloud sem importar os arquivos para o armazenamento do NEXA. A recomendação é uma integração de leitura sob demanda, com um intermediário autenticado no servidor e exibição em memória no mapa atual.

Isso evita cópias persistentes de polígonos, telemetria e aplicações no nosso banco ou Storage. Os dados necessariamente trafegam pela rede e ocupam memória no servidor e no navegador durante a consulta. Ainda haverá consumo de banda, execução de funções e dependência da disponibilidade da SaveCloud.

Não foram feitas chamadas autenticadas nem verificações com dados reais. As descrições de respostas abaixo são as do manual, e não resultados observados nesta pesquisa. A tentativa de abrir a raiz da API pela ferramenta de pesquisa não permitiu inspecionar seu conteúdo; isso não demonstra indisponibilidade da API.

## Encaixe no projeto atual

- `app.js`: mapa Leaflet, categoria visual `savefarm` e carregamento dos talhões via `state.cloudStore.load()`. Nos trechos examinados, não há conector SaveCloud.
- `auth.js`: as fazendas acessíveis são consultadas por `list_accessible_farms_by_gleba`. O intermediário deverá verificar essas permissões no servidor em cada consulta.
- `vercel.json` e pasta `api/`: o projeto já possui estrutura para funções de servidor. Por isso, a primeira opção é criar o conector nessa estrutura, sem adicionar outro serviço.
- Os limites e registros atuais do NEXA continuam sendo a referência cadastral. Os limites SaveCloud podem aparecer como camada externa e ser vinculados explicitamente ao cadastro existente.
- Não reutilizar o fluxo de importação/armazenamento da colheita para esta integração: o objetivo aqui é consulta remota.

## Recursos documentados

Base: `https://savecloud.savefarm.com.br/api/`.

| Recurso | Endpoint | Uso no NEXA |
| --- | --- | --- |
| Autenticação | `POST /auth` | Formulário `username` e `password`; retorna `token` |
| Máquinas | `GET /moviles/?full=true` | Catálogo, estado online e working, metadados |
| Uma máquina | `GET /moviles/{id}` | Dicionário `data_description`, headers e campos disponíveis |
| Talhões | `GET /poligonos/?full=true` | Limites com geometria; paginação e filtros `campo`, `ref` |
| Mapa | `GET /mapa` | GeoJSON por máquina, período e talhões |
| Por hora | `GET /estadistica_hora/` | Evolução operacional e indicadores por hora |
| Por trabalho | `GET /estadistica_trabajo/` | Volume, economia e operação |
| Por talhão | `GET /estadistica_poligono/` | Resumos por talhão e filtros de modo seletivo |
| Exportação | `GET /export/` | Recurso secundário para análises que exigirem registros detalhados |

Após autenticar, usar `Authorization: Token <token>`, conforme o manual. O token SaveCloud deve permanecer no servidor, separado da sessão do usuário NEXA. Não é um Bearer token.

### Talhões

Exemplo documentado:

```text
GET /api/poligonos/?page_size=100&full=true
```

Resposta paginada com `count`, `next`, `previous`, `results`. `full=true` inclui geometria; `campo` filtra o identificador da fazenda e `ref` filtra a referência sem diferenciar maiúsculas/minúsculas. O manual não detalha o esquema completo da geometria desse endpoint; validar e adaptar para GeoJSON se necessário.

Percorrer até `next=null`, com limites de segurança de páginas, tempo e volume. Validar a origem de cada URL de paginação antes de enviar o token. Usar referência apenas para auxiliar a vinculação inicial; homônimos entre fazendas tornam perigoso vincular por nome automaticamente.

### Aplicações e trajetos

`GET /api/mapa` recebe `movil`, `from`, `to`, `mode` e, opcionalmente, `poligonos_ids`, `include_data`, `interpretate_data`, `last`.

Datas deste endpoint: `YYYY-MM-DD-hh-mm-ss`. O fuso horário e a inclusão dos limites do intervalo não estão definidos no manual e precisam ser confirmados.

| mode | Conteúdo | Quando carregar |
| --- | --- | --- |
| 0 | Pontos da máquina | Inspeção pontual |
| 1 | Trajeto em linhas | Deslocamento e percurso |
| 2 | Faixas completas de trabalho | Análise da faixa percorrida; inclui trechos sem aplicação |
| 3 | Polígonos onde houve aplicação | Detalhamento da pulverização |
| 4 | Trajeto e aplicação | Inspeção conjunta |
| 5 | Superfície aplicada consolidada | Camada inicial recomendada, por reduzir polígonos |
| 6 | Resumo mínimo/máximo em `dbox` | Faixas de valores; não usar como camada geométrica |

Consulta proposta para a visão inicial:

```text
GET /api/mapa?movil=<id>&from=<inicio>&to=<fim>&mode=5&poligonos_ids=<ids_autorizados>
```

Consulta proposta ao abrir o detalhe:

```text
GET /api/mapa?movil=<id>&from=<inicio>&to=<fim>&mode=3&include_data=1&interpretate_data=1&poligonos_ids=<ids_autorizados>
```

O manual descreve mode=5 como uma Feature MultiPolygon com `properties.area`; não explicita sua unidade. Aceitar Feature e FeatureCollection e não exibir esse valor como hectares sem confirmação. Nos modos 1 a 4, `last=1` pode acrescentar um Point; tratar geometrias mistas. Atributos de segmentos correspondem à primeira das duas posições usadas em sua construção.

Não há endpoint WMS, XYZ, tiles vetoriais, filtro por janela do mapa ou webhook documentado. Não assumir suporte. A API descrita atende à consulta remota com GeoJSON; não equivale a um serviço de tiles remoto.

## Arquitetura recomendada

```text
Usuário autenticado no NEXA
  -> rota protegida /api/savecloud (proposta)
     -> valida sessão e fazendas/glebas acessíveis
     -> resolve vínculos externos autorizados
     -> consulta a API SaveCloud com segredo do servidor
     -> normaliza a resposta, sem gravar geometrias ou telemetria
  -> navegador desenha as camadas e cartões em memória
```

Persistir somente configurações necessárias: vínculo de fazenda/talhão NEXA com campo/poligono SaveCloud, conexão responsável e permissões. Segredos ficam em variáveis protegidas do servidor; nunca em `config.js`, HTML, repositório, URLs ou respostas ao navegador.

Não criar um proxy genérico que aceite URL arbitrária. Fixar host e endpoints permitidos, validar IDs e períodos, limitar concorrência e verificar a autorização de máquinas e talhões. Uma máquina pode atuar em várias fazendas: poder consultar uma fazenda não deve liberar automaticamente todo o histórico da máquina. A listagem de máquinas também deve ser filtrada.

Os filtros do navegador não são controle de acesso. Validar se `poligonos_ids` realmente restringe todos os dados retornados, principalmente a última posição, estatísticas e eventuais trajetos fora do talhão. Quando o isolamento não puder ser garantido, restringir o recurso ou aplicar recorte/filtragem no servidor antes de responder.

Usar `Cache-Control: private, no-store`, requisições sem cache e não persistir respostas em banco, Storage, disco, localStorage, IndexedDB ou cache de service worker. Não registrar corpos de resposta ou credenciais nos logs. Liberar camadas e resultados ao trocar de conta/sair. Um token mantido em memória do servidor pode ser reutilizado enquanto válido; não pressupor que essa memória sobreviva entre execuções.

Uma Supabase Edge Function é alternativa se houver vantagem operacional, mas não é necessário duplicar o conector em dois ambientes. A documentação oficial permite segredos nas funções; a proposta inicial aproveita as rotas Vercel existentes.

### Por que esse caminho

| Opção | Avaliação |
| --- | --- |
| Navegador chamando SaveCloud com token compartilhado | Expõe o segredo e depende de CORS e permissões externas; inadequado para a conexão compartilhada proposta |
| Intermediário autenticado, sem armazenamento de dados | Recomendado: protege a credencial e aplica as permissões NEXA |
| Importar arquivos ou replicar toda a API | Cria cópias, sincronização e manutenção; não atende ao objetivo de consulta sem armazenamento |
| Incorporar o painel SaveCloud em iframe | Não há suporte documentado de incorporação/SSO; também não entrega os cruzamentos nativos do NEXA |

### Desempenho e atualização

Carregar apenas ao abrir Save Farm. Primeiro catálogos e resumos; depois mode=5 para máquina, talhão e período selecionados. Mode=3/4 apenas quando solicitado. Começar com período curto, dividir consultas longas e limitar quantas máquinas são consultadas simultaneamente. Canvas pode ajudar na renderização vetorial, mas não reduz o tamanho recebido.

Cancelar consultas antigas ao mudar filtros. Exibir resultados vazios, respostas parciais e indisponibilidade de forma distinta. Em 429, respeitar Retry-After quando fornecido; em falhas temporárias, fazer poucas tentativas com espera crescente. Evitar autenticação em loop após 401/403.

Os limites de tamanho e duração da hospedagem devem ser medidos com respostas reais antes de fechar o desenho. Streaming pode ajudar no transporte, mas não elimina limites nem garante que o GeoJSON possa ser desenhado progressivamente. Se o modo consolidado ainda for grande, reduzir os recortes; consultar a Save Farm sobre tiles ou generalização remota como evolução.

Para acompanhamento, começar com botão Atualizar. Uma atualização periódica só deve ser habilitada após conhecer limites e frequência de sincronização, enquanto a aba estiver visível. Mostrar horário da consulta e horário do último dado, quando disponível. Online/working não comprovam dados instantâneos: a máquina pode sincronizar posteriormente.

## O que mostrar no NEXA

### Primeira entrega

1. Camadas alternáveis: talhões SaveCloud, aplicação consolidada e detalhada, percurso.
2. Filtros por fazenda/gleba vinculada, talhão, máquina, período e modo seletivo.
3. Cartões: litros aplicados, economia informada, área percorrida e área seletiva, respeitando metadados/unidades.
4. Resumo por trabalho/talhão e evolução diária ou horária, respeitando a granularidade disponível.
5. Lista de máquinas e seus estados: `working=0` parada, `1` deslocamento, `2` trabalhando; online separado.
6. Origem, horário da consulta e atualização dos dados identificados na tela.

### Evoluções úteis

- Planejado versus executado: comparar os talhões planejados no NEXA com operações consultadas na SaveCloud. Uma aplicação seletiva não precisa cobrir todo o talhão, portanto baixa área seletiva não significa operação incompleta.
- Economia por máquina, talhão, período e modo: comparações com volumes e condições equivalentes.
- Estimativa financeira: litros economizados multiplicados por custo compatível fornecido pelo usuário. Confirmar se o volume é de calda ou de produto concentrado e a composição antes de monetizar.
- Sobreposição e revisitas: analisar faixas detalhadas por tempo/máquina e recortar no talhão. Mode=5 elimina sobreposições e sozinho não informa reaplicações.
- Cruzar com plantio, variedade e colheita do NEXA: apresentar associações, sem atribuir efeito causal automaticamente.
- Taxa, velocidade, operador, bicos e alertas somente se os campos forem realmente expostos para aquela máquina. O site comercial descreve capacidades da plataforma que o manual não garante na API.
- Camada de concentração de aplicação seletiva pode indicar regiões a investigar; não tratar como identificação de espécie, densidade de plantas daninhas ou diagnóstico agronômico comprovado.

### Economia: regras para não distorcer

A página 14 documenta `ahorroSelectiva`, `ltsTotal`, `Hectareas`, `hectareasSelectiva` e, por trabalho, `ltsHectObj`.

```text
volumeConvencionalL = Hectareas * ltsHectObj
economiaL = max(0, volumeConvencionalL - ltsTotal)
economiaPct = economiaL / volumeConvencionalL * 100
```

Usar essa derivação somente com campos válidos e mesma base temporal/operacional. Denominador zero ou dados ausentes resultam em indicador indisponível. Não assumir `ltsHectObj` constante se houver mudança de taxa: calcular por intervalo/trabalho compatível e somar volumes. Agregar percentuais pelos volumes de referência, nunca pela média simples dos percentuais.

`Hectareas` é área percorrida durante aplicação na definição do manual; não é necessariamente área única do talhão. `hectareasSelectiva` também precisa de validação antes de ser comparada à área geométrica consolidada. Exibir economia informada e calculada com origem distinta se divergirem; investigar unidade e regra de agregação.

Preferir estatísticas prontas. `/export/?format_type=json&include_data=1` só será necessário se uma análise exigir registros ausentes nos resumos; mesmo nesse caso, processamento transitório em memória, sem salvar arquivo. Não é necessário usar exportação para desenhar os mapas documentados.

## Pontos a confirmar com a Save Farm

1. Conta de integração somente leitura, escopo de fazendas/máquinas, expiração/renovação/revogação do token e disponibilidade contratual da API.
2. Limites de chamadas, intervalo máximo, tamanho de respostas, paginação e custo/licenciamento.
3. Fuso horário, precisão dos timestamps e limites inclusivos/exclusivos dos intervalos.
4. Unidade de `properties.area`, esquema/CRS dos polígonos, unidades de volume e significado exato dos indicadores de área/economia.
5. Comportamento dos filtros de talhão/campo em cada endpoint e segurança do isolamento por fazenda.
6. Identificação do trabalho, data de atualização, produto/calda, dose e operador: quais campos existem em cada máquina e como são representados.
7. Frequência de sincronização, disponibilidade de posição recente e existência de webhooks/tiles fora deste manual.
8. A página 14 cita `/estadistica_poligono/id/`, enquanto a página 12 documenta a coleção com query `poligono`. Validar o contrato; começar pelo endpoint de coleção documentado em detalhe.

## Sequência de implementação e validação

1. Obter conexão de leitura por configuração segura; não solicitar senha no chat. Selecionar um talhão, uma máquina e um período conhecido com aplicação.
2. Validar respostas pequenas, metadados, paginação, unidades, horários e filtros de autorização; comparar com o painel SaveCloud.
3. Implementar intermediário e vínculos, preservando os cadastros atuais.
4. Entregar camada mode=5 e resumo por trabalho; adicionar mode=3 e trajetória depois.
5. Validar isolamento entre fazendas, token inválido, período vazio, 429, falhas, ausência de persistência e memória/latência em recortes maiores.
6. Seguir AGENTS.md: execução e ampliação de testes por agentes Luna, em tarefas pequenas e delimitadas. Nesta pesquisa não foram executados testes do projeto nem alterado o funcionamento do NEXA.

## Fontes públicas consultadas

- [Save Farm: recursos comerciais da SaveCloud](https://www.savefarm.com.br/). Capacidades do produto; não é contrato de endpoints da API.
- [Leaflet: GeoJSON, Canvas e camadas](https://leafletjs.com/reference.html). Sustenta o encaixe dos mapas no componente atual.
- [Vercel Functions](https://vercel.com/docs/functions). Intermediação no servidor e consultas a APIs externas.
- [Vercel: Cache-Control](https://vercel.com/docs/caching/cache-control-headers). Uso de no-store para evitar cache HTTP das respostas.
- [Vercel: limites de funções](https://vercel.com/docs/functions/limitations). Restrições a avaliar com o volume real.
- [Supabase: segredos de Edge Functions](https://supabase.com/docs/guides/functions/secrets). Alternativa de armazenamento de segredos para outro local de execução do conector.

Os endpoints, parâmetros e modos SaveCloud deste documento vêm do PDF local. A arquitetura, priorização e telas são recomendações desta análise.
