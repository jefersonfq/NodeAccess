# NA-0173 — Registro da implementação

## Resumo atual — 2026-11-11

Commit local autorizado pelo usuário em 11/11, após o checkpoint abaixo. A revalidação deve
identificar o novo SHA; resultados posteriores ao commit ficam em
`evidence/post-commit-20261111.json`, sem reaproveitar a aprovação do candidato sem commit.

Cópia isolada em `/home/jeferson/NodeAccess-NA-0173`, branch prevista, base original preservada;
originais canônicos mantidos. Estado LOCAL_WIP, sem commit/publicação. Somente no isolado,
acrescentados dois testes CLI ao teste existente, após falha real de cobertura (68,57% <80%).
Implementação do medidor inalterada. Ran: 14 testes de medidor/governança, lint e diffcheck PASS;
rascunho idêntico revisado independentemente, cobertura focal combinada de 92%.
Primeiro Sonar isolado FAIL: timeout browser no retorno Hosts → dashboard, cobertura baixa
e reconciliação `REVIEW_CHECKOUT_CHANGED`. Reprodução focal com as mesmas asserções/limites
passou, sem pageErrors ou requests falhadas; causa do timeout não comprovada.
Nova rodada: Vitest 3.658 e Node 684 aprovados, zero falhas; TLS/limpeza e nove harnesses browser
PASS. Cobertura diff 92%, Quality Gate OK (80,9% no período, sem novas ocorrências/hotspots).
`validate:sonar` integral permanece FAIL somente por `REVIEW_CHECKOUT_CHANGED`, sem commit.
Evidência: `evidence/resume-20261111.json`. Medidor continua selecionando arquivos por mtime,
não eventos por período; comparação semanal ainda exige correção específica.

## Pedido e objetivo

Usuário pediu análise de onde o Codex gasta tokens e, depois, backup explícito da configuração
atual e aplicação dos ajustes. Objetivo: menos contexto fixo e menos revisões de aprovação,
sem perder regras obrigatórias.

## Implementação

Base SHA 745253d1edb522db79aaa44fd96608ce434a2774 (branch NA-0172 com alterações não commitadas;
nada desta frente foi commitado).
- Backup + `ROLLBACK.md` (hashes SHA-256) em `ai/backup/codex-config-2026-11-08/`; backup das
  regras e do `config.toml` em `/root/.codex/rules-backup/` (fora do repo: contém senhas de exemplo).
- `AGENTS.md` 13,1 KB → 5,6 KB; checklists de domínio/frontend/UX movidos sem alteração para
  `ai/frontend-guidelines.md`; nova seção "Economia de contexto"; planilha 2027 com escrita agrupada.
- Skill de lifecycle 12,4 KB → 9,1 KB; seções de commit/PR/conclusão movidas para
  `references/commit-and-completion.md` com resumo e ponteiro.
- `/root/.codex/rules/default.rules`: 1.920 regras pontuais → 50 genéricas; `git push`,
  `gh pr merge` e `rm -rf` passam a pedir confirmação (antes havia `git push origin main` liberado).
- Claude Code: `CLAUDE.md` passa a importar `@AGENTS.md` (fonte única) + notas próprias;
  `.claude/settings.json` com as mesmas permissões (allow leitura/testes, ask push/merge/rm -rf,
  deny `.env`, `data/`, `backups/`, `node_modules/`, `package-lock.json`) e `bashOutputMaxChars` 15000;
  `.claude/skills/nodeaccess-change-lifecycle` como link para a skill do Codex.
- `tools/quality/ai-usage.mjs` + teste e `npm run ai:usage`: medição repetível (só contadores).
- `.gitignore`: `/.tmp/`. `docs/DEVELOPMENT-token-efficiency.md`: medição e ações.

## Validação

- Ran: `codex execpolicy check` (git status/npm run/runuser → allow; git push/rm -rf → prompt; curl POST → sem regra).
- Ran: `node --test scripts/change-governance.test.mjs` como root: 7/7 pass. Via `runuser` falhou por EACCES em `/root/.local/bin/git` (ambiente, não regressão).
- Na primeira etapa documental, Sonar não foi executado. A inclusão posterior de
  `ai-usage.mjs` exige `npm run validate:sonar`; não há dispensa por ser tooling.
- Manual: medir consumo nas próximas semanas com a mesma leitura dos rollouts.

## Recuperação

`ai/backup/codex-config-2026-11-08/ROLLBACK.md` (total ou parcial); sem impacto em banco ou aplicação.

## Pendências

- `.claude/settings.json` nega `Read(./.env.*)`, incluindo `.env.example`. Avaliar uma exceção
  mínima para o exemplo, preservando o bloqueio dos arquivos reais de segredos; substituir
  o glob apenas por `.env.local` deixaria outras variantes sem essa proteção. Nenhuma regra
  de permissão foi alterada nesta avaliação.

- Cópia isolada em `/home/jeferson/NodeAccess-NA-0173`, branch
  `chore/NA-0173-20261108-codex-token-efficiency`; originais ainda preservados na NA-0172.
- Medidor usa mtime de arquivos e históricos completos: não usar como consumo semanal.
- Sincronizar o `AGENTS.md` novo para outros worktrees quando forem integrados ao master.
- Planilha 2027 não atualizada: mudança de ferramenta interna, não de roadmap do produto.

## Diário de interações

### 2026-11-08T16:00:00-03:00 — análise e ajuste de consumo de tokens

Análise dos rollouts e da configuração; usuário aprovou backup e ajustes e passará a usar uma
thread por assunto. Ajustes aplicados e validados conforme acima. Próximo passo: usar por
algumas semanas, medir e ajustar regras se houver excesso de pedidos de aprovação.

### 2026-11-08T16:20:00-03:00 — mesmas regras para o Claude Code

Usuário pediu aplicar as regras ao Claude. Criados `.claude/settings.json`, link da skill e
`CLAUDE.md` importando `AGENTS.md`. Ran: JSON válido (35 regras allow). Pendente: ajuste do deny
de `.env.*` pelo usuário; validar numa sessão nova do Claude Code.

### 2026-11-08T16:45:00-03:00 — script de medição e inventário de worktrees

Usuário autorizou prosseguir. Criado `npm run ai:usage`; linha de base registrada em
`docs/DEVELOPMENT-token-efficiency.md` (bate com a análise manual). Ran: `node --test
tools/quality/ai-usage.test.mjs` 5/5; `npx eslint` nos dois arquivos sem erros.
Planned: `npm run validate:sonar` depois de separar a NA-0173 em branch própria (hoje a árvore
mistura NA-0172 e a análise não isolaria esta frente). Inventário de worktrees em `/tmp` feito
só para leitura; nenhuma remoção. Ajustes em `~/.claude/settings.json` (modelo 1M e
`autoMode.environment`) ficam com o usuário: alteração de permissões do próprio agente.

### 2026-11-11T19:55:59-03:00 — Isolamento e validação consolidados

Pedido: separar NA-0173 e concluir validações pendentes da Central. Criada a branch prevista
na base 745253d1edb522db79aaa44fd96608ce434a2774; 18 cópias/links conferidos, sem remover
originais canônicos. Worktree inicialmente em .tmp, depois movido para
`/home/jeferson/NodeAccess-NA-0173` para evitar descoberta de tsconfigs extras pelo scanner.
Nenhuma permissão persistente alterada. Dependências pelo lockfile, Prisma generate e shared
build aprovados. Documentos e índice mantidos no projeto canônico e no isolado.

Primeira rodada isolada FAIL: cobertura diff 68,57% e timeout no retorno Hosts → dashboard,
antes de acionar sessões. Sonar 75,9%, sem novas ocorrências. Reprodução focal em cópia
auxiliar, mesmas asserções/timeout de 15 s, passou sem pageErrors/requests falhadas;
causa da falha anterior permanece não comprovada. Evidências históricas preservadas.

NECESSARY_CORRECTION: acrescentados somente no isolado dois testes CLI com fixtures
sintéticos, cobrindo arquivos/recursão, limites de mtime, contadores, deduplicação e privacidade.
Cinco testes anteriores preservados; implementação do medidor inalterada. Revisão independente
PASS. Ran: 14 testes focados de medidor/governança, lint e diffcheck PASS.

Nova execução integral: Vitest 3.658 PASS/0 FAIL/125 ignorados; Node 684 PASS/0 FAIL/11
ignorados; tooling 230 PASS/0 FAIL/1 ignorado; TLS isolado e limpeza verificados; nove harnesses
browser PASS, sem timeout; cobertura diff 92%. Quality Gate OK, 80,9% no período, nenhuma
ocorrência inesperada/hotspot pendente. A rotina ainda retorna FAIL exclusivamente por
REVIEWED_FINDINGS_NOT_VERIFIED / REVIEW_CHECKOUT_CHANGED. Sem alteração de baseline,
exclusão de código, redução de limites ou relaxamento de asserções. Evidência sanitizada:
`evidence/resume-20261111.json`; manifesto atual em `.tmp/NA-0173-resume/isolation-current.json`.

Limitações: medidor seleciona históricos completos por mtime, não consumo de eventos no
período; teste ampliado existe só no worktree; deny de .env.example segue pendente conforme
registro anterior. Sem mudança de escopo/estado do roadmap do produto nesta interação.
LOCAL_WIP, sem commit/push/PR/merge. Próximo: autorização explícita para commit da NA-0173
e revalidação do SHA fixado; candidato exclusivo da Central ainda requer preparação própria.

Revisão final independente: PASS_WITH_WARNINGS para solicitar commit local apenas da NA-0173;
artefatos e escopo conferidos, sem divergência material. Aprovação integral continua BLOCKED
pela reconciliação. O revisor comparou bytes/manifesto, sem recalcular SHA no sandbox.

### 2026-11-11T20:17:38-03:00 — Commit autorizado e avaliação das pendências

Usuário autorizou o commit local da NA-0173 e pediu avaliação das pendências. Escopo do
candidato preservado: instruções/backups, configuração Claude, medidor, testes e registros
da NA-0173. Sem autorização de push/PR/merge ou commit da NA-0172. Planned: conferir índice
e segredos, criar commit convencional e executar validate:sonar no SHA fixado.

Avaliação independente: Central precisa de candidato exclusivo, separando hunks em
package.json, README.md, índice de mudanças, OPERATIONS-manual-pilot.md e gitleaks-fixtures;
não transportar workspace-preserved ou decisões alheias da planilha. Última validação não
demonstrou falha funcional, mas não aprova esse futuro candidato exclusivo.

Medidor: para comparar semanas, recortar timestamps de eventos e diferenças dos contadores
cumulativos Codex, mantendo deduplicação Claude e testes de sessões atravessando períodos.
Até lá, o relatório continua útil como total dos históricos selecionados por mtime, sem
alegação de economia medida. A configuração de .env.example requer ajuste específico que
preserve segredos. Integração/sincronização dos originais canônicos depende de entrega futura.
Não houve mudança de escopo/estado de entrega do roadmap do produto nesta avaliação.
