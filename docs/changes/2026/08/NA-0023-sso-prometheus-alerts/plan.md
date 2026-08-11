---
change_id: NA-0023
title: Alertas Prometheus opcionais para SSO
type: feature
status: passed
created_at: 2026-08-11T16:25:00-03:00
base_branch: master
base_sha: aa8ef7d6c930a7e52fa089c290190cd39b455923
branch: feature/NA-0023-20260811-sso-prometheus-alerts
owner: codex
planner: codex
risk: medium
issue: null
---

# NA-0023 — Alertas Prometheus opcionais para SSO

## Contexto e situação anterior

A NA-0022 passou a emitir métricas seguras do OIDC, mas o Helm chart ainda não
oferecia scraping autenticado nem alertas prontos para falhas operacionais.

## Problema e objetivo

Transformar os sinais existentes em detecção acionável de falhas de discovery,
JWKS/validação e login, sem impor Prometheus Operator à instalação.

## Escopo

- Included: `ServiceMonitor`, `PrometheusRule`, thresholds configuráveis,
  autenticação por Secret, schema, exemplo de produção e runbook.
- Excluded: instalar Prometheus Operator, criar dashboards, incluir dados de
  tenant/provedor e alterar o fluxo de autenticação.

## Critérios de aceitação

- [x] Recursos de monitoramento ficam desativados por padrão.
- [x] Scraping usa Bearer token obtido do `existingSecret`.
- [x] Alertas diferenciam discovery, validação/JWKS e erro operacional.
- [x] Thresholds e janelas são configuráveis e validados pelo schema.
- [x] Helm lint e render com monitoramento habilitado passam.
- [x] Runbook descreve resposta segura e break-glass.

## Estratégia técnica

Adicionar CRDs somente quando explicitamente habilitados nos values. Reusar o
Service da API e o endpoint `/metrics`, sem sidecar nem nova dependência de
runtime. Manter expressões baseadas apenas nos labels fechados da NA-0022.

## Riscos e mitigações

| Risco | Impacto | Mitigação | Stop criterion |
|---|---|---|---|
| CRD ausente | Alto | recursos desativados por padrão | instalação padrão exige Operator |
| Token exposto | Crítico | SecretKeySelector no ServiceMonitor | token renderizado em texto |
| Alert fatigue | Médio | thresholds/janelas configuráveis | rejeição esperada gera alerta crítico |
| Regra inválida | Alto | lint e render Helm real | chart não renderiza |

## Matriz de testes e evidências

| Critério/risco | Teste | Evidência |
|---|---|---|
| Compatibilidade padrão | Helm lint | chart válido sem CRDs habilitados |
| Recursos opcionais | Helm template | ServiceMonitor e PrometheusRule renderizados |
| Segurança | inspeção do render | apenas nome/chave do Secret |
| Configuração | parse/schema | JSON e values válidos |

## Baseline

Antes da mudança, cada instalação precisava criar manualmente scraping, regras
e documentação de resposta, aumentando risco de configuração divergente.

## Rollback ou recuperação

Desabilitar `monitoring.serviceMonitor.enabled` e
`monitoring.prometheusRule.enabled`, ou reverter o commit. Não há migration nem
alteração no backend.

## Aprovação

- Decisão: `GO`
- Aprovado por: usuário
- Aprovado em: 2026-08-11T16:25:00-03:00
