---
change_id: NA-0112
title: Encerrar descendentes do harness após timeout
type: fix
status: in-development
created_at: 2026-11-03T17:17:39-03:00
base_branch: chore/NA-0093-20261103-sonar-integration
base_sha: 47f06b51e693d91f5ed724b7b86e5362af75bc35
branch: fix/NA-0112-20261103-browser-timeout
owner: Codex
planner: Codex
risk: low
issue: null
---

# NA-0112 — Timeout do harness browser

## Objetivo e causa

executeBrowserHarness cancela o timer de SIGKILL ao receber close do pai, mesmo depois de timeout. Descendente resistente a SIGTERM permanece ativo. Reprodução isolada confirmou result timedOut=true com filho ainda vivo.

## Escopo e critérios

- Somente tools/coverage/browser.mjs e seus testes/documentos; não alterar produto nem a análise Sonar em andamento.
- Timeout encerra o grupo POSIX privado mesmo quando o pai encerra antes dos descendentes; escalada continua limitada.
- Preservar exit codes, logs privados, falhas de spawn, sucesso e timeout existentes.
- Teste real cria pai/filho sintéticos, preserva prova de falha anterior e garante cleanup defensivo.
- Registrar risco de reutilização de PID, comportamento Linux e limite Windows sem prometer encerramento de árvore nessa plataforma.

## Aprovação e recuperação

GO_WITH_RISKS: root autorizou a correção localizada em branch isolada no escopo de testes/Sonar solicitado pelo usuário. Commit local autorizado, sem merge/publicação. Reverter o commit restaura somente o harness. Revisão independente pelo agente frontend antes da integração.
