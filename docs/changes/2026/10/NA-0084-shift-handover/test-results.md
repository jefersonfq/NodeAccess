# NA-0084 — Evidências de validação

Estado: evidência histórica do corte 3A anterior à evolução do quadro gerencial. LOCAL_WIP; estes resultados não homologam as alterações posteriores. A evolução terá evidência própria em evolution-test-results.md.
Data: 2026-10-30T12:07:20-03:00. Base/HEAD: `f4a44b4b7ae87a8f688b1246d9e52a31f9a104bc`.
Checkout testado: `/tmp/nodeaccess-NA-0084`, branch `feature/NA-0084-20261030-shift-handover`.
Fingerprint SHA256 de 51 arquivos alterados/novos fora de docs/ e README.md: `c2bdde8f9d4a5350e48ec74c6123b44811568b54846e425f5bd1bd2f020f67b6` (nome + NUL + conteúdo + NUL, ordenados). Não é um commit.

## Validações executadas

| Validação | Resultado | Evidência local |
|---|---|---|
| `npm run test:handover:core` | PASS, 86 testes em 7 arquivos | `/tmp/na0084-core-final.log` |
| `npm run test:handover:web:lab` | PASS_WITH_WARNINGS, 14 cenários, 26 chamadas reais no browser, 8 capturas | `evidence/lab-report.json` |
| Revisão independente | PASS_WITH_WARNINGS, sem bloqueios; 13 cenários API, 51 testes e 6 verificações finais do registro de notificações | `evidence/independent-report.json`; `/tmp/na0084-independent-unit-final.log`; `/tmp/na0084-independent-registry-final.log` |
| ESLint dos 28 arquivos alterados de aplicação/testes | PASS | `/tmp/na0084-lint-final.log` |
| Builds shared, backend e frontend | PASS; Vite informa chunks grandes | `/tmp/na0084-root-backend-build.log`; `/tmp/na0084-root-frontend-build.log` |
| `npm run test:manual` | PASS, 2 testes Node + 18 Vitest | `/tmp/na0084-manual-tests-final.log` |
| `npm run manual:capture` e revisão final | PASS, 6 capítulos; teclado/mobile, erro/retry, versão dev, retorno sem reconexão | `evidence/manual-review.json`; `/tmp/na0084-manual-capture-final.log` |
| `npm run manual:check-reviewed` | PASS, 6 capítulos | `/tmp/na0084-manual-reviewed.log` |
| `npm run test:terminal-experience:web` | PASS, regressão completa após alteração no layout | `evidence/terminal-experience.json` |
| `git diff --check` | PASS | Reexecutado no fechamento |

O campo changeId NA-0014 no relatório da suíte terminal é legado do harness reutilizado; esta execução ocorreu no checkout NA-0084. Não representa uma execução antiga.

## O que foi simulado e o que foi real

MySQL 8.4 e Redis descartáveis no WSL; schema anterior e migração SQL aditiva real; Prisma, transações, HTTP, JWT e ACL reais. Dois contextos de browser, Carlos e Marina, usam APIs reais do novo fluxo. Shell externo ao fluxo e login possuem fixtures. Testados retries concorrentes, leitura sem aceite, concorrência de aceite, falha SQL na notificação com rollback de estado/evento, usuário desabilitado, isolamento de tenant, revogação de acesso e evidências de auditoria. Cenário de erro 503 no formulário confirma preservação dos campos antes do retry real. Laboratório removido ao terminar.

Capturas finais aguardam carregamento e notificações transitórias terminarem. Revisão visual de desktop/mobile confirmou responsável, destinatário, resultado, histórico e ausência de overflow; ver [roteiro](ux-walkthrough.md).

## Correções durante validação

Índice SQL encurtado para limite MySQL; comparação de revisão rejeita revisão futura; respostas antigas do frontend descartadas ao trocar contexto; busca de hosts com falha local preserva formulário; registro genérico de notificações rejeita origens desconhecidas e propriedades de prototype. Ajustados textos no passado, datas PT-BR, hierarquia mobile e espera das capturas. Trigger de falha do laboratório usa cliente MySQL porque o protocolo preparado não aceita esse DDL. Harness do manual atualizado de 5 para 6 capítulos e versão dev; os testes foram reexecutados após as correções.

## Limites e próximos gates

Não executado bootstrap completo com login/senha/MFA nem cadeia histórica integral `prisma migrate deploy`: migração nova foi aplicada sobre schema anterior com dados sintéticos preservados. Teste PTY real não se aplica, pois não houve mudança de transporte/resize SSH. Não houve VPS, dados reais, homologação humana, commit, push, PR, merge ou deploy. Logs em /tmp são transitórios; relatórios e capturas desta pasta são a evidência persistida.

Histórico contém eventos/revisões/motivos/resultados, não snapshots completos de cada edição. Host removido torna o conteúdo inacessível. Listagem usa ordem recente; não existe escalonamento automático por prioridade. Contagem autorizada de não lidas pode varrer históricos sem acesso. Chat, tarefas gerais, agregação de turno 3B e integração Jira estão fora do corte; ticket é apenas link validado.

Próximo gate: homologação humana do [roteiro entre usuários](ux-walkthrough.md), seguida de preparação/publicação autorizada e validação de migração/backup no ambiente de destino.
