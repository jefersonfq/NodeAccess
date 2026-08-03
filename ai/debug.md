Checklist rapido:
- bug de API: olhar `apps/backend/src`
- bug de terminal/UX: olhar `apps/frontend/src`
- contrato quebrado: olhar `packages/shared/src`
- problema SSH: ler `ai/modules/ssh.md`
- problema auth: ler `ai/modules/auth.md`
- problema terminal: ler `ai/modules/terminal.md`
- validacao web autenticada/DOM/CSS/cache: ler `docs/OPERATIONS-web-ui-validation-lite.md`

Fluxo:
1. reproduzir com menor escopo possivel
2. identificar camada: frontend, API, gateway, shared
3. validar schema, rota e fluxo de erro
4. rodar `npm run typecheck` e teste relacionado

Para bugs visuais ou relatos de "nao apareceu", validar com navegador real antes de concluir:
- abrir Chromium/CDP;
- injetar sessao autenticada;
- desabilitar cache;
- inspecionar DOM renderizado, estilos computados e erros de console;
- comparar a porta atual do Vite com uma porta nova quando houver suspeita de bundle antigo.
