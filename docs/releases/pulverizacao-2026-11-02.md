# Cronograma de pulverização

Pulverização usa exclusivamente a execução do plantio do talhão, safra e cultura selecionados. Talhões sem execução ou data de plantio não geram cronogramas.

São cinco aplicações: 1ª Pós (+15 dias do plantio), 2ª Pós (+10), 1º Fungicida (+10), 2º Fungicida (+15) e 3º Fungicida (+15). O 4º Fungicida (+15) é opcional por talhão. Cada etapa utiliza a realização anterior quando disponível; caso contrário, a previsão anterior gera uma projeção provisória. Correções não movem as datas efetivamente realizadas de outras etapas.

A edição mostra a prévia imediatamente, mas só confirma as realizações após salvar. Campos podem ser corrigidos ou limpos, respeitando a ordem das aplicações. Não são aceitas realizações futuras, anteriores ao plantio ou com etapas anteriores ainda sem registro. Pendências são verdes acima de dois dias, amarelas de dois dias até hoje e vermelhas após o vencimento. O calendário usa America/Sao_Paulo.

O painel inclui totais, concluídas, pendentes, atenção, atrasadas, próxima pendência, percentual concluído, edição por talhão e panorama em tabela. Os filtros de gleba, fazenda, safra e cultura são preservados.

Persistência em spray_schedules, vinculada por chave estrangeira ao registro de plantio. RLS limita a leitura às fazendas liberadas e a gravação a administradores/projetistas autorizados. O banco valida a sequência e registra autor, horário e versão. Atualizações concorrentes são detectadas por versão. Não há gravação de previsões como se fossem realizações.

Validação: agentes Luna executaram os testes de calendário, cálculo, status, resumo, repositório, interface simulada e regressão de Plantio. O teste SQL usa apenas contas e operações sintéticas em transação revertida com ROLLBACK, cobrindo acesso por fazenda, permissões, datas, quarto fungicida e concorrência. Dados reais não foram modificados para testar.

A prévia isolada utiliza somente dados fictícios. A conferência visual em navegador não foi concluída nesta sessão: o navegador integrado estava indisponível e a autorização de acesso à janela do Chrome expirou. A validação de interface realizada foi automatizada com DOM simulado, não uma conferência visual em dispositivo real.
