# Escolha de fazendas por gleba

A entrada mantém e-mail e senha em cada nova abertura. A última fazenda fica guardada como preferência por usuário e projeto neste navegador; nunca como autorização ou token permanente. Uma única fazenda liberada entra diretamente. Havendo várias, a preferência só é usada se continuar liberada no banco. O botão Trocar fazenda permite alterar a escolha durante o uso.

As listas de entrada, solicitação de cadastro e troca agrupam fazendas pela gleba cadastrada, mantendo uma fazenda por sessão. O catálogo de glebas foi derivado dos talhões originais. Agrupar FE e FE2 em FE não concede acesso entre elas.

Validação: 53 testes de autenticação, operações, recuperação e colheita aprovados. O teste SQL farm-gleba-rls.sql confirma que um usuário liberado apenas para FE2 recebe somente FE2, agrupada em FE. A nova consulta não pode ser executada anonimamente.

Versão anterior preservada em codex/antes-lembrar-fazenda-2026-10-08, commit 64ad49d. A migração de catálogo é aditiva e compatível com a interface anterior, que continua usando list_accessible_farms().
