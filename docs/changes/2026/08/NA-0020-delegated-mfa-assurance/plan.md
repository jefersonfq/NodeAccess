---
change_id: NA-0020
title: Garantia de MFA delegado com fallback local
type: security
status: passed
created_at: 2026-08-11T15:25:00-03:00
base_branch: master
base_sha: 52c279317fe141e94db96a8edc244df16e181e09
branch: feature/NA-0020-20260811-delegated-mfa-assurance
owner: codex
planner: codex
risk: high
issue: null
---

# NA-0020 — Garantia de MFA delegado com fallback local

## Contexto e situação anterior

O fluxo OIDC validava `amr`/`acr` somente quando a configuração do provedor
exigia explicitamente esses claims. Caso contrário, emitia sessão definitiva
mesmo quando a política efetiva do tenant exigia MFA.

## Problema e objetivo

Impedir bypass de MFA via OIDC e reutilizar o TOTP local quando a garantia
externa não atende à política, sem duplicar autenticação quando o IdP comprova
MFA de forma aceita.

## Escopo

- Included:
  - avaliação explícita de garantia por `amr` ou `acr`;
  - aplicação da política efetiva de MFA após resolver a identidade;
  - fallback para setup/verificação MFA local com token temporário;
  - preservação de tenant, `authMethod=oidc`, OTP disponível e redirect;
  - opção estrita de MFA no IdP continua rejeitando evidência insuficiente;
  - testes backend e Playwright do callback.
- Excluded:
  - mapear claims proprietários fora de `amr`/`acr`;
  - alterar algoritmo TOTP ou política de e-mail OTP;
  - automatizar Conditional Access de provedores externos.

## Critérios de aceitação

- [x] OIDC não emite sessão sem MFA quando a política efetiva exige MFA.
- [x] `amr` aceito evita desafio local duplicado.
- [x] `acr` aceito evita desafio local duplicado.
- [x] Evidência insuficiente inicia MFA local com isolamento de tenant.
- [x] Usuário sem TOTP é encaminhado para setup; usuário com TOTP, para verificação.
- [x] Modo estrito do IdP rejeita evidência insuficiente antes da sessão.
- [x] Callback não persiste access token durante o desafio local.
- [x] Redirect seguro e estados de erro permanecem funcionais.
- [x] Testes direcionados, typecheck e diff check passam.

## Estratégia técnica

Separar avaliação de garantia da decisão de enforcement. `OidcFlowService`
normaliza a evidência e preserva o bloqueio estrito do provedor;
`OidcAuthService` aplica a política efetiva e reutiliza `AuthService` para criar
o mesmo desafio MFA temporário usado pelo login local.

## Riscos e mitigações

| Risco | Impacto | Mitigação | Stop criterion |
|---|---|---|---|
| Bypass de MFA por SSO | Crítico | política efetiva aplicada antes dos tokens | access token emitido sem garantia |
| MFA duplicado | Médio | aceitar `amr`/`acr` configurados | IdP comprovado sempre cai no TOTP |
| Troca de tenant no desafio | Crítico | tenant no token temporário e resolução isolada | token funciona em outro tenant |
| Redirect perdido | Médio | transferir destino sanitizado ao fluxo TOTP | usuário retorna ao login ou URL externa |

## Matriz de testes e evidências

| Critério/risco | Teste | Evidência |
|---|---|---|
| AMR/ACR | unitário `OidcFlowService` | source e resultado da garantia |
| Política e fallback | unitário `OidcAuthService` | tokens ou desafio local |
| Token temporário | unitário `AuthService` | tenant, authMethod e stage |
| Callback | Playwright | storage, redirect, TOTP e ausência de sessão |
| Regressão | suites auth + typecheck | resultados registrados |

## Baseline

Antes da mudança, `mfaRequired=true` não governava a emissão de sessão OIDC se
`requireMfaClaim=false`, criando um caminho de autenticação menos forte.

## Rollback ou recuperação

Reverter o commit da NA-0020. Não há migration. Como isso reabre o risco de
bypass, rollback deve ser acompanhado de desabilitação temporária do OIDC em
tenants que exigem MFA.

## Aprovação

- Decisão: `GO`
- Aprovado por: usuário
- Aprovado em: 2026-08-11T15:25:00-03:00

