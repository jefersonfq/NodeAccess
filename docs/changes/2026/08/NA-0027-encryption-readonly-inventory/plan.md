---
change_id: NA-0027
title: Inventário somente leitura dos dados cifrados
type: security
status: passed
created_at: 2026-08-11T18:30:00-03:00
base_branch: master
base_sha: af5d8c9081bf7d7c8951b612a95ed3ae9643039f
branch: security/NA-0027-20260811-encryption-readonly-inventory
owner: codex
planner: codex
risk: high
issue: null
---

# NA-0027 — Inventário somente leitura dos dados cifrados

## Contexto e situação anterior

A primitiva de recifragem já existe, mas não havia contagem segura dos payloads
que usam chave primária, anterior ou que estão inválidos.

## Problema e objetivo

Mapear o impacto antes de qualquer escrita no banco, sem expor IDs, ciphertext,
plaintext ou chaves e bloqueando avanço quando houver payload inválido.

## Escopo

- Included: serviço agregador, adaptador Prisma somente leitura, integrações
  JSON conhecidas, comando operacional, exit codes, testes e runbook.
- Excluded: atualizar registros, recifrar, remover chaves ou mostrar detalhes de
  registros individuais.

## Critérios de aceitação

- [x] Inventário não possui operação de escrita.
- [x] Saída contém somente domínio e contagens agregadas.
- [x] Payloads primários, anteriores e inválidos são separados.
- [x] Campos JSON malformados contam como inválidos.
- [x] Código de saída bloqueia avanço quando houver inválidos.
- [x] Testes, typecheck e diff check passam.

## Estratégia técnica

Separar agregação, inspeção criptográfica e acesso Prisma por interfaces. O
adaptador enumera explicitamente pares ciphertext/IV conhecidos e campos JSON,
evitando descoberta dinâmica de colunas ou SQL de escrita.

## Riscos e mitigações

| Risco | Impacto | Mitigação | Stop criterion |
|---|---|---|---|
| Vazamento no relatório | Crítico | somente contagens agregadas | ID/payload aparece |
| Fonte esquecida | Alto | lista explícita por domínio | consumidor conhecido ausente |
| JSON inválido ignorado | Alto | contador invalid + exit 2 | parse falha silenciosamente |
| Escrita acidental | Crítico | somente `findMany` no adaptador | método update/create/delete |

## Matriz de testes e evidências

| Critério/risco | Teste | Evidência |
|---|---|---|
| Agregação | serviço unitário | totais primária/anterior/inválida |
| JSON inválido | parser unitário | contabilizado sem conteúdo |
| Crypto | keyring unitário | origem autenticada correta |
| Tipos | backend typecheck | campos Prisma existentes |
| Segurança | revisão do comando | output agregado e read-only |

## Baseline

Antes, não era possível estimar o volume legado ou detectar corrupção antes de
iniciar uma rotina de recifragem.

## Rollback ou recuperação

Reverter o commit. O comando não altera banco e não há migration.

## Aprovação

- Decisão: `GO`
- Aprovado por: usuário
- Aprovado em: 2026-08-11T18:30:00-03:00
