# Atualizar Mapa Aplicação — 04/11/2026

Novo subitem abaixo de Mapa, na Pulverização, com mapa de resumo e exportação PDF de uma página. A identidade visual segue o resumo do calcário: marca, fazenda/gleba, safra, indicadores de área/progresso, mapa e três classes de legenda.

O filtro aceita uma aplicação específica por vez (1ª Pós, 1º Fungicida, etc.), incluindo aplicações independentes e adicionais. Não oferece as opções agregadas Todas/Fungicidas/Inseticidas. Usa as mesmas aplicações confirmadas que alimentam a tabela, no contexto de fazenda/gleba, safra e cultura, sem herdar filtros de pesquisa/status/período da tabela. Mudanças pendentes ou com falha não recolorem o resumo como execução confirmada e bloqueiam a exportação.

Classificação exclusivamente visual, sem gravação no banco:

- **Aplicado**, verde: data realizada ou confirmação de execução sem data.
- **Em andamento**, amarelo: início registrado, sem conclusão, inclusive quando a previsão venceu.
- **Não aplicado**, vermelho: previsão em hoje ou antes, sem início/conclusão. A comparação usa a data de São Paulo, inclusive a previsão calculada já apresentada na tabela.
- Datas futuras e ausência de programação ficam neutras em cinza, explicadas na nota do mapa/PDF. Não recebem rótulo de atraso. Áreas sem programação ficam fora da área programada; futuras entram na programação. Em andamento não pressupõe hectares parcialmente executados.

Excluídas e etapas opcionais não ativadas ficam fora dos indicadores. Geometrias e demais mapas não mudam. O mapa operacional anterior e seu PDF conservam suas regras e cores. A nova exportação exige os mesmos perfis editor/Admin ou Projetista já usados pelos relatórios. Os visualizadores podem consultar o resumo. Troca de contexto/permissão durante geração invalida o download.

Testes por agentes Luna: 75 casos aprovados nas suítes de resumo, controle, GIS, relatório existente e exportação. Incluem navegação entre três modos, prioridade dos estados, separação de etapas e uso de dados confirmados durante o salvamento. Uma fixture antiga de atenção foi corrigida para usar a data corrente, evitando que vencesse com a passagem dos dias.

Evidências e preparação da publicação ficam em `.publish/spray-summary-20261104/`. A preparação parte da versão publicada `5c47e84985e7abd8633d05ca9baa8d29a2c18221` e preserva as versões de estilo/colheita e o comportamento do cabeçalho de colheita que diferem da cópia local. Nenhuma alteração de banco ou de dados operacionais é necessária.

Conferência visual por agente Luna em Chrome, com dados sintéticos: dashboard em desktop e celular sem rolagem horizontal, classificação das cinco situações e PDF A4 de uma página gerado com canvas real. O satélite foi desativado nessa fixture para eliminar dependência de rede. A inspeção não usa sessão autenticada do portal. O build isolado também concluiu, mantendo dados privados fora da saída.

Publicação autorizada pelo usuário em 04/11/2026, no repositório `enzooliveiraguilherme-source/NEXA-GM`. A alteração usa a branch `codex/resumo-aplicacao-20261104` e atualização sem sobrescrita forçada da versão principal. Arquivos de dados, cópias de segurança e evidências privadas ficam fora do envio.
