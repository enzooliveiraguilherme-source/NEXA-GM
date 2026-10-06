# Pontos originais — FE / Milho 2026

Os blocos JSON contêm os 2.619.944 pontos de FE.geojson, sem amostragem, agregação ou arredondamento. Cada valor é armazenado como float64 e compactado com gzip sem perdas. As colunas são longitude, latitude, prod_corig, No, X, Y, Predicted e SE_Pred. O nome da camada é preservado no índice; o arquivo GeoJSON original permanece localmente.

As posições e os valores de produtividade são originais. A otimização está na transferência em blocos e no desenho no navegador, com WebGL e alternativa Canvas. O tamanho em pixels dos pontos varia com o zoom; isso não muda os dados armazenados. Os polígonos dos talhões têm preenchimento transparente em todos os estados.

O portal permite mostrar todos os talhões ao mesmo tempo ou selecionar um. O cálculo atual da média foi preservado; sua substituição foi adiada conforme solicitado. Datas ausentes continuam nulas.

scripts/prepare-fe-original.cjs prepara os blocos. tests/fe-original.test.cjs relê o original e compara os valores de todos os pontos bit a bit com os blocos descompactados. Checksums SHA-256 também são verificados no navegador.

A migration 202610060004_original_harvest_points.sql permite a extensão JSON na tabela de arquivos de teste existente, mantendo as permissões de acesso. O envio cria outra versão e só a ativa ao concluir todos os blocos; a versão anterior permanece preservada.
