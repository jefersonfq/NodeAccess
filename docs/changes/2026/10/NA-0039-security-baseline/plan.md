---
change_id: NA-0039
title: "Preservar base local da revisão de segurança"
type: security
status: LOCAL_WIP
created_at: 2026-10-08T11:15:00-03:00
base_branch: local-security-baseline
base_sha: e833542c967da03b49956b0736e002b964214029
branch: chore/NA-0039-20261008-security-baseline
owner: Jeferson Quintana
planner: Codex
risk: medium
---

## Contexto e situação anterior
Revisão local autorizada em 08/10/2026, preservando alterações anteriores da NA-0038. Evidências em docs/reviews/2026-10-08-engineering-followup.md e 2026-10-08-stack-security-review.md.

## Problema e objetivo
Preservar base local da revisão de segurança. Reduzir riscos com alterações rastreáveis e validação contra regressões.

## Escopo
Snapshot seletivo dos fontes, testes, documentação e configurações do workspace atual. Exclui dados de execução, credenciais, sites e artefatos não pertinentes. Manifesto local /tmp/nodeaccess-security-original-manifest.json registra hashes e exclusões.

Guacd explicitamente excluído de atualizações por decisão do usuário. Sem deploy, push ou merge em master nesta etapa.

## Critérios de aceitação
- [ ] Evidência dos testes pertinentes registrada.
- [ ] Mudanças isoladas em commit e branch próprios.
- [ ] Guacd preservado e workspace original intacto.

## Estratégia técnica
Worktree isolada /tmp/nodeaccess-security-local. Branches sequenciais mantêm os pontos de retorno; não aplicar resets sobre o workspace original.

## Riscos e mitigações
Testes de regressão antes/depois. Alterações de contrato, dependências e deploy revisadas separadamente. Ausência de CVEs no scanner não garante ausência de vulnerabilidades.

## Matriz de testes e evidências
Testes focados por mudança e suíte integrada antes de uma release. Resultados registrados em evidence.md ao concluir a etapa.

## Baseline
Commit anterior: e833542c967da03b49956b0736e002b964214029. A primeira etapa captura código local ainda não commitado; não equivale a uma release homologada.

## Rollback ou recuperação
Consultar a branch anterior em uma nova worktree ou reverter apenas os commits desta etapa. Não restaurar arquivos sobre trabalho não salvo. Bases de dados descartáveis; nenhum banco de produção alterado.

## Aprovação
Decisão: GO
Autorização do usuário para revisão e correções locais fim a fim com branches, preservando guacd. Publicação e homologação da versão serão etapas posteriores.
