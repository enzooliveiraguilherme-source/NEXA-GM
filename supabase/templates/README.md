# Autenticação por senha temporária

Fluxo autorizado e publicado em 16/10/2026: o administrador cadastra e-mail e permissões; o colaborador recebe OTP de seis dígitos, válido por 3600 segundos e de uso único. O email aponta somente para a página pública do portal. O colaborador informa email e código e escolhe uma senha definitiva de pelo menos oito caracteres. Depois entra normalmente com sua senha.

Primeiro convite usa verifyOtp do tipo invite. Recuperação e reenvio usam recovery; o email explica selecionar Recuperar senha na tela de senha temporária. O administrador não recebe o código nem a senha definitiva. Senhas antigas continuam aceitas no login normal.

## Proteção no banco

Aplicada a migração temporary_password_flow: pendência privada em private.password_setup, dois triggers em auth.users, proteção nas quatro funções de autorização existentes e restrição nas cinco tabelas farms, user_farm_access, seed_varieties, seed_variety_cycles e harvest_user_legends. O hash interno gerado antes de confirmar o convite não elimina a pendência; uma troca de senha posterior à confirmação libera o acesso conforme o cargo e as fazendas cadastrados.

Contas principais enzo.oliveira e enzo.geox preservadas. Silvio e Nicolas continuam pendentes e sem fazendas concedidas até a conclusão do primeiro acesso e eventual liberação pelo administrador.

## Validação

- Luna: 72 testes automatizados de sessão, convite e templates passaram.
- Teste SQL transacional tests/temporary-password-rls.sql executado com sucesso no projeto: confirmação, senha interna, mudança de senha, bloqueio de dados, Storage e limites por cargo/fazenda. Fixtures revertidas por rollback.
- Função invite-member publicada na versão 3.
- Configuração do Auth: código de seis dígitos, expiração 3600 segundos e senha definitiva mínima de oito caracteres.
- Templates devem estar salvos também em Authentication → Emails; a publicação do site não os altera.

A conferência automática de segurança registra o acesso intencional a funções SECURITY DEFINER, cuja autorização foi coberta pelo teste SQL, e a tabela privada sem política direta (sem privilégios aos clientes). A proteção contra senhas vazadas depende do plano Pro e continua indisponível no plano atual.

A entrega real no Outlook e a conclusão pelo colaborador devem ser confirmadas separadamente; HTTP 200 significa somente solicitação aceita pelo serviço. Nenhum código ou senha deve ser registrado neste repositório.

Referência: https://supabase.com/docs/guides/auth/auth-email-templates
