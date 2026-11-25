# Mapa aéreo preparado

O mapa lê apenas gráficos preparados em `aerial_spray_map_cache`, com acesso por fazenda. O endpoint `aerial_spray_layers` retorna registros diretamente, sem projeção, união, interseção ou cálculo de área. `aerial_spray_catalog` fornece os talhões, indicadores e limites de enquadramento.

Os talhões de base vêm do cadastro que o portal já carregou. São respeitados fazenda, gleba, safra, contextos de pulverização e arquivamento. A câmera usa os limites dos talhões alvo; o percurso de deslocamento do avião nunca determina o enquadramento.

Uma AP de uma fazenda usa indicadores já preparados. Se houver mais registros, o mapa aparece primeiro e a consolidação exata das áreas roda separadamente. O resultado é reutilizado na sessão, sem somar áreas sobrepostas. As chamadas antigas são canceladas e resultados obsoletos ignorados.

Após qualquer importação ou correção de AP, executar `scripts/prepare-aerial-map-cache.sql` antes de anunciar os dados no site. As geometrias analíticas completas permanecem preservadas. A redução de vértices é exclusiva dos gráficos de apresentação.

Validação de 25/11/2026: mesma seleção AP163 + SH_01_02; caminho antigo 17,53 s e caminho preparado sob perfil autenticado 0,1449 s no banco. Isso mede o processamento da consulta, não a transferência da conexão do navegador. A carga mantém 28 APs e 120 feições, com AP126 excluída.

Testes cobrem base sem AP, falha de rede preservando os talhões, enquadramento antes da resposta, cache, debounce, respostas obsoletas, troca de aba, controles de camadas e indicadores fora do caminho de desenho.
