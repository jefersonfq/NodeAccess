---
change_id: NA-0008
title: Corrigir reprodutibilidade dos quality gates
type: fix
status: ready-for-commit
created_at: 2026-08-05T19:20:43-03:00
base_branch: master
base_sha: ffb716503c18fbe66c70e114efa542816f8dd788
branch: fix/NA-0008-20260805-ci-quality-gates
owner: codex
planner: codex
risk: medium
---

# NA-0008 — Quality gates reproduzíveis

## Contexto e situação anterior

Os checks de governança, lint, testes e build falharam nos PRs 4–7. O checkout local continha Prisma Client gerado e arquivos do módulo de logs ignorados, enquanto o checkout limpo do Actions não os possuía.

## Problema e objetivo

Fazer os mesmos comandos usados pelo GitHub Actions passarem em checkout limpo, sem relaxar regras relevantes nem alterar comportamento funcional da aplicação.

## Escopo

- Gerar Prisma Client explicitamente no CI.
- Versionar `apps/backend/src/modules/logs` sem liberar diretórios locais de log.
- Corrigir parsing ESLint de arquivos Vue.
- Aplicar lint incremental estrito aos arquivos alterados no PR.
- Alinhar mocks HTTP de importação ao schema vigente.
- Permitir branches de processo no validador de governança.
- Validar lint, typecheck, testes, build e governança.

## Critérios de aceitação

- [x] `npm run lint:changed` passa sem reduzir `max-warnings` ou desabilitar regras nos arquivos alterados.
- [x] `npm run typecheck` e `npm run build` passam após geração do Prisma Client.
- [x] A suíte completa passa com as variáveis do workflow.
- [x] O módulo `src/modules/logs` está incluído no diff e resolvido pelo TypeScript.
- [x] `process/NA-*` é validado e nomes inválidos continuam rejeitados.
- [ ] O validador aceita plano, branch e commit da NA-0008.

## Estratégia técnica

Corrigir contratos de ferramenta e fixtures. Preservar implementação existente do módulo de logs e schemas compartilhados; não alterar migrations, dados ou endpoints.

## Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Versionar arquivo local indevido | Alto | Adicionar somente cinco fontes do módulo e revisar diff |
| Mascarar falha de teste | Alto | Atualizar apenas campos obrigatórios do mock, mantendo assertions |
| CI divergir novamente | Médio | Executar exatamente os comandos do workflow |

## Matriz de testes e evidências

| Validação | Evidência | Obrigatório |
|---|---|---|
| Prisma | `npm run db:generate -w apps/backend` | sim |
| Estática | lint e typecheck | sim |
| Regressão | `npm test -- --testTimeout=10000` | sim |
| Build | `npm run build` | sim |
| Governança | testes e execução real do validador | sim |

Resultados executados estão em [test-results.md](./test-results.md).

## Baseline

- GitHub run `31051096049`: build, static-quality e tests falharam.
- GitHub run `31051096188`: change-governance falhou.
- Reprodução local: 351/353 testes passaram; duas fixtures HTTP retornaram 500.

## Rollback ou recuperação

Reverter os ajustes de workflow/configuração, as fixtures e o versionamento do módulo. Não há alteração persistente de banco.

## Aprovação

- Decisão: `GO`.
- Usuário autorizou seguir em 2026-08-05.
