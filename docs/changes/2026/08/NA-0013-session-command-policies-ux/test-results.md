---
change_id: NA-0013
tested_sha: LOCAL_WIP
tested_at: 2026-08-09T19:48:00-03:00
status: passed
---

# Resultado dos testes — NA-0013

## Resultado

PASS. A tela foi validada com APIs mockadas no Chromium, sem alteração de contrato ou persistência real.

## Evidências

| Validação | Resultado |
|---|---|
| Avaliador local (Vitest) | 10/10 testes passaram |
| Serviço backend: duplicidade e contratos | 4/4 testes passaram |
| Playwright: grupo configurado | Passou |
| Playwright: vazio e criação do primeiro grupo | Passou |
| Playwright: erro de carregamento | Passou |
| Playwright: loading | Passou |
| Regras, vínculos e aviso sem vínculo | Passou |
| Simulação local e efetiva | Passou |
| Navegação e foco por teclado | Passou |
| Viewport 1024×768 | Sem overflow horizontal |
| Typecheck frontend | Passou |
| Typecheck backend | Passou |
| Migration no MySQL local | Passou; 2 globais duplicados reduzidos para 1 |
| `git diff --check` | Passou |

## Comandos

```bash
npx vitest run apps/frontend/src/services/session-command-policy-evaluator.test.ts
npx vitest run apps/backend/src/modules/session-command-policy/session-command-policy.service.test.ts
npm run test:session-command-policies:web
npm run typecheck -w apps/frontend
npm run typecheck -w apps/backend
npx prisma migrate deploy
git diff --check
```

## Evidência visual

- Screenshot final: `/tmp/nodeaccess-session-command-policies.png`
- Resultado estruturado: `/tmp/nodeaccess-session-command-policies-playwright.json`

## Observações

- O teste final usou o frontend atualizado em `http://127.0.0.1:5176` porque a instância preexistente na porta 5173 não recarregou arquivos do volume OneDrive.
- O Playwright reproduz o contrato real do POST de vínculo (objeto único), criação de host, confirmação global, recarga e bloqueio de redundância.
- A migration local preservou o vínculo global `id=1` e removeu a duplicata semanticamente idêntica `id=2` do grupo 2.
- O foco visível nos passos foi preservado; o passo ativo também é identificado por `aria-current="step"`.
- APIs, permissões e regras do backend não foram alteradas.
