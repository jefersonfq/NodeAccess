---
change_id: NA-0185
title: Triagem exata de CVEs novas do OpenSSL Alpine sem pacote corrigido
type: security
status: implementing
created_at: 2026-11-21T08:30:00-03:00
base_branch: master
base_sha: b4e8cccaba309c8f5aa626e5e31955718b9fce84
branch: security/NA-0185-20261121-openssl-triage
owner: Jeferson Quintana
planner: Claude Code
risk: medium
issue: null
---

# NA-0185 — Triagem das CVEs novas do OpenSSL Alpine

## Contexto e situação anterior

O check `upgrade-restore` passou na PR75 em `52b7dc4e4` (2026-11-20) e falhou em `41fd3ca0e` e seguintes (2026-11-21) sem mudança de Dockerfile. `npm run security:images` (Grype fixado por digest) passou a encontrar 5 CVEs High novas do OpenSSL, sem correção conhecida. Evidência: artefato `stack-upgrade-report` do run 44891378946 (cópia local em `.tmp/NA-0185/ci`). A triagem OpenSSL da NA-0181 (`security/openssl-image-triage.json`, válida até 2026-12-19) cobre só a versão `3.5.9-r0` e outras 4 CVEs.

## Problema e objetivo

| CVE | Pacotes | Versões | Imagens | Exposição |
|---|---|---|---|---|
| CVE-2026-124709 (High) | libssl3, libcrypto3 (todas); openssl (só backend e tls-agent) | 3.5.9-r0, 3.5.9-r1 | backend, frontend, frontend-k8s, tls-agent, guacd, redis | Servidor QUIC; o produto não usa QUIC |
| CVE-2026-107494 (High) | idem | idem | idem | Pilha QUIC; não usada |
| CVE-2026-121482 (High) | idem | idem | idem | Verificação CMS/PKCS#7 com CRL; não usada |
| CVE-2026-84786 (High) | idem | idem | idem | Cliente TLS com DANE; não usado |
| CVE-2026-107493 (High) | idem | idem | idem | Só programas que reutilizam a pilha de `PEM_X509_INFO_read_bio_ex` após falha; o OpenSSL não faz isso e não há uso identificado no produto |

Correção upstream: OpenSSL 3.5.10. Índice oficial do Alpine em 2026-11-21: v3.24 publica `3.5.9-r1` (2026-11-18) e v3.22 publica `3.5.9-r0`; nos relatórios das imagens com `3.5.9-r1` as 4 CVEs antigas não aparecem e as 5 novas sim. Nenhum pacote corrigido disponível.

Objetivo: voltar o gate a verde com triagem exata (imagem, distro, pacote, versão, CVE, restrição de versão e CPE) e validade curta, sem ampliar a política.

## Escopo

- Dentro: `security/openssl-image-triage.json` com as 5 CVEs e a versão por imagem (`3.5.9-r1` nas imagens Alpine 3.24, `3.5.9-r0` no redis Alpine 3.22); ajuste mínimo em `scripts/security/openssl-image-policy.mjs` para aceitar a versão do pacote por imagem, mantendo todas as demais exigências; testes da política; registro em `image-gate-review.md`.
- Fora: mudar severidades bloqueantes, remover o scanner, triagem genérica (curinga), trocar imagem base, deploy.

## Critérios de aceitação

- [ ] Cada triagem cita CVE, pacotes e versão exatos por imagem, a restrição de versão e o CPE observados, motivo e validade definida pelo responsável.
- [ ] Achado com outra versão, imagem, distro, CPE ou restrição continua bloqueando (testes).
- [ ] `upgrade-restore` e governança PASS na PR; PR75 volta a passar no `upgrade-restore` após o merge.
- [ ] Revisão independente da triagem.

## Estratégia técnica

1. Versão do pacote por imagem: `images[ref].packageVersion` (opcional; sem ele vale `version`), comparada com o artefato e com o `searchedBy.package.version`.
2. Acrescentar as 5 CVEs com o `versionConstraint` exato do relatório.
3. Testes positivos e negativos em `openssl-image-policy.test.mjs`.

## Riscos e mitigações

- Aceitar High sem correção: escopo exato, validade curta, reavaliação ao vencer; exposição baixa (recursos não usados).
- Alpine publicar 3.5.10 antes do vencimento: reconstruir as imagens e retirar a triagem.

## Matriz de testes e evidências

`node --test scripts/security/*policy*.test.mjs`; reprocessar os relatórios do run 44891378946 com a política nova; checks remotos `upgrade-restore` e governança; `npm run validate:sonar` (código muda).

## Baseline

Run 44891378946: 6 imagens reprovadas (backend, frontend, frontend-k8s, tls-agent, guacd, redis); mysql aprovada.

## Rollback ou recuperação

Revert da PR. A triagem vence sozinha e volta a bloquear o gate.

## Mudanças de escopo e decisões

- 2026-11-22: responsável aceitou a triagem temporária até 2026-12-19 (mesma validade da NA-0181).
- Versão por CVE (`packageVersions`) para não estender as 4 CVEs antigas ao 3.5.9-r1.
- Pacotes por imagem (`images[ref].packages`) após a revisão independente: o `openssl` (CLI) só vale onde está instalado (backend, tls-agent).

## Aprovação

Decisão: `GO_WITH_RISKS` — aprovado pelo responsável em 2026-11-22 (aceitação temporária até 2026-12-19).
