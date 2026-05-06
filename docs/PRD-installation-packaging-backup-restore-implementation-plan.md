# PRD Installation Packaging Backup Restore Implementation Plan

## Objetivo
Transformar o PRD operacional em backlog tecnico executavel, priorizando:
1. compose e env oficiais de producao
2. scripts operacionais minimos
3. recuperacao administrativa offline
4. backup e restore com validacao

## Leitura de contexto usada
- `README.md`
- `docs/DEPLOY-lite.md`
- `docs/PRD-installation-packaging-backup-restore-lite.md`
- `apps/backend/prisma/schema.prisma`
- `apps/backend/scripts/promote-platform-admin.mjs`
- `apps/backend/src/modules/auth/auth.service.ts`
- `apps/backend/src/modules/users/user.repository.ts`

## Diagnostico Atual

### Base pronta
- Dockerfiles de backend e frontend existem
- compose de desenvolvimento existe
- migrations e seed ja existem
- ha script de promocao para `platform admin`
- o modelo `User` ja suporta:
  - `passwordHash`
  - `mfaSecret`
  - `mfaEnabled`
  - `forcePasswordChange`
  - `isPlatformAdmin`

### Gaps operacionais
- falta `docker-compose.prod.yml` oficial no repo
- falta `.env.example.prod`
- falta validacao automatica de env
- falta script oficial de backup e restore
- falta script de recuperacao de admin com escopo mais amplo que `promote-platform-admin`
- falta runbook operacional unico

## Prioridade Recomendada

### Corte 1. Foundation + admin recovery offline
Entregaveis:
- `docker-compose.prod.yml`
- `.env.example.prod`
- `scripts/install/validate-env.sh`
- `apps/backend/scripts/recover-admin-access.mjs`
- documentacao operacional consolidada

### Corte 2. Backup e restore
Entregaveis:
- `scripts/backup/backup-mysql.sh`
- `scripts/backup/restore-mysql.sh`
- `backup-manifest.json`
- checklist pos-restore

### Corte 3. Release artifact
Entregaveis:
- `scripts/release/build-release.sh`
- pacote versionado com checksums
- fluxo offline com `docker save/load`

### Corte 4. Admin recovery governado na plataforma
Entregaveis:
- endpoint administrativo auditado
- token temporario de recuperacao ou reset assistido
- obrigacao de redefinir senha e recompor MFA

## Backlog Tecnico

## Fase 1. Artefatos operacionais base

### 1.1 `docker-compose.prod.yml`
Objetivo:
- tirar o compose de producao do README e transformar em artefato oficial do repo

Aceite:
- inclui `mysql`, `redis`, `api`, `ssh-gateway`, `frontend`
- usa `env_file`
- tem healthcheck minimo
- usa volumes persistentes nomeados

Arquivos provaveis:
- `docker-compose.prod.yml`
- `README.md`
- `docs/DEPLOY-lite.md`

### 1.2 `.env.example.prod`
Objetivo:
- consolidar variaveis obrigatorias e observacoes operacionais criticas

Aceite:
- distingue obrigatorio x opcional
- explica `PEM_ENCRYPTION_KEY`
- inclui URLs publicas e variaveis de banco/cache

Arquivos provaveis:
- `.env.example.prod`
- `README.md`
- `docs/DEPLOY-lite.md`

### 1.3 `validate-env`
Objetivo:
- falhar cedo quando faltar configuracao critica

Aceite:
- valida presenca de variaveis obrigatorias
- valida formato basico de `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `PEM_ENCRYPTION_KEY`
- imprime resumo objetivo
- retorna exit code diferente de zero em erro

Arquivos provaveis:
- `scripts/install/validate-env.sh`

## Fase 2. Recuperacao administrativa offline

### 2.1 Script `recover-admin-access.mjs`
Objetivo:
- permitir recuperar acesso sem editar banco manualmente

Decisao de produto para o primeiro corte:
- fazer apenas recuperacao offline por CLI
- nao criar UI de bypass no primeiro momento
- toda operacao deve ser explicita, com flags e confirmacao

### Interface CLI recomendada

#### Promover admin existente
```bash
node apps/backend/scripts/recover-admin-access.mjs promote \
  --email admin@empresa.com
```

#### Gerar senha temporaria para usuario existente
```bash
node apps/backend/scripts/recover-admin-access.mjs reset-password \
  --email admin@empresa.com \
  --force-change
```

#### Limpar MFA com confirmacao explicita
```bash
node apps/backend/scripts/recover-admin-access.mjs clear-mfa \
  --email admin@empresa.com \
  --yes
```

#### Fluxo combinado de emergencia
```bash
node apps/backend/scripts/recover-admin-access.mjs emergency \
  --email admin@empresa.com \
  --promote-platform-admin \
  --reset-password \
  --clear-mfa \
  --force-change \
  --yes
```

### Comportamento esperado

#### `promote`
- encontra usuario por email
- marca `isPlatformAdmin=true`
- opcionalmente garante `role=ADMIN`
- nao altera senha

#### `reset-password`
- gera senha temporaria forte
- salva novo `passwordHash`
- marca `forcePasswordChange=true`
- reseta `failedLoginAttempts`
- limpa `lockedUntil`
- imprime a senha somente no stdout final

#### `clear-mfa`
- limpa `mfaSecret`
- marca `mfaEnabled=false`
- exige `--yes`

#### `emergency`
- executa operacoes combinadas
- imprime resumo final:
  - usuario afetado
  - tenant
  - senha temporaria gerada
  - se MFA foi limpo
  - se virou platform admin

### Guardrails obrigatorios
- recusar rodar sem `DATABASE_URL`
- recusar rodar se usuario nao existir
- exigir `--yes` para limpar MFA
- registrar `AdminLog` quando houver ator conhecido ou usar log tecnico dedicado
- nunca imprimir hash
- se gerar senha temporaria, alertar que ela deve ser trocada no primeiro login

### Observacao tecnica importante
Hoje `UserRepository.updatePassword()` seta `forcePasswordChange=false`.
Para o script de recuperacao, o fluxo deve:
- ou usar update direto no Prisma
- ou ajustar repositorio para suportar `updatePassword(id, hash, { forcePasswordChange: true })`

### Arquivos provaveis
- `apps/backend/scripts/recover-admin-access.mjs`
- `apps/backend/scripts/promote-platform-admin.mjs`
- `apps/backend/package.json`
- `apps/backend/src/modules/users/user.repository.ts`

## Fase 3. Backup e restore

### 3.1 `backup-mysql.sh`
Objetivo:
- gerar dump consistente com metadata simples

Aceite:
- gera `.sql.gz`
- gera `backup-manifest.json`
- gera checksum sha256
- inclui timestamp e versao

### 3.2 `restore-mysql.sh`
Objetivo:
- restaurar dump de forma repetivel e com confirmacao

Aceite:
- exige arquivo existente
- exige `--yes` para ambiente nao vazio
- valida manifest quando presente
- executa validacao pos-restore

### Validacao pos-restore minima
- banco sobe
- migrations aplicam sem erro
- login admin funciona
- listagem de hosts funciona
- decrypt de PEM/secret continua funcional
- terminal abre sessao de teste

## Fase 4. Release artifact

### 4.1 `build-release.sh`
Objetivo:
- gerar pacote operacional unico

Conteudo minimo:
- `docker-compose.prod.yml`
- `.env.example.prod`
- scripts operacionais
- `VERSION`
- `checksums.txt`
- instrucoes curtas

## Fase 5. Recuperacao governada na plataforma

### Direcao inicial
- um `platform admin` autenticado inicia recuperacao de outro admin
- sistema gera token temporario de uso unico
- usuario alvo redefine senha e recompõe MFA
- toda a trilha fica em `AdminLog`

### Nao fazer no primeiro corte
- autoatendimento irrestrito de bypass de MFA
- reset silencioso sem log
- fluxo dependente de email se o tenant nao tiver email configurado

## Ordem Recomendada de Execucao
1. `docker-compose.prod.yml`
2. `.env.example.prod`
3. `validate-env.sh`
4. `recover-admin-access.mjs`
5. `backup-mysql.sh`
6. `restore-mysql.sh`
7. consolidacao da documentacao

## Riscos e Trade-offs
- reset offline de MFA e necessario operacionalmente, mas precisa de trilha de auditoria forte
- gerar senha temporaria em CLI e pragmatico, mas exige cuidado para nao vazar em historico de shell ou captura de terminal
- manter a primeira versao em shell/Node simples reduz risco e acelera entrega

## Proximo Passo Imediato
Implementar o Corte 1 completo:
1. `docker-compose.prod.yml`
2. `.env.example.prod`
3. `scripts/install/validate-env.sh`
4. `apps/backend/scripts/recover-admin-access.mjs`
