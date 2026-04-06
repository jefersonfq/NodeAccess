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
