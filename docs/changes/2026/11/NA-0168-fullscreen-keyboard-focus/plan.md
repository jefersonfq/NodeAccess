---
change_id: NA-0168
title: Preservar teclado local após callback tardio de fullscreen
type: fix
status: in-development
created_at: 2026-11-04T18:41:48-03:00
base_branch: chore/NA-0093-20261103-sonar-delivery
base_sha: 72ff4fcd7ba033a28243abbcada1e3a779de481f
branch: fix/NA-0168-20261104-fullscreen-keyboard-focus
owner: NodeAccess
planner: Codex
risk: medium
---

# NA-0168 — Foco local durante fullscreen

## Contexto e situação anterior
`handleFullscreenChange` agenda foco do canvas após nextTick e dois rAF. Se Ctrl+Alt+Shift ativa teclado local nesse intervalo, o callback tardio pode roubar foco e o evento focus desativa localKeyboardMode. CI ae0624944 falhou na espera do botão Retomar teclado remoto; execução local pode passar conforme escalonamento.

## Problema e objetivo
Preservar a escolha explícita do teclado local após callback tardio de fullscreen.

## Escopo
Provar corrida em Chromium/Vue reais segurando callbacks rAF apenas no ensaio durante fullscreen; liberar depois do chord e exigir permanência do foco local. Aplicar menor guard no callback tardio para respeitar localKeyboardMode no momento da execução. Preservar updateDisplaySize, fullscreen, teclado remoto, estados desconectados, layout e transporte. Nenhuma mudança de CSS, resize, protocolo, dependência ou timeout/gate.

## Critérios de aceitação
- [x] Regressão determinística falha na base antes de editar produto.
- [x] Callback tardio não restaura foco remoto quando modo local está ativo.
- [x] Retomar teclado remoto continua retornando foco ao canvas.
- [x] Harness audit-input real passa; lint/typecheck e revisão independente registrados.

## Estratégia técnica
Avaliar localKeyboardMode no momento da execução do callback rAF, sem modificar updateDisplaySize ou o retorno explícito.

## Riscos e mitigações
Risco de regressão de foco mitigado por baseline determinística, mesma regressão pós-patch e execução independente; manter os gates integrados pendentes.

## Matriz de testes e evidências
Baseline e pós-patch: harness audit-input com controle de rAF; screenshots desktop/fullscreen/mobile locais. Contratos de estados existentes mantidos. APIs/WebSocket são interceptados com fixtures; Vue, foco, teclado e fullscreen são reais. Não é homologação de host remoto. Sem alteração de área útil do terminal/resize/transporte: suites PTY e terminal-experience não são acionadas por este guard.

## Manual e UX
GraphicalSessionView.vue não consta no manifest e não há fluxo gráfico mapeado; manual não alterado. Objetivo de UX: preservar escolha explícita do teclado local e foco no CTA Retomar teclado remoto. Sem novo texto, layout ou estado visual. Risco principal é impedir refoco automático indevido; retorno explícito preservado.

## Baseline
Base 72ff4fcd7ba033a28243abbcada1e3a779de481f; worktree isolado para preservar integração.

## Rollback ou recuperação
Reverter somente patch desta frente. Sonar integrado e CI final pendentes, sem transferir aprovação de candidatos anteriores. Docs canônicos/planilha ficam para orquestração.

## Aprovação
Decisão: GO_WITH_RISKS. Correção necessária autorizada pela orquestração em nome do fluxo fim a fim já autorizado; implementação e ensaio permitidos, commit somente após revisão independente.
