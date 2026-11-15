---
change_id: NA-0173
title: Reduzir contexto fixo e revisões de aprovação do Codex
type: chore
status: in-development
created_at: 2026-11-08T16:00:00-03:00
base_branch: master
base_sha: 745253d1edb522db79aaa44fd96608ce434a2774
branch: chore/NA-0173-20261108-codex-token-efficiency
owner: jeferson
planner: claude-code
risk: low
issue: null
---

# NA-0173 — Reduzir contexto fixo e revisões de aprovação do Codex

## Contexto e situação anterior

Medição local das sessões do Codex (out–nov/2026): ~3,76 bi tokens de entrada em 71 sessões
principais e ~548 mi em 267 sessões do revisor automático. `AGENTS.md` de 13 KB carregado em
toda sessão e revisão; 1.920 regras de aprovação pontuais; leituras repetidas de plano,
diário, `package.json` e skill de lifecycle.

## Problema e objetivo

Reduzir contexto fixo e chamadas ao revisor sem remover regras obrigatórias, com backup e
reversão explícitos.

## Escopo

- Included: `AGENTS.md`, `ai/frontend-guidelines.md`, skill de lifecycle (mover seções para
  referência), `.gitignore` (`/.tmp/`), `/root/.codex/rules/default.rules` (fora do repo),
  backup e `ROLLBACK.md`, `docs/DEVELOPMENT-token-efficiency.md`; alinhamento do Claude
  (`CLAUDE.md`, configuração local e link da skill); medidor `ai:usage` e testes,
  conforme autorizações registradas em 08/11.
- Excluded: código da aplicação, `config.toml`, modelo, CI.

## Critérios de aceitação

- [x] Backup com hashes e instruções de reversão em `ai/backup/codex-config-2026-11-08/`.
- [x] Nenhuma regra obrigatória removida (movida ou resumida com ponteiro).
- [x] Regras novas aceitas por `codex execpolicy check`; push e `rm -rf` exigem confirmação.
- [ ] Medir consumo nas próximas semanas com a mesma leitura dos rollouts.

## Estratégia técnica

Instruções sob demanda; regras genéricas por prefixo; temporários no workspace.

## Riscos e mitigações

| Risk | Impact | Mitigation | Stop criterion |
|---|---|---|---|
| Agente deixar de aplicar checklist de UX | médio | ponteiro obrigatório na ordem de leitura | regressão de UX observada → reverter AGENTS.md |
| Mais pedidos de aprovação no início | baixo | regras genéricas de leitura/teste | excesso de prompts → ajustar regras |

## Matriz de testes e evidências

| Criterion/risk | Test/harness | Environment | Evidence | Required |
|---|---|---|---|---|
| Regras válidas | `codex execpolicy check` | WSL local | implementation.md | yes |
| Governança | `node --test scripts/change-governance.test.mjs` | WSL local | implementation.md | yes |
| Medidor | `node --test tools/quality/ai-usage.test.mjs` e lint | worktree NA-0173 | implementation.md | yes |
| Código novo | `npm run validate:sonar` | worktree NA-0173 | implementation.md | yes |
| Isolamento | diff por frente, cópias verificadas e revisão independente | WSL local | implementation.md | yes |

## Baseline

- Base SHA: 745253d1edb522db79aaa44fd96608ce434a2774 (árvore com alterações da NA-0172 não commitadas)
- Commands/results: medição dos rollouts registrada em `docs/DEVELOPMENT-token-efficiency.md`
- Known failures: nenhuma conhecida
- Before evidence: backups com SHA-256 em `ai/backup/codex-config-2026-11-08/ROLLBACK.md`

## Rollback ou recuperação

Seguir `ai/backup/codex-config-2026-11-08/ROLLBACK.md` (total ou parcial).

## Mudanças de escopo e decisões

Planilha 2027: passa a uma escrita agrupada por interação (decisão do usuário em 2026-11-08).
Skill mantida em `codex/skills/` porque o teste de governança referencia o caminho do template.

Retomada em 11/11: worktree isolado em `/home/jeferson/NodeAccess-NA-0173`, na branch prevista,
com base original preservada; originais canônicos mantidos até integração verificada.
A janela atual do medidor seleciona arquivos por mtime e soma seus históricos completos;
não equivale ao consumo de eventos no período. Comparação semanal exige correção posterior.

NECESSARY_CORRECTION em 11/11: cobertura isolada68,57% exigiu dois testes CLI com
fixtures sintéticos e verificação de privacidade/seleção de arquivos. Implementação do medidor
inalterada, testes anteriores e limite80% preservados. Aprovação independente do acréscimo;
medição focal92%, sujeita à repetição do gate integral. Timeout no harness de dashboard não
reproduzido no ensaio focal; causa permanece não comprovada, sem ampliar timeout/asserts.

Resultado final local em 11/11: testes e cobertura integral PASS (diff 92%), Quality Gate OK
(80,9% no período, sem novas ocorrências/hotspots). Rotina integral ainda FAIL exclusivamente
por REVIEWED_FINDINGS_NOT_VERIFIED / REVIEW_CHECKOUT_CHANGED. Estado LOCAL_WIP;
nenhum commit/publicação. Evidência em `evidence/resume-20261111.json`; próximo gate exige
autorização explícita de commit e revalidação no SHA fixado, sem inferir homologação.

## Aprovação

- Decisão: `GO`
- Aprovado por: usuário (chat, 2026-11-08)
- Aprovado em: 2026-11-08T16:00:00-03:00
