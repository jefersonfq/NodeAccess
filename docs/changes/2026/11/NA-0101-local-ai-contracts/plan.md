---
change_id: NA-0101
title: Testar chat streaming e contexto de IA local
type: test
status: in-development
created_at: 2026-11-03T19:34:07+00:00
base_branch: chore/NA-0089-20261103-sonar-integration
base_sha: 4a77f7139600e70aa612e753418978d9b31b10ae
branch: test/NA-0101-20261103-local-ai-contracts
owner: NodeAccess
planner: Codex
risk: medium
---

# NA-0101 — Contratos de IA local

## Contexto e situação anterior

O módulo local-ai/local-ai.service.ts ainda tem 149 linhas e 51 funções descobertas no baseline, especialmente chat, streaming e montagem de contexto.

## Problema e objetivo

Exercitar contratos observáveis e reduzir lacunas sem modificar produto nem limiares.

## Escopo

Testes do serviço e roteador reais. Provider, banco, ferramentas e licença são fronteiras simuladas; criptografia real. Sem instalações/modelos/acesso remoto.

## Critérios de aceitação

- [x] Contexto e citações preservam escopo e seleção de ferramentas.
- [x] Streaming, falhas e failover não duplicam resposta.
- [x] Quota, uso e registro de interações têm assertivas de efeitos.
- [x] Testes, lint, typecheck e revisão independente registrados.

## Estratégia técnica

Testar APIs públicas com providers fake e geradores controlados. Não substituir métodos do serviço nem roteador. Assertivas em payloads, respostas e persistência.

## Riscos e mitigações

Mocks não demonstram HTTP real do provider nem autorização das ferramentas/banco; declarar limites e preservar os testes existentes desses componentes.

## Matriz de testes e evidências

Ran: 22 novos testes aprovados; módulo 143 aprovados e 3 opt-in ignorados. Cobertura dirigida 311/313 linhas, 78/81 funções, 436/527 branches. Lint, typecheck oficial e revisão independente aprovados. Checagem suplementar dos testes tem limitação de tipos Telnet, registrada em implementation.md.

## Baseline

SHA 4a77f7139600e70aa612e753418978d9b31b10ae; sem modificação de comportamento.

## Rollback ou recuperação

Reverter somente novo arquivo de teste; sem migração ou produção.

## Aprovação

Decisão: GO_WITH_RISKS. ampliação de testes necessária ao pedido das quatro pendências autorizado pelo usuário.
