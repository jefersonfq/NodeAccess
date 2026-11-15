# Avaliação — aviso de plantão no terminal

Estado: proposta avaliada no código existente; não implementada nem medida em runtime.

## Decisão recomendada

Faz sentido um indicador discreto de pendências abertas autorizadas do host ativo, com painel flutuante de consulta. TerminalView já identifica activeHostId e tem barra lateral de ferramentas; o módulo de plantão já separa consulta, participação/gestão e ACL de origem. A integração pode ficar em componente próprio e serviço de leitura, sem mudanças no transporte SSH.

Indicador: ícone estável na barra existente, contagem compacta quando houver pendência e tooltip. Sem banner automático, piscar ou texto extenso sobre a saída do terminal. Janela ancorada abre por clique/teclado, mostra nome do host, descrição cadastrada quando disponível, títulos/contextos autorizados, próximo passo, responsável, prioridade e prazo; itens expansíveis/paginados e link ao detalhe completo. Fechar por X/Escape; fechar janela não conclui pendência. Corte inicial somente leitura para preservar contexto e reduzir complexidade de confirmação.

## Custo e atualização

Consulta HTTP independente e assíncrona; nunca bloquear conexão ou executar comando no host. Consultar só host ativo; deduplicar por usuário/tenant/host; TTL curto em memória (sugestão30–60s), atualização ao abrir/focar e manual. Atualização periódica apenas enquanto painel aberto/documento visível se necessária; não criar timer por sessão. Cache deve ser invalidado ao trocar identidade/tenant/ACL. Revalidar ao abrir, limpar conteúdo antigo e descartar resposta de host anterior. Indicador informa erro/desatualização discretamente; falha não significa zero.

Não reutilizar cegamente o quadro gerencial completo: hoje a seleção pode carregar500 candidatos e metadados agregados. Preferir consulta compacta por host com mesma autorização, sem histórico/snapshots/textos extensos no primeiro pedido. Conteúdo paginado é carregado ao abrir. Contagem limitada deve ser sinalizada, sem prometer total exato. Nenhuma estimativa de milissegundos ou consumo foi medida nesta avaliação.

## Permissões e interação

Ter acesso SSH ao host não concede acesso a todas as pendências. Indicador, contagem e detalhes revelam apenas assuntos permitidos pela participação/concessão de gestão e ACL atual de host/auditoria. Avisos gerais para qualquer operador exigiriam política explícita separada.

Overlay não altera dimensões do terminal nem chama resize/fit; permanece dentro do fullscreen quando aplicável. Foco entra no painel somente após ação explícita, teclado não envia comandos ao SSH enquanto interage, Escape fecha sem vazar ao terminal e foco retorna ao mesmo terminal se ainda existir. Em split usa o painel ativo; troca de host fecha/redefine conteúdo para não misturar máquinas. Seleção/cópia do texto é permitida. Evitar controles que obriguem navegação para fora da sessão; detalhe pode abrir em nova aba identificada ou expansão no próprio painel.

## Validação proposta para implementação

Baseline/regressão terminal-experience:web; área útil/rows/cols inalterados ao abrir/fechar; ausência de reconexão e comandos injetados; digitação/copy/paste/foco/Escape; split/troca rápida com resposta HTTP atrasada; identidade/tenant/ACL revogada; erros/offline/sem pendência; fullscreen/mobile; deduplicação com múltiplas sessões do mesmo host e painel fechado sem polling contínuo. Ensaio PTY real só se implementação tocar resize/transporte; essa alteração não é necessária no desenho proposto.

## Verificação executada

Leitura de TerminalView (activeHostId, foco e barra existente), HandoverBoardService (seleção limitada e ACL) e documentação da frente. Nenhum código, dependência, migração ou configuração de produção alterado. Testes não executados porque esta interação solicita avaliação, não implementação.

## Atualização após autorização

A proposta foi implementada localmente. A avaliação acima é histórica; consulte [validação final](terminal-indicator-test-results.md) e [revisão UX](terminal-indicator-ux.md). Homologação humana e publicação permanecem pendentes.
