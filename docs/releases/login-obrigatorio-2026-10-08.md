# Login, fazendas e operações compartilhadas

Backup anterior: branch `codex/antes-login-obrigatorio-2026-10-08`, commit `4115b12`. Nenhum registro local foi apagado.

O login utiliza Supabase Auth com e-mail e senha. A sessão fica na aba, validada remotamente por `getUser`. Nova abertura exige credenciais; F5 mantém a sessão durante o uso. O perfil vem de `profiles`, sem privilégios concedidos por endereço de e-mail ou URL. Após as credenciais, o colaborador escolhe uma única fazenda dentre as liberadas pelo administrador. A seleção é revalidada no servidor antes de entrar.

O cadastro solicita nome, e-mail, senha e uma fazenda. Essa escolha cria somente um pedido; não concede acesso. A confirmação de e-mail está ativada. O endereço de retorno e a URL autorizada foram configurados para `https://nexa-gm.vercel.app/index.html`. A pedido do proprietário, a interface aceita senhas somente numéricas, sem exigência de letras ou símbolos. Para novos cadastros, mantém o mínimo de 6 caracteres imposto pelo Supabase. Login de contas existentes consulta o serviço sem aplicar requisitos locais de complexidade ou tamanho. Senhas existentes não foram alteradas. O token do link de confirmação nunca abre o portal automaticamente.

O administrador usa “Gerenciar acessos” para definir Visualizador, Editor (papel `projetista`), Administrador, fazendas individuais ou todas. Administradores continuam acessando todas; colaboradores sem atribuição aguardam liberação. Nenhuma fazenda foi atribuída automaticamente às contas existentes.

Plantio, adubação, planejamento e histórico usam o banco. A geometria e os registros são carregados apenas da fazenda escolhida. As políticas RLS impedem consultar e gravar em outras fazendas. Alterações do grupo usam uma transação; conflito em qualquer talhão desfaz o grupo completo. Autor e datas são definidos pelo banco. Falhas mantêm o formulário aberto e não atualizam o cache como se a gravação tivesse ocorrido. F5 consulta alterações feitas por outro computador; versões protegem edições simultâneas.

Foi aplicada a migração combinada `operations_and_farm_access`, reunindo `202610060001_operations.sql` e `202610080006_farm_access.sql` em uma única transação; em seguida `restrict_auth_helpers_to_signed_in_users` (`202610080007_function_permissions.sql`). O banco contém 16 fazendas e 225 talhões únicos. Cópias idênticas do mapa foram descartadas; partes do mesmo talhão foram agrupadas em MultiPolygon. Feições sem fazenda foram excluídas. A colheita existente permanece no banco, consultável por quem possui acesso à FE.

O build publica somente as páginas e os recursos de interface em `site-dist`. GeoJSON, fontes QMD, derivados de colheita, SQL e testes não são copiados. O app não usa os arquivos públicos como alternativa ao banco. O envio da base antiga por arquivos públicos foi ocultado, pois a base já existe no banco.

“Importar registros deste navegador” oferece revisão, cópia para download e gravação de registros novos da fazenda ativa. Ignora demonstrações com autor `Operador Inicial`, outras fazendas e contextos existentes no banco. A cópia local permanece; o histórico antigo fica disponível no backup, e o banco registra a autoria/data atuais da importação. A importação ocorre por tipo em blocos de até 500; após uma falha parcial, reabrir a revisão identifica o que ainda falta. As listas de filtros continuam como preferências locais, acrescidas dos contextos existentes nos registros compartilhados.

Validação: 41 testes de autenticação, cache, importação, seleção múltipla e transporte Supabase, além de sintaxe. `tests/farm-access.sql` foi executado no banco com usuários temporários e rollback: isolamento de fazendas, visualizador, e-mail não confirmado, lote, conflito e auditoria passaram. Consulta administrativa confirmou 2 contas existentes, 16 fazendas e 225 talhões. Não foram usadas senhas reais em testes ou enviadas confirmações para terceiros.

## Envio de confirmação por Gmail temporário

SMTP personalizado configurado no painel Supabase com `smtp.gmail.com`, porta `465`, remetente e usuário `enzo.geox@gmail.com` e nome `Geoportal Grupo Michels`. A senha de app foi informada pelo proprietário e armazenada somente no painel; nenhuma credencial foi escrita no código ou no Git. O SMTP ativo, host e senha armazenada foram verificados após recarregar o painel em 08/10/2026. Teste autorizado em 08/10/2026 às 15:40 (America/Sao_Paulo): solicitação de recuperação para a conta confirmada do proprietário retornou HTTP 200; o banco registrou `recovery_sent_at` correspondente. A senha existente não foi alterada. O proprietário confirmou a chegada na caixa de entrada. O envio SMTP e a entrega foram validados; este teste não valida o fluxo completo de cadastro de um novo colaborador.

O remetente pode ser substituído depois, sem remover contas, fazendas ou registros. O nome escolhido para a senha de app no Google não altera o remetente. Para produção com maior volume, configurar um serviço de e-mails com domínio verificado.

Referências: [SMTP Supabase](https://supabase.com/docs/guides/auth/auth-smtp), [Google SMTP no Supabase](https://supabase.com/docs/guides/troubleshooting/using-google-smtp-with-supabase-custom-smtp-ZZzU4Y), [senhas de app Google](https://support.google.com/accounts/answer/185833?hl=pt-BR).
## Retorno sem apagar dados

Restaurar frontend e `vercel.json` da branch de backup em um novo commit, sem force push. Isso reativa a persistência local antiga; os registros gravados no banco permanecem. Não remover tabelas de operações, histórico, fazendas ou atribuições. As regras por fazenda podem permanecer; visualizadores sem atribuição não consultarão a colheita no banco pelo frontend antigo. Configurações de senha, confirmação e URLs são independentes do frontend. Não utilizar o fallback antigo de administrador para liberar novas contas.
