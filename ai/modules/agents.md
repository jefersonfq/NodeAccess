# Agents Module

Use para tarefas de agentes proxy e acesso via VPN local.

## Ler em Ordem
1. `ai/context.md`
2. `ai/patterns.md`
3. `docs/PRD-agents-lite.md`

## Contexto Curto
- agente conecta outbound por WebSocket
- NodeAccess usa o agente para abrir conexoes TCP locais e tunelar SSH
- downloads publicos do agente saem por `/api/v1/agents/download/:platform`
- binarios atuais ficam em `apps/agent/dist`

## Arquivos-Chave
- `apps/frontend/src/views/AgentsView.vue`
- `apps/backend/src/modules/agents/agent.routes.ts`
- `apps/backend/src/modules/agents/agent.gateway.ts`
- `apps/backend/src/modules/agents/agent.registry.ts`
- `apps/agent/src/index.js`

## Gaps Ja Mapeados
- links de download errados na UI causavam 404
- macOS arm64 ainda nao existe no build atual
- falta onboarding e diagnostico de instalacao
- falta versao/health do agente na UI
- ha duplicacao entre `AgentsView.vue` e `AgentManager.vue`
