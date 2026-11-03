# NA-0087 — Revisão após análise integrada

A análise NA-0089 manteve cinco ocorrências previamente corrigidas e trouxe três alertas no harness desta frente. Nenhum alerta foi suprimido ou marcado na API.

| Ocorrência | Decisão após análise real | Evidência |
|---|---|---|
| ForwardingsView: label do agente | Separado label/for e id no input interno; preservados nome e pesquisa | DOM: associação nativa e clique foca input |
| SnippetsView: três labels de filtro | Mesma associação explícita, mantendo grid e estilos de texto | DOM por ocorrência; snippets desktop/mobile e budgets originais |
| GraphicalSessionView: canvas | context_reviewed após correção img→application; preservado histórico | Handlers reais de keydown/keyup e conversão Guacamole; testes de keysym/encoding; composição gráfica já validada |
| Harness S1523 | Function removido; parser de literais limitado, sem executar JS | Três testes Node de parsing, rejeição de código e limites |
| Harness S4036 (duas chamadas) | Git absoluto /usr/bin/git no WSL, sem resolução por PATH | Harness DOM reexecutado com checkout real |

Ran: 44 fixtures de label + 10 controles nativos, incluindo HTMLLabelElement.control e foco por clique em todos os labels explícitos; três testes do parser; suíte gráfica de teclado/encoding; harness snippets desktop/mobile; ESLint e typecheck do frontend. A execução ampla de coverage/build/Sonar permanece com a integração. O parser não adiciona dependência e aceita apenas o subconjunto necessário às fixtures; expressões de estado desconhecidas recebem o texto sintético já utilizado anteriormente.

A superfície remota tem foco e captura teclas quando conectada; um botão nativo não representa seu comportamento. A revisão não afirma teste com servidor RDP real nem leitor de tela humano. O alerta residual de canvas permanece aberto no scanner. Para os quatro labels, a nova associação está validada no DOM, mas a ausência no próximo scanner ainda não foi confirmada.

Inventário original: 77 fixed e 88 context_reviewed; um dos 88 preserva correção anterior em history. Os três novos alertas de harness têm decisões próprias em followup-dispositions.json. Esse arquivo contém oito registros por chave (cinco atualizações, três novos), permitindo integração sem duplicar achados.

Harness de revisão é específico para WSL/Linux: exige /usr/bin/git e falha com mensagem explícita se ausente; não altera suporte de plataformas do produto. Identificado e encerrado processo órfão de uma tentativa antiga de captura de licença que falhou durante screenshot. Cleanup de contexto/browser agora usa finally e fecha o browser também quando a captura falha, preservando a falha como resultado de teste.

Cleanup validado também por injeção de falha em page.screenshot: o workflow snippets retornou exit 1 com o erro simulado, sem atingir o timeout externo de 30 s; browser foi fechado. Execução normal repetida retornou exit 0. A falha injetada é evidência de recuperação, não falha do produto.
