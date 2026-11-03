# Revisão de lint da integração

Execução inicial sobre os 80 arquivos TypeScript/Vue staged, com a configuração existente e `--max-warnings 0`. Resultado FAIL: 81 erros e 1.619 avisos. Esta tabela é o retrato inicial, não uma alegação de que todos são novos ou continuam presentes após correções. O script padrão lint:changed compara commits; por isso a execução pré-commit usou a lista staged explicitamente.

Erros em testes novos de MCP e DOM do proxy foram corrigidos em NA-0105 e NA-0097, com testes e lint focal repetidos. Helpers novos do frontend são tratados na NA-0111. Comparação do restante com origin/master em andamento. Nenhuma regra desativada ou limiar reduzido. A aprovação do CI exige nova execução sobre o SHA publicado.

| Arquivo | Erros iniciais | Avisos iniciais |
|---|---:|---:|
| `apps/backend/src/modules/agents/agent.routes.ts` | 2 | 0 |
| `apps/backend/src/modules/ai-ssh-actions/ai-script-artifact.repository.test.ts` | 3 | 0 |
| `apps/backend/src/modules/ai-ssh-actions/ai-script-artifact.service.test.ts` | 6 | 0 |
| `apps/backend/src/modules/ai-ssh-actions/ai-script-upload.real.test.ts` | 2 | 0 |
| `apps/backend/src/modules/ai-ssh-actions/ai-script-upload.test.ts` | 4 | 0 |
| `apps/backend/src/modules/mcp/mcp-interactive-ssh.service.test.ts` | 23 | 0 |
| `apps/backend/src/modules/native-ssh-gateway/native-ssh-gateway.routes.ts` | 1 | 1 |
| `apps/backend/src/modules/shared-sessions/shared-session.ws-routes.ts` | 1 | 0 |
| `apps/backend/src/modules/users/user.service.ts` | 7 | 0 |
| `apps/backend/src/modules/web-access/web-access.service.test.ts` | 3 | 0 |
| `apps/frontend/src/components/CommandPalette.vue` | 6 | 111 |
| `apps/frontend/src/components/SessionSupervisionPermission.vue` | 0 | 25 |
| `apps/frontend/src/components/TunnelManager.vue` | 2 | 117 |
| `apps/frontend/src/components/diagnostics/DiagnosticRunHistoryPanel.vue` | 0 | 33 |
| `apps/frontend/src/components/platform/TenantLicenseEditor.vue` | 0 | 200 |
| `apps/frontend/src/services/audit-text-patterns.ts` | 1 | 3 |
| `apps/frontend/src/services/avatar-image-processing.ts` | 0 | 6 |
| `apps/frontend/src/services/host-view-preferences.service.ts` | 1 | 13 |
| `apps/frontend/src/services/terminal-input-model.service.ts` | 3 | 7 |
| `apps/frontend/src/services/terminal-session-entity-index.service.ts` | 3 | 4 |
| `apps/frontend/src/services/text-boundaries.ts` | 3 | 0 |
| `apps/frontend/src/views/DiagnosticRunDetailView.vue` | 2 | 617 |
| `apps/frontend/src/views/admin/DashboardView.vue` | 8 | 400 |
| `apps/frontend/src/views/admin/IntegrationsView.vue` | 0 | 3 |
| `apps/frontend/src/views/admin/McpTokensView.vue` | 0 | 6 |
| `apps/frontend/src/views/admin/ObservabilityView.vue` | 0 | 2 |
| `apps/frontend/src/views/admin/SettingsView.vue` | 0 | 71 |
