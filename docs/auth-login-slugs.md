# Login com slugs de tenant

Este documento registra o fluxo atual de login do NodeAccess quando há resolução de tenant por slug, subdomínio ou seleção por e-mail.

## Fluxo principal

1. O usuário informa o e-mail em `/auth/login`.
2. O frontend chama `POST /api/v1/auth/lookup-tenant` com o e-mail.
3. O backend retorna tenants ativos onde existe usuário ativo com esse e-mail.
4. Se houver um tenant, o frontend seleciona automaticamente.
5. Se houver mais de um tenant, o frontend mostra um seletor com nome e slug.
6. O usuário informa a senha.
7. O frontend chama `POST /api/v1/auth/login` com `email`, `password` e, quando selecionado, `tenantSlug`.
8. O backend valida senha e segue para TOTP/setup TOTP conforme o estado MFA do usuário.

## Prioridade de resolução do tenant

O backend resolve o tenant no login nesta ordem:

1. `tenantSlug` no body da requisição.
2. Header `x-tenant-slug`, normalmente enviado pelo proxy/nginx.
3. Fallback para `default`.

Quando `TENANT_BASE_DOMAIN` está configurado, o backend interpreta subdomínios simples como slug:

- `cliente-a.nodeaccess.com.br` com `TENANT_BASE_DOMAIN=nodeaccess.com.br` resolve `cliente-a`.
- `nodeaccess.com.br` não vira tenant especial; cai na normalização do hostname.

## Fallback

Se o slug resolvido não existir e não for `default`, o backend tenta o tenant `default`.

Esse fallback mantém compatibilidade com instalações antigas, mas pode mascarar erro de DNS/proxy. Em produção multi-tenant estrita, avaliar remover esse fallback ou torná-lo configurável.

## Segurança e privacidade

`/auth/lookup-tenant` é pré-login e retorna nomes/slugs de tenants associados a um e-mail ativo. Isso melhora a UX para usuários presentes em múltiplos tenants, mas permite confirmar que um e-mail existe em alguma organização.

Medidas recomendadas:

- aplicar rate limit por IP/e-mail nesse endpoint;
- registrar tentativas de lookup em auditoria se o volume crescer;
- considerar resposta neutra em ambientes que exigem não enumeração de contas;
- manter mensagens de senha inválida genéricas, como já ocorre no login.

## MFA e tokens temporários

O login com senha não emite token autenticado final. Ele retorna `tempToken` com stage:

- `mfa_setup`, quando o usuário ainda precisa configurar TOTP;
- `mfa_pending`, quando precisa apenas validar TOTP.

O tenant escolhido fica dentro do token temporário e é usado na emissão do access token final.

## Google SSO

`GET /api/v1/auth/google/config` e `POST /api/v1/auth/google` usam a mesma resolução de tenant por slug/header/fallback. No fluxo atual, o botão Google aparece antes da seleção por e-mail; portanto, para SSO multi-tenant, o tenant deve vir do subdomínio/header ou cairá no fallback.
