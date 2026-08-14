---
change_id: NA-0035
title: Tornar suites de criptografia e tuneis hermeticas
type: fix
status: passed
created_at: 2026-08-14T00:18:00-03:00
base_branch: feature/NA-0034-20260813-platform-tenant-license-settings
base_sha: e31f24589801cc112acfb26e702820fbf4115b5f
branch: fix/NA-0035-20260814-test-suite-hermeticity
owner: codex
planner: codex
risk: low
issue: null
---

# NA-0035 — Hermeticidade da suite

## Contexto e situação anterior

Tres suites importavam criptografia antes de preparar variaveis obrigatorias e
um teste de concorrencia de tuneis abria uma porta TCP real.

## Problema e objetivo

Permitir que toda a suite rode de forma deterministica em ambiente isolado, sem
depender do `.env`, Redis/MySQL reais ou permissao para bind de socket.

## Escopo

- bootstrap de ambiente nos tres testes afetados;
- adapter `node:net` simulado somente no teste de concorrencia;
- regressao direcionada e completa;
- nenhuma mudanca de runtime.

## Estratégia técnica

Preparar variaveis com `vi.hoisted` antes dos imports ESM e substituir o servidor
TCP por um fake orientado a eventos que preserva `listen`, `address` e `close`.

## Riscos e mitigações

| Risco | Impacto | Mitigação | Stop criterion |
|---|---|---|---|
| mock esconder erro de runtime | medio | limitar mock ao teste de ownership | testes de TunnelService externos falham |
| estado global entre casos | medio | fechar todas as sessoes criadas | tunnel permanece apos teste |
| env vazar entre suites | baixo | valores test-only via hoisted | suite depende de ordem |

## Critérios de aceitação

- [x] quatro arquivos anteriormente falhos passam sem infraestrutura externa;
- [x] teste de ownership valida compartilhamento e fechamento;
- [x] suite completa nao falha pelos quatro motivos registrados;
- [x] typecheck e diff check passam.

## Estratégia de testes

Executar primeiro os quatro arquivos afetados em conjunto e isoladamente, depois
a suite completa, typecheck e `git diff --check`.

## Matriz de testes e evidências

| Criterio/risco | Teste | Evidencia |
|---|---|---|
| bootstrap ESM | tres suites de crypto | coleta e casos aprovados |
| socket hermetico | tunnel-concurrency | sem bind real e ownership aprovado |
| regressao | suite completa | resultado final registrado |

## Baseline

597/598 testes funcionais passaram; um falhou com `listen EPERM` e tres suites
nao foram coletadas por `process.exit(1)` da validacao de ambiente.

## Rollback ou recuperação

Reverter apenas os mocks/bootstrap dos testes. Nao ha alteracao de producao.

## Aprovação

- Decisão: GO
- Aprovado por: usuario
- Aprovado em: 2026-08-14
