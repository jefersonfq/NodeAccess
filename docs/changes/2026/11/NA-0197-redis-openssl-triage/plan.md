---
change_id: NA-0197
title: Gate de imagens — Redis com OpenSSL 3.5.9-r1
type: security
status: ready-for-review
created_at: 2026-11-23T23:59:00-03:00
base_branch: master
base_sha: 07c004f10f6c0b0df062db39b59ada89c4886308
branch: security/NA-0197-20261123-redis-openssl-triage
owner: Jeferson Quintana
planner: Claude Code
risk: low
issue: null
---

# NA-0197 — Gate de imagens: Redis com OpenSSL 3.5.9-r1

## Contexto e problema

`upgrade-restore` passou a reprovar `nodeaccess-redis:8.2.10-1` em 2026-11-23 (PR #85, sem relação com a mudança): o Alpine publicou `openssl 3.5.9-r1` para a v3.22 e a triagem da NA-0185 fixava o Redis em `3.5.9-r0`. Afeta qualquer PR a partir desta data.

## Objetivo e escopo

Reconhecer a nova revisão de pacote no Redis sem ampliar a aceitação de risco: Redis passa a `3.5.9-r1`; as quatro CVEs que o Alpine corrigiu por backport no r1 passam a aceitar r1 (falso positivo comprovado pelo secdb); as outras cinco seguem a aceitação temporária da NA-0185 com o mesmo prazo. Fora: trocar a base do Redis (não há OpenSSL 3.5.10 no Alpine).

## Estratégia técnica

Ajuste mínimo da triagem exata existente (`openssl-image-policy.mjs` inalterado): só a revisão de pacote do Redis e as revisões aceitas das quatro CVEs corrigidas por backport, com evidência do secdb.

## Critérios de aceitação

- [x] Redis com `3.5.9-r1` reconhecido; `r0` e `r2` continuam bloqueando.
- [x] Prazo (2026-12-19) e lista de CVEs inalterados.
- [x] Evidência do secdb (v3.22 e v3.24) registrada com hash.
- [ ] `upgrade-restore` verde na PR.

## Matriz de testes e evidências

`node --test scripts/security/*.test.mjs` (264 PASS, incluindo os casos novos); `upgrade-restore` na CI (Grype fixado por digest).

## Rollback ou recuperação

Revert da PR (volta a bloquear o Redis).

## Aprovação

Decisão: `GO` — responsável escolheu em 2026-11-23 "Merge e nova frente": tratar a imagem do Redis atualizando a base se houver correção ou registrando a revisão das CVEs com prazo.
