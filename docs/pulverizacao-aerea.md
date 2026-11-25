# Pulverização Aérea

A aba `aerea` apresenta as aplicações aéreas no menu. Usa os acessos de fazenda já existentes e filtros próprios de ano, cultura e seleção de uma ou várias APs. Não grava lançamentos nos módulos de plantio, pulverização terrestre ou colheita.

## Dados de entrada

Preparar GeoJSON em WGS84 (EPSG:4326), com longitude e latitude. O nome deve estar em `AP`, nas duas camadas:

| Camada | Geometria | Atributos |
| --- | --- | --- |
| Circuito | LineString / MultiLineString | `AP`, `APLICANDO` (0 ou 1, número ou texto) |
| Cobertura aplicada | Polygon / MultiPolygon | `AP` |
| Limites dos talhões alvo | Polygon / MultiPolygon | `AP` e identificação do talhão |

Os limites são associados na importação aos talhões cadastrados no NEXA, conferindo fazenda, gleba e ano. Guardar uma cópia do limite para cada AP; um mesmo talhão pode pertencer a várias APs. Se um talhão inteiro ficou sem aplicação, ele também precisa constar entre os alvos da AP. Nunca usar somente o envelope das faixas aplicadas como área total do talhão.

Cada feição importada ocupa uma linha em `aerial_spray_features`: `farm_code`, `gleba`, `ano`, `cultura`, `ap`, `kind` (`circuito`, `cobertura`, `limite`) e `feature` (GeoJSON Feature original). A importação definitiva aguarda os dados do usuário; não há dados fictícios no catálogo. Importar uma AP completa em uma transação, validando antes os polígonos e os flags. Evitar repetir uma importação existente; os circuitos e os polígonos individuais são preservados.

## Cálculo

O banco une os limites das APs selecionadas e a cobertura, recorta a cobertura pelos limites e calcula hectares com PostGIS/geography. Não soma áreas sobrepostas. A área não aplicada é o total menos a cobertura dentro do limite. Os buracos internos dos polígonos são respeitados. Falta de limite ou cobertura em qualquer AP impede indicadores completos e gera aviso; não se presume que faltas de dados sejam zero.

O mapa mantém polígonos individuais e atributos. O circuito usa vermelho para `APLICANDO=0`, verde para `APLICANDO=1`. Cobertura, circuito, limites e lacunas possuem controles independentes. Desligar camadas não muda os indicadores.

## Implementação

- Frontend: `js/aerial-spray.js`, `js/aerial-spray.css`, `portal.html`, integração em `app.js`.
- Banco: `supabase/maintenance/aerial-spray.sql`, instalado via migration `aerial_spray_module`, seguido por ajuste da resposta vazia.
- Leitura: funções `aerial_spray_catalog` e `aerial_spray_map`, SECURITY INVOKER e RLS por fazenda. Escrita apenas por administradores.
- Build: `node scripts/build-site.cjs`. Dados privados não integram a publicação estática.
