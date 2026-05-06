Tarefa: Bastions / Jump servers no NodeAccess.

Leia:
1. `ai/context.md`
2. `ai/patterns.md`
3. `ai/modules/ssh.md`
4. `docs/PRD-bastions-lite.md`

Arquivos provaveis:
- `apps/backend/src/modules/bastions/*`
- `apps/backend/src/modules/hosts/*`
- `apps/backend/src/modules/ssh/*`
- `apps/backend/prisma/schema.prisma`
- `apps/frontend/src/views/admin/BastionsView.vue`
- `apps/frontend/src/views/HostsView.vue`
- `packages/shared/src/schemas/bastion.schema.ts`
- `packages/shared/src/schemas/host.schema.ts`

Regras:
- `Host.bastionId` sobrescreve bastion herdado do grupo
- backend e fonte de verdade para bastion efetivo
- PEM cadastrada no sistema deve ser preferida ao fluxo legado de colar PEM
- host key trust do host final nao deve ser enfraquecido
- trust-store dedicado de bastion e fase futura de seguranca

Validacao comum:
- `npx prisma validate --schema apps/backend/prisma/schema.prisma`, se tocar schema
- `npm run build -w packages/shared`, se tocar shared
- `npm run typecheck -w apps/backend`
- `npm run typecheck -w apps/frontend`
