---
change_id: NA-0022
title: Observabilidade operacional segura do SSO OIDC
type: feature
status: passed
created_at: 2026-08-11T16:10:00-03:00
base_branch: master
base_sha: 30aa6d9
branch: feature/NA-0022-20260811-sso-observability
owner: codex
planner: codex
risk: medium
decision: GO
---

# NA-0022 — Observabilidade operacional segura do SSO OIDC

## Objetivo

Permitir alertas e diagnóstico de falhas no discovery, troca de código,
JWKS/validação de token e conclusão do login OIDC sem registrar dados de tenant,
issuer, usuário, claims, códigos ou tokens.

## Escopo

- adicionar contadores e histogramas OIDC ao registro Prometheus existente;
- limitar labels a operação e resultado de baixa cardinalidade;
- diferenciar sucesso, MFA local necessário, rejeição esperada e erro operacional;
- preservar respostas públicas e decisões atuais de autenticação.

## Fora de escopo

- alterar o fluxo de login, políticas, provisionamento JIT ou autorização;
- criar dashboards ou regras específicas de uma plataforma de alertas;
- incluir tenant, provedor ou identidade nos labels.

## Critérios de aceite

- [x] Discovery, troca de código e validação/JWKS expõem sucesso, falha e duração.
- [x] O resultado do login diferencia sucesso, MFA local, rejeição e erro.
- [x] Métricas não contêm dados sensíveis ou labels de alta cardinalidade.
- [x] Testes OIDC e typecheck do backend passam no SHA candidato.

## Riscos e controles

| Risco | Controle |
| --- | --- |
| Cardinalidade excessiva | Labels fechados em enums de operação e resultado |
| Vazamento de informação | Nenhum tenant, issuer, identidade, claim, código ou token |
| Regressão no login | Observador injetável e matriz de regressão OIDC |
| Dupla contagem | Resultado final registrado somente após emissão/MFA bem-sucedida |

## Rollback

Reverter o commit da NA-0022 remove somente instrumentação e seus testes; não há
migration nem alteração de contrato HTTP.
