# Certificação OIDC

## Keycloak

O harness inicia um Keycloak efêmero, importa um realm exclusivo de teste e usa
Chromium headless para executar o Authorization Code Flow com PKCE.

```bash
npm run test:oidc:keycloak
```

Pré-requisitos:

- Docker com acesso a `quay.io/keycloak/keycloak:26.7.0`;
- Chromium em `/usr/bin/chromium-browser`, ou `PLAYWRIGHT_EXECUTABLE_PATH`;
- portas locais `18080` e `18081` disponíveis.

O teste cobre discovery, troca do código, PKCE, assinatura JWKS, issuer,
audience, nonce, e-mail verificado, grupos, evidência MFA, consumo único do
state e indisponibilidade do IdP. O contêiner é removido ao final, inclusive em
caso de falha.

O issuer e seus endpoints podem usar HTTP somente em loopback e fora de
produção. Em produção, o backend continua exigindo HTTPS.

