# NA-0020 — Resultados de teste

Data: 2026-08-11

## Executado

- MFA upstream aceito via AMR: aprovado;
- MFA upstream aceito via ACR: aprovado;
- modo estrito sem evidência: rejeitado;
- política MFA com evidência insuficiente: fallback local aprovado;
- token temporário preserva tenant e `authMethod=oidc`: aprovado;
- callback com sessão definitiva: aprovado;
- callback com MFA pendente e sem access token: aprovado;
- redirect seguro, replay, erro do provedor e múltiplos tenants: aprovados;
- Playwright desktop/mobile: aprovado, sem anomalias.
- regressão direcionada de autenticação: 65 testes aprovados;
- typecheck backend e frontend: aprovados;
- `git diff --check`: aprovado.
