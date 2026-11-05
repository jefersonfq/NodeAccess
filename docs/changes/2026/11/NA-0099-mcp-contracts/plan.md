---
change_id: NA-0099
title: Contratos de orquestração MCP
type: test
status: in_progress
created_at: 2026-11-03T16:33:08-03:00
base_branch: chore/NA-0089-20261103-sonar-integration
base_sha: 4a77f7139600e70aa612e753418978d9b31b10ae
branch: test/NA-0099-20261103-mcp-contracts
owner: Codex
planner: Codex
risk: medium
issue: null
---

# NA-0099 — Contratos MCP

## Contexto e situação anterior

A coleta ampliada revelou métodos MCP ainda sem execução, apesar dos testes existentes de operações e investigação.

## Problema e objetivo

Validar catálogos, filtros, despacho JSON-RPC, recursos, políticas e contexto de auditoria usando dependências simuladas, preservando o produto.

## Escopo

- Novos testes do serviço e documentação desta frente.
- Fora: refatoração do produto, exclusões de cobertura, conexão à VPS, PTY real ou instalação.

## Critérios de aceitação

- [x] Contratos positivos e negativos executam implementação real do serviço.
- [x] Nenhuma conexão externa, envio de email ou dado real.
- [x] Testes e cobertura observada registrados sem inferir homologação real.

## Estratégia técnica

Instanciar McpService real com banco, SSH, diagnósticos, snippets e serviços de ação simulados nas fronteiras. Exercitar métodos públicos e despacho JSON-RPC sem substituir regras internas.

## Riscos e mitigações

| Risco | Impacto | Mitigação | Parada |
|---|---|---|---|
| Fake encobre regra | Falso positivo | Mock apenas IO, assert efeitos e rejeições | Regra de produto substituída |
| Timer/conexão vaza | Instabilidade | Cleanup e timers controlados | Handle aberto |

## Matriz de testes e evidências

| Critério | Teste | Ambiente | Evidência | Obrigatório |
|---|---|---|---|---|
| Catálogo/filtros/JSON-RPC/auditoria | Vitest contratos | Worktree isolado | test-results.md | Sim |
| Ausência de regressão | Testes existentes do módulo | Worktree isolado | test-results.md | Sim |

## Baseline

SHA `4a77f7139600e70aa612e753418978d9b31b10ae`; lacunas de execução identificadas na coleta ampliada da coordenação. Não é requisito impor100% ou inventar segurança comprovada.

## Rollback ou recuperação

Reverter commit de testes. Nenhum schema, runtime ou configuração de produção alterado.

## Mudanças de escopo e decisões

Coordenação atribuiu esta frente após ensaio CI real aprovado para ampliar cobertura funcional do escopo legado.

## Aprovação

- Decisão: GO_WITH_RISKS
- Aprovado por: usuário (tratamento das pendências) e coordenação (testes do serviço)
- Aprovado em: 2026-11-03
