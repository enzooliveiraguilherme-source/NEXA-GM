# Exclusão recuperável de variedades

Correção da ausência de exclusão na área **Opções → Variedades e ciclos**. Cada variedade/cultura agora tem **Excluir**, com confirmação dentro do site. A variedade sai do catálogo ativo e das sugestões daquela cultura, e o ciclo deixa de ser aplicado às previsões. Os plantios e o histórico permanecem intactos, inclusive a identificação da variedade realmente plantada no mapa.

Para desfazer, o ADM marca **Mostrar excluídas** e escolhe **Restaurar**. O ciclo anterior fica preservado. Cadastrar novamente uma variedade/cultura excluída também reativa o mesmo registro, com o novo ciclo informado, sem duplicá-lo. A exclusão funciona inclusive para variedades antigas sem ciclo, criando um registro inativo que impede sua reaparição automática pela lista original ou pelos plantios já lançados.

Migration: `20261015152514_archive_seed_varieties.sql`, coluna `archived` na tabela de ciclos. Permanecem as políticas RLS existentes: apenas administradores confirmados podem inserir ou alterar; não foi concedida exclusão permanente a nenhum perfil. Atualizações continuam protegidas por versão. Os ciclos carregados no cálculo ignoram registros inativos.

Verificações: 51 testes automatizados aprovados. Teste transacional no banco confirmou exclusão/restauração pelo ADM e bloqueio para projetista/visualizador; todas as alterações desse teste foram revertidas. Conferência no navegador com dados fictícios: botão Excluir, confirmação, desaparecimento da lista ativa, exibição em Mostrar excluídas e restauração com ciclo original. Nenhuma variedade real foi excluída durante a implementação.

O retorno deve preservar a coluna `archived` e os registros inativos; reativar frontend antigo sem filtro faria variedades excluídas reaparecerem e seus ciclos voltarem a ser usados. Base anterior do frontend: `d27da641891da6814da25df4c9baef60fbde1364`.
