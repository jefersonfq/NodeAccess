# NA-0017 — Resultados de teste

Data: 2026-08-11

## Keycloak real

`npm run test:oidc:keycloak`: aprovado com Keycloak 26.7.0 e Chromium
headless.

- discovery: aprovado;
- Authorization Code + PKCE: aprovado;
- assinatura JWKS, issuer, audience e nonce: aprovados;
- e-mail verificado e grupos: aprovados;
- evidência de MFA delegado: aprovada;
- replay de state: rejeitado;
- IdP indisponível: falha segura confirmada;
- tokens sensíveis no output: não encontrados.

## Regressão

- testes unitários OIDC: 15 aprovados;
- typecheck do backend: aprovado;
- `git diff --check`: aprovado.

