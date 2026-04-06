# Agents Governance Module

Use para ownership, ciclo de vida e auditoria de agentes.

## Ler em Ordem
1. `ai/context.md`
2. `ai/patterns.md`
3. `docs/PRD-agents-lite.md`
4. `docs/PRD-agents-governance-lite.md`

## Resumo Curto
- suportar `user-bound` e `service-bound`
- nao permitir agente sem owner
- separar `revogar` de `excluir permanentemente`
- preservar logs por snapshot mesmo apos exclusao

## Arquivos-Chave
- `apps/frontend/src/views/AgentsView.vue`
- `apps/backend/src/modules/agents/agent.service.ts`
- `apps/backend/src/modules/agents/agent.routes.ts`
- schema/migrations de agentes e logs
