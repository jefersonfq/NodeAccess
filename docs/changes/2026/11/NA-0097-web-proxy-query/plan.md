---
change_id: NA-0097
title: Preservar query e fragmento nos links do proxy web
type: fix
status: in-development
created_at: 2026-11-03T16:22:00-03:00
base_branch: test/NA-0096-20261103-web-access-contracts
base_sha: 155405123b21d6542f692f08e339c8da02e5f2c5
branch: fix/NA-0097-20261103-web-proxy-query
owner: NodeAccess
planner: Codex
risk: medium
---

# NA-0097 — URLs do proxy web

## Contexto e situação anterior

A função buildProxyUrl acrescenta sempre ?token ao caminho completo. Se o destino já contém query ou fragmento, o token pode virar parte de outro valor ou ficar no fragmento, quebrando o acesso.

## Problema e objetivo

Reproduzir o comportamento com HTTP real descartável e preservar caminho, query, fragmento e token válido na URL reescrita.

## Escopo

Correção necessária descoberta na validação autorizada: função de montagem de URL e testes dirigidos. Sem modificar autenticação, transporte, autorização ou contrato do link.

## Critérios de aceitação

- [x] Testes reproduzem defeito antes da correção.
- [x] Redirects e recursos HTML/CSS preservam parâmetros e fragmento.
- [x] Token da sessão de acesso web é único e válido.
- [x] Suite anterior, lint, typecheck e revisão independente aprovados.

## Estratégia técnica

Separar fragmento e query do caminho, atualizar token com URLSearchParams e remontar URL relativa do proxy. Preservar destino e isolamento existentes.

## Riscos e mitigações

URLSearchParams pode normalizar encoding de query mantendo o valor decodificado. Testar parâmetros repetidos, caracteres codificados e token preexistente. Não alterar transformação de origins ou headers neste lote.

## Matriz de testes e evidências

Planned: testes regressivos HTTP real, suite anterior, lint/typecheck e revisão independente. Reproduzidos quatro erros no servidor e um no script dinâmico antes das correções; 36 testes dirigidos e 37 com Chromium aprovados.

## Baseline

Base 155405123: 31 testes de acesso web aprovados. Defeito confirmado pelos testes regressivos antes da alteração.

## Rollback ou recuperação

Reverter somente alteração de montagem de URL e testes correspondentes; sem migração.

## Aprovação

Decisão: GO_WITH_RISKS. Correção pontual necessária dentro da validação de colaterais autorizada pelo usuário; sem ampliação de produto.
