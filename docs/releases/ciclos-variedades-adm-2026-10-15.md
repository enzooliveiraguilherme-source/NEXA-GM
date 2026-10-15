# Variedades e ciclos administráveis

O administrador acessa **Opções → Variedades e ciclos** para cadastrar uma variedade/cultura e definir ou alterar os dias após o plantio. As variedades já utilizadas continuam disponíveis para definir ciclo. O prazo aceita de 1 a 730 dias inteiros; em branco significa sem previsão. Nome e cultura de um ciclo existente ficam bloqueados na edição para preservar a associação com os plantios.

O catálogo compartilhado está em `public.seed_variety_cycles`, criado pela migration `20261015140507_seed_variety_cycles.sql`. Olimpo/Soja e NEO 790/Soja foram inicializadas com 114 dias. NEO780 permanece distinta e sem prazo assumido. O catálogo original de sementes não foi removido ou alterado. Novos nomes também entram nas sugestões de sementes do plantio.

Os mapas oficiais carregam o catálogo autenticado antes dos dados de execução. Após salvar, a sessão do administrador recalcula os mapas imediatamente; os demais usuários recebem os ciclos vigentes ao carregar/recarregar o portal. Datas e hectares de execução permanecem intactos. O ciclo é referência atual da variedade/cultura, não um valor congelado por safra, então sua alteração recalcula previsões de qualquer safra consultada.

Falha na consulta do catálogo deixa as previsões indisponíveis em vez de reaplicar silenciosamente os ciclos fixos da demonstração. O aviso aparece na legenda do mapa. A demonstração isolada mantém os seus padrões fictícios.

A proteção é aplicada por RLS no banco: leitura autenticada; inserção e edição somente por `public.is_admin()`, que consulta perfil confirmado no banco. Anônimo não consulta o catálogo. Não há exclusão pelo site. Chaves normalizadas impedem duplicações por caixa/espaço, incluindo NEO790/NEO 790. O banco valida a faixa de dias e controla versão, horário e autor. A edição envia a versão lida e trata conflito sem sobrescrever outra alteração.

Validações realizadas: 48 testes automatizados aprovados, incluindo recálculo, remoção do ciclo, cultura, leitura incompleta/falha, erro de permissão e conflito. Testes RLS em transação revertida confirmaram leitura por visualizador/projetista, bloqueio das suas gravações, inserção/edição pelo ADM, versão/autoria geradas no servidor, duplicação rejeitada, dias inválidos rejeitados e leitura anônima bloqueada. Os testes não deixaram variedades temporárias nem prazos alterados no banco. A consulta final confirmou os dois ciclos iniciais de 114 dias.

Conferência de tela com cliente fictício local: abrir Opções, listar ciclos, localizar variedade sem ciclo, editar Olimpo e adicionar uma nova variedade. Esses dados fictícios não fazem parte da publicação. A revisão de segurança do Supabase não apontou problema na nova tabela/funções; os avisos existentes de funções administrativas SECURITY DEFINER e configuração de senhas não foram alterados nesta entrega.

Base oficial anterior: `33e3a58614cff5111e37a56a4f3a031ae453417e`. O retorno do frontend pode usar a branch `codex/antes-ciclos-adm-2026-10-15`; o catálogo no banco deve ser preservado. Para retornar apenas esta funcionalidade depois que o ADM alterar prazos, não reativar silenciosamente o cálculo fixo antigo: conferir os valores do catálogo antes da decisão.
