---
change_id: NA-0144
title: Preservar diagnóstico de assertions async no formato real Node
status: ready-for-review
type: fix
created_at: 2026-11-03T22:12:35.494979-03:00
base_branch: chore/NA-0093-20261103-sonar-delivery
base_sha: b568eccf0e2c8048842c8db830ec42639c59c287
branch: fix/NA-0144-20261103-node-diagnostic-frames
owner: Codex
planner: Codex
risk: low
issue: null
---

# Plano

GO_WITH_RISKS: raiz autorizou correção causal do parser diagnóstico. Reprodução real mostrou console.error deAssertionError apósawait gerando único frame terminado em ) {, rejeitado pelo regexestrito. Aceitar somente sufixo literal de inspeçãoNode e CR deCRLF, preservando basenameallowlist e bounds. Reconhecer também cabeçalho literal Error [TimeoutError]: como TIMEOUT. Testeschildrenreais/negativosmaliciosos/boundaries e regressões declassificação/leitor64KiB; revisão independente antescheckpoint. Não resolver porinferência a falhahistórica dofrontend. Baseline/gates/timeoutdeharness intactos. Rollbackporcommit.
