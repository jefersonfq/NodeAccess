Checklist rapido:
- bug de API: olhar `apps/backend/src`
- bug de terminal/UX: olhar `apps/frontend/src`
- contrato quebrado: olhar `packages/shared/src`
- problema SSH: ler `ai/modules/ssh.md`
- problema auth: ler `ai/modules/auth.md`
- problema terminal: ler `ai/modules/terminal.md`

Fluxo:
1. reproduzir com menor escopo possivel
2. identificar camada: frontend, API, gateway, shared
3. validar schema, rota e fluxo de erro
4. rodar `npm run typecheck` e teste relacionado
