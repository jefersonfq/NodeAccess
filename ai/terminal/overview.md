Responsabilidade:
Camada de experiencia de terminal no frontend.

Escopo atual:
- terminal web com xterm.js
- multiplas abas por janela
- resize dinamico
- copy/paste
- tema, fonte e limpeza de buffer
- sincronizacao com gateway WebSocket SSH

Limites de produto:
- reconexao e manual; usuario decide quando tentar de novo
- limpar buffer nao encerra sessao
- preferencias visuais podem ser persistidas localmente

Separacao recomendada:
- `terminal-core`: instancia do terminal, addons, buffer, resize
- `terminal-session`: estado de conexao, reconexao, tempo de sessao
- `terminal-ui`: toolbar, tabs, overlays, indicadores
- `terminal-transport`: ponte com WebSocket/gateway

Regra para evolucao:
- novas integracoes de terminal devem tocar primeiro a camada `terminal-transport`
- mudancas visuais nao devem conhecer detalhes de SSH
- mudancas de SSH/gateway nao devem depender de detalhes de xterm.js

Codigo atual:
- `apps/frontend/src/terminal/types.ts`: contrato minimo do renderer
- `apps/frontend/src/terminal/xterm-adapter.ts`: implementacao atual com xterm.js
- `apps/frontend/src/composables/useTerminal.ts`: sessao, WebSocket e regras de uso
