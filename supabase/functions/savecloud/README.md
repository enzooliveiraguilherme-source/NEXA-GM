# SaveCloud no NEXA: primeira etapa

Fluxo: navegador NEXA autenticado -> função `savecloud` no Supabase -> API SaveCloud -> função -> camada Leaflet e indicadores em memória.

## Retenção

Não há tabela, bucket, arquivo ou rotina de importação para aplicações/geometrias SaveCloud. A função não realiza escrita no banco nem no Storage, usa cache HTTP `private, no-store` e impõe prazo de 25 segundos e teto de 6 MiB para respostas externas por consulta. Não registra payloads ou credenciais em logs da aplicação.

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

Se a documentação Swagger não enviar o formulário de autenticação, o administrador pode abrir **Configurar acesso SaveCloud** no NEXA. O formulário envia usuário e senha uma única vez à função autenticada do Supabase, que faz POST no endpoint fixo `/api/auth` da SaveCloud. Não grava senha, não registra o corpo em logs e limpa o campo após a solicitação. O token retornado fica em um campo mascarado, somente nesta sessão, para ser transferido ao segredo protegido `SAVECLOUD_TOKEN`. Esse fluxo não salva o segredo automaticamente nem dá acesso a outros perfis.

A ação `authenticate` tem a mesma exigência de administrador, entrada limitada e resposta externa limitada a 64 KiB. O token de 40 caracteres hexadecimais é aceito no retorno; mensagens de erro não repetem senha, token ou corpo bruto do fornecedor. Sair da aba ou da conta limpa senha e token do formulário. Trate o envio desse formulário como geração de uma credencial: o administrador deve saber que sua senha passa pelo Supabase até a SaveCloud e autorizar a ação.

Use **Copiar token** no formulário e cole diretamente no painel protegido do Supabase. Não extraia o valor do campo mascarado por uma ferramenta de navegação: ela pode substituir o conteúdo por `<redacted>`, invalidando a configuração. A cópia ocorre dentro da própria página, por ação explícita, sem exibir a credencial no chat.

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
- Fazendas vinculadas conferidas por `list_accessible_farms_by_gleba`, usando o JWT do próprio usuário e RLS. Não usa service_role.
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
