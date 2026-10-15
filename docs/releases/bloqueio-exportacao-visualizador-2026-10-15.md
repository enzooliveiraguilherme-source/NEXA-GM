# Bloqueio de exportação no modo Visualizador

A exportação já conferia o perfil da conta, mas o seletor de modo de um ADM altera somente state.userRole. Isso mantinha os botões e a geração liberados enquanto a conta ADM navegava como Visualizador.

PDF e PNG passam a exigir perfil admin/projetista e modo editor. A troca para Visualizador atualiza imediatamente os botões, fecha a prévia PNG aberta e impede liberar uma exportação que terminou de gerar após a troca de modo. Voltar para Editor restaura os controles para os perfis autorizados. Contas visualizador e estados sem modo definido permanecem bloqueados.

Verificação no navegador: ADM/Editor com botão PDF; troca pelas Opções para Visualizador remove o botão nas abas de colheita e variedades; voltar para Editor restaura. Testes adicionais cobrem ausência de modo, perfil visualizador mesmo com estado editor, bloqueio da geração e fechamento da prévia PNG. Nenhuma permissão de conta ou dado agrícola é alterado.
