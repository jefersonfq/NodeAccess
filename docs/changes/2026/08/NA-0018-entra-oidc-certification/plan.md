---
change_id: NA-0018
title: Compatibilidade e preflight OIDC com Microsoft Entra ID
type: feature
status: passed
created_at: 2026-08-11T14:00:00-03:00
base_branch: master
base_sha: d0c112ef98d68e044a4e157ea18db7d259e7af47
branch: feature/NA-0018-20260811-entra-oidc-certification
owner: codex
planner: codex
risk: medium
issue: null
---

# NA-0018 — Compatibilidade e preflight OIDC com Microsoft Entra ID

## Contexto e situação anterior

O fluxo OIDC genérico foi certificado com Keycloak, mas a configuração não
explicava diferenças do Microsoft Entra ID. Aliases multitenant produzem issuer
templated, domínios amigáveis resolvem para issuer GUID e os ID tokens não
garantem e-mail verificado.

## Problema e objetivo

Evitar configurações Entra ambíguas ou inseguras, validar metadata/JWKS reais e
orientar o administrador no ponto de decisão sem alterar o login genérico.

## Escopo

- Included:
  - issuer Entra single-tenant com Tenant ID GUID e endpoint v2.0;
  - rejeição de `common`, `organizations` e domínio amigável;
  - JIT por e-mail desabilitado na UI e rejeitado na API para Entra;
  - preflight real de discovery, HTTPS, RS256 e JWKS;
  - orientação contextual no formulário OIDC;
  - testes unitários e Playwright desktop/mobile.
- Excluded:
  - login interativo em tenant de cliente;
  - automação de MFA/Conditional Access;
  - consulta Microsoft Graph para group overage;
  - suporte multitenant Entra.

## Critérios de aceitação

- [x] Somente issuer Entra GUID v2.0 é aceito.
- [x] Claims mutáveis não são promovidos a e-mail verificado.
- [x] Auto-provisionamento por e-mail fica bloqueado na UI e API.
- [x] Discovery e JWKS reais do Entra passam no preflight.
- [x] O formulário explica callback, issuer e limitação de JIT sem poluição permanente.
- [x] Fluxo de teclado e viewport móvel não apresentam regressão.
- [x] Testes direcionados, typecheck e diff check passam.

## Estratégia técnica

Manter o OIDC genérico como núcleo. Aplicar somente guardas de interoperabilidade
quando o host do issuer for `login.microsoftonline.com`, com defesa equivalente
no frontend e backend. O harness externo não persiste tokens ou credenciais.

## Riscos e mitigações

| Risco | Impacto | Mitigação | Stop criterion |
|---|---|---|---|
| Mistura de tenants | Alto | exigir issuer GUID específico | alias multitenant aceito |
| Conta vinculada por claim mutável | Alto | manter `issuer + subject` e exigir e-mail verificado no JIT | `preferred_username` vira e-mail |
| Restrição apenas visual | Alto | rejeição equivalente na API | chamada direta habilita JIT |
| Orientação poluir formulário genérico | Baixo | conteúdo exibido somente ao detectar Entra | alerta aparece para outro IdP |

## Matriz de testes e evidências

| Critério/risco | Teste | Evidência |
|---|---|---|
| Tenant e claims | Vitest | `OidcService` e `OidcConfigService` |
| Metadata real | harness Entra | discovery, endpoints, RS256 e JWKS |
| UX e API payload | Playwright | issuer inválido, JIT, save e mobile |
| Regressão | typecheck + testes OIDC | suites frontend/backend |

## Baseline

Antes da mudança, aliases Entra eram aceitos no cadastro e falhavam apenas no
discovery; a UI permitia configurar JIT que seria rejeitado no primeiro usuário
sem `email_verified`.

## Rollback ou recuperação

Reverter o commit da NA-0018. Não há migration nem alteração de dados. As
configurações OIDC genéricas anteriores permanecem compatíveis.

## Aprovação

- Decisão: `GO_WITH_RISKS`
- Risco aceito: login interativo depende de app registration e conta de teste externos.
- Aprovado por: usuário
- Aprovado em: 2026-08-11T14:00:00-03:00

