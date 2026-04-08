Tarefa: Snippets e Vault Secrets no NodeAccess.

Leia:
1. `ai/context.md`
2. `ai/patterns.md`
3. `ai/modules/terminal-macros.md`
4. `docs/PRD-snippets-lite.md`
5. `docs/PRD-vault-secrets-lite.md`

Arquivos provaveis:
- `apps/backend/src/modules/secrets/*`
- `apps/backend/src/modules/ssh/ssh.gateway.ts`
- `apps/backend/src/modules/ssh/ssh.session.ts`
- `apps/frontend/src/views/SnippetsView.vue`
- `apps/frontend/src/components/SnippetsPanel.vue`
- `apps/frontend/src/views/SecretsView.vue`
- `apps/frontend/src/services/snippet*.ts`
- `apps/frontend/src/services/secret.service.ts`
- `packages/shared/src/schemas/secret.schema.ts`

Regras:
- snippet nao armazena segredo em texto claro
- usar referencia `{{secret:alias}}`
- valor de secret nao deve voltar ao frontend como payload comum
- auditoria e logs devem mascarar valor sensivel
- redaction em memoria deve ter TTL curto e nao persistir valor

Validacao comum:
- `npx prisma validate --schema apps/backend/prisma/schema.prisma`, se tocar schema
- `npm run build -w packages/shared`, se tocar shared
- `npm run typecheck -w apps/backend`
- `npm run typecheck -w apps/frontend`
