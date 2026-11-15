---
change_id: NA-0082
title: Saúde dos recursos com evidências e proteção contra desativação no deploy
type: feature
status: tests-passed
created_at: 2026-10-29T20:36:13-03:00
base_branch: master
base_sha: f4a44b4b7ae87a8f688b1246d9e52a31f9a104bc
branch: feature/NA-0082-20261029-resource-health
owner: Codex
planner: Codex
risk: medium
issue: null
---

# NA-0082 — Saúde dos recursos

## Contexto e situação anterior

As configurações mostram flags da API, mas habilitação não comprova funcionamento. A NA-0081 encontrou auditoria desabilitada e IA habilitada sem provider configurado. Comparativo e roadmap: `docs/PRD-resource-health-and-comparison.md`.

## Problema e objetivo

Distinguir habilitação, configuração e evidência operacional dos seis recursos, orientando correção sem bloquear o acesso SSH.

## Escopo

- Painel nas configurações, endpoint administrativo limitado ao tenant, metadados de auditoria, readiness de IA e evidências do gateway/MCP.
- Estados desabilitado, não configurado, operacional, degradado e desconhecido, com idade e ação recomendada.
- Proteção de atualização/rollback contra desativação silenciosa de flags, com exceção explícita.
- Testes unitários, de autorização, simulações de falha e browser responsivo.
- Excluídos: bloqueio de sessões, alteração do transporte, gravação gráfica, WinBox, handover, migração de banco e deploy em produção.

## Critérios de aceitação

- [x] Os seis recursos aparecem com motivo e próximo passo; flag sozinha não gera saúde positiva.
- [x] Auditoria indisponível apresenta alerta crítico e preserva admissão de sessões.
- [x] Integração ausente, evidência expirada, falha de consulta e divergência API/gateway são distinguíveis.
- [x] Apenas administradores consultam; dados de uso isolados por tenant e sem segredos/conteúdo de sessões.
- [x] Consultas de saúde não executam comandos SSH ou chamadas a provedores.
- [x] Interface cobre carregamento, erro/retry, atualização e telas pequenas.
- [x] Deploy protegido contra regressão de flags, com simulações de sucesso/falha/exceção.
- [x] Revisão independente e validações reais registradas, sem afirmar homologação humana.

## Estratégia técnica

Readmodel dedicado, reutilizando readiness existente. Evidência ausente ou antiga vira desconhecido. Publicação periódica do gateway separada do fluxo de sessões. UI composta, sem aumentar a área do terminal. Sem novas bibliotecas de aplicação. O guard requer Python 3.6+ no host, com biblioteca padrão para parsing seguro de JSON.

## Riscos e mitigações

| Risco | Impacto | Mitigação | Stop criterion |
|---|---|---|---|
| Falso saudável | Auditoria perdida passa despercebida | Evidência datada, estados conservadores | Saúde inferida somente de flag |
| Vazamento entre tenants | Exposição de uso | Filtros JWT e testes negativos | Consulta sem escopo |
| Diagnóstico afetar SSH | Indisponibilidade | Leitura e publisher independente | Await novo no transporte |

## Matriz de testes e evidências

| Critério | Teste | Ambiente | Evidência | Required |
|---|---|---|---|---|
| Estados, erros, permissões | Vitest backend/frontend | Local isolado | test-results.md | yes |
| Deploy | Fixtures e mocks de Docker | Local | test-results.md | yes |
| UX | Browser com API simulada | Local | test-results.md | yes |
| Integração | Typecheck/lint/build | Node 24 | test-results.md | yes |

## Baseline

- Base SHA: f4a44b4b7ae87a8f688b1246d9e52a31f9a104bc.
- Worktree isolado preserva registros não commitados da NA-0081.
- Baselines executados: backend 25 testes, frontend 43 testes e guard stateful 6 testes aprovados; detalhes em `test-results.md`.

## Rollback ou recuperação

Reverter os arquivos desta frente; não há migração ou alteração de política de admissão. Heartbeats expiram e leitores antigos ignoram as novas chaves. Nenhuma alteração remota autorizada nesta frente.

## Mudanças de escopo e decisões

Usuário confirmou manter acesso e exibir alerta crítico quando a auditoria estiver indisponível. Publicação GitHub/produção não faz parte desta execução local. Correção necessária identificada na revisão: observação passiva de erros já capturados na persistência de auditoria; registra somente timestamp e não altera admissão/transporte. Dependência operacional explícita Python 3.6+ para o guard.

## Aprovação

- Decisão: GO_WITH_RISKS (análise independente de evidências e ausência de fail-closed).
- Aprovado por: usuário, ao solicitar implementação fim a fim e confirmar política de alerta.
- Aprovado em: 2026-10-29 (sessão atual).

## Resultado local

Validação técnica: PASS_WITH_WARNINGS; working tree identificado em `test-results.md`, sem novo commit. Revisão independente frontend PASS e backend PASS_WITH_WARNINGS; guard revisado pelo orquestrador e executado independentemente. Estado de entrega LOCAL_WIP; commit, push, PR, merge, sincronização de master e homologação humana pendentes. Não marcar esta frente como entregue.
