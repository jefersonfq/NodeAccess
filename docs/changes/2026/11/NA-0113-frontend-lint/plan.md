---
change_id: NA-0113
title: Sanear lint legado dos arquivos frontend do PR
type: fix
status: in_progress
created_at: 2026-11-03T17:11:23-03:00
base_branch: chore/NA-0093-20261103-sonar-final-validation
base_sha: 47f06b51e693d91f5ed724b7b86e5362af75bc35
branch: fix/NA-0113-20261103-frontend-lint
owner: Codex
planner: Codex
risk: medium
issue: null
---

# NA-0113 — Lint frontend do PR

## Contexto e situação anterior

Após NA-0111, a comparação com master identificou 25 erros frontend preexistentes e warnings nos arquivos já alterados. O usuário autorizou saneá-los sem reduzir as regras.

## Problema e objetivo

Corrigir 25 erros legados e warnings de formatação/tipos nos arquivos frontend já alterados, sem suprimir regras ou alterar intenção dos fluxos.

## Escopo

- Somente arquivos frontend já alterados no PR, listados abaixo, e documentação desta frente.
- Fora: refatoração do produto, exclusões de cobertura, conexão à VPS, PTY real ou instalação.

## Critérios de aceitação

- [x] Lint focal e testes de equivalência/adversariais existentes passam.
- [x] Sem mudança de regra de lint, API, transporte ou layout intencional.
- [x] Testes e evidências registrados sem inferir homologação real.

## Estratégia técnica

Aplicar autofix ESLint somente ao conjunto aprovado. Revisar diferenças de AST JavaScript/Vue quando possível, corrigir promessas/types localmente e executar lint zero, unitários, typecheck e terminal UX.

## Riscos e mitigações

| Risco | Impacto | Mitigação | Parada |
|---|---|---|---|
| Autofix altera estrutura | Regressão visual | Comparar AST normalizada, CSS e capturas reais | Diferença sem explicação |
| Novas linhas de formatação | Queda de diffcoverage | Medir novamente na integração, preservar thresholds | Gate reprovado |

## Matriz de testes e evidências

| Critério | Teste | Ambiente | Evidência | Obrigatório |
|---|---|---|---|---|
| Comportamentos frontend | Vitest frontend | Worktree isolado | test-results.md | Sim |
| Ausência de regressão | Testes existentes do módulo | Worktree isolado | test-results.md | Sim |

## Baseline

SHA `47f06b51e693d91f5ed724b7b86e5362af75bc35`; lacunas de execução identificadas na coleta ampliada da coordenação. Não é requisito impor100% ou inventar segurança comprovada.

## Rollback ou recuperação

Reverter commit de lint. Nenhum schema ou configuração de produção alterado.

## Mudanças de escopo e decisões

Usuário autorizou corrigir lint legado em branches separadas; coordenação atribuiu o subconjunto frontend já alterado no PR.

## Aprovação

- Decisão: GO_WITH_RISKS
- Aprovado por: usuário (tratamento das pendências) e coordenação (lint frontend)
- Aprovado em: 2026-11-03

## Arquivos autorizados

- `apps/frontend/src/components/CommandPalette.vue`
- `apps/frontend/src/components/HostAccessIndicator.vue`
- `apps/frontend/src/components/ImportHostsModal.vue`
- `apps/frontend/src/components/SessionSupervisionPermission.vue`
- `apps/frontend/src/components/TerminalPane.vue`
- `apps/frontend/src/components/TunnelManager.vue`
- `apps/frontend/src/components/diagnostics/DiagnosticRunHistoryPanel.vue`
- `apps/frontend/src/components/platform/TenantLicenseEditor.vue`
- `apps/frontend/src/composables/useTerminal.ts`
- `apps/frontend/src/services/audit-text-patterns.ts`
- `apps/frontend/src/services/avatar-image-processing.ts`
- `apps/frontend/src/services/host-view-preferences.service.ts`
- `apps/frontend/src/services/mobaxterm-import.service.ts`
- `apps/frontend/src/services/pem-key-encryption.ts`
- `apps/frontend/src/services/session-import-detection.service.ts`
- `apps/frontend/src/services/terminal-input-model.service.ts`
- `apps/frontend/src/services/terminal-session-entity-index.service.ts`
- `apps/frontend/src/services/text-boundaries.test.ts`
- `apps/frontend/src/services/text-boundaries.ts`
- `apps/frontend/src/views/DiagnosticRunDetailView.vue`
- `apps/frontend/src/views/ForwardingsView.vue`
- `apps/frontend/src/views/GraphicalSessionView.vue`
- `apps/frontend/src/views/SnippetsView.vue`
- `apps/frontend/src/views/TerminalView.vue`
- `apps/frontend/src/views/admin/DashboardView.vue`
- `apps/frontend/src/views/admin/IntegrationsView.vue`
- `apps/frontend/src/views/admin/McpTokensView.vue`
- `apps/frontend/src/views/admin/ObservabilityView.vue`
- `apps/frontend/src/views/admin/SessionAuditDetailView.vue`
- `apps/frontend/src/views/admin/SettingsView.vue`
- `apps/frontend/src/views/admin/TenantsView.vue`
- `apps/frontend/src/views/auth/LoginView.vue`

## Complemento de revalidação documental

Coordenação autorizou revalidar capítulo terminal pela skill nodeaccess-manual: manual:capture cinco imagens demonstrativas, revisão visual, test:manual e check-reviewed. Texto permanece porque procedimentos não mudaram; atualizar somente hash/data de revisão terminal após evidências e acrescentar registro no OPERATIONS-manual-pilot sem sobrescrever a cópia canônica do usuário.
