# Login, fazendas e operações compartilhadas

Backup anterior: branch `codex/antes-login-obrigatorio-2026-10-08`, commit `4115b12`. Nenhum registro local foi apagado.

O login utiliza Supabase Auth com e-mail e senha. A sessão fica na aba, validada remotamente por `getUser`. Nova abertura exige credenciais; F5 mantém a sessão durante o uso. O perfil vem de `profiles`, sem privilégios concedidos por endereço de e-mail ou URL. Após as credenciais, o colaborador escolhe uma única fazenda dentre as liberadas pelo administrador. A seleção é revalidada no servidor antes de entrar.

O cadastro solicita nome, e-mail, senha e uma fazenda. Essa escolha cria somente um pedido; não concede acesso. A confirmação de e-mail está ativada. O endereço de retorno e a URL autorizada foram configurados para `https://nexa-gm.vercel.app/index.html`. Novas senhas exigem ao menos 8 caracteres, minúscula, maiúscula, número e símbolo conforme a opção do serviço. Senhas existentes não foram alteradas. O token do link de confirmação nunca abre o portal automaticamente.

O administrador usa “Gerenciar acessos” para definir Visualizador, Editor (papel `projetista`), Administrador, fazendas individuais ou todas. Administradores continuam acessando todas; colaboradores sem atribuição aguardam liberação. Nenhuma fazenda foi atribuída automaticamente às contas existentes.

Plantio, adubação, planejamento e histórico usam o banco. A geometria e os registros são carregados apenas da fazenda escolhida. As políticas RLS impedem consultar e gravar em outras fazendas. Alterações do grupo usam uma transação; conflito em qualquer talhão desfaz o grupo completo. Autor e datas são definidos pelo banco. Falhas mantêm o formulário aberto e não atualizam o cache como se a gravação tivesse ocorrido. F5 consulta alterações feitas por outro computador; versões protegem edições simultâneas.

Foi aplicada a migração combinada `operations_and_farm_access`, reunindo `202610060001_operations.sql` e `202610080006_farm_access.sql` em uma única transação; em seguida `restrict_auth_helpers_to_signed_in_users` (`202610080007_function_permissions.sql`). O banco contém 16 fazendas e 225 talhões únicos. Cópias idênticas do mapa foram descartadas; partes do mesmo talhão foram agrupadas em MultiPolygon. Feições sem fazenda foram excluídas. A colheita existente permanece no banco, consultável por quem possui acesso à FE.

Os caminhos públicos de GeoJSON, fontes QMD, derivados da colheita, SQL e testes são bloqueados na publicação. O app não usa mais os arquivos públicos como alternativa ao banco. O envio da base antiga por arquivos públicos foi ocultado, pois a base já existe no banco.

“Importar registros deste navegador” oferece revisão, cópia para download e gravação de registros novos da fazenda ativa. Ignora demonstrações com autor `Operador Inicial`, outras fazendas e contextos existentes no banco. A cópia local permanece; o histórico antigo fica disponível no backup, e o banco registra a autoria/data atuais da importação. A importação ocorre por tipo em blocos de até 500; após uma falha parcial, reabrir a revisão identifica o que ainda falta. As listas de filtros continuam como preferências locais, acrescidas dos contextos existentes nos registros compartilhados.

Validação: 41 testes de autenticação, cache, importação, seleção múltipla e transporte Supabase, além de sintaxe. `tests/farm-access.sql` foi executado no banco com usuários temporários e rollback: isolamento de fazendas, visualizador, e-mail não confirmado, lote, conflito e auditoria passaram. Consulta administrativa confirmou 2 contas existentes, 16 fazendas e 225 talhões. Não foram usadas senhas reais em testes ou enviadas confirmações para terceiros.

## Envio de confirmação pendente

O SMTP padrão ainda restringe destinatários fora da equipe. O usuário autorizou criar um serviço; a página de criação Resend foi aberta para conclusão pessoal da senha e aceite dos termos. Conexão Resend e domínio verificado dependem do usuário. É preciso habilitar o SMTP e verificar a entrega para colaboradores antes de considerar o envio concluído.

Resend gratuito: 3.000 e-mails/mês, até 100/dia. A integração oficial Resend–Supabase configura o SMTP sem copiar chaves pela conversa. Configuração manual, se necessária, deve ser feita privadamente no painel: host `smtp.resend.com`, porta `465`, usuário `resend`, chave de envio como senha. Nunca colocar essa chave no código, no navegador do portal ou no Git.

Referências: [SMTP Supabase](https://supabase.com/docs/guides/auth/auth-smtp), [integração Resend](https://supabase.com/partners/catalog/resend), [SMTP Resend](https://resend.com/docs/send-with-supabase-smtp), [plano gratuito](https://resend.com/pricing).

## Retorno sem apagar dados

Restaurar frontend e `vercel.json` da branch de backup em um novo commit, sem force push. Isso reativa a persistência local antiga; os registros gravados no banco permanecem. Não remover tabelas de operações, histórico, fazendas ou atribuições. As regras por fazenda podem permanecer; visualizadores sem atribuição não consultarão a colheita no banco pelo frontend antigo. Configurações de senha, confirmação e URLs são independentes do frontend. Não utilizar o fallback antigo de administrador para liberar novas contas.
