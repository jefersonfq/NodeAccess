# NA-0018 — Resultados de teste

Data: 2026-08-11

## Executado

- preflight público Microsoft Entra ID: aprovado;
- discovery tenant-specific e endpoints HTTPS: aprovados;
- RS256 e disponibilidade de chaves JWKS: aprovados;
- testes direcionados finais: 32 aprovados;
- typecheck backend: aprovado;
- typecheck frontend: aprovado;
- Playwright administrativo desktop/mobile: aprovado;
- issuer multitenant e JIT Entra: bloqueados antes do envio;
- anomalias de console/browser: nenhuma.

## Pendente externo

Login interativo, claims efetivos, Conditional Access, MFA e rotação observada de
chaves exigem um app registration e uma conta de teste em tenant Microsoft
Entra ID controlado. O preflight não declara esses itens como certificados.
