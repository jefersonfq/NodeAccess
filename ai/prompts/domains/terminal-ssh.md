Tarefa: Terminal SSH no NodeAccess.

Leia:
1. `ai/context.md`
2. `ai/patterns.md`
3. `ai/modules/ssh.md`
4. `ai/modules/terminal.md`
5. `ai/terminal/overview.md`
6. PRD especifico apenas se tocar a frente:
   - compartilhamento: `docs/PRD-terminal-sharing-lite.md`
   - host switcher: `docs/PRD-terminal-host-switcher-lite.md`
   - snippets: `docs/PRD-snippets-lite.md`

Arquivos provaveis:
- `apps/backend/src/modules/ssh/*`
- `apps/frontend/src/views/TerminalView.vue`
- `apps/frontend/src/components/TerminalPane.vue`
- `apps/frontend/src/composables/useTerminal.ts`
- `packages/shared/src/schemas/*`

Regras:
- preservar verificacao de host key do host final
- manter queda/reconexao sob controle do usuario
- nao acoplar xterm diretamente a regra de negocio SSH
- diferenciar erro de gateway, sessao, renderer e UI

Validacao comum:
- `npm run typecheck -w apps/backend`
- `npm run typecheck -w apps/frontend`
