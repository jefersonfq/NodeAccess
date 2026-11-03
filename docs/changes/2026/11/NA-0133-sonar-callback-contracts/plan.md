---
change_id: NA-0133
title: Callbacks unários e contratos observáveis no processo pai
type: fix
status: ready-for-review
created_at: 2026-11-03T19:52:52-03:00
base_branch: chore/NA-0093-20261103-sonar-integration
base_sha: b76faaec6031f3ebed1372a65dcede08f930cde0
branch: fix/NA-0133-20261103-sonar-callback-contracts
owner: Codex
planner: Codex
risk: low
issue: null
---

# Plano

GO_WITH_RISKS: correção delegada pela raiz dentro da autorização fim a fim. Corrigir sete achados novos sem mudar baseline, exclusões ou política. Usar callbacks unários explícitos para readIssue/publicIssue, inclusive uso relacionado não sinalizado. Nos dois testes com subprocesso, transportar resultados reais em JSON e verificar no pai, mantendo timeout de três segundos. Rodar contratos, lint e revisão independente. Reversão pelo commit isolado. Sem scanner ou implantação nesta frente.
