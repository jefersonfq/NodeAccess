# Session Policy

Use este modulo quando a tarefa envolver expiracao de sessao web, redirecionamento para login, ou politica entre sessao web e sessao SSH.

## Ler primeiro
1. `ai/context.md`
2. `ai/patterns.md`
3. `docs/PRD-session-policy-lite.md`
4. `ai/modules/auth.md`
5. `ai/modules/terminal.md` se houver impacto em SSH/WebSocket

## Estado atual
- expiracao da sessao web limpa auth local
- expiracao da sessao web limpa abas SSH do navegador
- a politica segura atual e encerrar a reutilizacao local das sessoes

## Foco
- seguranca primeiro
- UX clara ao expirar
- separacao conceitual entre UI web e sessao SSH

## Evitar
- assumir que sessao SSH pode sobreviver sem arquitetura adicional
- misturar politica de expiracao web com macro/snippet
- introduzir persistencia complexa cedo demais
