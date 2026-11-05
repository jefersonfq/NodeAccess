---
change_id: NA-0142
title: Classificação linear de timeout no diagnóstico privado
status: ready-for-review
type: fix
created_at: 2026-11-03T21:56:59.490365-03:00
base_branch: chore/NA-0093-20261103-sonar-delivery
base_sha: 2902f526d60aa75ee8a623ebd7c2b20e751b560d
branch: fix/NA-0142-20261103-linear-timeout-diagnostic
owner: Codex
planner: Codex
risk: low
issue: null
---

# Plano

GO_WITH_RISKS autorizado pela raiz para corrigir S8786 em parser diagnóstico, sem alterar integração. Substituir regex por leitura linear preservando positivos/negativos, incluindo múltiplos marcadores. Testar equivalência com padrão anterior em entradas limitadas e log longo adversarial. Leitura64KiB, projeção sanitizada e gates preservados; revisão independente antes de checkpoint, rollback por commit.
