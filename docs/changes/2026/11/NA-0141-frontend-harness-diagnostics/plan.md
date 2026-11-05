---
change_id: NA-0141
title: Diagnóstico seguro da falha do harness frontend
type: fix
status: ready-for-review
created_at: 2026-11-03T21:36:43.214602-03:00
base_branch: chore/NA-0093-20261103-sonar-delivery
base_sha: de7817938134c0c1e08e00833b671af937ad5864
branch: fix/NA-0141-20261103-frontend-harness-diagnostics
owner: Codex
planner: Codex
risk: medium
issue: null
---

# Plano

GO_WITH_RISKS: investigação e correção delegadas dentro da autorização fim a fim. Reproduzir frontendharness em Ubuntu24/Chromium1248/Node24.22.1/cache frio/CPU2, sem alterar integração. Acrescentar diagnóstico com etapa/asserção em allowlist, nunca mensagens ou snapshots brutos no artefato CI. Demonstrar corrida antes da correção; não aumentar timeouts nem remover assertions. Contratos e revisão independente antes do checkpoint. Reversão do commit e limpeza dos containers próprios.
