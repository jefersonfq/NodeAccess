# Prévia da posição de abas — 24/09/2026

## Comportamento

Antes, arrastar sobre uma aba não indicava a posição de destino; o drop movia a origem para o índice da aba alvo. Agora, a metade esquerda indica inserção antes e a metade direita indica inserção depois. Um marcador vertical aparece na borda correspondente, com entrada suave, enquanto a aba de origem fica translúcida. A ordem só muda ao soltar.

Posições equivalentes à atual não mostram marcador. Sair do alvo, cancelar ou concluir limpa a indicação. Arrastes externos não reordenam sessões. A preferência de movimento reduzido desativa a animação. O marcador é sobreposto e não altera altura/largura das abas ou área do terminal. O fluxo existente de janela separada foi preservado.

## Arquivos

- `apps/frontend/src/views/TerminalView.vue`: cálculo da posição de inserção, ciclo do feedback e CSS.
- `tools/frontend/terminal-drag-review-playwright.cjs`: simulações de arraste e regressão.
- `tools/frontend/terminal-experience-playwright.cjs`: opção para executar o cenário isolado.

## Reproduzir

Com um frontend local iniciado:

```sh
FRONTEND_BASE=http://127.0.0.1:5178 TERMINAL_DRAG_REVIEW=1 REPORT_PATH=/tmp/nodeaccess-terminal-drag-review.json npm run test:terminal-experience:web
UI_THEME=light FRONTEND_BASE=http://127.0.0.1:5178 TERMINAL_DRAG_REVIEW=1 REPORT_PATH=/tmp/nodeaccess-terminal-drag-review-light.json npm run test:terminal-experience:web
FRONTEND_BASE=http://127.0.0.1:5178 npm run test:terminal-experience:web
npm run typecheck -w apps/frontend
```

O cenário cria três abas pela ação “Duplicar aba” e verifica marcador antes/depois, ordem inalterada durante a prévia, movimento nos dois sentidos, posição equivalente, cancelamento, saída do alvo, arraste externo, movimento reduzido e preservação da aba ativa/conexões. Inclui eventos controlados e um arraste com mouse real via Playwright/Chromium. HTTP e WebSocket são simulados; não usa hosts de produção.

Validação manual: abrir três abas, arrastar a primeira sobre as metades da terceira e conferir a borda azul antes de soltar. Arrastar de volta, cancelar um arraste e verificar que a sessão ativa continua conectada.

## Resultado

Cenário específico aprovado nos temas claro e escuro, incluindo arraste nativo com mouse e ausência de reconexão. Suíte completa `test:terminal-experience:web`, typecheck frontend e verificação de whitespace aprovados. Prévia visual inspecionada no Chromium. Relatórios em `/tmp/nodeaccess-terminal-drag-review.json` e `/tmp/nodeaccess-terminal-drag-review-light.json`; capturas em `/tmp/nodeaccess-terminal-drag-preview-dark.png` e `/tmp/nodeaccess-terminal-drag-preview-light.png`. Sem publicação em produção.
