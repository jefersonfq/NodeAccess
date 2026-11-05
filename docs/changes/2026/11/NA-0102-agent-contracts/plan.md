---
change_id: NA-0102
title: Testar cadastro diagnostico e credenciais de agentes
type: test
status: in-development
created_at: 2026-11-03T19:34:07+00:00
base_branch: chore/NA-0089-20261103-sonar-integration
base_sha: 4a77f7139600e70aa612e753418978d9b31b10ae
branch: test/NA-0102-20261103-agent-contracts
owner: NodeAccess
planner: Codex
risk: medium
---

# NA-0102 — Contratos de agentes

## Contexto e situação anterior

O módulo agents/agent.service.ts ainda tem 110 linhas e 45 funções descobertas no baseline, especialmente cadastro, listagem e diagnóstico.

## Problema e objetivo

Exercitar contratos observáveis e reduzir lacunas sem modificar produto nem limiares.

## Escopo

Testes do serviço real. Registro de runtime, banco, trial e licença são fronteiras simuladas; criptografia real. Sem instalações/modelos/acesso remoto.

## Critérios de aceitação

- [x] Listagem e status preservam escopo e estados de runtime.
- [x] Criação e autenticação não persistem token em claro.
- [x] Diagnóstico, auditoria e operações têm assertivas de efeitos.
- [x] Testes, lint, typecheck e revisão independente registrados.

## Estratégia técnica

Testar APIs públicas com banco e registro de runtime simulados. Criptografia real e SQL parametrizado; verificar dados, escopo e efeitos sem substituir métodos do serviço.

## Riscos e mitigações

Mocks não demonstram transação SQL real nem transporte do agente; declarar limites e preservar os testes existentes desses componentes.

## Matriz de testes e evidências

Ran: 30 novos contratos; suite 113 aprovados e 1 opt-in ignorado. Cobertura 179/180 linhas, 64/66 funções, 227/244 branches. Lint, typecheck oficial e revisão independente aprovados.

## Baseline

SHA 4a77f7139600e70aa612e753418978d9b31b10ae; sem modificação de comportamento.

## Rollback ou recuperação

Reverter somente novo arquivo de teste; sem migração ou produção.

## Aprovação

Decisão: GO_WITH_RISKS. ampliação de testes necessária ao pedido das quatro pendências autorizado pelo usuário.
