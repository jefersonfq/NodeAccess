---
change_id: NA-0004
title: Retry seletivo do warm-up local de Hosts
type: performance
status: ready-for-review
created_at: 2026-08-04T11:58:28-03:00
base_branch: performance/NA-0003-20260803-dev-warmup
base_sha: e100d30f32c9d89a9303b947c9463efa414c16c1
branch: performance/NA-0004-20260804-warmup-selective-retry
owner: codex
planner: codex
risk: low
---

# NA-0004 — Retry seletivo do warm-up local

## Contexto e situação anterior

A NA-0003 aquece quatro recursos seguros do fluxo de Hosts e repete a execução até três vezes quando existe falha. Cada tentativa atual solicita novamente todos os recursos, inclusive os que já responderam com sucesso.

## Problema e objetivo

Evitar trabalho repetido durante corridas de inicialização ou falhas parciais. Depois da primeira tentativa, somente recursos reprovados devem ser solicitados novamente, sem remover resultados aprovados do relatório final.

## Escopo

- Preservar a allowlist fixa e os timeouts atuais.
- Repetir somente recursos cujo resultado mais recente seja `failed`.
- Manter no relatório final os quatro recursos, na ordem original.
- Informar quantidade de tentativas por recurso e quantidade global de ciclos.
- Adicionar testes para falha parcial, falha persistente e sucesso inicial.
- Atualizar a documentação do warm-up.

### Fora do escopo

- Pré-navegação com navegador, alteração de endpoints ou cache de produção.
- Novas dependências, requests mutáveis ou origens remotas.
- Alterar readiness, portas, JWT ou a semântica strict/best-effort.

## Critérios de aceitação

- [x] Em falha parcial, recursos aprovados recebem exatamente uma request.
- [x] Somente recursos reprovados são repetidos, no máximo por três ciclos globais.
- [x] O relatório final preserva os quatro recursos e informa tentativas individuais.
- [x] Falha persistente continua reprovada e respeita strict/best-effort.
- [x] Allowlist, GET, timeouts e proteção do token permanecem inalterados.
- [x] Testes automatizados e revisão independente aprovam a mudança.

## Estratégia técnica

Permitir que a função interna execute um subconjunto da allowlist por nome. O orquestrador de retries acumula o resultado mais recente e o contador de cada recurso; entre ciclos, deriva a próxima seleção somente dos itens reprovados. A API pública do CLI e os defaults permanecem compatíveis.

## Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Omitir recurso no resumo | Médio | Testar ordem e quatro resultados finais |
| Contador incorreto | Baixo | Testar sucesso inicial, recuperação e falha persistente |
| Alterar segurança | Alto | Reexecutar allowlist, loopback e não vazamento |

## Matriz de testes e evidências

| Validação | Evidência | Obrigatório |
|---|---|---|
| Baseline NA-0003 | 7 testes aprovados no SHA base | sim |
| Retry seletivo | contagem de calls por URL e tentativas por recurso | sim |
| Regressão de segurança | testes existentes de allowlist/token/loopback | sim |
| Sintaxe e diff | `node --check` e `git diff --check` | sim |
| Validação independente | gate no diff candidato | sim |
| Governança | summary associado ao SHA final | sim |

## Baseline

- Base: NA-0003 no SHA `e100d30f32c9d89a9303b947c9463efa414c16c1`.
- `npm run test:dev-warmup`: 7/7 cenários aprovados antes da alteração.
- Comportamento reproduzido no teste existente: uma falha parcial provoca nova request para todos os quatro recursos.

## Resultados

- Suíte ampliada de 7 para 11 cenários, todos aprovados.
- Falha parcial recuperável: contadores individuais `[1, 1, 2, 1]`; somente o recurso reprovado recebeu a segunda request.
- Recuperação em ciclos diferentes: `[1, 1, 2, 3]`, preservando ordem e relatório completo.
- Falha persistente: `[1, 1, 1, 3]`, com strict reprovado e best-effort preservado.
- Seleção vazia/desconhecida é rejeitada; limites zero, negativos ou não finitos são normalizados de forma finita.
- Revisão independente final: `PASS`, incluindo casos adversariais de allowlist, token, subconjunto, `Infinity`, `-Infinity` e `NaN`.

## Rollback ou recuperação

Reverter os commits NA-0004 restaura o retry integral da NA-0003. Não há dados persistidos ou migração.

## Aprovação

- Decisão: `GO`.
- Autorização do usuário: 2026-08-04, ao solicitar seguir com as melhorias documentadas.
