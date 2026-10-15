# Relatório de variedades e colheita por dia

As abas Data estimada de colheita e Variedades plantadas passam a oferecer Exportar relatório PDF para Administradores e Projetistas, seguindo a permissão de exportação já existente no plantio. Os mapas passam a usar cores saturadas e preenchimento de 88%, com a mesma correspondência de cores no relatório.

O PDF A4 respeita os filtros e contém resumos gerais de variedades e datas, seguidos por páginas de cada fazenda: mapa e tabela de variedades, tabela diária com hectares somados e acumulados, detalhamento dos talhões e eventuais pendências de data/ciclo. As considerações destacam o maior volume por dia, a variedade predominante e os hectares sem previsão. O cálculo usa somente execução registrada e os ciclos carregados, sem depender do planejamento nem alterar registros.

Geração local no navegador, sem enviar dados a outro serviço e sem dependências externas para montar o PDF. A memória das páginas é liberada por fazenda durante a codificação. Cabeçalhos, notas e numeração são repetidos nas continuações. O botão indica progresso e impede gerações simultâneas.

Validação: 41 testes automatizados passaram; amostra real da gleba FE gerada com 25 páginas, conferida visualmente em todas as páginas e aberta pelo Poppler. O botão do portal gerou e baixou o mesmo relatório em teste local. Cenário sintético com 82 talhões, 36 variedades, 28 datas e pendências gerou 14 páginas com continuações e totais verificados. Nenhum dado de teste, amostra de PDF ou arquivo privado é incluído na publicação.
