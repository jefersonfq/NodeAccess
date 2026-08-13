---
change_id: NA-0030
title: Certificação SSO e Kubernetes reproduzível
type: feature
status: passed
created_at: 2026-08-13T15:00:00-03:00
base_branch: feature/NA-0029-20260811-oidc-group-mapping
base_sha: 49022b1d035137c4c650bbbec47091d9d093e497
branch: feature/NA-0030-20260813-sso-kubernetes-certification
owner: codex
planner: codex
risk: high
issue: null
---

# NA-0030 — Certificação SSO e Kubernetes reproduzível

## Contexto e situação anterior

A base já possuía OIDC genérico, chart Helm e testes isolados, mas não havia uma
certificação reproduzível que reunisse política administrativa, provedores de
mercado e os cenários críticos de operação em Kubernetes.

## Problema e objetivo

Consolidar a política OIDC, entitlement, compatibilidade simulada Entra/Okta e
a instalação Helm em gates reproduzíveis, incluindo sessão SSH durante rollout,
migration recovery e Ingress TLS com Nginx e Traefik.

## Escopo

- entitlement e teste administrativo da configuração OIDC;
- política SSO com break-glass validado e UX de confirmação;
- matriz local Entra/Okta e certificação Keycloak;
- drenagem do gateway ligada ao ciclo real do WebSocket;
- chart Helm, migration recovery, TLS/WSS Nginx e Traefik;
- gates de pull request e certificações agendadas/manuais.

## Critérios de aceitação

- [x] SSO obrigatório não é ativado sem break-glass validado.
- [x] OIDC sem entitlement não é exposto nem iniciado.
- [x] Keycloak passa ponta a ponta e Entra/Okta possuem matriz local explícita.
- [x] Migration com falha não altera workloads e recupera após correção.
- [x] SSH permanece ativo durante rollout e readiness retorna 503 em drenagem.
- [x] Nginx e Traefik terminam TLS e preservam WSS/SSH.
- [x] Typechecks, testes direcionados, Helm lint/render e kind integrado passam.

## Estratégia técnica

Manter o adaptador OIDC baseado em padrões, validar diferenças de provedores por
matriz automatizada e usar Keycloak como IdP controlado. No Kubernetes, ligar a
drenagem ao ciclo real do WebSocket e certificar o chart em kind com cenários
independentes de migration, rollout e Ingress.

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Bloqueio administrativo por SSO | break-glass local validado antes da ativação |
| Declaração excessiva de compatibilidade | separar simulação de homologção externa Entra/Okta |
| Queda de SSH em rollout | lease por WebSocket, readiness fail-fast e grace period validado |
| Upgrade parcial | migration pre-upgrade e teste de falha/recuperação |
| Flakiness de registry externo | retry limitado somente no download de charts |

## Matriz de testes e evidências

- 130 testes centrais de autenticação aprovados;
- 22 testes da matriz OIDC aprovados;
- Keycloak ponta a ponta e metadata/JWKS Entra revalidados;
- certificação kind integrada aprovada para install, Helm test, migration,
  drenagem, Nginx e Traefik;
- typechecks backend/frontend e Helm harness aprovados.

## Baseline

- branch-base: `feature/NA-0029-20260811-oidc-group-mapping`;
- SHA-base: `49022b1d035137c4c650bbbec47091d9d093e497`;
- comportamento anterior preservado para tenants sem entitlement ou política SSO.

## Rollback ou recuperação

Desabilitar OIDC pela política administrativa, manter login break-glass e
reverter os commits desta mudança. Em Kubernetes, executar `helm rollback` para
a revisão anterior; a migration de entitlement adiciona somente coluna booleana.

## Aprovação

- Decisão: `GO_WITH_RISKS`
- Aprovado por: usuário
- Aprovado em: 2026-08-13
