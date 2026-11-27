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

- Publicação do 0.1.1 na VPS (não autorizada nesta frente); homologação humana.
- Backup cifrado da chave: script testado em `.tmp/NA-0207/backup-signing-key.sh`, a ser executado pelo usuário (pede senha).
- Helper de restauração (NA-0206): pacotes já na última versão do Alpine 3.24, sem correção disponível; decisão do usuário entre triagem individual com revisão independente ou reescrever sem Python.

## Diário de interações

### 2026-11-27T14:03:00-03:00 — Abertura

Branch criada sobre NA-0206 (PR #93). Plano GO; baseline registrado.

### 2026-11-27T14:30:00-03:00 — Pacote, Sonar e publicação

Commit `f51b218d0`, push e PR #94 (empilhado sobre #93). Usuário escolheu ACL temporária para o Docker; `setfacl` ausente e alternativa por `chgrp` negada pela política, então Sonar ficou BLOCKED. Planilha: escrita única (META-005/META-017 D/G/J/K e Revisões linha 54), hash antes `20c7a104…` e depois `c87052f1…`. Ran: governança, pacote, verificador, Sonar (BLOCKED). Manual: homologação, backup da chave, merge.

### 2026-11-27T16:45:00-03:00 — Sonar PASS

Usuário autorizou executar a ACL. Instalado o pacote `acl`; ACL temporária no socket aplicada e removida ao fim. Segunda rodada: Node/TLS PASS, falha só em `vault-site-terminal` por imagens locais ausentes; imagens reconstruídas pelos comandos do CI, teste focal PASS, terceira rodada `validate:sonar` PASS no `4c876319b`. Próximo commit é só de documentação. Manual: homologação, backup da chave, merge.
