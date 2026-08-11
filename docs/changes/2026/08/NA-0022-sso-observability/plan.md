---
change_id: NA-0022
title: Observabilidade operacional segura do SSO OIDC
type: feature
status: passed
created_at: 2026-08-11T16:10:00-03:00
base_branch: master
base_sha: 30aa6d9dc5919df9ff1556d33e2da8aaea2603e4
branch: feature/NA-0022-20260811-sso-observability
owner: codex
planner: codex
risk: medium
issue: null
---

# NA-0022 — Observabilidade operacional segura do SSO OIDC

## Contexto e situação anterior

O NodeAccess já disponibiliza um registro Prometheus protegido e métricas dos
fluxos críticos de SSH e auditoria. O SSO OIDC, porém, não emitia sinais
operacionais próprios para distinguir indisponibilidade do IdP, falha de JWKS,
troca de código ou rejeição esperada de política.

## Problema e objetivo

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

## Critérios de aceitação

- [x] Discovery, troca de código e validação/JWKS expõem sucesso, falha e duração.
- [x] O resultado do login diferencia sucesso, MFA local, rejeição e erro.
- [x] Métricas não contêm dados sensíveis ou labels de alta cardinalidade.
- [x] Testes OIDC e typecheck do backend passam no SHA candidato.

## Estratégia técnica

Usar um observador OIDC injetável sobre o registro de métricas existente. Os
serviços informam somente enums fechados de estágio e resultado, mantendo o
observador independente de regras de autenticação e sem acesso a payloads.

## Riscos e mitigações

| Risco | Impacto | Mitigação | Stop criterion |
|---|---|---|---|
| Cardinalidade excessiva | Alto | labels fechados em enums | label dinâmico detectado |
| Vazamento em métricas | Crítico | nenhum dado de tenant/issuer/identidade | dado sensível no `/metrics` |
| Regressão no login | Alto | observador injetável e testes OIDC | fluxo funcional alterado |
| Dupla contagem | Médio | registrar resultado após operação final | dois resultados por conclusão |

## Matriz de testes e evidências

| Critério/risco | Teste | Evidência |
|---|---|---|
| Labels seguros | unitário do observador | somente `operation` e `outcome` |
| Discovery/JWKS | testes do serviço OIDC | sucessos e falhas preservados |
| Troca de código | testes do fluxo OIDC | respostas e validações preservadas |
| Login/MFA | testes do auth OIDC | emissão, MFA e rejeição preservados |
| Regressão | auth suites + typecheck | resultados documentados |

## Baseline

Antes da mudança, falhas do SSO apareciam apenas como erros de requisição, sem
contadores ou duração por etapa. Isso impedia alertas objetivos de degradação do
discovery, endpoint de token ou validação baseada em JWKS.

## Rollback ou recuperação

Reverter o commit da NA-0022 remove somente instrumentação e seus testes; não há
migration nem alteração de contrato HTTP.

## Aprovação

- Decisão: `GO`
- Aprovado por: usuário
- Aprovado em: 2026-08-11T16:10:00-03:00
