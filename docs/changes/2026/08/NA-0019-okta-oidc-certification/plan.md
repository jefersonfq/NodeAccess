---
change_id: NA-0019
title: Preparação e preflight OIDC com Okta
type: feature
status: passed
created_at: 2026-08-11T14:30:00-03:00
base_branch: master
base_sha: bb86e0ad74e7588916dae0938200328bfe0e6d93
branch: feature/NA-0019-20260811-okta-oidc-certification
owner: codex
planner: codex
risk: medium
issue: null
---

# NA-0019 — Preparação e preflight OIDC com Okta

## Contexto e situação anterior

O núcleo OIDC já suporta Authorization Code + PKCE, validação JWKS e MFA por
`amr`, mas o formulário não explicava as escolhas específicas do Okta entre
authorization server da organização e customizado nem a configuração de grupos.

## Problema e objetivo

Reduzir erros de configuração Okta, disponibilizar um preflight seguro para uma
organização controlada e não confundir preparação técnica com certificação de
login real.

## Escopo

- Included:
  - detecção contextual de domínios oficiais Okta no formulário;
  - cabeçalho padronizado com nome, código, protocolo, status e toggle contextual;
  - orientação sobre aplicação Web, callback e authorization server;
  - orientação condicional para scope e claim `groups`;
  - preflight parametrizado de discovery, HTTPS, RS256, JWKS e PKCE;
  - Playwright desktop/mobile e regressão OIDC.
- Excluded:
  - criar organização Okta externa;
  - armazenar credenciais reais;
  - declarar login, grupos ou MFA certificados sem tenant controlado;
  - suportar autorização pelo access token.

## Critérios de aceitação

- [x] Configuração Okta recebe orientação somente quando detectada.
- [x] O card passa a se apresentar como Okta sem duplicar a integração OIDC.
- [x] Scope `groups` é explicado sem bloquear configurações que não usam grupos.
- [x] Preflight exige explicitamente `OKTA_ISSUER`.
- [x] Preflight valida issuer exato, HTTPS, RS256, JWKS e Code + PKCE.
- [x] Ausência de tenant não produz resultado de certificação falso.
- [x] Teclado, salvamento genérico e viewport móvel não apresentam regressão.
- [x] Typecheck, testes OIDC e diff check passam.

## Estratégia técnica

Preservar o provedor OIDC genérico e limitar a mudança do produto a orientação
contextual. O harness reutiliza `OidcService`, não registra segredos e só acessa
o issuer fornecido explicitamente pelo operador.

## Riscos e mitigações

| Risco | Impacto | Mitigação | Stop criterion |
|---|---|---|---|
| Declarar compatibilidade sem tenant | Alto | marcar login/grupos/MFA como não certificados | output indicar certificação interativa |
| Scope groups sem claim correspondente | Médio | ajuda contextual no campo scopes | UI sugerir que scope sozinho cria claim |
| Custom domain não ser detectado na UI | Baixo | fluxo genérico continua funcional | cadastro de custom domain for bloqueado |
| Chave Okta rotacionar | Alto | JWKS dinâmico do discovery | chave estática introduzida |

## Matriz de testes e evidências

| Critério/risco | Teste | Evidência |
|---|---|---|
| UX Okta | Playwright | orientação, groups, teclado e mobile |
| Preflight sem configuração | CLI | erro claro antes de chamada externa |
| Metadata com tenant | CLI parametrizada | pendente de `OKTA_ISSUER` controlado |
| Regressão OIDC | Vitest + typecheck | suites direcionadas |

## Baseline

Antes da mudança, um administrador precisava conhecer previamente a diferença
entre issuers Okta e não havia comando seguro para inspecionar metadata e JWKS.

## Rollback ou recuperação

Reverter o commit da NA-0019. Não há migration ou alteração de dados e o fluxo
OIDC genérico permanece independente das orientações visuais.

## Aprovação

- Decisão: `GO_WITH_RISKS`
- Risco aceito: certificação interativa depende de organização Okta externa.
- Aprovado por: usuário
- Aprovado em: 2026-08-11T14:30:00-03:00
