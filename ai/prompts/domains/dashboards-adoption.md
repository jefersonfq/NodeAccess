Tarefa: Dashboards, adocao e UX de produtividade no NodeAccess.

Leia:
1. `ai/context.md`
2. `ai/patterns.md`
3. `ai/modules/platform.md`
4. `ai/modules/preferences.md`, se tocar preferencias
5. `docs/PRD-platform-adoption-lite.md`
6. PRD especifico se necessario:
   - pessoal: `docs/PRD-user-dashboard-lite.md`
   - admin: `docs/PRD-admin-adoption-dashboard-lite.md`

Arquivos provaveis:
- `apps/backend/src/modules/dashboard/*`
- `apps/backend/src/modules/user-dashboard/*`
- `apps/frontend/src/views/DashboardView.vue`
- `apps/frontend/src/views/admin/DashboardView.vue`
- `apps/frontend/src/views/admin/DashboardUserView.vue`
- `apps/frontend/src/services/user-preferences.service.ts`
- `apps/frontend/src/services/user-productivity-telemetry.service.ts`

Regras:
- dashboard pessoal nao deve virar BI pesado
- dashboard admin deve separar adocao/operacao de dados sensiveis
- preferencias devem ter backend como fonte de verdade e cache local como resposta imediata
- telemetria nao deve bloquear UI

Validacao comum:
- `npm run build -w packages/shared`, se tocar contratos
- `npm run typecheck -w apps/backend`
- `npm run typecheck -w apps/frontend`
