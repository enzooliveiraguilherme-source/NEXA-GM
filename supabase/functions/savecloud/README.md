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

Ainda exigem validação real: token configurado, escopo de conta, retorno das geometrias e estatísticas, fuso/intervalos, comparação de totais com a SaveCloud e desempenho com dados reais. Testes simulados não comprovam conexão operacional com a SaveCloud.
