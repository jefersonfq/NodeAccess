# NA-0082 — Evidências locais

Resultado: **PASS_WITH_WARNINGS**, concluído em 2026-10-29T20:53:06-03:00.

Base e HEAD: `f4a44b4b7ae87a8f688b1246d9e52a31f9a104bc`.
Branch: `feature/NA-0082-20261029-resource-health`.
Checkout: `/tmp/nodeaccess-NA-0082`. Os testes cobrem alterações locais ainda não commitadas, não um novo SHA publicado.

Fingerprint SHA-256 de 35 arquivos novos/alterados de aplicação/scripts/package (excluindo docs e README): `33955a7eafb18cf2c6f0f38850ee0de30d7ee43e100328ca65e72e612a14e707`. Algoritmo: caminhos ordenados de git diff + untracked, concatenar caminho UTF-8, byte nulo, conteúdo e byte nulo. Novas mudanças invalidam esta evidência.

Ambiente: Linux, Node 24.21.0, npm 11.12.1. `npm ci --no-audit --no-fund`, shared build e Prisma generate executados. Chromium headless existente selecionado por `PLAYWRIGHT_CHROMIUM_EXECUTABLE`; o instalador da revisão atual não suporta Ubuntu 20.04 deste ambiente.

| Estado | Validação | Resultado e critério |
|---|---|---|
| Ran | Baseline backend settings/health/readiness | 25 testes / 4 arquivos aprovados antes da implementação |
| Ran | Baseline frontend | 43 testes aprovados antes da implementação |
| Ran | Baseline guard stateful | 6 testes aprovados antes da implementação |
| Ran | `npm run test:feature-health:core` | 84/84 em 8 arquivos: estados, auth, tenant, redaction, expiração, falhas/recuperação, hooks reais de persistência |
| Ran | Regressão settings/health/readiness/audit publisher/normalizer | 174/174 em 6 arquivos; transporte e comportamento de auditoria preservados |
| Ran | `node --test scripts/lib/feature-flags-guard.test.mjs scripts/lib/stateful-upgrade-guard.test.mjs` | 21/21, execução independente; scripts reais com Docker simulado, ordem antes de mutações e estágio de empacotamento |
| Ran | `npm run test:feature-health:web` | Chromium desktop 1440/mobile 360: seis estados, 503/retry, expiração sem polling/reload; temas claro/escuro validados pela implementação |
| Ran | Browser independente de troca de tenant | auth.enterTenantManagement real + APIs simuladas; dados antigos limpos durante pending, token delegado e novo tenant corretos |
| Ran | ESLint arquivos novos/alterados `--max-warnings 0` | 24 arquivos, zero erros/avisos na rodada final |
| Ran | Builds shared/backend/frontend | Todos aprovados; frontend inclui vue-tsc, backend tsc. Vite reporta chunk vendor-ui acima de 950 kB; sem alteração de bundling nesta frente |
| Ran | Shell syntax e `git diff --check` | Aprovados |
| Ran | Revisão independente | Frontend PASS; backend/shared PASS_WITH_WARNINGS; guard revisado pelo orquestrador, que não o implementou |
| Skipped | Terminal PTY/área útil | Sem mudanças de transporte, resize ou área do terminal; hooks de falha somente registram timestamp e preservam retorno/rejeição |
| Skipped | MySQL/Redis reais, providers reais, carga e release completa | Metadados/infra com doubles; não alegar validação de produção ou desempenho |
| Manual | Homologação, CI em SHA publicado e VPS | Pendentes; sem commit, PR ou deploy |

Primeira rodada integrada encontrou validade nativa incorreta (77 passaram/1 falhou); correção e teste adversarial permaneceram. Lint inicial encontrou tipagem/assinaturas a ajustar; rodada final zero warnings, sem desativar regras.

## Evidências e reprodução

Logs: `/tmp/na0082-core-tests.log`, `/tmp/na0082-regression-tests.log`, `/tmp/na0082-deploy-tests.log`, `/tmp/na0082-final-lint.log`, `/tmp/na0082-backend-build.log`, `/tmp/na0082-frontend-build.log`, `/tmp/na0082-final-browser.log`. Capturas finais: `/tmp/na0082-final-browser/`. Revisão: `/tmp/na0082-review-all.log`; tenant independente: `/tmp/na0082-independent-tenant/`.

Para browser, iniciar Vite local e definir FRONTEND_BASE. Nesta execução foi usado `http://127.0.0.1:5182` e `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`. Servidor temporário encerrado após testes. Artefatos temporários não são CI publicado e não contêm dados reais.

## Limitações verificadas

- Metadados e probe do diretório não certificam cada arquivo/playback.
- Nativo em HA permanece desconhecido; registry não descobre gateways nunca registrados.
- Falhas passivas são memória por processo/instalação, sem conteúdo/tenant; podem alertar conservadoramente outros tenants. Recuperação exige gravação posterior.
- Guard exige Python 3.6+ e Compose com JSON. Scripts externos/Docker manual não recebem proteção automaticamente; serializar deploys.
- Na execução dos testes, o checkout original continha somente os registros NA-0081 não versionados. Em 30/10/2026, os documentos foram disponibilizados também em `/home/jeferson/projects/NodeAccess-current/docs/`, conforme pedido do usuário. O código e o ambiente testado continuam em `/tmp/nodeaccess-NA-0082`.
