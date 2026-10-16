# E-mails do Geoportal Grupo Michels

Fluxo atualizado em 16/10/2026 para convite e escolha de senha pelo colaborador.

- Invite user: invite.html. Assunto: Seu convite para o Geoportal Grupo Michels.
- Reset password: recovery.html. Assunto: Redefinir senha do Geoportal Grupo Michels.

O administrador informa nome, e-mail, cargo e glebas em Membros e acessos → Adicionar membro. A função invite-member valida o administrador, envia o convite pelo SMTP configurado no Supabase e salva as permissões. O administrador não escolhe nem recebe a senha do colaborador.

Os modelos usam TokenHash em um link para o portal. Abrir a página apenas apresenta a confirmação; verifyOtp ocorre após clicar em Aceitar convite e criar senha. Essa etapa evita consumir o convite durante a pré-verificação automática de links por clientes de e-mail, como Outlook. Depois, a pessoa define e confirma sua senha, encerra a sessão temporária e entra com e-mail e senha. Links antigos com tokens no fragmento continuam compatíveis.

Os dois modelos foram salvos também em Authentication → Emails no projeto qdvlwszyehblmrjnqglx. Publicar o site não altera os modelos do Supabase. O nome e as credenciais SMTP existentes foram preservados. A entrega na caixa de entrada do Outlook depende também do provedor e dos filtros da organização, e deve ser conferida com um destinatário real.

Validação: 43 testes automatizados de autenticação e convites passaram, executados e ampliados pelo Luna. Publicação Vercel confirmada para o commit 6b313d42a4c95c675a306c869622a7fa795dff7e. Conferido o carregamento da confirmação de convite em produção com um hash fictício, sem criar conta nem enviar e-mail real.

Referência: https://supabase.com/docs/guides/auth/auth-email-templates
