---
change_id: NA-0010
title: Tornar visível o estado de publicação e sincronização das mudanças
type: process
status: ready-for-tests
created_at: 2026-08-06T13:11:33-03:00
base_branch: master
base_sha: 512024608ea18b98f7bf2bb228e5a1846db929b5
branch: process/NA-0010-20260806-change-state-visibility
owner: codex
planner: codex
risk: low
issue: null
---

# NA-0010 — Visibilidade do estado de mudanças

## Contexto e situação anterior

O lifecycle diferencia estados internos, mas a comunicação após commit e push não deixa explícito que os arquivos só aparecem no `master` e no diretório principal depois de PR, merge e sincronização. O template de plano também usa títulos em inglês incompatíveis com o validador em português, causando falha apenas após o commit.

## Problema e objetivo

Eliminar a falsa sensação de que arquivos não foram atualizados, fornecendo estados verificáveis para trabalho local, commit, push, PR, merge e sincronização do `master`, além de alinhar os templates ao validador existente.

## Escopo

- Included:
  - alinhar templates de plano e evidência ao contrato do validador;
  - documentar os seis estados públicos de entrega;
  - orientar visibilidade de worktrees no VS Code;
  - criar comando somente leitura que reporte SHA local/remoto, merge e sincronização;
  - criar testes determinísticos para a classificação dos estados;
  - garantir que o build limpo gere o pacote compartilhado antes das aplicações;
  - atualizar documentação de engenharia pertinente.
- Excluded:
  - criar ou mesclar PRs automaticamente sem credencial GitHub;
  - alterar branch protection ou rulesets;
  - remover worktrees, branches ou arquivos locais;
  - alterar código funcional da aplicação.

## Critérios de aceitação

- [x] O template de plano passa no validador sem ajuste manual de títulos.
- [x] O fluxo distingue `LOCAL_WIP`, `COMMITTED`, `PUSHED`, `PR_OPEN`, `MERGED` e `MASTER_SYNCED`.
- [x] O relatório informa quando a branch aberta no VS Code não é a branch da frente.
- [x] O comando de status é somente leitura e funciona sem GitHub CLI.
- [x] Estados derivados possuem testes unitários, incluindo branch não enviada, enviada, mesclada e master desatualizado.
- [x] Nenhum arquivo de aplicação, banco, autenticação ou runtime é alterado.
- [x] Governança, testes direcionados e `git diff --check` passam.
- [x] O build de raiz funciona após instalação limpa, sem depender de artefato pré-existente de `packages/shared`.

## Estratégia técnica

Separar a classificação pura de estados das leituras Git. O CLI coletará referências locais/remotas e emitirá JSON e resumo legível, mantendo PR como estado manual quando não houver integração autenticada com GitHub.

Como correção necessária encontrada durante a validação, o build raiz passa a compilar `packages/shared` antes de backend e frontend; sem isso, uma instalação limpa falhava ao resolver `@nodeaccess/shared`.

## Riscos e mitigações

| Risco | Impacto | Mitigação | Stop criterion |
|---|---|---|---|
| Reportar estado incorreto | Médio | Funções puras e testes de matriz | Divergência entre SHA e estado |
| Confundir push com merge | Médio | Estados independentes e próximo passo explícito | Saída marcar master atualizado antes do merge |
| Depender de GitHub CLI | Baixo | Git como fonte local; PR fica Manual/Unknown | CLI tentar mutação ou rede |
| Expandir para código da aplicação | Médio | Allowlist de scripts/docs/skill | Qualquer diff em apps/ |

## Matriz de testes e evidências

| Critério/risco | Teste/harness | Ambiente | Evidência | Obrigatório |
|---|---|---|---|---|
| Classificação de estados | testes Node determinísticos | local | TAP | sim |
| Leitura real Git | CLI sobre NA-0009 e NA-0010 | worktrees locais | saída JSON | sim |
| Compatibilidade do plano | testes de governança | local | TAP | sim |
| Escopo | diff e diff check | NA-0010 | saída Git | sim |
| Regressão da aplicação | não aplicável | — | nenhum arquivo apps/ | não |

## Baseline

- Base SHA: `512024608ea18b98f7bf2bb228e5a1846db929b5`.
- NA-0009: commit local e remoto `260b97f4...`, não contido em `origin/master`.
- O diretório principal está em `master` atualizado, mas mostra cópias não rastreadas de `docs/assets/` porque a frente está em outro worktree.
- O template atual falha nas seções obrigatórias do validador até receber correções manuais.

## Rollback ou recuperação

Reverter scripts e documentação desta frente. O comando é somente leitura e não modifica refs, arquivos, PRs ou configurações Git.

## Aprovação

- Decisão: `GO`
- Aprovado por: usuário
- Aprovado em: 2026-08-06T13:11:33-03:00
