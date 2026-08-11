---
change_id: NA-0028
title: Recifragem controlada dos Secrets do cofre
type: security
status: passed
created_at: 2026-08-11T19:40:00-03:00
base_branch: master
base_sha: 74cf81fa1bf70fb1160a0e3e4b97d878734c3335
branch: security/NA-0028-20260811-vault-secret-rewrap
owner: codex
planner: codex
risk: critical
issue: null
---

# NA-0028 — Recifragem controlada dos Secrets do cofre

## Contexto e situação anterior

O inventário e a primitiva de rewrap existiam, mas nenhum repositório permitia
aplicar a recifragem persistida de forma controlada.

## Problema e objetivo

Recifrar inicialmente apenas o cofre `Secret`, com dry-run padrão, confirmação
forte, baseline esperado, lotes e proteção contra concorrência.

## Escopo

- Included: serviço paginado, repositório Prisma transacional por lote, comando
  dry-run/apply, confirmação, comparação otimista, testes e runbook.
- Excluded: PEM, hosts, links, integrações JSON, execução no banco do usuário e
  remoção de chaves anteriores.

## Critérios de aceitação

- [x] Comando sem argumentos não escreve.
- [x] Apply exige contagem esperada e confirmação literal.
- [x] Payload inválido bloqueia antes da primeira escrita.
- [x] Apenas payload legado é atualizado.
- [x] Atualização compara ciphertext/IV anterior.
- [x] Reexecução é idempotente e paginada em lotes de 100.
- [x] Testes, typecheck e diff check passam.

## Estratégia técnica

Executar pre-scan completo, validar baseline e então fazer segunda passagem.
Cada lote usa transação Prisma com `updateMany` condicionado ao valor antigo.
Uma contagem divergente sinaliza concorrência e interrompe a operação.

## Riscos e mitigações

| Risco | Impacto | Mitigação | Stop criterion |
|---|---|---|---|
| Escrita acidental | Crítico | dry-run default + dois argumentos | apply sem confirmação |
| Corrupção existente | Crítico | pre-scan bloqueia invalid | escrita inicia com invalid > 0 |
| Concorrência | Alto | compare-and-set de ciphertext/IV | sobrescrita silenciosa |
| Processo parcial | Alto | lotes e idempotência | rerun altera primários |
| Escopo excessivo | Crítico | somente modelo Secret | outro domínio atualizado |

## Matriz de testes e evidências

| Critério/risco | Teste | Evidência |
|---|---|---|
| Dry-run | serviço unitário | zero chamadas de update |
| Baseline | serviço unitário | divergência bloqueia |
| Apply seletivo | serviço unitário | somente anterior atualizado |
| Concorrência | serviço unitário | count divergente interrompe |
| Corrupção | serviço unitário | invalid bloqueia escrita |
| Regressão | inventory + crypto tests | inspeção/rewrap preservados |

## Baseline

Antes, não existia comando de escrita para recifragem e a chave anterior não
podia ser removida com segurança.

## Rollback ou recuperação

Interromper o comando e manter ambas as chaves no keyring. Lotes já concluídos
usam a primária; os demais continuam legíveis pela anterior. Reexecutar dry-run
antes de retomar. Não há migration.

## Aprovação

- Decisão: `GO_WITH_RISKS`
- Aprovado por: usuário
- Aprovado em: 2026-08-11T19:40:00-03:00
