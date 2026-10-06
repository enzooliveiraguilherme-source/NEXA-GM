# Pontos originais — FE / Milho 2026

Os blocos JSON contêm os 2.619.944 pontos de FE.geojson, sem amostragem, agregação ou arredondamento. Cada valor é armazenado como float64 e compactado com gzip sem perdas. As colunas são longitude, latitude, prod_corig, No, X, Y, Predicted e SE_Pred. O nome da camada é preservado no índice; o arquivo GeoJSON original permanece localmente.

As posições e os valores de produtividade são originais. A otimização está na transferência em blocos e no desenho no navegador, com WebGL e alternativa Canvas. O tamanho em pixels dos pontos varia com o zoom; isso não muda os dados armazenados. Os polígonos dos talhões têm preenchimento transparente em todos os estados.

O portal permite mostrar todos os talhões ao mesmo tempo ou selecionar um. O cálculo atual da média foi preservado; sua substituição foi adiada conforme solicitado. Datas ausentes continuam nulas.

A visualização usa seis níveis de pirâmide por talhão (5, 10, 20, 40, 80 e 160 metros em Web Mercator). Cada célula agrega os valores somente para produzir a imagem de exibição. Os pontos originais no Supabase permanecem intactos. As imagens são suavizadas na tela e recortadas pelo polígono, inclusive pelos anéis internos. No zoom 18 ou superior, os pontos originais são carregados sob demanda e recebem o mesmo recorte. scripts/prepare-harvest-pyramid.cjs prepara as imagens; tests/harvest-pyramid.test.cjs verifica os furos do FE 19, os níveis e os limites das classes. A média exibida no painel permanece inalterada.

Legenda: 0 a menos de 120, 120 a menos de 130, 130 a menos de 140, 140 a menos de 160, 160 a 180 e acima de 180 sc/ha. O limite inferior pertence à classe seguinte; 180 pertence à penúltima classe.

Atualização de nitidez: o nível de 5 metros aparece a partir do zoom 15; o detalhe original começa no zoom 16. As células originais são desenhadas como quadriláteros orientados pelos X/Y da origem, sem limite fixo de tamanho em pixels. Pequenas lacunas periódicas criadas pela reprojeção nas imagens de transição são preenchidas entre vizinhos somente na imagem; a máscara de limites e furos é aplicada depois. Os dados do Supabase e a média do painel permanecem intactos.

scripts/prepare-fe-original.cjs prepara os blocos. tests/fe-original.test.cjs relê o original e compara os valores de todos os pontos bit a bit com os blocos descompactados. Checksums SHA-256 também são verificados no navegador.

A migration 202610060004_original_harvest_points.sql permite a extensão JSON na tabela de arquivos de teste existente, mantendo as permissões de acesso. O envio cria outra versão e só a ativa ao concluir todos os blocos; a versão anterior permanece preservada.
