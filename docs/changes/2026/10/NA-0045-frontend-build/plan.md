---
change_id: NA-0045
title: "Remover dependencias vulneraveis do build frontend"
type: security
status: LOCAL_VALIDATED
created_at: 2026-10-08T11:15:00-03:00
base_branch: local-security-baseline
base_sha: b95bd85f8e678e36003a1e54d1c202993ffa2886
branch: security/NA-0045-20261008-frontend-build
owner: Jeferson Quintana
planner: Codex
risk: medium
---

## Contexto e situação anterior
Revisão local autorizada em 08/10/2026, preservando alterações anteriores da NA-0038. Evidências em docs/reviews/2026-10-08-engineering-followup.md e 2026-10-08-stack-security-review.md.

## Problema e objetivo
Remover dependencias vulneraveis do build frontend. Reduzir riscos com alterações rastreáveis e validação contra regressões.

## Escopo
Migrar Tailwind 3 para 4 com compatibilidade visual de base, validar desktop/mobile/terminal e atualizar evidências do manual somente após revisão. Branch anterior preservada para rollback.

Guacd explicitamente excluído de atualizações por decisão do usuário. Sem deploy, push ou merge em master nesta etapa.

## Critérios de aceitação
- [x] Evidência dos testes pertinentes registrada.
- [x] Mudanças isoladas em commit e branch próprios.
- [x] Guacd preservado e workspace original intacto.

## Estratégia técnica
Worktree isolada /tmp/nodeaccess-security-local. Branches sequenciais mantêm os pontos de retorno; não aplicar resets sobre o workspace original.

## Riscos e mitigações
Testes de regressão antes/depois. Alterações de contrato, dependências e deploy revisadas separadamente. Ausência de CVEs no scanner não garante ausência de vulnerabilidades.

## Matriz de testes e evidências
Testes focados por mudança e suíte integrada antes de uma release. Resultados registrados em evidence.md ao concluir a etapa.

## Baseline
Commit anterior: b95bd85f8e678e36003a1e54d1c202993ffa2886. A primeira etapa captura código local ainda não commitado; não equivale a uma release homologada.

## Rollback ou recuperação
Consultar a branch anterior em uma nova worktree ou reverter apenas os commits desta etapa. Não restaurar arquivos sobre trabalho não salvo. Bases de dados descartáveis; nenhum banco de produção alterado.

## Aprovação
Decisão: GO
Autorização do usuário para revisão e correções locais fim a fim com branches, preservando guacd. Publicação e homologação da versão serão etapas posteriores.

Autorização específica adicional: o usuário escolheu migrar o Tailwind em branch própria e validar telas e terminal.
