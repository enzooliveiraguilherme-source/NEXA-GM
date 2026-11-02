# Pulverização: tabela simples e mapa separados

Pulverização tem submenu Tabela/Mapa e alternância no topo. Tabela é a entrada padrão e ocupa toda a área útil; Mapa mostra apenas o mapa com seu filtro de aplicação. Apenas uma área aparece por vez, inclusive no celular. A troca mantém o contexto, filtros e seleção. O mapa só monta polígonos na visualização Mapa.

A tabela usa linhas compactas, um talhão por linha, aplicações em grupos de duas colunas (Prevista/Realizada), sem cartões, checkboxes ou frases repetidas dentro de cada aplicação. Cores discretas e dicas no hover indicam a situação. Resumos e contadores extensos deixam de ocupar a tela principal. Lista com outros campos e preenchimento em massa ficam em Mais opções.

Alterar uma célula confirma automaticamente a edição com a RPC transacional existente e atualiza a sequência. O indicador no topo mostra Salvando, Salvo ou Não salvo nas duas visualizações. As células ficam bloqueadas durante confirmação e releitura para evitar envio com versões antigas. Tab confirma a alteração e retoma o foco na célula seguinte após a confirmação. Alterações inválidas não são enviadas. Erros preservam os valores pendentes; Tentar novamente e Descartar alteração só aparecem quando necessários. Nenhuma falha é apresentada como gravação confirmada.

Não houve mudança no banco nesta entrega. A gravação continua usando versões e validações existentes. Testes de interface simulada, navegação, exclusividade de áreas, autosave, falha/retry, consulta somente leitura e regressões são executados por agentes Luna. A verificação visual foi tentada em uma prévia com dados fictícios, mas o controle do Chrome bloqueou a inspeção por não conseguir confirmar a URL da janela. Não houve gravação de dados reais para testar.
