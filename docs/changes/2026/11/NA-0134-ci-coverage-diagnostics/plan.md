---
change_id: NA-0134
title: Diagnóstico sanitizado de falha de cobertura no CI
type: fix
status: implemented_local
created_at: 2026-11-03T19:55:30-03:00
base_branch: fix/NA-0093-sonar-delivery
base_sha: b76faaec6031f3ebed1372a65dcede08f930cde0
branch: fix/NA-0134-20261103-ci-coverage-diagnostics
owner: equipe NodeAccess
planner: Codex
risk: medium
---

# NA-0134 — Diagnóstico CI

## Contexto e situação anterior
Job126258021626 terminou CI_EXECUTION_FAILED, coverageExit1 e nenhuma análise. Artefato13276578724 não revela coletor interno; logsprivados apagados corretamente.

## Problema e objetivo
Preservar diagnóstico estruturado mínimo sem publicar mensagens livres, paths, tokens ou rawlogs.

## Escopo
ci-run e contratos focais; resumoallowlist da cobertura e faseenum. Sem gates, timeout ou produtos alterados.

## Critérios de aceitação
- [x] FaltaLCOV explicitamente falha antes iniciar servidor.
- [x] Coletorstatus/códigos conhecidos sobrevivem ao cleanup semconteúdo livre.
- [x] Entradasmaliciosas, summaryausente/inválido e fluxo válido testados.
- [x] Revisão independente e checks focais passam.

## Estratégia técnica
Ler metadata limitada antesvalidarLCOV; copiar apenas enums e inteiros válidos. Registrar fase vigente de execução. Desconhecido vira código constante. Nãoinferir causa exata retroativamente.

## Riscos e mitigações
Artefatos públicos não podem conter error.message bruto; testes negativos incluem tokens/path emcamposlivres. Nãoalterarresultado gate comdiagnóstico indisponível.

## Matriz de testes e evidências
Planned: testesci-run/diagnóstico, lint, governança; nenhumscanner nesta frente.

## Baseline
b76faaec6031f3ebed1372a65dcede08f930cde0; artefatoprivado mostra headmerge3defff44d6fd633adea235088c4875ae1989e671, coverageExit1, semserver/análises.

## Rollback ou recuperação
Reverter commit; apenas observabilidade, semdados afetados.

## Aprovação
Decisão: GO_WITH_RISKS. Root aprovou explicitamente diagnóstico mínimo emNA0134, preservando privacidade e gates. Commitlocal autorizado.
