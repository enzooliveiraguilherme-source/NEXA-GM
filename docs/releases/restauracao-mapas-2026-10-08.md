# Registros antigos, colheita e coluna lateral

Correções publicadas em `9dca7b1` e `670e61f`. Backup da versão anterior: branch `codex/antes-restaurar-mapas-2026-10-08`, commit `87b86e2`.

A coluna lateral permite quebra de linha nos botões e reserva uma linha inteira para o nome e a fazenda. A seleção da fazenda permanece no acesso escolhido ao alternar operações. Em telas menores, o mapa mantém altura mínima de 500 px; o desenho dos pontos aguarda dimensões válidas.

O navegador da sessão do proprietário conservava 21 registros antigos. A migração anterior ignorava a autoria `Operador Inicial`; essa exclusão foi removida para preservar o que já era exibido. Ao abrir a fazenda como editor, registros locais compatíveis são recuperados automaticamente, com confirmação do banco antes de atualizar o mapa. Contextos já existentes nunca são sobrescritos, e a cópia local permanece. A importação manual continua disponível para revisão, download e novas tentativas.

Na sessão validada, 20 registros foram recuperados automaticamente; o banco passou a conter 21 registros de adubação da FE em 2026, Soja, Calcário PRNT 80: 7 concluídos, 7 em andamento e 7 não iniciados. Registros de outros navegadores dependem de abrir o portal na origem para a recuperação automática. Nenhum registro de plantio foi inventado.

Os pontos originais da colheita estavam no banco, mas o desenho geral ainda procurava resoluções em arquivos públicos que foram removidos. A migração `private_harvest_rasters` criou `harvest_raster_files`, com RLS por acesso à FE e escrita administrativa. Os 127 arquivos originais de resolução foram copiados para a mesma versão ativa: um índice e 126 resoluções. Os 64 arquivos de pontos foram preservados. O desenho agora consulta o banco; fontes privadas continuam fora da publicação. O controle administrativo de restauração fica oculto quando a base está completa.

Validação: 50 testes de autenticação, transporte, recuperação, operações em lote e colheita, além dos testes de continuidade das células e sincronização do zoom. `tests/harvest-rasters-rls.sql` passou no banco com usuário temporário e rollback: FE2 recebe zero resoluções, e FE recebe as 127 da versão ativa. Anônimos não possuem SELECT. A sessão real confirmou o mapa de colheita desenhado, registros de adubação coloridos e coluna legível.

Restaurar o frontend anterior por novo commit preserva registros, resoluções e pontos no banco. Não remover as tabelas para retornar uma versão.
