Objetivo:
Permitir trocar, integrar ou escalar a experiencia de terminal sem espalhar acoplamento.

Contratos que valem a pena manter:
- entrada: texto/comandos e eventos de resize
- saida: stream de texto, status de conexao e erros
- sessao: conectar, desconectar, reconectar, limpar, focar
- preferencias: tema, fonte, atalhos e comportamento visual

Se precisar suportar outros terminais ou renderizadores:
- mantenha a UI falando com uma interface de sessao, nao com xterm.js direto
- isole addons e APIs especificas do renderizador em um adaptador
- centralize eventos de conexao e estado fora do componente visual
- trate WebSocket/SSH como transporte, nao como responsabilidade da view

Sinais de que precisa refatorar:
- componente Vue conhece detalhes de `ssh2` ou payloads de gateway
- toolbar altera estado interno do xterm diretamente em varios pontos
- mesma regra de reconexao aparece em mais de um componente
- tema/fonte depende de detalhes do transporte

Leitura adicional:
- `ai/modules/ssh.md` para regras de conexao
- `docs/PRD-lite.md` para regras de produto
