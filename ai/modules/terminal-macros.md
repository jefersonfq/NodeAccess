# Terminal Macros

Use este modulo quando a tarefa envolver evolucao de snippets para macros ou automacoes guiadas por output.

## Ler primeiro
1. `ai/context.md`
2. `ai/patterns.md`
3. `docs/PRD-terminal-macros-lite.md`
4. `ai/modules/terminal.md`

## Foco
- snippets sequenciais
- macros `expect-send`
- execucao manual, segura e previsivel
- manter frontend-first enquanto o modelo ainda estiver evoluindo

## Estado atual
- `command`, `sequence` e `expect-send` ja existem no frontend
- timeout, cancelamento manual e feedback visual basico ja existem
- macro-v1 organiza enviar, aguardar, pausa e tecla; Enter automatico por padrao
- timeout por espera, regex em Worker terminavel, progresso e fila por sessao
- formatos legados preservados; macros novas exigem capability na listagem
- testes: npm run test:snippets; FRONTEND_BASE=http://127.0.0.1:5173 npm run test:snippets:web; npm run test:snippets:mysql (Docker descartavel)

## Evitar
- criar DSL livre na primeira iteracao
- enviar segredos automaticamente sem guardrail
- misturar macro e snippet simples sem diferenca clara na UI
