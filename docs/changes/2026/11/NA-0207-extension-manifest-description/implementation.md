# NA-0207 — Registro da implementação

## Pedido e objetivo

Após revisão da extensão (2026-11-27), usuário pediu ajustar todos os itens fim a fim: VPS só local, push/PR sem merge, backup cifrado da chave. Esta frente corrige a descrição do manifesto e prepara o pacote 0.1.1.

## Implementação

Base `109add8bf`. `apps/extension/manifest.ts`: descrição nova. `apps/extension/src/core/client.test.ts`: asserção da descrição.

## Validação

Ran: baseline Vitest extensão 372 PASS; após a mudança 373 PASS (+1 teste de descrição), `typecheck:extension` PASS, ESLint sem erros (`.tmp/NA-0207/after-checks.log`). Pacote de prova 0.1.1 (checkout sujo) mudou só `version` e `description` no manifesto em relação ao 0.1.0; mesmo ID.

Pós-commit `f51b218d0`: pacote 0.1.1 regenerado no checkout limpo (`sourceCommit` = SHA, ZIP idêntico byte a byte ao de prova, SHA256 `9446a7b4…5c1e`); verificador independente (adaptado de NA-0206) 11/11 PASS (`.tmp/NA-0207/artifact-verification.json`); empacotador/release 29 PASS, 1 skip condicional. `validate:sonar` BLOCKED por ambiente: Gate OK, cobertura nova 100%, Vitest 5073 PASS, mas laboratório TLS e harness `vault-site-terminal` falharam com `docker: permission denied` (grupo `docker` vazio). Detalhes em `docs/sonarqube/validation-NA-0207.md`.

## Recuperação

Reverter o commit; pacote 0.1.0 preservado.

## Pendências

- Homologação humana (Chrome/Edge, Windows) pelo roteiro `homologation.md` desta pasta.
- Merge na ordem #92 → #93 → #94 após CI verde e homologação.
- Pentest externo do preenchimento pelo escopo `docs/changes/2026/11/NA-0203-extension-sequence/pentest-scope.md`; flag continua desligada.
- Helper de restauração (NA-0206): triagem individual com revisão independente antes do ensaio isolado.
- Backup cifrado da chave: usuário informou ter executado; arquivo não está no destino padrão (local escolhido pelo usuário, não verificado).

## Diário de interações

### 2026-11-27T14:03:00-03:00 — Abertura

Branch criada sobre NA-0206 (PR #93). Plano GO; baseline registrado.

### 2026-11-27T14:30:00-03:00 — Pacote, Sonar e publicação

Commit `f51b218d0`, push e PR #94 (empilhado sobre #93). Usuário escolheu ACL temporária para o Docker; `setfacl` ausente e alternativa por `chgrp` negada pela política, então Sonar ficou BLOCKED. Planilha: escrita única (META-005/META-017 D/G/J/K e Revisões linha 54), hash antes `20c7a104…` e depois `c87052f1…`. Ran: governança, pacote, verificador, Sonar (BLOCKED). Manual: homologação, backup da chave, merge.

### 2026-11-27T16:45:00-03:00 — Sonar PASS

Usuário autorizou executar a ACL. Instalado o pacote `acl`; ACL temporária no socket aplicada e removida ao fim. Segunda rodada: Node/TLS PASS, falha só em `vault-site-terminal` por imagens locais ausentes; imagens reconstruídas pelos comandos do CI, teste focal PASS, terceira rodada `validate:sonar` PASS no `4c876319b`. Próximo commit é só de documentação. Manual: homologação, backup da chave, merge.

### 2026-11-27T18:15:00-03:00 — Publicação 0.1.1 na VPS e CI do GitHub

Usuário autorizou seguir com homologação, merge, publicação 0.1.1, helper e pentest. Publicação: pasta da extensão conferida com os hashes da 0.1.0, backup em `/opt/nodeaccess/maintenance/NA-0207-extension-0.1.1/backup-0.1.0`, ZIP/CRX novos instalados e `release.json`/`update.xml` trocados por renomeação atômica; API relê o pacote por requisição, sem reinício. Smoke público PASS: `update.xml` 0.1.1, CRX SHA256 `938d3abd…3d00d`, saúde OK, metadados 401 sem autenticação (`.tmp/NA-0207/vps/publish-evidence.json`). CI remoto falhava por lacunas de ambiente introduzidas desde NA-0203; correções em NA-0203/NA-0206 trazidas por merge. Criados `homologation.md` (roteiro humano) e, em NA-0203, `pentest-scope.md`. Planilha: segunda escrita única desta interação (Revisões linha 55). Merge não feito: depende de CI verde e homologação. Ran: publicação/smoke, governança. Manual: homologação, pentest.
