# Evidências de teste — NA-0010

- Plan: `docs/changes/2026/08/NA-0010-change-state-visibility/plan.md`
- Branch: `process/NA-0010-20260806-change-state-visibility`
- Base SHA: `512024608ea18b98f7bf2bb228e5a1846db929b5`
- Tested SHA: `LOCAL_WIP` (ainda sem commit por política)
- Environment: worktree local, Node.js 20.20.2, instalação limpa com `npm ci`
- Finished at: 2026-08-06T14:25:01-03:00
- Result: `PASS_WITH_WARNINGS` (validação independente `PASS`; suíte completa limitada pelo ambiente)

## Critérios de aceitação

| Critério | Status | Evidência | Notas |
|---|---|---|---|
| Template compatível | PASS | `npm run test:change-governance` | 5 testes aprovados |
| Seis estados separados | PASS | `npm run test:change-status` | 7 testes aprovados |
| Worktree incorreto visível | PASS | teste Git temporário e CLI real | caminho do worktree e `visibleInCurrentWorkspace` |
| CLI somente leitura | PASS | revisão independente | apenas comandos Git de leitura |
| Sem alteração funcional | PASS | diff em `apps/`, `packages/` e `prisma` vazio | mudança limitada a processo/scripts/docs |
| Build limpo reproduzível | PASS | `npm ci`, Prisma generate, `npm run build` | shared → backend → frontend |

## Suítes

| Suíte | Ran/Skipped/Planned/Manual | Resultado | Evidência |
|---|---|---|---|
| Status unitário e Git temporário | Ran | PASS, 7/7 | TAP |
| Governança | Ran | PASS, 5/5 | TAP |
| Build raiz | Ran | PASS | shared, backend e frontend |
| Validação independente | Ran | PASS | três falsos positivos reproduzidos, corrigidos e revalidados |
| Lint de arquivos alterados | Ran | PASS | nenhum TS/Vue afetado |
| `git diff --check` | Ran | PASS | sem erros |
| Suíte Vitest completa | Ran | FAIL preexistente/ambiental | 333 testes passaram; 4 arquivos falharam por variáveis de ambiente ausentes |
| PR no GitHub | Manual | pendente | sem consulta autenticada nesta etapa |

## Antes e depois

| Aspecto | Antes | Depois |
|---|---|---|
| Estado após push | Comunicação ambígua | Seis estados independentes e próximo passo |
| Worktree do VS Code | Não explicitado | Caminho e visibilidade informados |
| Branch recém-criada | Poderia parecer mesclada | `MERGED` exige commit próprio e ancestralidade |
| Alteração em outro worktree | Podia parecer limpa | Status é lido no worktree da branch |
| Build após instalação limpa | Dependia de `packages/shared/dist` pré-existente | Pacote compartilhado é compilado primeiro |

## Limitações, avisos e próximo estado

- A suíte Vitest completa requer `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` e `PEM_ENCRYPTION_KEY`; as quatro falhas não tocam os arquivos desta frente.
- `npm ci` reportou vulnerabilidades já presentes no lockfile; nenhuma dependência foi alterada.
- Evidência está vinculada ao `LOCAL_WIP`; após eventual commit, os gates aplicáveis devem ser repetidos no SHA final.
- Próximo estado: solicitar autorização explícita para commit e repetir os gates aplicáveis no SHA final.
