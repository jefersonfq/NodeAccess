Tarefa: Port forwardings / Acessos locais / Web access no NodeAccess.

Leia:
1. `ai/context.md`
2. `ai/patterns.md`
3. `ai/modules/port-forwardings.md`
4. `ai/modules/web-access.md`, se tocar `Abrir web` ou link HTTP
5. `docs/PRD-port-forwardings-lite.md`

Arquivos provaveis:
- `apps/backend/src/modules/tunnels/*`
- `apps/backend/src/modules/web-access/*`
- `apps/frontend/src/components/TunnelManager.vue`
- `apps/frontend/src/views/ForwardingsView.vue`
- `apps/frontend/src/views/TerminalView.vue`
- `apps/frontend/src/views/HostsView.vue`

Regras:
- porta remota nao muda
- `localPort` e porta preferida/configurada
- `assignedLocalPort` e porta ativa/real no NodeAccess
- links e copiar endpoint devem usar sempre porta ativa
- fallback de porta deve ficar claro para o usuario

Validacao comum:
- `npm run typecheck -w apps/backend`
- `npm run typecheck -w apps/frontend`
