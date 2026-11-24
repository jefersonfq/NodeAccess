# NA-0197 — Revisão do gate de imagens: Redis com OpenSSL 3.5.9-r1 (2026-11-23)

Fonte: artefato `stack-upgrade-report` do run 45284757020 (check `upgrade-restore` da PR #85). A única imagem reprovada foi `nodeaccess-redis:8.2.10-1` (Alpine 3.22.8): o build faz `apk upgrade` sobre a base fixada por digest e o Alpine publicou `openssl 3.5.9-r1` para a v3.22; a triagem da NA-0185 fixava o Redis em `3.5.9-r0`, então as 18 ocorrências High (9 CVEs × `libssl3`/`libcrypto3`) deixaram de ser reconhecidas.

## Evidência do Alpine (secdb, baixado em 2026-11-23)

| Arquivo | SHA-256 | openssl: CVEs corrigidas em 3.5.9-r1 |
|---|---|---|
| `https://secdb.alpinelinux.org/v3.22/main.json` | `3d29da6853ee52ee63931470c7dd65f18610de0693821c9b435d3a359b314dc2` | CVE-2026-88823, CVE-2026-95691, CVE-2026-95692, CVE-2026-107496 |
| `https://secdb.alpinelinux.org/v3.24/main.json` | `d04f6022c4001313f6cce8fe937fcb395c023598211fbb74c19d233e07f78a0f` | as mesmas quatro |

As outras cinco (CVE-2026-124709, -107494, -121482, -84786, -107493) não têm correção no Alpine em nenhuma das duas versões; continuam sob a aceitação temporária da NA-0185 (classificação e uso no produto em `../NA-0185-openssl-image-triage/image-gate-review.md`).

## Mudança na política (`security/openssl-image-triage.json`)

- Redis: `packageVersion` `3.5.9-r0` → `3.5.9-r1` (mesma distro 3.22.8, mesmos pacotes `libssl3`/`libcrypto3`).
- As quatro CVEs corrigidas por backport passam a listar também `3.5.9-r1`: no r1 elas são falso positivo do match por CPE do NVD (que compara só a versão upstream 3.5.9 < 3.5.10). Na NA-0185 elas ficaram só em r0 porque não apareciam no r1; agora o secdb comprova a correção.
- `reason` atualizado com o backport; `reviewedAt` 2026-11-23; `expiresAt` **mantido** em 2026-12-19; nenhuma CVE nova; demais exigências inalteradas (imagem e distro exatas, pacote, severidade, namespace, fonte, sem correção, match único, restrição e CPEs idênticos, validade).

## Garantias

Outra revisão de pacote (ex.: `3.5.9-r2`), imagem, distro, CVE, restrição ou CPE volta a bloquear (testes em `scripts/security/openssl-image-policy.test.mjs`).
