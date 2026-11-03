---
change_id: NA-0106
title: Testar CLI e integridade do catalogo SonarQube
type: test
status: in-development
created_at: 2026-11-03T19:49:23+00:00
base_branch: chore/NA-0089-20261103-sonar-integration
base_sha: 4a77f7139600e70aa612e753418978d9b31b10ae
branch: test/NA-0106-20261103-sonar-ledger-contracts
owner: NodeAccess
planner: Codex
risk: low
---

# NA-0106 — Contratos do catálogo SonarQube

## Contexto e situação anterior

A coleta real mostra 65 unidades de linhas/branches do ledger ainda descobertas no diff integrado, incluindo geração CLI e validação de baseline.

## Problema e objetivo

Validar geração de artefatos e rejeição de dados inválidos com processo real e filesystem descartável.

## Escopo

Somente testes Node do ledger existente. Sem alteração de catálogo real, baseline aceito ou supressão de regras.

## Critérios de aceitação

- [x] CLI gera JSON/CSV/HTML e preserva IDs descobertos em reexecução.
- [x] Baselines inválidos e decisões duplicadas são rejeitados.
- [x] Mensagens brutas não são exportadas; CSV/HTML são escapados.
- [x] Testes e revisão independente registrados.

## Estratégia técnica

Executar CLI original com cwd temporário e fixtures; importar funções públicas para condições inválidas. Usar NODE_V8_COVERAGE herdado na coleta normal, sem crédito externo.

## Riscos e mitigações

CLI escreve somente na fixture temporária; limpar diretório ao terminar. Testes de HTML verificam conteúdo, complementados por ensaio de navegador na frente de cobertura.

## Matriz de testes e evidências

Ran: 22 testes aprovados (16 novos e 6 anteriores), incluindo CLI real em filesystem descartável. Revisão independente reproduziu 22 casos e aprovou. Cobertura V8 será medida na consolidação.

## Baseline

SHA 4a77f7139600e70aa612e753418978d9b31b10ae; nenhum produto alterado.

## Rollback ou recuperação

Reverter arquivo novo de testes; catálogo real não é tocado.

## Aprovação

Decisão: GO_WITH_RISKS. Necessário à cobertura do código novo autorizada nas quatro pendências.
