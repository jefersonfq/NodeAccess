---
change_id: NA-0158
title: Distinguir histórico corrigido no replay Sonar
type: fix
status: ready-for-tests
created_at: 2026-11-04T14:10:04-03:00
base_branch: chore/NA-0093-20261103-sonar-delivery
base_sha: 9a47efdba488adeff100ebf28dfb3f74798e1d4d
branch: fix/NA-0158-20261104-sonar-fixed-history
owner: NodeAccess
planner: Codex
risk: medium
---

# NA-0158 — Distinguir histórico corrigido no replay Sonar

## Contexto e situação anterior

O inventário real contém uma ocorrência FIXED antiga de ImportHostsModal com a mesma regra/hash de uma ocorrência atual. Excluir somente FIXED da detecção de ranges extras; toda ocorrência ativa, aceita ou classificada continua bloqueando se não revisada. Não transicionar o histórico.

## Problema e objetivo

Distinguir histórico corrigido no replay Sonar

## Escopo

O inventário real contém uma ocorrência FIXED antiga de ImportHostsModal com a mesma regra/hash de uma ocorrência atual. Excluir somente FIXED da detecção de ranges extras; toda ocorrência ativa, aceita ou classificada continua bloqueando se não revisada. Não transicionar o histórico.

## Critérios de aceitação

- [x] Reproduzir falha e preservar asserções.
- [x] Executar testes dirigidos.
- [ ] Revalidar CI integrado.

## Estratégia técnica

O inventário real contém uma ocorrência FIXED antiga de ImportHostsModal com a mesma regra/hash de uma ocorrência atual. Excluir somente FIXED da detecção de ranges extras; toda ocorrência ativa, aceita ou classificada continua bloqueando se não revisada. Não transicionar o histórico.

## Riscos e mitigações

Alteração localizada; preservar baseline, gates e permissões. Sem deploy.

## Matriz de testes e evidências

41 contratos PASS, incluindo seis estados históricos e negativa de escrita em ocorrência não relacionada.

## Baseline

9a47efdba488adeff100ebf28dfb3f74798e1d4d

## Rollback ou recuperação

Branch independente e reversão por PR, sem migração.

## Aprovação

Correção necessária dentro do pedido de conformidade fim a fim. Não representa homologação humana.
