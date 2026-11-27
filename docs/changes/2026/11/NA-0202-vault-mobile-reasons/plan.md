---
change_id: NA-0202
title: Motivo de bloqueio do cofre junto ao item no celular
type: fix
status: in-development
created_at: 2026-11-24T17:24:32-03:00
base_branch: master
base_sha: 9d2fc71768a0e7aee34a6495e4ec11eceb338076
branch: fix/NA-0202-20261124-vault-mobile-reasons
owner: unassigned
planner: Codex
risk: low
issue: null
---

# NA-0202 — Motivos visíveis no celular

## Contexto e situação anterior

A tabela VaultView tem largura de rolagem 1020 px. O motivo por item aparece na coluna de entrega, fora da área inicial em celular. E3 está não commitada e com Sonar bloqueado; é preservada no checkout principal.

## Problema e objetivo

Explicar o bloqueio junto ao nome do item em telas pequenas, sem exigir rolagem horizontal nem alterar autorização.

## Escopo

Dentro: projeção responsiva do motivo existente em VaultView, validação visual, revalidação do manual e evidências. Fora: ACL, entrega, diagnóstico de outro usuário, host associado, E4, itens web e E7. Demais frentes seguem sequência própria.

## Critérios de aceitação

- [ ] Motivo aparece abaixo do nome em viewport mobile, sem rolagem horizontal para lê-lo.
- [ ] Item liberado não recebe motivo de bloqueio; PEM e revogados mantêm o comportamento existente.
- [ ] Desktop preserva a coluna atual; texto não é duplicado visualmente.
- [ ] Não muda o contrato, ações oferecidas ou regra de autorização.
- [ ] Testes, manual e Sonar registrados sem confundir bloqueio com aprovação.

## Estratégia técnica

Reusar `deliveryFor`, mensagens existentes e breakpoint responsivo do projeto. Alterar apenas render do nome para apresentar uma projeção mobile; coluna atual permanece no desktop. Worktree `.tmp/NA-0202-mobile-worktree`, independente da E3. Documentos sincronizados com pasta canônica.

## Riscos e mitigações

Texto duplicado para leitor de tela: ocultação responsiva via display, não só opacidade. Nome comprido: quebra de palavras. Não copiar regras de disponibilidade para outra camada. Evidência da worktree não significa teste da E3 no checkout principal.

## Matriz de testes e evidências

| Verificação | Resultado esperado |
|---|---|
| vault-views.test.ts | Estados de bloqueio/liberação preservados |
| Chromium 390 px / desktop | Motivo legível junto ao nome, sem duplicação visível |
| Typecheck/lint aplicáveis | Sem regressão de tipos/estilo |
| Manual | Procedimento atualizado após verificar tela |
| validate:sonar | Gate obrigatório; tokens ausentes são bloqueio |

## Baseline

Fetch confirmou origin/master `9d2fc71768a0e7aee34a6495e4ec11eceb338076`. Worktree criada desse SHA. `vault-views.test.ts`: 12 PASS antes da edição, executados dentro da worktree usando dependências já instaladas por symlink.

## Rollback ou recuperação

Reverter a alteração de apresentação. Sem banco/configuração. Preservar E3/handoff; não remover worktree sem recuperar alterações.

## Aprovação

- Decisão: GO.
- Autorização: pedido explícito do usuário para implementar as melhorias menores em 2026-11-24. Esta fatia é uma correção de apresentação de baixo impacto, sem decisão nova de produto/ACL.
- E4 e hosts associados aguardam respostas específicas; a autorização desta fatia não resolve essas regras.
