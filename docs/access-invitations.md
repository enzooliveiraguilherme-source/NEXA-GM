# Acesso por convite

O administrador abre Opções → Membros e acessos → Adicionar membro.
Define e-mail, nome opcional, cargo e acesso a todas ou a glebas específicas.
Ao marcar uma gleba, o formulário salva todas as fazendas cadastradas nela.
O banco continua validando a permissão de cada fazenda individualmente.
Acessos antigos parciais são indicados sem serem ampliados automaticamente;
marcar explicitamente a gleba libera o grupo completo.
Administrador implica acesso global. Projetista e visualizador podem ter escopo limitado.
Todas as fazendas inclui as que forem adicionadas no futuro.

O convite usa Supabase Auth e o destino oficial index.html. A pessoa cria a senha pelo
link type=invite; a página valida a sessão no Auth, limpa os tokens da URL e pede um
novo login após salvar. O cargo e as fazendas continuam sendo consultados no banco.
As contas existentes mantêm suas permissões; o formulário permite editá-las.

invite-member usa getUser(token) e is_admin() com o token do solicitante antes
de utilizar a chave de serviço exclusivamente no servidor. admin_set_access também
valida o administrador no banco. Nenhum cargo vindo de user_metadata é confiado.
Se o e-mail for enviado mas as permissões falharem, a interface informa o resultado
parcial e o novo membro permanece sem fazendas liberadas.

Não existe cadastro público na interface nova. Ao ativar o convite em produção,
desativar Allow new users to sign up em Authentication → Sign In / Providers.
Manter Confirm email ativo. SMTP personalizado já está configurado.

## Autenticação da função

O projeto usa JWT ES256, confirmado no JWKS público em 09/10/2026.
Conforme a documentação de signing keys do Supabase, a verificação legada
da plataforma Edge Functions é incompatível com ES256. A função implementa
validação obrigatória própria via Auth getUser, além da autorização no banco.
O ajuste verify_jwt=false foi autorizado pelo usuário e aplicado em 09/10/2026.
A checagem de autenticação e do cargo é obrigatória dentro da função.

Testes de convite usam clientes simulados, sem enviar e-mails ou criar contas reais.
Testes de autenticação cobrem convite, recuperação, sessão e visibilidade de fazendas.
