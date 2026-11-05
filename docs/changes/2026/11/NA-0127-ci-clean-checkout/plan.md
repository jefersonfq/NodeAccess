---
change_id: NA-0127
title: Preservar checkout limpo após instalação npm
type: fix
status: in_progress
created_at: 2026-11-03T19:00:00-03:00
base_branch: chore/NA-0093-20261103-sonar-final-validation
base_sha: 8dae9b49a8dab89b9c0a7c4fcb4a29a1d401662d
branch: fix/NA-0127-20261103-ci-clean-checkout
owner: Codex
planner: Codex
risk: low
issue: null
---
# NA-0127 — Checkout limpo após npm

## Contexto e situação anterior

PR59 falhou em CI_CLEAN_TRACKED_CHECKOUT_REQUIRED após instalação e preparação. WSL usa core.filemode=false; GitHubLinux verifica modos.

## Problema e objetivo

Reproduzir alteração rastreada e corrigir sua origem sem retirar guarda de checkout limpo.

## Escopo

Diagnóstico npm/arquivo bin workspace e correção mínima comprovada. Configuração base/head e gates preservados.

## Critérios de aceitação

- [x] Arquivo e transformação identificados com hashes/modos antes/depois.
- [x] Preparação não altera checkout corrigido comfilemode=true.
- [x] Guarda continua rejeitando alteração rastreada real.

## Estratégia técnica

Clone privado com configuração Linuxfilemode=true; executar npmci e demais etapas pertinentes. Se chmod do bin for confirmado, versionar modo executável correto do entrypoint comshebang. Não ignorar diferenças.

## Riscos e mitigações

Conteúdo/segredos não devem aparecer em diagnóstico; usar somente caminhos/modes/hashes. Não alterar configuração global Git nemcheckoutNA0093.

## Matriz de testes e evidências

| Critério | Teste | Ambiente | Evidência | Obrigatório |
|---|---|---|---|---|
| Origem | npmci antes/depois | CloneLinuxprivado | test-results.md | Sim |
| Regressão | preparação checkoutcorrigido | CloneLinuxprivado | test-results.md | Sim |
| Guarda | testesci-run | Worktree | test-results.md | Sim |

## Baseline

Commit base registrado acima; log privadoCI126230708071 preservado pela coordenação.

## Rollback ou recuperação

Reverter apenas delta mínimo desta frente; não restaurar/limpar arquivos do usuário.

## Mudanças de escopo e decisões

Hipótese inicial: npm bin-links torna apps/agent/src/index.js executável, atualmente100644; validar antes de corrigir.

## Aprovação

- Decisão: GO_WITH_RISKS
- Aprovado por: usuário e coordenação
- Aprovado em: 2026-11-03
