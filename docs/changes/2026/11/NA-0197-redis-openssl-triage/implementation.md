# NA-0197 — Registro da implementação

Base: `07c004f10` (master após a NA-0194). Branch: security/NA-0197-20261123-redis-openssl-triage.

## Pedido e decisão

Na PR #85, `upgrade-restore` reprovou a imagem do Redis por CVEs do OpenSSL sem relação com a mudança; o responsável autorizou o merge e uma frente separada para tratar a imagem.

## Implementação

- Diagnóstico: `apk upgrade` no build trouxe `openssl 3.5.9-r1`; a triagem exata da NA-0185 fixava o Redis em `r0`.
- Secdb do Alpine (v3.22 e v3.24): quatro das nove CVEs corrigidas por backport em `3.5.9-r1`; as outras cinco sem correção.
- `security/openssl-image-triage.json`: Redis `r1`; as quatro CVEs aceitam `r1`; motivo e evidência atualizados; prazo mantido.
- Testes da política ajustados (Redis `r1`; `r0`/`r2` bloqueiam; as quatro CVEs com `r1` e motivo).

## Validação

- Ran: `node --test scripts/security/*.test.mjs` 265 PASS.
- Ran: revisão independente (subagente): PASS_WITH_WARNINGS — aceita só os 18 achados reportados; secdb v3.22/v3.24 conferido; ajustes aplicados (teste de CVE revisada só para outra revisão de pacote; texto do motivo).
- Planned: `upgrade-restore` na CI da PR.

## Diário de interações

### 2026-11-23T23:59:00-03:00 — Diagnóstico e ajuste

Ver acima.
