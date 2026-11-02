# Pré-emergente, Boro e Dessecação pré-plantio

Restaura as três colunas da tabela de referência, na ordem Pré-emergente, Boro e Dessecação pré-plantio, antes das pós-emergentes. Cada talhão cadastrado do contexto recebe campos dessas etapas, mesmo que ainda não exista execução ou data de plantio.

Não foram inventados intervalos agronômicos: previsão e realização têm lançamento manual e autosave. A realização pode ser anterior ao plantio e não exige completar outras aplicações. É possível registrar apenas a realização, preservando previsão vazia. Sem datas, a etapa fica neutra e não entra em pendências, atrasos ou áreas programadas. Datas informadas passam a usar as mesmas cores, filtros e dados de produto/dose/responsável/observações das demais aplicações.

As três etapas são identificadas por fazenda, talhão, safra, cultura e etapa, sem depender do ID do plantio. Registrar ou corrigir o plantio depois não duplica nem desloca esses lançamentos. A sequência de pós-emergentes e fungicidas continua usando exclusivamente suas próprias datas reais e os intervalos definidos anteriormente. O quarto fungicida permanece visível e opcional.

O banco permite os três identificadores independentes (pre, boro, desiccation), mantém a unicidade por contexto, aceita previsão vazia nessas etapas e atualiza a identificação de duplicatas da RPC de lote. Aplicações genéricas continuam exigindo previsão; etapas pós/fungicidas continuam exigindo vínculo com plantio. RLS, autoria, versionamento, validação de realização futura e atomicidade continuam vigentes. Nenhum dado agrícola existente foi alterado pela migração.

Agentes Luna executam testes de domínio, grid, repositório e autosave. Testes SQL com fixtures sintéticas em transação revertida verificam as três inclusões em lote sem plantio, datas anteriores ao plantio, previsão NULL, escopos/duplicatas, permissões e rollback ao misturar etapas independentes e encadeadas. Conferência visual em navegador real permanece indisponível nesta sessão.
