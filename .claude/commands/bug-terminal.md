Tarefa: investigar e corrigir bug na experiencia de terminal.

Leia:
1. `ai/context.md`
2. `ai/patterns.md`
3. `ai/modules/terminal.md`
4. `ai/terminal/overview.md`
5. `ai/terminal/adapters.md` se houver integracao, renderer ou escala
6. `ai/modules/ssh.md` se o problema tocar conexao ou gateway

Arquivos provaveis:
- `apps/frontend/src/components/TerminalPane.vue`
- `apps/frontend/src/composables/useTerminal.ts`
- `apps/frontend/src/views/TerminalView.vue`
- `apps/backend/src/modules/ssh/*` quando houver suspeita no gateway

Fluxo:
- classifique: UI, renderer, sessao ou transporte
- preserve reconexao manual e regra de limpeza de buffer
- evite acoplar UI a detalhes de SSH ou do renderer
- mude pouco e valide com foco no comportamento quebrado
