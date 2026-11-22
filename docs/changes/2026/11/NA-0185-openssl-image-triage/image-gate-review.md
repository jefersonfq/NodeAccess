# NA-0185 — Revisão do gate de imagens (2026-11-22)

Fonte: artefato `stack-upgrade-report` do run 44891378946 (check `upgrade-restore` da PR75, Grype fixado por digest em `scripts/security/scan-images.mjs`). Decisão do responsável em 2026-11-22: aceitar temporariamente as 5 CVEs novas, sem pacote corrigido, com a mesma validade da triagem OpenSSL da NA-0181, até **2026-12-19** (o bloqueio volta em 2026-12-19T00:00:00Z). Histórico anterior: `docs/changes/2026/11/NA-0181-image-vulnerability-gate/image-gate-review.md`.

## Achados e classificação

| CVE | Pacotes | Versão por imagem | Restrição observada | Classificação |
|---|---|---|---|---|
| CVE-2026-124709 | `libssl3`, `libcrypto3` em todas; `openssl` só em backend e tls-agent | 3.5.9-r1 (backend, frontend, frontend-k8s, tls-agent em Alpine 3.24.4; guacd em 3.24.3); 3.5.9-r0 (redis, Alpine 3.22.8) | `>= 3.5.0, < 3.5.10` (e ramos 4.x) | Vulnerabilidade real no servidor QUIC; o produto não usa QUIC |
| CVE-2026-107494 | idem | idem | idem | Real, pilha QUIC; não usada |
| CVE-2026-121482 | idem | idem | idem | Real, verificação CMS/PKCS#7 com CRL; não usada |
| CVE-2026-84786 | idem | idem | inclui ramos 1.1.1 e 3.0 | Real, cliente TLS com DANE; não usado |
| CVE-2026-107493 | idem | idem | inclui ramos 1.0.2, 1.1.1 e 3.0 | Real; só afeta quem reutiliza a pilha de `PEM_X509_INFO_read_bio_ex` após falha; sem uso identificado no produto |

Todas com `namespace=nvd:cpe`, `fix.state=unknown`, `matcher=apk-matcher`, CPE pesquisado `cpe:2.3:a:openssl:openssl:3.5.9:…` e CPE encontrado `cpe:2.3:a:openssl:openssl:*:…`. Correção upstream: OpenSSL 3.5.10. Em 2026-11-21 o índice do Alpine publica `3.5.9-r1` (v3.24) e `3.5.9-r0` (v3.22); nos relatórios das imagens com `3.5.9-r1` as 4 CVEs da NA-0181 já não aparecem; as 5 novas sim.

## Mudança na política

- `images[ref].packageVersion` (opcional; sem ele vale `version`), declarado em todas as imagens: Alpine 3.24 em `3.5.9-r1`, redis em `3.5.9-r0`. A versão é comparada com o artefato e com `searchedBy.package.version`.
- `images[ref].packages` (opcional; sem ele vale a lista global): frontend, frontend-k8s, guacd e redis aceitam só `libssl3`/`libcrypto3`; backend e tls-agent também `openssl`, que é onde o pacote existe. Antes, a lista era global (ampliação teórica herdada da NA-0181).
- Cada CVE lista `packageVersions` revisadas (obrigatório). As 4 CVEs da NA-0181 ficam só em `3.5.9-r0` (no r1 elas não aparecem e, se aparecessem, continuariam bloqueando); as 5 novas valem para r0 e r1.
- Demais exigências inalteradas: imagem e distro exatas, pacote, severidade High, namespace, fonte NVD, sem correção, um único match, restrição e CPEs idênticos, validade.

## Garantias mantidas

- Severidades bloqueantes e scanner inalterados; relatórios brutos preservados; sem curinga.
- Outra versão, imagem, distro, CVE, restrição ou CPE, ou correção disponível, volta a bloquear.

## Validação

- `node --test scripts/security/*policy*.test.mjs`: 256 PASS / 0 FAIL.
- Mutação local: sem a checagem de `packageVersions`, 62 testes falham; sem a versão por imagem, 77; sem os pacotes por imagem, 25.
- Revisão independente (subagente, 2026-11-22): aprovada com ajustes de documentação e escopo de pacotes, aplicados.
- Replay das políticas sobre os relatórios brutos do run 44891378946 (`.tmp/NA-0185/replay.mjs`, local): 7/7 imagens PASS em 2026-11-22; em 2026-12-19T00:00Z as imagens voltam a bloquear.
- Check remoto `upgrade-restore`: registrar na PR.

## Build do guacd (2026-11-22)

O check da PR76 falhou no build do guacd: o APK fixado `glib-2.90.0-r0` foi retirado do Alpine edge (a URL responde 404; o índice edge publica `2.90.1-r0`). O pin passou a `glib-2.90.1-r0`, SHA256 `8d48e2c7…a2f3`; `apk verify` com as chaves oficiais da base `alpine:3.24.3` retornou OK e a instalação simulada concluiu. Os pins `alsa-lib-1.2.16.1-r0` e `sqlite-libs-3.54.1-r0` seguem no índice. O scan do guacd com o pacote novo fica registrado no check `upgrade-restore`.

## Pendências

- Quando o Alpine publicar OpenSSL 3.5.10 (ou backport), reconstruir as imagens e remover as entradas.
- Reavaliar tudo antes de 2026-12-19, junto com as demais triagens e a verificação do CVE-2026-84782 (NA-0181).
