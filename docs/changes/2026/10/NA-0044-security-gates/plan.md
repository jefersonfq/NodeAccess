---
change_id: NA-0044
title: "Automatizar verificacoes e registrar bloqueios de release"
type: security
status: LOCAL_VALIDATED
created_at: 2026-10-08T11:15:00-03:00
base_branch: local-security-baseline
base_sha: f2108dc6d4275089447831ee146aa96d3eebee55
branch: security/NA-0044-20261008-security-gates
owner: Jeferson Quintana
planner: Codex
risk: medium
---

## Contexto e situação anterior
Revisão local autorizada em 08/10/2026, preservando alterações anteriores da NA-0038. Evidências em docs/reviews/2026-10-08-engineering-followup.md e 2026-10-08-stack-security-review.md.

## Problema e objetivo
Automatizar verificacoes e registrar bloqueios de release. Reduzir riscos com alterações rastreáveis e validação contra regressões.

## Escopo
Auditoria npm de runtime bloqueante, relatório de desenvolvimento e SBOM; scan local de segredos e SAST com ferramentas gratuitas; exceção explícita do guacd e critérios de liberação rastreáveis.

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
Commit anterior: f2108dc6d4275089447831ee146aa96d3eebee55. A primeira etapa captura código local ainda não commitado; não equivale a uma release homologada.

## Rollback ou recuperação
Consultar a branch anterior em uma nova worktree ou reverter apenas os commits desta etapa. Não restaurar arquivos sobre trabalho não salvo. Bases de dados descartáveis; nenhum banco de produção alterado.

## Aprovação
Decisão: GO
Autorização do usuário para revisão e correções locais fim a fim com branches, preservando guacd. Publicação e homologação da versão serão etapas posteriores.

## Ajuste de escopo pela evidência
SAST identificou bypass TLS no acesso web por túnel; validação corrigida com teste HTTPS real. Tag GCM de 16 bytes explicitada preservando formato existente.
