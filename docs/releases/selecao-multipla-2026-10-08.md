# Seleção múltipla no plantio e na adubação

Versão anterior preservada na branch `codex/antes-selecao-multipla-2026-10-08`, no commit `45666fc908907566970a5558a9da764c3f106639`.

Na execução, Shift + clique adiciona ou remove talhões da seleção sem abrir o formulário. Enquanto houver uma seleção, o clique esquerdo também alterna os talhões. O botão direito sobre um selecionado abre a edição do grupo. Sobre um talhão não selecionado, abre somente esse talhão. O botão “Atualizar selecionados” continua disponível.

Os registros são salvos juntos, com áreas e histórico individuais. Percentual é aplicado sobre a área de cada talhão; hectares são aplicados a cada um e validados antes de salvar.

Validação: `node --test tests/operations-bulk.test.cjs tests/operations-repository.test.cjs` e `node --check app.js`.

Para retornar, restaurar `app.js`, `portal.html` e `style.css` a partir da branch de backup, revisar e publicar um novo commit. Não usar force push nem resetar o histórico remoto. A versão anterior também permanece no histórico de deployments da Vercel.
