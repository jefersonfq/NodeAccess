# NA-0022 — Resultados de teste

Data: 2026-08-11

## Executado

- labels operacionais limitados e sem dados sensíveis: aprovado;
- contadores de resultado de login: aprovado;
- regressão de autenticação e serviços OIDC: 82 testes aprovados em 9 arquivos;
- typecheck backend: aprovado;
- `git diff --check`: aprovado.

## Validação operacional rápida

Consultar `/metrics` com a credencial administrativa já exigida pelo endpoint e
filtrar por `nodeaccess_oidc_`. Os labels esperados são apenas `operation` e
`outcome`.
