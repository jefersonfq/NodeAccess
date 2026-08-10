---
change_id: NA-0011
title: Alinhar branch padrão e encerramento das frentes Git
type: process
status: ready-for-tests
created_at: 2026-08-07T16:20:00-03:00
base_branch: master
base_sha: ee9df9f125714c6cf3a389676e646321ed136ec1
branch: process/NA-0011-20260807-git-delivery-alignment
owner: codex
planner: codex
risk: low
issue: null
---

# NA-0011 — Alinhamento da entrega Git

## Contexto e situação anterior

O repositório usa worktrees para isolar frentes, mas mantém referências conflitantes a `main` e `master`. A `master` local não possui upstream e uma frente pode terminar em `PUSHED` sem que o fluxo cobre PR, merge e sincronização da pasta principal.

## Problema e objetivo

Padronizar `master` como branch padrão e impedir que uma frente seja comunicada como entregue antes de `MERGED` e `MASTER_SYNCED`, preservando o isolamento por worktree.

## Escopo

- Included:
  - padronizar exemplos e regras em `master`/`origin/master`;
  - exigir upstream correto da branch padrão;
  - expor upstream ausente ou divergente no comando de status;
  - usar a branch da frente na pasta principal para trabalho sequencial;
  - reservar worktrees separadas para concorrência ou preservação de trabalho sujo;
  - definir encerramento por merge/sincronização ou abandono explícito;
  - ajustar configuração Git local sem publicar commits.
- Excluded:
  - push, criação ou merge de PR;
  - remoção automática de branches/worktrees;
  - alterações em aplicação, autenticação ou runtime.

## Critérios de aceitação

- [x] Documentação usa apenas `master` como branch padrão.
- [x] O status informa o upstream efetivo e alerta quando ausente/incorreto.
- [x] Uma frente não pode ser encerrada como entregue antes de merge e sincronização.
- [x] Abandono exige confirmação e preserva recuperabilidade.
- [x] Trabalho sequencial mantém os arquivos visíveis no VS Code atual.
- [x] Worktree separada é tratada como exceção para paralelismo ou preservação.
- [x] Testes direcionados e `git diff --check` passam.

## Estratégia técnica

Manter o modelo de worktrees e corrigir apenas seus contratos de base, visibilidade e fechamento. Estender o CLI existente com leitura não mutável do upstream.

## Riscos e mitigações

| Risco | Impacto | Mitigação | Stop criterion |
|---|---|---|---|
| Confundir branch padrão | Médio | valor único `master` | referência ativa a `origin/main` no fluxo |
| Declarar entrega prematuramente | Médio | gate explícito | fechamento com estado pendente |
| Apagar trabalho abandonado | Alto | confirmação e recuperabilidade | remoção automática |

## Matriz de testes e evidências

| Critério/risco | Teste/harness | Ambiente | Evidência | Obrigatório |
|---|---|---|---|---|
| Estado e upstream | `npm run test:change-status` | local | TAP | sim |
| Governança | `npm run test:change-governance` | local | TAP | sim |
| Formatação | `git diff --check` | NA-0011 | saída Git | sim |

## Baseline

- Base local: `master` em `ee9df9f`, seis commits à frente de `origin/master`.
- `branch.master.remote` e `branch.master.merge` ausentes.
- `origin/HEAD` ausente.
- Exemplo de worktree ainda aponta para `origin/main`.

## Rollback ou recuperação

Reverter documentação e scripts. A configuração local pode voltar a não possuir upstream sem afetar commits.

## Aprovação

- Decisão: `GO`
- Aprovado por: usuário
- Aprovado em: 2026-08-07T16:20:00-03:00
