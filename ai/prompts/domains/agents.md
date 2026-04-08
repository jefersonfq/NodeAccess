Tarefa: Agentes no NodeAccess.

Leia:
1. `ai/context.md`
2. `ai/patterns.md`
3. `ai/modules/agents.md`
4. `ai/modules/agents-governance.md`, se tocar ownership/revogacao/exclusao
5. `docs/PRD-agents-lite.md`
6. `docs/PRD-agents-governance-lite.md`, se tocar governanca

Arquivos provaveis:
- `apps/backend/src/modules/agents/*`
- `apps/frontend/src/views/AgentsView.vue`
- `apps/frontend/src/services/agent.service.ts`
- `packages/shared/src/schemas/*`
- `apps/agent/*`, se tocar binario/agente local

Regras:
- tela deve refletir binarios realmente publicados
- instrucoes precisam cobrir Windows, Linux e macOS quando aplicavel
- nao prometer arquitetura/artefato nao publicado
- governanca de agente deve preservar auditoria e revogacao

Validacao comum:
- `npm run typecheck -w apps/backend`
- `npm run typecheck -w apps/frontend`
- validacao especifica de `apps/agent`, se tocar agente local
