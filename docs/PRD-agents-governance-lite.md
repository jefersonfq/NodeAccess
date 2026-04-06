# PRD Agents Governance Lite

## Objetivo
Definir governanca de agentes proxy com ownership claro, auditoria preservada e ciclo de vida controlado.

## Decisao de Produto
- Agente pode existir em dois modelos:
  - `user-bound`: vinculado a um usuario
  - `service-bound`: vinculado a uma identidade de servico do tenant
- Nao permitir agente sem vinculo algum

## Motivacao
- `user-bound` cobre uso humano: notebook, desktop, VPN pessoal
- `service-bound` cobre uso tecnico: VM compartilhada, jump host, appliance, container
- Evita tokens orfaos e melhora auditoria

## Regras
- Todo agente precisa ter owner explicito
- Criacao deve registrar quem criou
- Revogacao impede novas conexoes
- Exclusao permanente nao pode apagar trilha de auditoria historica

## Ciclo de Vida
- `active`
- `revoked`
- `deleted`

## Operacoes
### Revogar
- bloqueia novas conexoes
- mantem cadastro visivel para auditoria e operacao
- deve registrar `revokedAt` e `revokedBy`

### Excluir permanentemente
- remove o cadastro operacional do agente
- permitido apenas para admin ou politica equivalente
- deve preservar logs historicos por snapshot
- deve registrar `deletedAt` e `deletedBy`

## Auditoria Minima
Os logs nao devem depender apenas de FK viva para o agente.

Cada evento relevante deve preservar snapshot com pelo menos:
- `agentId`
- `agentName`
- `agentMode` (`user-bound` ou `service-bound`)
- `ownerType`
- `ownerId` ou referencia equivalente
- `createdBy`
- timestamp do evento

## Eventos Minimos
- agente criado
- token emitido
- agente conectado
- agente usado em sessao SSH
- agente revogado
- agente excluido

## UX Recomendada
- criar agente:
  - escolher modo `Usuario` ou `Servico`
  - exibir owner claramente
- listar agentes:
  - mostrar owner
  - mostrar status `ativo`, `revogado`, `excluido`
- excluir:
  - distinguir `Revogar` de `Excluir permanentemente`
  - explicar que logs serao preservados

## Arquivos Provaveis
- frontend:
  - `apps/frontend/src/views/AgentsView.vue`
  - `apps/frontend/src/services/agent.service.ts`
  - `apps/frontend/src/locales/pt-BR.json`
  - `apps/frontend/src/locales/en.json`
- backend:
  - `apps/backend/src/modules/agents/agent.service.ts`
  - `apps/backend/src/modules/agents/agent.controller.ts`
  - `apps/backend/src/modules/agents/agent.routes.ts`
  - schema Prisma e migration de agentes/logs

## Fora de Escopo Inicial
- RBAC detalhado por tipo de agente
- rotacao automatica de token
- aprovacoes em duas etapas

## Proximo Corte Recomendado
1. modelar ownership do agente
2. separar `revogar` de `excluir permanentemente`
3. garantir snapshot de auditoria
