Tarefa: Auditoria, logs e compliance no NodeAccess.

Leia:
1. `ai/context.md`
2. `ai/patterns.md`
3. `docs/PRD-session-audit-lite.md`, se tocar auditoria SSH
4. `docs/PRD-iso27001-lite.md`, se tocar evidencias/compliance
5. `docs/PRD-map-lite.md`, se precisar escolher PRD complementar

Arquivos provaveis:
- `apps/backend/src/modules/session-audit/*`
- `apps/backend/src/modules/session-audit-policy/*`
- `apps/backend/src/modules/logs/*`
- `apps/backend/src/modules/sessions/*`
- `apps/frontend/src/views/admin/*Audit*`
- `apps/frontend/src/views/admin/*Logs*`
- `packages/shared/src/schemas/*audit*`
- `packages/shared/src/schemas/log.schema.ts`

Regras:
- auditoria nao deve registrar segredo em claro
- logs devem ser uteis para evidencia, mas sem vazar sensiveis
- sessoes stale devem ser encerradas/reparadas para evitar falso ativo
- ISO 27001 e suporte a evidencia, nao certificacao automatica

Validacao comum:
- `npm run build -w packages/shared`, se tocar contratos
- `npm run typecheck -w apps/backend`
- `npm run typecheck -w apps/frontend`
