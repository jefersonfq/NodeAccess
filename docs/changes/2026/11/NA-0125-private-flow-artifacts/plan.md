---
change_id: NA-0125
title: Proteger artefatos do harness de diagnóstico
type: fix
status: in-development
created_at: 2026-11-03T21:34:22+00:00
base_branch: chore/NA-0093-20261103-sonar-delivery
base_sha: 78d4a5c4ce55d23af79412184afec30883a3f6a8
branch: fix/NA-0125-20261103-private-flow-artifacts
owner: NodeAccess
planner: Codex
risk: low
---

# NA-0125 — Artefatos privados

## Contexto e situação anterior

Reanálise real apontou javascript:S5443 no diretório temporário fixo do harness sonar-flow-coverage.cjs. Mesmo criando com modo 0700, o harness não recusava diretório preexistente público ou symlink.

## Problema e objetivo

Reutilizar o helper privado existente para capturas e relatório, sem mudar produto ou gates.

## Escopo

Somente harness, testes de rejeição dos destinos e evidências. Preservar SONAR_FLOW_OUTPUT com diretório privado validado.

## Critérios de aceitação

- [x] Destino padrão sob raiz privada por workspace.
- [x] Diretório público e symlink rejeitados antes de abrir navegador/escrever.
- [x] Fluxos reais mantidos e capturas geradas em diretório privado.
- [ ] Lint, revisão independente e reanálise integrada.

## Estratégia técnica

Usar tools/shared/private-artifacts.cjs em cada destino; não duplicar validação de permissões nem criar dependências.

## Riscos e mitigações

Overrides públicos antes tolerados passarão a falhar; erro explícito exige pasta privada. Não alterar permissões de diretórios de terceiros.

## Matriz de testes e evidências

Ran: seis testes Node PASS (três do executável e três do helper), seis grupos de cenários Chromium PASS no destino padrão privado, lint limpo e revisão independente PASS_WITH_WARNINGS. Reanálise integrada pendente.

## Baseline

SHA 78d4a5c4ce55d23af79412184afec30883a3f6a8; único novo achado na reanálise, key e56f6cf5-7540-422b-88a0-6b198cdf4e3e.

## Rollback ou recuperação

Reverter somente harness/documentação; sem migração ou produção.

## Aprovação

Decisão: GO_WITH_RISKS. Correção de achado no escopo Sonar autorizado pelo usuário.
