# SaveCloud no NEXA

## Conexão persistente (02/11/2026)

O administrador usa **Conectar conta** no NEXA. A função autentica na SaveCloud e salva somente o token criptografado no Supabase Vault, no segredo fixo `nexa_savecloud_connection`. A senha é transitória e o token nunca volta ao navegador. O catálogo é carregado automaticamente após conectar e nas próximas visitas. O token salvo tem precedência sobre o antigo segredo de ambiente `SAVECLOUD_TOKEN`, que continua funcionando como alternativa enquanto não houver uma conexão salva.

A migração `20261102200237_savecloud_persistent_connection.sql` cria funções privadas com nome fixo e duas entradas públicas invoker. Somente `service_role` pode executá-las, e as funções privadas verificam esse papel novamente. A chave privilegiada é usada apenas no servidor, após o handler validar o usuário confirmado e seu cargo de administrador com o JWT pessoal. Fazendas e consultas mantêm as verificações existentes. Nenhum mapa, aplicação ou senha é armazenado.

Quando a SaveCloud retorna 401, a função responde 409 com `SAVECLOUD_RECONNECT_REQUIRED`. A interface descarta os resultados, bloqueia novas consultas e abre Conectar conta. Erros temporários de rede e limite de consultas não apagam a credencial. Uma troca de conta substitui a conexão compartilhada entre administradores. Não se promete renovação automática de credenciais revogadas pelo fornecedor.

Publicar a migração antes de `index.ts`/`handler.mjs`, depois publicar o frontend. O runtime utiliza `SUPABASE_SERVICE_ROLE_KEY` apenas para os RPCs do cofre. Não imprimir resultados de `savecloud_connection_read` em logs ou ferramentas de depuração.

Fluxo: navegador NEXA autenticado -> função `savecloud` no Supabase -> API SaveCloud -> função -> camada Leaflet e indicadores em memória.

## Retenção

Não há tabela, bucket, arquivo ou rotina de importação para aplicações/geometrias SaveCloud. A única escrita é a credencial no cofre; mapas e estatísticas usam cache HTTP `private, no-store`, prazo de 25 segundos e teto de 6 MiB para respostas externas por consulta. Não registra payloads ou credenciais em logs da aplicação.

No navegador, trocar filtros, usar Limpar mapa, sair da aba Save Farm, sair da conta ou fechar a página aborta solicitações e libera as referências de camadas e indicadores. A coleta física da memória é gerenciada pelo navegador/runtime; não se promete apagamento seguro de RAM. Logs operacionais da plataforma ainda podem registrar metadados da requisição, sem a aplicação enviar geometrias ou tokens aos logs.

Somente segredos da conexão e vínculos de IDs são configurações persistentes. Não criar cópias temporárias dos mapas para depois apagá-las: eles já não são gravados.

## Configuração protegida

Cadastrar no painel Supabase, Edge Functions -> Secrets:

| Nome | Valor |
| --- | --- |
| `SAVECLOUD_TOKEN` | Token real obtido por POST `/api/auth`; nunca colocar no frontend, repositório ou chat |
| `SAVECLOUD_TIME_ZONE` | Fuso da interpretação dos horários pela API, após confirmação com o fornecedor |
| `SAVECLOUD_ACCOUNT_MODE` | `1` habilita a consulta administrativa por máquina, sem vínculo com talhão |
| `SAVECLOUD_BINDINGS` | Opcional: JSON de vínculos explícitos, formato abaixo |
| `SAVECLOUD_ALLOWED_ORIGINS` | Opcional: origens exatas de prévias autorizadas, separadas por vírgula |

O fuso informado é apresentado na tela. Ele documenta a interpretação esperada; a função recebe horários sem offset e não os converte silenciosamente. Confirmar fuso e inclusão dos limites do intervalo com a Save Farm antes de interpretar totais diários como definitivos.

O formulário **Conectar ou trocar conta SaveCloud** envia usuário e senha à função autenticada, que usa o endpoint fixo `/api/auth`. O acesso é salvo automaticamente no cofre; não é necessário abrir o painel Supabase nem copiar tokens. Esse fluxo continua exclusivo de administradores.

A ação `authenticate` mantém entrada limitada e resposta externa limitada a 64 KiB. O token de 40 caracteres hexadecimais é validado no servidor e somente uma confirmação de sucesso é devolvida ao navegador. Mensagens de erro não repetem senha, token ou corpo bruto do fornecedor. Sair da aba ou da conta limpa os campos do formulário.

O segredo de ambiente `SAVECLOUD_TOKEN` é compatibilidade com a configuração anterior; novas conexões devem usar o formulário do NEXA.

Exemplo fictício de vínculos (IDs externos devem ser strings):

```json
[
  {
    "farm": "CODIGO_NEXA",
    "campo": "123",
    "polygons": [{ "id": "456", "label": "Talhão exemplo" }],
    "machines": [{ "id": "789", "label": "Máquina exemplo" }]
  }
]
```

Os vínculos não contêm geometrias. Sem token/configuração, catálogo informa conexão pendente e nenhuma consulta de mapa é liberada. Se `SAVECLOUD_ACCOUNT_MODE=1`, o catálogo descobre as máquinas permitidas pelo token na própria API e confere novamente a máquina escolhida antes de cada consulta. Não é preciso inventar vínculo com uma fazenda NEXA quando a conta externa não fornece talhões. A interface identifica consultas por máquina como capazes de abranger várias fazendas.

## Autorização e primeira liberação

- JWT do usuário obrigatório, `verify_jwt=true` na implantação e `getUser` no handler.
- Cargo de administrador conferido no banco via `is_admin`, em cada chamada.
- Fazendas vinculadas conferidas por `list_accessible_farms_by_gleba`, usando o JWT do próprio usuário e RLS. O cliente privilegiado serve exclusivamente ao cofre, após essa autorização.
- Consulta por máquina habilitada separadamente por segredo e somente para administrador. Não habilitar esse modo para outros perfis sem implementar isolamento validado.
- Host externo fixo, redirecionamentos desativados e paginação verificada/restringida ao endpoint e filtros originais.
- Lista de ações/argumentos e períodos limitada; não aceita URL externa do navegador.

A decisão de limitar a administradores é da primeira etapa de validação. Antes de liberar projetistas/visualizadores, verificar isolamento espacial, filtros e trajetos, inclusive quando máquinas passam por várias fazendas.

## Tela

`js/savefarm-view.js` é carregado em `portal.html` antes de `app.js`. `renderMap` chama `SaveFarmView.refresh(state)`; entrar em Save Farm consulta o catálogo e sair descarta os dados. Alterações no cadastro/planejamento existente não são necessárias.

Consulta por máquina ou talhão, período máximo de sete dias, com horas inteiras:

- modo 5: cobertura consolidada;
- modo 3: faixas aplicadas;
- modo 4: percurso e aplicação;
- modo 1: percurso;
- boundaries: limite do talhão, quando houver vínculo externo real.

**Taxa de aplicação (L/ha)** usa o modo 3 com `include_data=1`. A função consulta o dicionário da máquina e identifica a taxa efetivamente aplicada em L/ha, separada da taxa objetivo e mínima. No contrato observado, esse campo é `280` (Produto por hectare). Aplica os coeficientes `c` e `o` informados pelo fornecedor; valores ausentes, inválidos e negativos viram nulos, sem converter ausência em zero. Somente a taxa normalizada acompanha a geometria na resposta; os demais atributos brutos continuam descartados.

A rampa utiliza o esquema `s` do campo ou o esquema `def` da máquina, com limites da consulta fornecidos por `dbox` e valores observados como alternativa. Esquemas graduais são interpolados em RGB; esquemas sólidos preservam intervalos. Na ausência de configuração válida, o mapa identifica o esquema alternativo como NEXA. Taxa constante e trechos sem taxa têm apresentação própria; ausência aparece em cinza. A legenda e os valores são descartados juntamente com a camada. Cobertura consolidada continua sendo uma camada de cor única, pois o modo 5 não preserva a taxa de cada faixa.

Mapas detalhados têm o mesmo teto de resposta da integração. Se a consulta exceder o limite, reduza o período; o sistema não deve truncar ou apresentar um mapa parcial como completo.

Estatísticas por trabalho são paginadas até o fim ou falham explicitamente ao atingir limites. Mapa e indicadores têm falhas independentes, sem conservar totais de uma consulta anterior. Metadados instantâneos dos polígonos não são exibidos nesta primeira etapa. `properties.area` do mapa não vira hectares sem unidade confirmada.

Totais ausentes, strings numéricas não validadas, valores negativos ou não finitos produzem indicador indisponível. A economia calculada soma volumes convencionais de referência por registro e compara ao volume aplicado; não faz média simples de percentuais. Todas as métricas são apresentadas como prévia até comparação com o painel SaveCloud e confirmação de unidades/taxa/intervalos.

## Implantação

Publicar `index.ts` e `handler.mjs` juntos na função `savecloud` do projeto Geoportal Grupo Michels (`qdvlwszyehblmrjnqglx`), mantendo `verify_jwt=true`. O pacote Supabase JS usa versão fixa 2.57.4. O frontend usa o projeto já configurado em `config.js`, sem token SaveCloud público.

Não publicar o diretório de trabalho inteiro inadvertidamente: ele já contém alterações de outras frentes. A entrega do frontend deve usar uma versão revisada do NEXA e incluir somente os arquivos necessários, sem dados privados ou arquivos de apoio da API.

## Verificação

Conforme AGENTS.md, testes executados/ampliados por agentes Luna:

- `node --test tests/savecloud-handler.test.mjs` (mocks, sem credenciais reais).
- `node --test tests/savefarm-view.test.cjs` (DOM/Leaflet e dados simulados).
- Regressões direcionadas de plantio, glebas, colheita e seleção em lote.
- Na função publicada: OPTIONS autorizado 204; POST sem JWT e com JWT inválido 401.

Foi confirmada pela tela autenticada do NEXA a conexão real: catálogo de máquinas, cobertura consolidada no mapa e estatísticas por trabalho, usando exclusivamente a função Supabase. Nenhum payload agrícola dessa verificação foi gravado no projeto.

Ainda exigem validação: limites de talhões (a conta consultada retornou catálogo vazio), fuso/intervalos, unidades e comparação de totais/economia com o painel SaveCloud, desempenho em recortes maiores e isolamento antes de liberar outros perfis. Os testes unitários continuam usando somente dados simulados; a consulta real foi uma verificação separada na interface.
