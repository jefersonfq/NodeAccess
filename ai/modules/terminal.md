Responsabilidade:
Indice curto do dominio de terminal.

Leitura:
- `ai/terminal/overview.md` para escopo e separacao
- `ai/terminal/adapters.md` para integracao, troca de terminal ou escala

Problemas comuns:
- copy quebrado
- encoding
- scroll buffer
- sync com websocket
- resize e fit addon

Regras:
- manter UI responsiva mesmo com muito output
- nao confundir limpar buffer com encerrar sessao
- persistir preferencias locais so quando fizer sentido

Checklist obrigatorio para mudancas que alterem a area util ou transporte:
- revisar `fit()` do xterm, dimensoes iniciais do WebSocket e `setWindow()` do PTY
- validar toolbar, sidebar, fullscreen, split, fonte, zoom, abas e pop-out
- validar entrada/saida do alternate buffer com `vim`, `top` e `htop`
- comparar `stty size` remoto com `data-terminal-cols/rows` no navegador
- preservar foco, selecao, scroll, buffer, copy/paste e reconexao
- executar `npm run test:terminal-experience:web`
- para mudanca em resize, WebSocket ou SSH, executar tambem `npm run test:terminal-pty:real` contra host descartavel
- testes detalhados e telemetria de certificacao devem ser opt-in e nunca adicionar polling, comando remoto ou round-trip ao caminho normal do usuario
