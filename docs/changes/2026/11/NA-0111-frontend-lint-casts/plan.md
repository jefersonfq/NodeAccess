---
change_id: NA-0111
title: Remover assertions TypeScript redundantes
type: fix
status: in_progress
created_at: 2026-11-03T17:11:23-03:00
base_branch: chore/NA-0089-20261103-sonar-integration
base_sha: 4a77f7139600e70aa612e753418978d9b31b10ae
branch: fix/NA-0111-20261103-frontend-lint-casts
owner: Codex
planner: Codex
risk: medium
issue: null
---

# NA-0111 — Lint dos helpers frontend

## Contexto e situação anterior

Lint integrado identificou quatro assertions não nulas redundantes nos dois helpers novos de NA-0087. Comparação master identificou 25 outros erros frontend preexistentes, preservados fora deste delta.

## Problema e objetivo

Remover quatro assertions e explicitar três retornos booleanos sem efeito runtime, preservando os scanners lineares e suas regras.

## Escopo

- Helpers audit-text-patterns.ts, text-boundaries.ts e documentação desta frente.
- Fora: refatoração do produto, exclusões de cobertura, conexão à VPS, PTY real ou instalação.

## Critérios de aceitação

- [x] Lint focal e testes de equivalência/adversariais existentes passam.
- [x] Sem alteração runtime, Vue ou regras de lint.
- [x] Testes e cobertura observada registrados sem inferir homologação real.

## Estratégia técnica

Retirar assertions não nulas identificadas pelo ESLint e declarar retorno dos três predicados. Reexecutar testes existentes adversariais e de equivalência dos helpers.

## Riscos e mitigações

| Risco | Impacto | Mitigação | Parada |
|---|---|---|---|
| Fake encobre regra | Falso positivo | Mock apenas IO, assert efeitos e rejeições | Regra de produto substituída |
| Timer/conexão vaza | Instabilidade | Cleanup e timers controlados | Handle aberto |

## Matriz de testes e evidências

| Critério | Teste | Ambiente | Evidência | Obrigatório |
|---|---|---|---|---|
| Scanners de texto | Vitest helpers | Worktree isolado | test-results.md | Sim |
| Ausência de regressão | Testes existentes do módulo | Worktree isolado | test-results.md | Sim |

## Baseline

SHA `4a77f7139600e70aa612e753418978d9b31b10ae`; lacunas de execução identificadas na coleta ampliada da coordenação. Não é requisito impor100% ou inventar segurança comprovada.

## Rollback ou recuperação

Reverter commit de testes. Nenhum schema, runtime ou configuração de produção alterado.

## Mudanças de escopo e decisões

Coordenação atribuiu esta frente após ensaio CI real aprovado para ampliar cobertura funcional do escopo legado.

## Aprovação

- Decisão: GO_WITH_RISKS
- Aprovado por: usuário (tratamento das pendências) e coordenação (testes do serviço)
- Aprovado em: 2026-11-03
