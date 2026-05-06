# Versionamento de banco e estratégia de deploy seguro

Este documento descreve como gerenciar mudanças de schema do banco de dados sem interromper clientes em produção, e o fluxo completo de atualização do NodeAccess.

---

## O problema: a janela perigosa

Todo deploy que envolve mudança de schema cria uma janela de risco onde banco e código estão fora de sincronia.

```
         DEPLOY INGÊNUO (perigoso)
         ─────────────────────────────────────────────────────────

  Banco    ──── schema v1 ──────────────────── schema v2 ────────▶
                                   ▲
                             migration aplicada
                                   │
  Código   ──── código v1 ─────────┼──────────── código v2 ───────▶
                                   │
                              ❌ janela de risco:
                              banco já mudou,
                              código v1 ainda rodando
                              → crashes / erros 500
```

A solução é garantir que **migrations nunca quebrem o código da versão anterior**.

---

## Técnica: Expand-Contract

Mudanças destrutivas (rename, drop, NOT NULL) são divididas em duas fases separadas por um deploy.

```
         EXPAND-CONTRACT (seguro)
         ─────────────────────────────────────────────────────────────────────

  Banco    ── schema v1 ──┬─── schema v1 + v2 ────────┬─── schema v2 ────────▶
                          │   (colunas coexistem)      │   (v1 removida)
                      migration                    migration
                       Expand                      Contract
                          │                            │
  Código   ── código v1 ──┼──────── código v2 ─────────┼──── código v2 ────────▶
                          │        (usa ambas)          │    (só usa v2)
                       deploy N                     deploy N+1

                       ✅ Código v1 continua         ✅ Código v2 já
                          funcionando durante            não depende de v1
                          a transição
```

### As três fases na prática

```
┌─────────────────────────────────────────────────────────────────────┐
│ FASE 1 — EXPAND  (migration do release N)                           │
│                                                                     │
│  • Adiciona coluna nova (nullable ou com default)                   │
│  • NÃO remove nem renomeia nada                                     │
│  • Código antigo continua funcionando                               │
│  • Código novo escreve nas duas colunas (old + new)                 │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ FASE 2 — MIGRATE DATA  (pode ser no mesmo release ou script avulso) │
│                                                                     │
│  • Backfill: copia dados de old para new                            │
│  • Pode rodar como script, worker ou migration separada             │
│  • Verificar que 100% dos registros estão preenchidos               │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ FASE 3 — CONTRACT  (migration do release N+1)                       │
│                                                                     │
│  • Remove a coluna antiga                                           │
│  • Adiciona constraints, NOT NULL, índices definitivos              │
│  • Código novo já depende apenas da coluna nova                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Exemplo: renomear `host_ip` → `host_address`

**Release N — migration Expand:**

```sql
-- Adiciona nova coluna (nullable, sem constraint)
ALTER TABLE hosts ADD COLUMN host_address VARCHAR(255);

-- Backfill imediato (safe em tabelas pequenas)
UPDATE hosts SET host_address = host_ip WHERE host_address IS NULL;
```

**Código v2** — escreve nas duas colunas, lê da nova:

```typescript
// Escreve em ambas durante a transição
await db.hosts.update({ host_ip: value, host_address: value })

// Lê sempre da nova
const addr = host.host_address ?? host.host_ip
```

**Release N+1 — migration Contract:**

```sql
-- Agora é seguro remover a antiga
ALTER TABLE hosts DROP COLUMN host_ip;

-- Adiciona constraint que não era possível antes
ALTER TABLE hosts MODIFY host_address VARCHAR(255) NOT NULL;
```

---

## Matriz de segurança de operações DDL

| Operação | Seguro? | Ação recomendada |
|---|---|---|
| `ADD COLUMN NULL` | ✅ Sempre | Deploy direto |
| `ADD COLUMN NOT NULL DEFAULT x` | ✅ Sempre | Deploy direto |
| `ADD COLUMN NOT NULL` sem default | ❌ Quebra | Adicionar nullable primeiro (Expand) |
| `DROP COLUMN` | ❌ Quebra | Só no release seguinte (Contract) |
| `RENAME COLUMN` | ❌ Quebra | Expand-Contract obrigatório |
| `RENAME TABLE` | ❌ Quebra | Expand-Contract + view de compatibilidade |
| `ADD INDEX` | ✅ Online no MySQL 8 | Deploy direto; monitorar lock em tabelas >10M rows |
| `ADD UNIQUE INDEX` | ⚠️ Valide duplicatas antes | Limpar dados antes da migration |
| `ADD FOREIGN KEY` | ⚠️ Valide integridade antes | Verificar registros órfãos antes |
| `ALTER COLUMN` (ampliar tipo) | ✅ ex: VARCHAR(50→255) | Deploy direto |
| `ALTER COLUMN` (restringir tipo) | ❌ | Expand-Contract |
| `CREATE TABLE` | ✅ Sempre | Deploy direto |
| `DROP TABLE` | ❌ Quebra | Só após remover todas as referências do código |

---

## Fluxo completo de deploy no cliente

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    FLUXO DE ATUALIZAÇÃO DO NODEACCESS                    │
└──────────────────────────────────────────────────────────────────────────┘

  DESENVOLVEDOR / CI                         CLIENTE (servidor)
  ──────────────────                         ──────────────────

  1. Escreve migration                       
     (Prisma schema + SQL)                   
          │                                  
          ▼                                  
  2. Revisa migration                        
     (checklist abaixo)                      
          │                                  
          ▼                                  
  3. Build das imagens                       
     docker build --target prod              
          │                                  
          ▼                                  
  4. Tag com versão                          
     :1.5.0 + :<git-sha>                     
          │                                  
          ▼                                  
  5. Push para registro                      
     Nexus / Harbor                          
          │                                  
          └──────────────────────────────────▶  6. Backup do banco
                                                   mysqldump > backup-pre-1.5.0.sql
                                                        │
                                                        ▼
                                                 7. Pull das imagens novas
                                                    docker compose pull
                                                        │
                                                        ▼
                                                 8. Migrations aplicadas
                                                    (automático via entrypoint)
                                                    prisma migrate deploy
                                                        │
                                                 ┌──────┴──────┐
                                                 │             │
                                              Sucesso       Falha
                                                 │             │
                                                 ▼             ▼
                                          9. Sobe containers  Restaurar backup
                                             novos            + voltar imagem
                                             up -d            anterior
                                                 │
                                                 ▼
                                         10. Verificar saúde
                                             docker compose ps
                                             curl /api/v1/health
                                                 │
                                          ┌──────┴──────┐
                                          │             │
                                       Saudável      Com erro
                                          │             │
                                          ▼             ▼
                                    ✅ Deploy        Rollback
                                    concluído        (ver abaixo)
```

---

## Automatizando migrations via entrypoint

Para garantir que migrations rodam **antes** do servidor subir, adicione ao Dockerfile de produção:

**`docker/entrypoint.sh`** (criar este arquivo):

```bash
#!/bin/sh
set -e

echo "[nodeaccess] Verificando migrations pendentes..."
npx prisma migrate status

echo "[nodeaccess] Aplicando migrations..."
npx prisma migrate deploy

echo "[nodeaccess] Iniciando servidor..."
exec "$@"
```

**`docker/backend.Dockerfile`** — target prod (atualizar):

```dockerfile
FROM node:20-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/backend/dist           ./dist
COPY --from=builder /app/apps/backend/package*.json  ./
COPY --from=builder /app/node_modules                ./node_modules
COPY --from=builder /app/apps/backend/prisma         ./prisma
COPY docker/entrypoint.sh                            ./entrypoint.sh
RUN chmod +x entrypoint.sh
ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "dist/server.js"]
```

Com isso, o fluxo no cliente vira simplesmente:

```bash
docker compose pull && docker compose up -d
```

As migrations são aplicadas automaticamente, na ordem certa, antes de qualquer requisição ser aceita.

---

## Rollback

O MySQL não suporta rollback de DDL via transação. A estratégia é baseada em backup preventivo.

```
┌─────────────────────────────────────────────────────────────────────┐
│ PROCEDIMENTO DE ROLLBACK                                            │
└─────────────────────────────────────────────────────────────────────┘

  ANTES de qualquer deploy:
  ┌─────────────────────────────────────────────────────────────────┐
  │ docker compose exec mysql \                                     │
  │   mysqldump -u root -p${DB_ROOT_PASSWORD} ${DB_NAME} \         │
  │   > backup-pre-$(date +%Y%m%d-%H%M).sql                        │
  └─────────────────────────────────────────────────────────────────┘

  SE o deploy falhar:
  
  1. Parar containers novos
     docker compose down
  
  2. Restaurar banco
     docker compose up -d mysql
     docker compose exec -T mysql \
       mysql -u root -p${DB_ROOT_PASSWORD} ${DB_NAME} < backup-pre-YYYYMMDD-HHMM.sql
  
  3. Voltar para a imagem anterior (ajustar tag no compose)
     image: registro/nodeaccess-backend:1.4.0   ← versão anterior
  
  4. Subir versão anterior
     docker compose up -d
  
  5. Verificar saúde
     docker compose ps
     curl http://localhost:3000/api/v1/health
```

---

## Checklist de revisão de migration (PR)

Antes de aprovar qualquer PR que contenha migration, verificar:

```
[ ] A migration usa Expand se envolve rename ou remoção de coluna?
[ ] Nenhuma coluna foi removida ou renomeada diretamente?
[ ] Colunas NOT NULL novas possuem DEFAULT ou foram preenchidas antes?
[ ] Índices UNIQUE foram precedidos de limpeza de duplicatas?
[ ] Foreign keys foram precedidas de verificação de integridade?
[ ] A migration foi testada localmente com `npm run db:migrate`?
[ ] O status foi verificado com `npx prisma migrate status`?
[ ] O rollback manual (SQL reverso) foi documentado no PR se for alto risco?
[ ] O backup pré-deploy está na checklist do deploy deste release?
```

---

## Controle de versão das imagens

Nunca usar `:latest` como única tag em produção. Usar sempre versão semântica + SHA do commit:

```bash
VERSION=1.5.0
SHA=$(git rev-parse --short HEAD)

docker build -f docker/backend.Dockerfile --target prod \
  -t registro/nodeaccess-backend:${VERSION} \
  -t registro/nodeaccess-backend:${SHA} \
  -t registro/nodeaccess-backend:latest \
  .
```

No `docker-compose.prod.yml` do cliente, fixar a versão:

```yaml
api:
  image: registro/nodeaccess-backend:1.5.0   # ← nunca só :latest
```

Isso garante que:
- O cliente sabe exatamente o que está rodando
- O rollback é feito trocando a tag, sem rebuild
- O histórico de deploys é rastreável pelo registro de imagens

---

## Comandos de referência rápida

```bash
# Verificar migrations pendentes
docker compose exec api npx prisma migrate status

# Aplicar migrations manualmente (sem entrypoint automático)
docker compose exec api npx prisma migrate deploy

# Backup antes do deploy
docker compose exec mysql \
  mysqldump -u root -p${DB_ROOT_PASSWORD} ${DB_NAME} > backup-pre-deploy.sql

# Atualizar cliente (com entrypoint automático configurado)
docker compose pull && docker compose up -d

# Verificar saúde após deploy
docker compose ps
curl http://localhost:3000/api/v1/health

# Rollback de imagem (sem restaurar banco — só se migration foi backward-compatible)
docker compose up -d --no-build   # após editar a tag no compose
```
