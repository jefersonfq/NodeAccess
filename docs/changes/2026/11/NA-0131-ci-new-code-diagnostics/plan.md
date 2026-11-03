---
change_id: NA-0131
title: Preservar diagnóstico sanitizado de código novo no CI
type: fix
status: in-development
created_at: 2026-11-03T21:34:22+00:00
base_branch: chore/NA-0093-20261103-sonar-delivery
base_sha: 8dae9b49a8dab89b9c0a7c4fcb4a29a1d401662d
branch: fix/NA-0131-20261103-ci-new-code-diagnostics
owner: NodeAccess
planner: Codex
risk: low
---

# NA-0131 — Diagnóstico de código novo no CI

## Contexto e situação anterior

Ensaio real 8dae aprovou cobertura80.1 e baseline295, porém gate new_violations=1. Limpeza correta do clone apaga raw export, impedindo identificar a ocorrência posteriormente.

## Problema e objetivo

Preservar somente identificadores e relação de assinatura com baseline, mantendo gate bloqueado e política intacta.

## Escopo

Helper de paginação sanitizada api/issues/search e integração no ci-run antes de cleanup; testes e documentos. Sem produto, credenciais, relaxamento de gate ou nova análise automática.

## Critérios de aceitação

- [x] Consulta oficial inNewCodePeriod com components=nodeaccess e resolved=false, paginação completa e limitada.
- [x] Saída somente issueId/rule/file/line/signature e indicador informativo de assinatura revisada; sem messages/snippets/raw.
- [x] Identidade da análise validada antes/depois e cada achado confere com export da mesma análise.
- [x] Erros de API/paginação/conflito falham fechados; cleanup preservado.
- [x] Testes e revisão independente; prova real atribuída separadamente.

## Estratégia técnica

API Community26.10 confirmada pela raiz via webservices/list: inNewCodePeriod desde9.4, components (componentKeys deprecated), ps máximo500. Usar100 por página e limite10000, igual export atual. Guardas de análise/fontes continuam envolvendo export+diagnóstico. Preservar gate no summary mesmo se diagnóstico falhar.

## Riscos e mitigações

Campo de assinatura revisada é diagnóstico, nunca autorização para ignorar new_violations. Raw API fica em memória. Consulta extra somente no opt-in CI, sem impacto no produto. API ausente/inconsistente impede aprovação.

## Matriz de testes e evidências

Planned: paginação, campo extra sensível omitido, assinatura contextual, duplicata/totais/identidade inválidos, erro API, concorrência de análise e cleanup.

## Baseline

8dae9b49a8dab89b9c0a7c4fcb4a29a1d401662d. Ensaio anterior não será descrito como validação do candidato final.

## Rollback ou recuperação

Reverter helper e chamada; nenhum dado persistente ou configuração de produto.

## Aprovação

Decisão: GO_WITH_RISKS. Raiz aprovou diagnóstico necessário, sem relaxar gate ou baseline.
