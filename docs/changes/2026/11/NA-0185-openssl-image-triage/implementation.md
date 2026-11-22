# NA-0185 — Registro da implementação

Base: b4e8cccaba309c8f5aa626e5e31955718b9fce84. Branch: security/NA-0185-20261121-openssl-triage.

## Pedido e objetivo

Voltar o gate de imagens (`upgrade-restore`) a verde após 5 CVEs High novas do OpenSSL sem pacote corrigido no Alpine, com triagem exata e temporária. Desbloqueia a PR75 (NA-0183).

## Implementação

- `scripts/security/openssl-image-policy.mjs`: versão e pacotes por imagem (`images[ref].packageVersion`, `images[ref].packages`) e lista obrigatória `packageVersions` por CVE.
- `security/openssl-image-triage.json`: imagens Alpine 3.24 em `3.5.9-r1`; 5 CVEs novas com restrição exata; 4 CVEs antigas restritas a `3.5.9-r0`; `reviewedAt` 2026-11-22; validade 2026-12-19 mantida.
- `scripts/security/openssl-image-policy.test.mjs`: casos por imagem/versão e negativos (versão cruzada, CVE antiga no r1, CVE sem versões revisadas, distro cruzada).
- `docker/guacd.Dockerfile` e `docker/guacd/README.md`: pin `glib-2.90.0-r0` (retirado do edge) trocado por `glib-2.90.1-r0` com SHA256 novo; assinatura conferida.
- Detalhes e classificação: `image-gate-review.md`.

## Validação

- Ran: `node --test scripts/security/*policy*.test.mjs` 256 PASS / 0 FAIL; mutação das três checagens novas detectada; revisão independente aprovada com ajustes aplicados; replay sobre os relatórios do run 44891378946: 7/7 PASS hoje e bloqueio de volta em 2026-12-19.
- Planned: checks remotos da PR (`upgrade-restore`, governança); `npm run validate:sonar` pelo responsável.

## Recuperação

Revert da PR. Sem banco ou configuração; a triagem vence sozinha em 2026-12-19.

## Pendências

- Remover as entradas quando houver OpenSSL corrigido no Alpine; reavaliar antes de 2026-12-19.

## Diário de interações

### 2026-11-22T10:30:00-03:00 — Aprovação e implementação

Responsável aceitou a triagem até 2026-12-19. Implementada a versão por imagem e por CVE, testes e revisão; validação local acima. Revisão independente aprovada com ajustes (pacotes por imagem, texto sobre o secdb), aplicados. Roadmap 2027: sem item novo (manutenção de segurança). Próximo: commit, push e PR (com autorização).

### 2026-11-22T17:30:00-03:00 — Checks da PR76

`change-governance` falhou (decisão do plano e trailers do commit): corrigidos, validador local PASS. `upgrade-restore` falhou no build do guacd porque `glib-2.90.0-r0` saiu do Alpine edge; pin atualizado para `2.90.1-r0` (`apk verify` OK, instalação simulada OK). Próximo: novo push e checks.
