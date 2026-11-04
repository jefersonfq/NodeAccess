---
change_id: NA-0159
title: Completar fixture do instalador do agente
type: test
status: ready-for-tests
created_at: 2026-11-04T14:10:04-03:00
base_branch: chore/NA-0093-20261103-sonar-delivery
base_sha: 9a47efdba488adeff100ebf28dfb3f74798e1d4d
branch: test/NA-0159-20261104-agent-artifact-fixture
owner: NodeAccess
planner: Codex
risk: medium
---

# NA-0159 — Completar fixture do instalador do agente

## Contexto e situação anterior

Os CLIs copiados pela fixture importam trusted-executable.cjs, ausente no diretório temporário. Copiar o helper real em ambos os cenários e incluir stderr na asserção de importação para diagnóstico. Nenhuma alteração no instalador ou fronteiras de segurança.

## Problema e objetivo

Completar fixture do instalador do agente

## Escopo

Os CLIs copiados pela fixture importam trusted-executable.cjs, ausente no diretório temporário. Copiar o helper real em ambos os cenários e incluir stderr na asserção de importação para diagnóstico. Nenhuma alteração no instalador ou fronteiras de segurança.

## Critérios de aceitação

- [x] Reproduzir falha e preservar asserções.
- [x] Executar testes dirigidos.
- [ ] Revalidar CI integrado.

## Estratégia técnica

Os CLIs copiados pela fixture importam trusted-executable.cjs, ausente no diretório temporário. Copiar o helper real em ambos os cenários e incluir stderr na asserção de importação para diagnóstico. Nenhuma alteração no instalador ou fronteiras de segurança.

## Riscos e mitigações

Alteração localizada; preservar baseline, gates e permissões. Sem deploy.

## Matriz de testes e evidências

19 testes reais de artefatos/proveniência PASS em Linux; Windows depende do runner hospedado.

## Baseline

9a47efdba488adeff100ebf28dfb3f74798e1d4d

## Rollback ou recuperação

Branch independente e reversão por PR, sem migração.

## Aprovação

Correção necessária dentro do pedido de conformidade fim a fim. Não representa homologação humana.
