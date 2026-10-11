# Validação final NA-0038 — 2026-10-05

Branch `fix/NA-0038-20261005-engineering-hardening`; workspace anterior preservado; sem deploy ou acesso a produção. Artefatos em `docs/reviews/evidence/2026-10-05-engineering-hardening/`.

| Verificação | Resultado final | Evidência |
|---|---|---|
| Suíte padrão, 219 arquivos reportados | **1.795 assertions passed, zero failed; 34 skipped opt-in** | `unit.json`, `unit-summary.json`, `unit.log` |
| OpenSSH: API SFTP, arquivos de sessão, utilitários/editor/agente e quotas | **16/16** reais aprovados | `sftp-all-real.json` |
| MySQL: ACL entre tenants e criação concorrente de sessão compartilhada | **2/2** reais aprovados | `access-mysql-real.json` |
| MySQL: filas/migration/crash | **10 cenários aprovados**, incluindo 20 inserts e 30 claims concorrentes, 100 eventos/10 workers, SIGKILL real e preferência por entrega já concluída na migração | `mysql-real.json` |
| API real: Jira com IA desligada e SIGTERM | Readiness 503 durante drain; um efeito remoto, resultado persistido, exit 0 | `api-shutdown.json`, log real da API |
| Nginx | **24 respostas**, quatro perfis HTTP/HTTPS/prod/Kubernetes; headers e HSTS quando aplicável | `nginx-headers.json` |
| Terminal Playwright | Resultado passed; regressão de experiência/foco/layout e interação | `terminal-web.json` |
| FileManager real em Vue com APIs simuladas | Exceção contida, recuperação por teclado sem nova conexão, foco/input preservados e deadline HTTP explícito | `ui-hardening.json` |
| Utilitários Playwright | Cópia, seleção do destino, credenciais isoladas, comandos sem execução automática, edição, quota, conflito, fechamento do painel e mobile aprovados | `utilities-web.json` |
| SFTP Chromium CDP com API simulada | **10 cenários**, ok; zero pageErrors | `sftp-cdp.json` |
| Manual | Cinco capturas atualizadas/revisadas, 2 testes do compilador + 18 testes de produto aprovados, cinco capítulos com reviewCurrent true | `manual-capture.log`, `manual-tests.log`, `manual-reviewed.log` |
| Typecheck/build/schema | Backend e frontend: exit 0; Prisma schema validado | `backend-typecheck.log`, `frontend-typecheck.log`, `backend-build.log`, `frontend-build.log`, `prisma-validate.log` |
| Lint dirigido | Implementações selecionadas sem erros; aviso do callback dispatcher corrigido e revalidado; novos componentes Vue sem erros/avisos | `lint-ts.json`, `lint-dispatcher-final.json`, `lint-vue.json`, `lint-new-tests.json` |
| Ajustes finais de tipagem dos testes | **25/25** cenários afetados repetidos após corrigir lint, sem mudanças de produto | `final-test-typing.json` |
| Recuperação | Dry run validou 60 arquivos; restauração aplicada apenas em repositório temporário, preservando conteúdo anterior e arquivos alheios | `rollback-dry-run.log`, `rollback-simulation.json` |

O reporter JSON desta versão do Vitest inclui skipped no total agregado de numPassedTests. A contagem acima usa o status individual de cada assertion; os 18 testes reais são cenários que estavam opt-in na suíte padrão. Não somar repetições de testes direcionados como cobertura adicional.

## Execução reproduzível

- `npx vitest run --maxWorkers=4 --minWorkers=1 --reporter=json --outputFile=docs/reviews/evidence/2026-10-05-engineering-hardening/unit.json`
- `npm run typecheck -w apps/backend`; `npm run typecheck -w apps/frontend`; `npm run build -w apps/backend`; `VITE_APP_VERSION=engineering-hardening-local npm run build -w apps/frontend`.
- Laboratório MySQL 8.4 em `127.0.0.1:3308/hardening`, Redis sem persistência em `127.0.0.1:6383`, OpenSSH descartável em `127.0.0.1:22283`. Os harnesses de engenharia recusam banco diferente do laboratório. Configurar variáveis explícitas de teste; nunca reutilizar credenciais de produção.
- `HARDENING_DATABASE_URL=<laboratório> node --import tsx tools/backend/engineering-hardening-real.mts` e `tools/backend/engineering-shutdown-real.mts`.
- `RUN_SFTP_REAL=true npx vitest run apps/backend/src/modules/sftp/sftp.real.test.ts apps/backend/src/modules/ssh/session-files.real.test.ts apps/backend/src/modules/ssh/session-files-quota.real.test.ts` com chave de criptografia exclusiva de teste.
- `RUN_ACL_MYSQL=true RUN_SHARE_MYSQL=true ACL_TEST_DATABASE_URL=<laboratório> DATABASE_URL=<laboratório> npx vitest run apps/backend/src/modules/inventory/inventory-acl.mysql.test.ts apps/backend/src/modules/shared-sessions/shared-session-reuse.mysql.test.ts`.
- Frontend de teste com `VITE_APP_VERSION=engineering-hardening-local`, `FRONTEND_BASE=http://127.0.0.1:5179`; terminal: `npm run test:terminal-experience:web`; modos adicionais `ENGINEERING_HARDENING_REVIEW=1` e `FILE_UTILITIES_REVIEW=1` no mesmo harness. Para SFTP, `CDP_BASE=http://127.0.0.1:9368 npm run test:sftp:web` com Chromium descartável.
- `MANUAL_EXPECTED_VERSION=engineering-hardening-local npm run manual:capture`, `npm run test:manual`, `npm run manual:check-reviewed`.
- `python3 tools/recovery/engineering-hardening-rollback.py` é somente dry run por padrão.

## Falhas investigadas e limites

A corrida de upsert e o EOF SFTP foram corrigidos e os testes reais repetidos. A versão inicial do ensaio SQL dividia comentários por ponto e vírgula: o harness foi corrigido para remover comentários antes de separar statements, e a migration passou novamente. O teste de foco inicialmente recebeu componente antigo de Vite em volume Windows; servidor reiniciado e cenário aprovado. Um timeout inicial de observabilidade sob disputa de recursos passou na repetição controlada da suíte. O manual foi repetido com versão esperada explícita.

O CDP registrou navegação quente de 2.027 ms e nove avisos/erros de console durante cenários de falha; não registrou pageErrors. Esses avisos continuam no artefato. Build tem aviso de chunk grande da UI e Browserslist antigo. Lint dirigido não certifica que todo o workspace anterior está livre de dívida.

Não houve mudança de resize, WebSocket ou transporte SSH; a regressão obrigatória da área do terminal foi executada. O ensaio PTY interativo com top/htop não foi realizado nesta rodada. OpenSSH real valida SFTP e utilitários, enquanto os ensaios web usam transporte/API simulados. Não houve soak de horas/dias, teste de carga em produção, certificação de aplicações Windows de terceiros ou garantia de ausência absoluta de regressões.

Os três containers descartáveis e o frontend/Chromium locais foram encerrados após os ensaios. A revisão final de diff comparou somente esta rodada aos snapshots anteriores, sem problemas de whitespace (`scoped-diff-check.json`).
