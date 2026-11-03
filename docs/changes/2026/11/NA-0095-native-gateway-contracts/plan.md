---
change_id: NA-0095
title: Contratos de orquestração do gateway SSH nativo
type: test
status: in_progress
created_at: 2026-11-03T16:12:00-03:00
base_branch: chore/NA-0089-20261103-sonar-integration
base_sha: 4a77f7139600e70aa612e753418978d9b31b10ae
branch: test/NA-0095-20261103-native-gateway-contracts
owner: Codex
planner: Codex
risk: medium
issue: null
---

# NA-0095 — Contratos do gateway SSH nativo

## Contexto e situação anterior

Testes existentes validam parser e diagnósticos, mas não executam a orquestração de NativeSshGatewayService. A coleta ampliada revelou lacuna de cobertura real.

## Problema e objetivo

Validar autenticação, MFA, limitação, heartbeat e canais com entradas adversariais e IO simulado, preservando o produto.

## Escopo

- Novos testes do serviço e documentação desta frente.
- Fora: refatoração do produto, exclusões de cobertura, conexão à VPS, PTY real ou instalação.

## Critérios de aceitação

- [x] Contratos positivos e negativos executam implementação real do serviço.
- [x] Nenhuma conexão externa, envio de email ou dado real.
- [x] Testes e cobertura observada registrados sem inferir homologação real.

## Estratégia técnica

Instanciar serviço com repositórios, Redis, email e transporte simulados nas fronteiras. Temporizadores controlados nos cenários de atraso/timeout. Exercitar métodos de orquestração sem substituir suas regras por mocks.

## Riscos e mitigações

| Risco | Impacto | Mitigação | Parada |
|---|---|---|---|
| Fake encobre regra | Falso positivo | Mock apenas IO, assert efeitos e rejeições | Regra de produto substituída |
| Timer/conexão vaza | Instabilidade | Cleanup e timers controlados | Handle aberto |

## Matriz de testes e evidências

| Critério | Teste | Ambiente | Evidência | Obrigatório |
|---|---|---|---|---|
| Auth/MFA/rate | Vitest contratos | Worktree isolado | test-results.md | Sim |
| Ausência de regressão | Testes existentes do módulo | Worktree isolado | test-results.md | Sim |

## Baseline

SHA `4a77f7139600e70aa612e753418978d9b31b10ae`; cobertura do serviço ausente na coleta ampliada inicial da coordenação. Não é requisito impor100% ou inventar segurança comprovada.

## Rollback ou recuperação

Reverter commit de testes. Nenhum schema, runtime ou configuração de produção alterado.

## Mudanças de escopo e decisões

Coordenação atribuiu esta frente enquanto o ensaio CI NA-0092 aguarda recurso Docker. CI permanece prioridade quando o slot estiver disponível.

## Aprovação

- Decisão: GO_WITH_RISKS
- Aprovado por: usuário (tratamento das pendências) e coordenação (testes do serviço)
- Aprovado em: 2026-11-03
