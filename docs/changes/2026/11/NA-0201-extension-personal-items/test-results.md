# NA-0201 — Evidências locais

Base/HEAD sem novo commit: `9d2fc71768a0e7aee34a6495e4ec11eceb338076`. Testes abaixo exercitam o working tree da branch `feature/NA-0201-20261124-extension-personal-items`, não o checkout master limpo. Data: 2026-11-24, America/Sao_Paulo. Estado global: BLOCKED por Sonar, não homologado.

| Verificação | Resultado real | Evidência/limite |
|---|---|---|
| Baseline extensão, Secrets, PEM | Ran: 147 PASS, 5 opt-in skipped | Antes das alterações |
| Regressão extensão, vault-security, Secrets, PEM, shared | Ran: 455 PASS, 56 opt-in skipped | MySQL opt-in executado separadamente; SSH real não afetado |
| MySQL/Redis descartáveis | Ran: 49/49 PASS | `.tmp/NA-0178/mysql-1795551166/execution.json`; cleanup true, fingerprint início/fim `33cdb6b02dd2cde51a9acdd80d0536f59725c15c003515adffe57c4972bc54eb`, fontes estáveis |
| Chromium real da extensão | Ran: 44 checks PASS | `.tmp/NA-0201/browser/result.json`; portal simulado, backend coberto separadamente |
| Correção HTTP item revogado/removido | Ran: 56 testes PASS | Rotas, cliente e popup; execução após a rodada MySQL estável |
| Typecheck | Ran: backend e extensão PASS | Contratos shared compilados |
| ESLint | Ran: `LINT_INCLUDE_WORKTREE=true npm run lint:changed` PASS | Inclui arquivos novos; primeira execução sem flag selecionou zero arquivos e não foi usada como aprovação |
| Security scan | Ran: PASS | `.tmp/NA-0201/security/scan-summary.json`: gitleaks 42 fixtures revisadas/0 novas; Semgrep 0 achados/0 erros, 981 alvos |
| Manual unitário | Ran: 2 Node +18 Vitest PASS | Captura/editorial registrados em OPERATIONS-manual-pilot |
| Capturas do manual | Ran: PASS | Cinco capítulos, 60 estados de compartilhamento, dois ciclos de tenant; cinco capturas inspecionadas e fontes E3 mapeadas em Hosts |
| Revisão editorial | Ran: `manual:check-reviewed` 5/5 PASS | Hash recalculado após validação, capturas e revisão |
| Governança documental | Ran: PASS | validatePlan + validateImplementationRecord; commit/PR não solicitados |
| Sonar | Ran: BLOCKED, exit 1 na pré-validação | Ambos tokens ausentes; nenhuma análise ou cobertura diferencial aprovada |
| Revisão independente | Ran: PASS estático após correções | Revisor separado inspecionou diff e relatório MySQL; não reexecutou suites |
| Homologação E3/Windows Hello | Manual: pendente | Não inferida dos testes |

## Cobertura dos critérios

Contratos estritos recusam ownership/tenant/escopo forjados e payload inválido. Testes de serviço/SQL impedem editar item compartilhado, alheio, de outro tenant ou revogado. DPoP cobre POST, replay, ausência de origem, token expirado e dispositivo revogado. MySQL real comprova criação, edição sem trocar ciphertext, rotação, importação, auditoria sem valores e rollback de escrita/auditoria na mesma transação. Teste unitário do adapter exige propagação de falha da auditoria.

Cliente e popup cobrem criação, metadados, rotação explícita, gerador, PEM com/sem passphrase, envio duplicado, expiração, falha, descarte e leitura concorrente de arquivo. Chromium cobre campos reais, arquivo, lista, teclado, layout e ausência de material submetido em storage. Nenhum conteúdo de teste é credencial operacional.

## Diagnósticos e recuperação

Falhas iniciais corrigidas sem reduzir gates: acesso ao socket Docker pelo grupo existente apenas no processo; PATH herdado com diretórios privados de root; engine Prisma gerado como root (usada cópia instalada legível por jeferson); artefatos antigos de navegador sem permissão (usado diretório novo NA-0201). Harness MySQL ganhou reporter textual para mostrar falhas de beforeAll omitidas no JSON. Execução anterior MySQL passou com fontes alteradas durante a rodada; substituída pela rodada estável acima.

Nenhuma mudança de baseline Sonar, exclusão de fonte/regra ou redução de threshold. Sem commit/publicação/deploy. Evidências privadas ficam em `.tmp`, sem segredos no registro versionado.
