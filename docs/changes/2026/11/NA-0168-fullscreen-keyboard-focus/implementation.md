# NA-0168 — Registro da implementação

## Pedido e objetivo
Preservar foco local quando callback fullscreen atrasado ocorre após Ctrl+Alt+Shift.

## Implementação
Base SHA 72ff4fcd7ba033a28243abbcada1e3a779de481f. Worktree /tmp/nodeaccess-NA-0168. Skill frontend-full-cycle-agent em modo Implementer aplicada. Plano aprovado antes de qualquer edição de produto.

## Validação
Ran em `/tmp/nodeaccess-NA-0168`, base acima + diff LOCAL_WIP, Node `/tmp/na0093-owned-runtime/bin/node` e Chromium `/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`:
- Produto base + teste determinístico: exit1. Primeira versão do assert aguardava botão removido (timeout30s); refinada para leitura imediata de activeElement, voltou a falhar com AssertionError, texto ativo vazio em vez de Retomar teclado remoto. `/tmp/na0168-baseline-direct.log` e screenshot `/tmp/na0168-audit-baseline-direct/canvas-local-keyboard-fullscreen.png`.
- Produto com guard + mesmo teste: exit0; harness audit-input completo passou cinco checks (playback read-only, corrida fullscreen, sessão fechada, Tab/Escape/chord/retorno e mobile, IPv6).
- Comando: `FRONTEND_BASE=http://127.0.0.1:18681 AUDIT_INPUT_OUTPUT=/tmp/na0168-audit-fixed node tools/frontend/audit-input-safety-playwright.cjs`, com PATH/PLAYWRIGHT_EXECUTABLE_PATH acima. `/tmp/na0168-fixed.log`; screenshots e report em `/tmp/na0168-audit-fixed`. Inspeção visual confirma botão de retorno com foco após callbacks tardios.
- ESLint de GraphicalSessionView.vue e audit-input-safety-playwright.cjs: exit0, zero avisos. `git diff --check`: passou.
- `vue-tsc --noEmit` frontend: exit0.
- Resumo durável sanitizado: `evidence/focus-race-summary.json`.
Planned: revisão independente, Sonar integrado e CI final; nenhuma execução de pipeline neste implementador.
Skipped: PTY/terminal-experience específicos, pois guard não altera área útil, resize ou transporte; o harness audit-input exerceu viewport mobile existente.

## Recuperação
Reverter guard e incremento de teste da frente. Nenhuma alteração em dados, layout, resize ou transporte.

## Pendências
Typecheck aprovado, revisão independente sem bloqueador; Sonar integrado e CI final pendentes. Documentos canônicos/planilha pela orquestração. Servidor Vite próprio18681 permanece para revisão e será encerrado depois.

## Diário de interações

### 2026-11-04T18:41:48-03:00 — Plano e autorização
Orquestração forneceu causa provável e autorizou frente168 isolada. Skill frontend lida; manifest não mapeia GraphicalSessionView/fluxo gráfico. Código confirmado: callback fullscreen chama focusCanvas incondicional após dois rAF; chord marca localKeyboardMode e focus do canvas o desfaz. Planejada reprodução controlada antes de editar produto; sem commit até revisão.

### 2026-11-04T18:45:03-03:00 — Corrida reproduzida e guard localizado

Baseline comprovou corrida real existente: evento fullscreen agenda rAF, chord entra em modo local, callbacks tardios restabelecem foco remoto e removem o botão. Isso é compatível com a falha CI, sem provar a sequência histórica exata daquela execução. Alteração de produto restrita a `if (!localKeyboardMode.value) focusCanvas()` no callback; updateDisplaySize continua incondicional, preservando cálculo/layout. Harness controla entrega de frames somente durante cenário, sem sleep, alteração de timeout ou condição favorável. Guard passou mesma regressão e o fluxo audit-input completo. Retorno explícito já exercitado no mesmo harness, estados desconectados e mobile preservados. Todos os diffs IN_PLAN. Revisor independente recebeu plano, diff, comandos e evidências; sem commit antes da revisão.

### 2026-11-04T18:45:47-03:00 — Revisão independente

Revisor `security_closure_review` executou o harness focal em Chromium/Node24 contra frontend18681 e confirmou cinco checks PASS em `/tmp/na0168-independent-review/report.json`. Inspeção confirmou guard de uma linha, updateDisplaySize preservado e retorno explícito coberto. Nenhum bloqueador identificado. Typecheck frontend final exit0 registrado. Gate Sonar integrado/CI permanece pendente; commit aguarda autorização da orquestração.

### 2026-11-04T18:45:47-03:00 — Autorização de commit

Orquestração recebeu revisão `PASS_WITH_WARNINGS`, inspecionou screenshot pós-patch e autorizou commit com governança. Nenhum layout novo; botão Retomar permanece visível/focado. Servidor Vite18681 mantido por solicitação para teste focal após integração; sessão do implementador39643, log `/tmp/na0168-vite.log`. Sonar integrado/CI final continuam pendentes.

### 2026-11-04T18:46:16-03:00 — Adequação estrutural do plano

Primeira execução de governança reprovou nomes de seções e formato da decisão no plano. Conteúdo foi reorganizado sob os títulos obrigatórios e `Decisão: GO_WITH_RISKS`, sem alteração de código/escopo. Amend local para corrigir o documento antes da integração; repetir governança no SHA resultante.
