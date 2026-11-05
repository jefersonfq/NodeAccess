---
change_id: NA-0107
title: Testar escopo das ferramentas de contexto IA
type: test
status: ready-for-tests
created_at: 2026-11-03T19:34:07+00:00
base_branch: chore/NA-0089-20261103-sonar-integration
base_sha: 4a77f7139600e70aa612e753418978d9b31b10ae
branch: test/NA-0107-20261103-ai-tools-contracts
owner: NodeAccess
planner: Codex
risk: medium
---

# NA-0107 — Contratos de ferramentas IA

## Contexto e situação anterior

O módulo local-ai/local-ai-tools.service.ts ainda tem 65 linhas e 26 funções descobertas no baseline, especialmente buscas, resumos e autorização de contexto.

## Problema e objetivo

Exercitar contratos observáveis e reduzir lacunas sem modificar produto nem limiares.

## Escopo

Testes do serviço real; banco e repositórios de contexto/ACL/licença são fronteiras simuladas. Sem instalações/modelos/acesso remoto.

## Critérios de aceitação

- [x] Busca e resumos filtram tenant, usuário e permissão efetiva.
- [x] Recursos ausentes/negados não geram contexto inventado.
- [x] Campos e limites são mapeados com assertivas de efeitos.
- [x] Suite, lint/typecheck e revisão independente registrados.

## Estratégia técnica

Serviço real com banco, repositório de ACL, licença e conhecimento simulados. Assertivas sobre consultas parametrizadas e resultados; sem modelos/provedores externos.

## Riscos e mitigações

Os testes não comprovam aplicação das consultas no banco real. Validar filtros/argumentos e não substituir métodos do serviço.

## Matriz de testes e evidências

Ran: 15 contratos PASS; cobertura dirigida 65/65 linhas, 26/26 funções e 58/60 branches; ESLint e typecheck backend PASS. Revisão independente reproduziu 15/15: PASS_WITH_WARNINGS quanto às fronteiras simuladas.

## Baseline

SHA 4a77f7139600e70aa612e753418978d9b31b10ae; sem modificação de comportamento.

## Rollback ou recuperação

Reverter somente novo arquivo de teste; sem migração ou produção.

## Aprovação

Decisão: GO_WITH_RISKS. ampliação de testes necessária ao pedido das quatro pendências autorizado pelo usuário.
