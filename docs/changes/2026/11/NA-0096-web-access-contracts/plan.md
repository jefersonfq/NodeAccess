---
change_id: NA-0096
title: Testar contratos de configuracao e diagnostico de acesso web
type: test
status: in-development
created_at: 2026-11-03T15:57:28-03:00
base_branch: chore/NA-0089-20261103-sonar-integration
base_sha: 4a77f7139600e70aa612e753418978d9b31b10ae
branch: test/NA-0096-20261103-web-access-contracts
owner: NodeAccess
planner: Codex
risk: medium
---

# NA-0096 — Contratos de acesso web

## Contexto e situação anterior

O WebAccessService apresenta 191 linhas instrumentáveis sem cobertura no baseline legado. Ele assina links temporários, mantém túneis compartilhados e encaminha HTTP.

## Problema e objetivo

Validar comportamento do proxy e ciclo de vida dos túneis, preservando os limiares globais de cobertura.

## Escopo

Somente testes: serviço e JWT reais, servidor HTTP descartável em loopback, fronteiras de persistência e túnel simuladas. Sem alteração de produto, kernel ou VPS.

## Critérios de aceitação

- [x] Link assinado, escopo, expiração e rejeição de acesso validados.
- [x] Encaminhamento HTTP, headers, corpos, cookies e recursos HTML/CSS validados.
- [x] Concorrência, isolamento de tenant, reuso e fechamento de túneis validados.
- [x] Lint, typecheck e revisão independente registrados.

## Estratégia técnica

Exercitar APIs públicas com assertivas dos efeitos e HTTP real. Simular apenas persistência, criação SSH e eventos; usar relógio controlado para expiração e timeout ocioso. Não atribuir aos testes a validação do transporte SSH real ou do navegador.

## Riscos e mitigações

A reescrita HTML é testada como conteúdo: execução dos scripts no navegador fica fora desse lote. Não alterar expectativas para ocultar regressões. Falhas descobertas devem ser registradas e corrigidas em frente própria.

## Matriz de testes e evidências

Ran: 31 testes aprovados; cobertura dirigida 185/191 linhas (96,85%), 40/42 funções (95,23%), 95/115 branches (82,60%). Lint e typecheck aprovados; revisão independente reproduziu os 31 casos. Ver implementation.md.

## Baseline

SHA 4a77f7139600e70aa612e753418978d9b31b10ae. Nenhuma alteração de produto neste lote.

## Rollback ou recuperação

Reverter o arquivo de testes. Nenhuma migração ou persistência real.

## Aprovação

Decisão: GO_WITH_RISKS. Trabalho necessário ao pedido autorizado das quatro pendências, com testes e simulações; preservar limiares e fronteiras externas.
