---
change_id: NA-0094
title: Testar contratos de configuracao e diagnostico de integracoes
type: test
status: in-development
created_at: 2026-11-03T15:57:28-03:00
base_branch: chore/NA-0089-20261103-sonar-integration
base_sha: 4a77f7139600e70aa612e753418978d9b31b10ae
branch: test/NA-0094-20261103-integration-contracts
owner: NodeAccess
planner: Codex
risk: medium
---

# NA-0094 — Contratos de integrações

## Contexto e situação anterior

IntegrationService tem 373 linhas instrumentáveis sem cobertura no baseline legado; os clients externos e repositórios são fronteiras distintas.

## Problema e objetivo

Exercitar contratos de configuração, segredos, licenciamento, saúde, diagnóstico e tickets sem modificar produto ou chamar provedores reais.

## Escopo

Testes de comportamento para IntegrationService;fixtures tenant-scoped em memória,crypto/JWT reais e clients externos simulados. Nenhum novo recurso ou alteração de API.

## Critérios de aceitação

- [x] Configuração e preservação de credenciais verificadas.
- [x] Erros/licenciamento/isolamento e saúde stale verificados.
- [x] Diagnóstico e políticas Jira verificadas com assertivas de efeitos.
- [x] Testes passam, typecheck e revisão independente registrados.

## Estratégia técnica

Reusar Vitest e serviço real;mock somente IO externo/licença/DB. Casos orientados a comportamento, não varredura de métodos sem assertivas. Crypto real valida proteção de credenciais.

## Riscos e mitigações

Mocks podem esconder integração real: declarar esse limite e verificar payload/escopo; não mudar assertions para mascarar bug. Qualquer bug novo será comunicado antes de alterar produto.

## Matriz de testes e evidências

Ran: 57 testes aprovados, cobertura dirigida 100% linhas/funções e 95,54% branches, lint, typecheck e revisão independente. Ver implementation.md para limites e evidências.

## Baseline

SHA 4a77f7139600e70aa612e753418978d9b31b10ae;IntegrationService sem cobertura anterior.

## Rollback ou recuperação

Branch test isolada;reverter testes não altera dados nem serviços. Manter worktree para reprodução.

## Aprovação

Decisão: GO_WITH_RISKS. Usuário autorizou quatro pendências com todos os testes;subset necessário à cobertura, sem produção ou credenciais reais.
