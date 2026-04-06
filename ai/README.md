# AI Kit

Arquivos de uso rapido para agentes no NodeAccess.

Ordem recomendada:
1. `ai/context.md`
2. `ai/patterns.md`
3. `docs/PRD-lite.md` se houver regra de produto
4. Um arquivo de `ai/modules/*` ou `ai/terminal/*` conforme o dominio
5. `ai/debug.md` para investigacao
6. `docs/PRD.txt` apenas em excecao

Prompts base:
- `ai/prompts/gpt-base.md`
- `ai/prompts/claude-base.md`

Prompts por tarefa:
- `ai/prompts/bug-backend.md`
- `ai/prompts/bug-terminal.md`
- `ai/prompts/feature-auth.md`
- `ai/prompts/feature-hosts.md`

Platform:
- `docs/PRD-platform-adoption-lite.md`: UX curta por Windows, Linux e macOS
- `ai/modules/platform.md`: indice curto para tarefas de aderencia por plataforma

Preferences:
- `docs/PRD-user-preferences-lite.md`: persistencia curta de preferencias por usuario
- `ai/modules/preferences.md`: indice curto para tarefas de preferencias

Terminal Macros:
- `docs/PRD-terminal-macros-lite.md`: evolucao curta de snippets para macros
- `ai/modules/terminal-macros.md`: indice curto para automacao guiada por output

Session Policy:
- `docs/PRD-session-policy-lite.md`: politica curta entre sessao web e sessoes SSH
- `ai/modules/session-policy.md`: indice curto para expiracao, redirect e politica de sessao

Agents:
- `docs/PRD-agents-lite.md`: evolucao curta da frente de agentes proxy
- `ai/modules/agents.md`: indice curto para downloads, setup e operacao via VPN local
- `docs/PRD-agents-governance-lite.md`: ownership, revogacao e exclusao de agentes
- `ai/modules/agents-governance.md`: indice curto para governanca e auditoria

Port Forwardings:
- `docs/PRD-port-forwardings-lite.md`: revisao curta de configuracao e tuneis ativos
- `ai/modules/port-forwardings.md`: indice curto para forwarding, auto-start e seguranca
- `docs/PRD-forwarding-ux-lite.md`: clareza de host vinculado, contagem e conflito de porta

Web Access:
- `docs/PRD-web-access-lite.md`: acesso HTTP/HTTPS via NodeAccess sem expor forwarding bruto
- `ai/modules/web-access.md`: indice curto para proxy web autenticado

Terminal:
- `ai/modules/terminal.md`: indice curto
- `ai/terminal/overview.md`: escopo e separacao
- `ai/terminal/adapters.md`: integracao, troca de renderer e escala
