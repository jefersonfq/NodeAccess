# Validação local NA-0147

Base: `ee436402db8bcce7fab4378d6ba28c1673b282b5`. Execução no worktree `/tmp/nodeaccess-NA-0147`; Node24.22.1. Sem VPS, transporte SSH ou scanner Sonar nesta frente.

| Verificação | Resultado |
|---|---|
| Baseline anterior ao produto | 63 testes / 3 arquivos PASS |
| Suíte final highlights/frontend/backend | 108 testes / 6 arquivos PASS |
| Revisão independente frontend | 84 testes / 3 arquivos PASS_WITH_WARNINGS |
| Telemetria unavailable/input-limit/capacity/timeout | 4 casos PASS; duração zero quando não houve resultado medido |
| Lint fontes TS/Vue/backend/tools | PASS |
| Frontend vue-tsc | PASS |
| Build Vite7.3.7 | PASS30.41s; Worker emitido separado; warning950kB anterior preservado |
| Terminal-experience completo | PASS; sem alterar harness |
| Highlights Playwright | 15 jornadas PASS; waits de observação assíncrona, mesmas asserções |
| Worker e editor real Chromium151 | PASS CPU1x/4x; relatório e quatro prints em evidence/ |
| Manual capture | PASS3fluxos; cinco capturas revistas; somente terminal alterado preservado na frente |
| Manual unit / Vitest / reviewed hash | 2 +18 testes PASS; cinco capítulos atuais |

O ensaio real usa Chromium151 instalado por override local (1234), não prova a instalação locked1248 do CI. Browser Node/CDP da página não coleta cobertura do Worker; a execução real é evidência operacional separada. Os testes unitários usam o motor puro real e workers simulados para concorrência.

No browser, regras válidas/literal/wildcard/Unicode funcionam antes da falha. Regex adversarial respondeu timeout em53/55ms e a UI continuou respondendo. Dez reconfigurações e um consumidor novo permanecem suspensos, sem segundo Worker. Encerramento físico ocorreu em2005/2007ms; `terminate()` não garante CPU50ms. Prova separada de CPU residual em `evidence/worker-cpu.json` mede consumo agregado de renderer em cenário isolado, não consumo de toda aplicação. Fonte Chromium: https://chromium.googlesource.com/chromium/src/+/494419358caf690316f160a1f27d9e771a14c033/third_party/blink/renderer/core/workers/worker_thread.cc .

Prints desktop/mobile mostram aviso textual e ação revisar/salvar/recarregar sem esconder controles; input continua respondendo. Fixture usa componente real e dados sintéticos, não layout completo de produção. Terminal completo e editor integrado são cobertos pelos ensaios existentes. Exportação opera em batches e só salva após todos concluírem; nenhum fallback síncrono ou truncamento silencioso adicionado. Não foi simulado download de auditoria contra backend real nem WebKit.

O último ajuste após browser foi apenas telemetria do orquestrador, coberto por quatro novos testes. Manifesto refere-se às fontes desta frente; raiz revalidará manual após integração disjunta NA0148. Cobertura/Sonar conjuntos, homologação humana, publicação e planilha2027 permanecem pendentes na entrega integrada.

## Complemento UX — botão de suspensão
Após revisão da raiz, rótulo do botão comunica pausa mesmo com menu fechado. Ensaio terminal completo adicional PASS, com Worker real; `evidence/terminal-pause-report.json` e dois prints `terminal-paused-*.png`. Geometria antes/depois igual, input continua chegando ao WebSocket simulado, botão cabe em390px. Lint focal e vue-tsc PASS. Duas tentativas anteriores falharam por fixture ainda em alternate screen; corrigida saída explícita desse modo antes da regra, sem relaxar asserções.
