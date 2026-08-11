---
change_id: NA-0017
title: Certificação OIDC com Keycloak
type: test
status: passed
created_at: 2026-08-11T13:30:00-03:00
base_branch: master
base_sha: a7e3ae651cf8e83dc97b72e03224aacb5b1616d7
branch: feature/NA-0017-20260811-oidc-keycloak-certification
owner: codex
planner: codex
risk: medium
issue: null
---

# NA-0017 — Certificação OIDC com Keycloak

## Contexto e situação anterior

O provedor OIDC genérico possuía cobertura unitária e de interface, mas ainda
não havia sido exercitado contra um IdP real e reproduzível em ambiente local.

## Problema e objetivo

Validar o fluxo OIDC do NodeAccess contra Keycloak sem acoplar o domínio de
autenticação a um provedor específico nem reduzir as garantias de produção.

## Escopo

- Included:
  - Keycloak efêmero e realm exclusivo de certificação;
  - Authorization Code Flow com PKCE em Chromium headless;
  - discovery, JWKS, issuer, audience, nonce e claims normalizados;
  - grupos, evidência de MFA, replay e indisponibilidade do IdP;
  - HTTP local restrito a loopback fora de produção.
- Excluded:
  - alterar o fluxo público de login;
  - ativar `ssoRequired` automaticamente;
  - armazenar credenciais reais de tenant;
  - certificar Microsoft Entra ID ou Okta nesta branch.

## Critérios de aceitação

- [x] Login real completa Authorization Code + PKCE.
- [x] Assinatura JWKS, issuer, audience e nonce são validados.
- [x] E-mail verificado, grupos e evidência MFA são normalizados.
- [x] Replay de state é rejeitado.
- [x] Indisponibilidade do IdP falha de forma segura.
- [x] HTTP é aceito apenas para loopback fora de produção.
- [x] Testes direcionados, typecheck e diff check passam.

## Estratégia técnica

Usar a implementação OIDC existente diretamente em um harness isolado. O
harness sobe e remove o contêiner, importa um realm determinístico e automatiza
somente a interação do usuário pelo Chromium.

## Riscos e mitigações

| Risco | Impacto | Mitigação | Stop criterion |
|---|---|---|---|
| HTTP local escapar para produção | Alto | condição explícita por ambiente e loopback | HTTP aceito com `NODE_ENV=production` |
| Segredo ou token aparecer no log | Alto | saída resumida sem payloads | token detectado no output |
| Harness deixar recursos ativos | Médio | trap de cleanup e nome fixo | contêiner permanece após execução |

## Matriz de testes e evidências

| Critério/risco | Teste | Evidência |
|---|---|---|
| Fluxo e claims | Keycloak + Chromium | saída estruturada do harness |
| Replay e outage | harness integrado | rejeições confirmadas |
| HTTPS em produção | Vitest | testes de `OidcService` |
| Regressão de fluxo | Vitest + TypeScript | 15 testes e typecheck aprovados |

## Baseline

Antes da mudança, somente testes com documentos, chaves e respostas OIDC
simulados cobriam o fluxo. Não existia comando de certificação com IdP real.

## Rollback ou recuperação

Reverter o commit da NA-0017. Não há migration nem estado persistente; o
contêiner e o realm são exclusivos do teste e removidos automaticamente.

## Aprovação

- Decisão: `GO`
- Aprovado por: usuário
- Aprovado em: 2026-08-11T13:30:00-03:00

