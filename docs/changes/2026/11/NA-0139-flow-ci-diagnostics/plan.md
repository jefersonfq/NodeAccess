---
change_id: NA-0139
title: Diagnosticar falha do harness de fluxos no CI
type: fix
status: in-development
created_at: 2026-11-04T00:10:05+00:00
base_branch: chore/NA-0093-20261103-sonar-delivery
base_sha: 2ce54c08887a7de4e194fdcb97a8f33c55655419
branch: fix/NA-0139-20261103-flow-ci-diagnostics
owner: NodeAccess
planner: Codex
risk: low
---

# NA-0139 — Fluxos determinísticos e diagnóstico CI

## Contexto e situação anterior

CI2ce: frontend/table/terminal/platform PASS; flows exit1 semtimeout. Rawlog apagado; causa específica não identificada. Cobertura/diff e Sonar aprovados, execução browser bloqueia corretamente.

## Problema e objetivo

Reproduzir falha e corrigir somente causa comprovada. Preservar diagnóstico seguro de etapa/categoria para não perder evidência após cleanup.

## Escopo

Harness sonar-flow, testes e fronteira de diagnóstico sanitizado do coletor. Sem produto, limiares, baseline, timeouts ou relaxamento de asserts.

## Critérios de aceitação

- [x] Reprodução Ubuntu/Chromium1248/CPU2 ou limite explicitamente documentado.
- [x] Etapas/categorias enumeradas, sem rawmessages/tokens/URLs de erro publicados.
- [x] Correção mínima somente com evidência; assertions permanecem exigentes.
- [x] Contratos negativos, ensaio real e revisão independente.

## Estratégia técnica

Controle do código base intacto em ambiente isolado; analisar esperas de UI e estados observáveis. Adicionar etapas estáticas e classificação fixa. Propagar somente campos permitidos ao resumo CI, sem logs brutos.

## Riscos e mitigações

Falha intermitente pode não reproduzir; não atribuir causa por suposição. Não substituir asserts por retries sem limite ou sleep arbitrário. Artefatos de debug privados. Dependências/cache próprios no container, sem modificar integração.

## Matriz de testes e evidências

Ran: controle baseline e candidato Ubuntu1248/CPU2/V8/CDP com cinco harnesses PASS; reprodução dirigida do TypeError de Hosts com fixture original; 35 contratos Node e três Vitest PASS; ESLint nove arquivos e diffcheck PASS. Revisão independente registrada no implementation.md. Scanner/cobertura ampla ficam na integração.

## Baseline

2ce54c08887a7de4e194fdcb97a8f33c55655419. Imagem de ensaio já validada pela frenteNA0138: mcr.microsoft.com/playwright:v1.64.0-noble@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f.

## Rollback ou recuperação

Reverter frente isolada; sem migração ou mudança de política.

## Aprovação

Decisão: GO_WITH_RISKS. Raiz autorizou investigação/correção mínima, sem rawlogs ou relaxamento de gates.
