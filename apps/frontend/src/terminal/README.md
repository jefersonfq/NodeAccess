Terminal frontend layout:

- `xterm-adapter.ts`: adaptador atual baseado em xterm.js
- `types.ts`: contrato minimo entre renderer e camada de sessao

Objetivo:
- permitir troca futura de renderer sem reescrever `useTerminal.ts`
- manter WebSocket, sessao e regra de produto fora da implementacao visual
