Tarefa: Auth, identidade, MFA e Google no NodeAccess.

Leia:
1. `ai/context.md`
2. `ai/patterns.md`
3. `ai/modules/auth.md`
4. `docs/PRD-lite.md`

Arquivos provaveis:
- `apps/backend/src/modules/auth/*`
- `apps/backend/src/modules/users/*`
- `apps/backend/src/modules/integrations/*`
- `apps/frontend/src/views/auth/*`
- `apps/frontend/src/views/admin/IntegrationsView.vue`
- `packages/shared/src/schemas/auth*.ts`
- `packages/shared/src/schemas/user*.ts`

Regras:
- TOTP e obrigatorio
- nao expor token, segredo TOTP, hash ou senha
- diferenciar autenticacao de autorizacao
- Google SSO e Google Workspace coexistem, mas com responsabilidades separadas
- usuario desativado nao deve consumir licenca

Validacao comum:
- `npm run build -w packages/shared`, se tocar contratos
- `npm run typecheck -w apps/backend`
- `npm run typecheck -w apps/frontend`
