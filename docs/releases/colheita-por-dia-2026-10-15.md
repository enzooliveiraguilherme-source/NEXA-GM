# Dia estimado de colheita

A legenda do mapa oficial passa de “Semana estimada de colheita” para **Dia estimado de colheita**. Cada entrada contém a data exata em dd/mm/aaaa, calculada com a data de plantio e o ciclo cadastrado pelo ADM. Talhões previstos para o mesmo dia compartilham cor e área somada; dias diferentes ficam separados, mesmo quando pertencem à mesma semana. Datas sem ciclo ou sem execução continuam sem previsão.

O resumo mantém a janela global de primeira a última previsão do filtro. As janelas semanais da legenda foram removidas. Filtros, permissões, hectares parciais, variedades e ciclos permanecem com as regras atuais.

Implementação e teste foram divididos entre dois agentes a pedido do usuário. Teste específico: Olimpo plantada em 15/10/2026 e 16/10/2026, com 114 dias, resulta em entradas distintas para 06/02/2027 e 07/02/2027, com áreas e cores próprias. Nenhum registro agrícola ou ciclo foi alterado.
