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

## Microsoft Entra ID

A certificação de metadata usa um tenant Microsoft público apenas para validar
discovery, endpoints HTTPS, algoritmos anunciados e conjunto JWKS real:

```bash
npm run test:oidc:entra:metadata
```

Para validar outro tenant sem autenticar um usuário:

```bash
ENTRA_TENANT_ID=<tenant-guid> npm run test:oidc:entra:metadata
```

O issuer configurado no NodeAccess deve ser
`https://login.microsoftonline.com/<tenant-guid>/v2.0`. Aliases como `common`,
`organizations` e domínios `onmicrosoft.com` não são aceitos porque o issuer
real retornado pelo discovery é específico do tenant.

Este preflight não certifica login, MFA ou claims de um tenant do cliente. Essa
etapa exige um app registration e uma conta de teste dedicados.

## Okta

O preflight do Okta exige o issuer de uma organização controlada e não utiliza
client secret nem autentica usuário:

```bash
OKTA_ISSUER=https://dev-00000000.okta.com/oauth2/default \
  npm run test:oidc:okta:metadata
```

Também é possível usar o authorization server da organização, cujo issuer é a
raiz `https://<dominio-okta>`. O comando valida correspondência exata do issuer,
endpoints HTTPS, RS256, JWKS e a montagem local de Authorization Code + PKCE.

O login interativo, o claim `groups` e a evidência `amr` dependem da configuração
do tenant Okta e permanecem pendentes até existir uma organização de teste.

