<div align="center">

# 🖥️ NodeAccess

**Plataforma web de acesso SSH via navegador**

Centraliza conexões, gerencia credenciais, audita sessões e suporta bastion host —
sem precisar de cliente SSH no dispositivo do usuário.

![Node.js](https://img.shields.io/badge/Node.js-20_LTS-339933?logo=node.js&logoColor=white)
![Vue](https://img.shields.io/badge/Vue-3-4FC08D?logo=vue.js&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-8.0-4479A1?logo=mysql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-4-000000?logo=fastify&logoColor=white)

</div>

---

## ✨ Funcionalidades

- 🔐 **Autenticação segura** — JWT, TOTP/MFA e SSO Google
- 🖥️ **Terminal SSH no browser** — powered by xterm.js, sem plugin
- 🏰 **Bastion host** — acesso a redes privadas via jump server
- 🔑 **Gestão de credenciais** — chaves PEM e segredos cifrados com AES-256-GCM
- 📋 **Auditoria de sessões** — gravação, replay e análise com IA
- 👥 **Multi-tenant** — isolamento por organização com controle de licença
- 🛡️ **ACL de inventário** — administração por pasta, herança automática, importação governada e movimentação em massa com rollback
- 📡 **SSH Agent** — relay para conectividade sem exposição direta
- 🔁 **Alta disponibilidade** — topologia active/passive com gates, witness,
  replicação de MySQL/Redis/arquivos, journal e feedback de transferência da VIP
- 🤖 **MCP (Model Context Protocol)** — integração com agentes de IA
- 🎫 **Jira no atendimento SSH** — OAuth/API token e ticket opcional ou obrigatório antes da conexão
  - escopo por tenant, usuário, grupo ou pasta corporativa;
  - atendimento persistente, refresh OAuth, capabilities e outbox idempotente;
  - comentários, link/anexo de auditoria, transição e break-glass auditado.

---

## 🗂️ Índice

- [Pré-requisitos](#-pré-requisitos)
- [Opção A — Código-fonte (dev)](#-opção-a--código-fonte-desenvolvimento)
- [Opção B — Imagem do registro](#-opção-b--imagem-do-registro-nexus--harbor)
- [Operação rápida](#-operação-rápida)
- [Variáveis de ambiente](#-variáveis-de-ambiente)
- [Build e publicação das imagens](#-build-e-publicação-das-imagens)
- [Estrutura do projeto](#-estrutura-do-projeto)
- [Scripts úteis](#-scripts-úteis)

---

## 📋 Pré-requisitos

| Ferramenta | Versão | Observação |
|---|---|---|
| 🟢 Node.js | **20 LTS** | Necessário apenas para desenvolvimento local |
| 🐳 Docker + Compose | **24+** | Obrigatório para banco, cache e imagens |
| 🐬 MySQL | **8.0** | Pode ser via Docker |
| ⚡ Redis | **7** | Pode ser via Docker |

Validacao rapida no host:

```bash
node -v
npm -v
docker -v
docker compose version
```

Se `npm` nao existir, a Opção A nao vai funcionar nesse host.

Instalacao rapida de Node.js 20 em Linux:

RHEL / Rocky / Alma / CentOS:

```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs
```

Se o host ainda usar `yum`:

```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
yum install -y nodejs
```

Ubuntu / Debian:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
```

---

## 🅰️ Opção A — Código-fonte (desenvolvimento)

> Use esta opção para contribuir com o projeto ou rodar em ambiente de desenvolvimento local.
> Exige `Node.js 20 LTS` e `npm` instalados no host antes do `npm install`.

### Passo 1 — Clone e instale as dependências

```bash
git clone https://<seu-bitbucket>/nodeaccess.git
cd nodeaccess
node -v
npm -v
npm install
```

### Passo 2 — Configure o ambiente

```bash
cp .env.example .env
```

Edite `.env` com as variáveis obrigatórias. Para gerar os secrets de segurança:

```bash
# Gera JWT_SECRET e PEM_ENCRYPTION_KEY (execute uma vez para cada)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> ⚠️ **Nunca versione o arquivo `.env` no repositório.**

### Passo 3 — Suba o banco e o cache

```bash
docker compose up -d mysql redis
```

Aguarde os healthchecks passarem antes de continuar:

```bash
docker compose ps   # ambos devem exibir "(healthy)"
```

### Passo 4 — Aplique as migrations e o seed inicial

```bash
npm run db:deploy -w apps/backend
npm run db:seed   -w apps/backend
```

### Passo 5 — Inicie o projeto

```bash
npm run dev
```

Todos os serviços sobem automaticamente:

| Serviço | Endereço |
|---|---|
| 🌐 Frontend | http://localhost:5173 |
| 🔌 API REST | http://localhost:3000 |
| 📡 SSH Gateway (WebSocket) | ws://localhost:3001 |

Depois que API e frontend ficam disponíveis, o comando executa um warm-up seguro e finito da tela de Hosts. Isso antecipa a transformação fria do Vite e algumas consultas de leitura, sem criar dados nem impedir que os servidores continuem ativos em caso de falha. Consulte [Warm-up do ambiente de desenvolvimento](docs/DEVELOPMENT-warmup-lite.md) para diagnóstico, modo estrito e limitações.

---

## 🅱️ Opção B — Imagem do registro (Nexus / Harbor)

> Use esta opção para instalar o NodeAccess em produção a partir das imagens publicadas. **Não é necessário ter o código-fonte.**

### Passo 1 — Autentique no registro privado

```bash
# Nexus
docker login nexus.suaempresa.com

# Harbor
docker login harbor.suaempresa.com
```

### Passo 2 — Crie o arquivo de ambiente

Crie `.env.prod` com as variáveis obrigatórias (baseie-se no `.env.example` do repositório):

```env
NODE_ENV=production

# Banco de dados
DB_ROOT_PASSWORD=senha-root-forte
DB_NAME=nodeaccess
DB_USER=nodeaccess_app
DB_PASSWORD=senha-app-forte
DATABASE_URL=mysql://nodeaccess_app:senha-app-forte@mysql:3306/nodeaccess

# Cache
REDIS_URL=redis://redis:6379

# Segurança — gere com: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=<64-chars-hex>
PEM_ENCRYPTION_KEY=<64-chars-hex>

# URLs públicas
APP_URL=https://nodeaccess.suaempresa.com
APP_FRONTEND_URL=https://nodeaccess.suaempresa.com
```

### Passo 3 — Crie o `docker-compose.prod.yml`

```yaml
services:

  mysql:
    image: mysql:8.0
    restart: unless-stopped
    env_file: .env.prod
    environment:
      MYSQL_ROOT_PASSWORD: ${DB_ROOT_PASSWORD}
      MYSQL_DATABASE: ${DB_NAME}
      MYSQL_USER: ${DB_USER}
      MYSQL_PASSWORD: ${DB_PASSWORD}
    volumes:
      - mysql_data:/var/lib/mysql
    healthcheck:
      test: ["CMD-SHELL", "mysqladmin ping -h 127.0.0.1 --silent"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

  api:
    image: <registro>/nodeaccess-backend:1.0.0   # ← fixe sempre a versão
    restart: unless-stopped
    env_file: .env.prod
    environment:
      APP_MODE: api
    ports:
      - "3000:3000"
    depends_on:
      mysql:
        condition: service_healthy
      redis:
        condition: service_healthy

  ssh-gateway:
    image: <registro>/nodeaccess-backend:1.0.0   # ← mesma versão da API
    restart: unless-stopped
    env_file: .env.prod
    environment:
      APP_MODE: gateway
    ports:
      - "3001:3001"
    depends_on:
      mysql:
        condition: service_healthy
      redis:
        condition: service_healthy

  frontend:
    image: <registro>/nodeaccess-frontend:1.0.0
    restart: unless-stopped
    environment:
      TLS_MODE: ${TLS_MODE:-provided}
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ${NGINX_CONFIG_FILE:-./docker/nginx.https.conf}:/etc/nginx/nginx.conf:ro
      - ./certs:/etc/nginx/certs:ro

volumes:
  mysql_data:
  redis_data:
```

> 💡 Substitua `<registro>` pelo endereço do seu Nexus ou Harbor.

### Passo 4 — Suba os serviços

**Primeira instalação:**

```bash
bash scripts/deploy/install-all-nodeaccess.sh

# Verifique a saúde dos containers
docker compose -f docker-compose.prod.yml ps
```

**Atualizações futuras:**

```bash
# Faz backup, aplica migrations via container e atualiza os serviços
bash scripts/deploy/update-nodeaccess.sh
```

> ✅ Os scripts de deploy aplicam as migrations via `docker compose run --rm api npx prisma migrate deploy` antes da subida final. Consulte [`docs/DEPLOY-DATABASE-VERSIONING.md`](docs/DEPLOY-DATABASE-VERSIONING.md) para a estratégia completa de versionamento de banco.

---

## 🛠️ Operação rápida

Fluxo recomendado de instalação em servidor:

1. gerar ou receber uma release `.tar.gz`
2. copiar o pacote para o host de destino
3. executar o instalador principal com `install-all-nodeaccess.sh`
4. se algo falhar, rodar manualmente a etapa indicada pelo proprio instalador
5. usar `doctor-nodeaccess.sh` e `smoke-check.sh` para validar a stack quando necessario

Regra prática:
- use `install-all-nodeaccess.sh` como fluxo principal de primeira instalacao
- use `prepare-nodeaccess-host.sh` em host novo ou quando quiser validar o layout base antes do deploy
- use `install-from-tarball.sh` quando voce tem o pacote `.tar.gz`
- use `install-nodeaccess.sh` quando a release ja esta extraida e promovida para `current`
- use `update-nodeaccess.sh` somente para atualizar uma instalacao ja existente
- use `switch-release.sh` quando quiser promover manualmente uma release ja extraida
- use `rollback-nodeaccess.sh` quando quiser voltar para uma release anterior ja extraida

Arquivos operacionais oficiais do primeiro corte:

- `docker-compose.prod.yml`
- `.env.example.prod`
- `scripts/install/validate-env.sh`
- `scripts/install/smoke-check.sh`
- `scripts/deploy/install-all-nodeaccess.sh`
- `scripts/deploy/prepare-nodeaccess-host.sh`
- `scripts/deploy/install-nodeaccess.sh`
- `scripts/deploy/install-from-tarball.sh`
- `scripts/deploy/update-nodeaccess.sh`
- `scripts/deploy/doctor-nodeaccess.sh`
- `scripts/deploy/rollback-nodeaccess.sh`
- `scripts/deploy/switch-release.sh`
- `scripts/backup/backup-mysql.sh`
- `scripts/backup/restore-mysql.sh`
- `scripts/release/build-release.sh`

Preparacao inicial do host:

```bash
bash scripts/deploy/prepare-nodeaccess-host.sh
```

Bootstrap assistido de Docker no host, quando necessario:

```bash
AUTO_INSTALL_DOCKER=true bash scripts/deploy/prepare-nodeaccess-host.sh
```

Observacao para sistemas legados:
- `CentOS/RHEL 7` podem exigir ajustes manuais mesmo com `AUTO_INSTALL_DOCKER=true`
- `Node.js 20` nao e suportado nativamente nesse host por causa de `glibc` antigo
- nesses casos, trate o host como ambiente de deploy via release/Docker, nao como ambiente de desenvolvimento

Instalacao recomendada a partir do pacote de release:

```bash
bash scripts/deploy/install-all-nodeaccess.sh --archive /tmp/nodeaccess-release-0.1.0.tar.gz
```

Pré-visualizar o fluxo sem executar comandos:

```bash
bash scripts/deploy/install-all-nodeaccess.sh --dry-run --archive /tmp/nodeaccess-release-0.1.0.tar.gz
```

Retomar depois de corrigir uma falha:

```bash
bash scripts/deploy/install-all-nodeaccess.sh --resume-from install-stack
```

Etapas aceitas em `--resume-from`: `prepare-host`, `promote-release`, `install-stack`, `smoke-check`.

Fluxo que esse comando executa:
- prepara o host, salvo se usar `--skip-host-prepare`
- extrai a release em `releases/`
- carrega imagens offline se o bundle estiver no pacote
- promove para `current`
- executa `install-nodeaccess.sh` sem smoke interno
- executa `smoke-check.sh` como etapa final separada

Para debugar manualmente etapa por etapa, rode os scripts individuais:

```bash
bash scripts/deploy/prepare-nodeaccess-host.sh
RUN_INSTALL=false bash scripts/deploy/install-from-tarball.sh /tmp/nodeaccess-release-0.1.0.tar.gz
bash /opt/nodeaccess/current/scripts/deploy/install-nodeaccess.sh
bash /opt/nodeaccess/current/scripts/install/smoke-check.sh
```

Instalacao em release ja extraida:

```bash
bash scripts/deploy/install-all-nodeaccess.sh --skip-host-prepare
```

Atualizacao simplificada:

```bash
bash scripts/deploy/update-nodeaccess.sh
```

Diagnostico rapido do host:

```bash
bash scripts/deploy/doctor-nodeaccess.sh
```

Promover release extraida para `current` com estrutura padrao:

```bash
bash scripts/deploy/switch-release.sh /opt/nodeaccess/releases/nodeaccess-release-0.1.0
```

Rollback para release anterior extraida:

```bash
bash scripts/deploy/rollback-nodeaccess.sh /opt/nodeaccess/releases/nodeaccess-release-0.0.9
```

Os scripts:
- validam `.env`
- validam `docker compose`
- suportam `TLS_MODE=off|provided|selfsigned`
- exigem `certs/fullchain.pem` e `certs/privkey.pem` apenas em `TLS_MODE=provided`
- geram certificado local em `TLS_MODE=selfsigned`
- `prepare-nodeaccess-host` cria `releases/`, `shared/`, `certs/` e `backups/` e valida prerequisitos do host
- `prepare-nodeaccess-host` pode tentar instalar Docker automaticamente com `AUTO_INSTALL_DOCKER=true`
- `install-all-nodeaccess` orquestra preparacao, promocao de release, instalacao da stack e smoke check
- `install-all-nodeaccess` grava log persistente em `DEPLOY_ROOT/shared/logs/` ou no caminho definido por `INSTALL_LOG_FILE`
- `install-all-nodeaccess` suporta `--dry-run` e `--resume-from <etapa>` para instalacao assistida e retomada
- `install-from-tarball` extrai em `releases/`, promove para `current` e pode executar a instalacao quando usado diretamente
- aplicam migrations via container `api`
- executam `smoke-check` ao final
- no update, fazem backup antes da troca por padrao
- o `doctor` mostra alertas operacionais sem alterar a stack
- o `switch-release` organiza `releases/`, `shared/` e `current`, com `.env`, `certs` e `backups` compartilhados via symlink
- o `rollback` reutiliza a release alvo, faz backup antes da troca, reaplica migrations da versao alvo e promove a release para `current` ao final

Layout recomendado no servidor:

```text
/opt/nodeaccess/
  current -> /opt/nodeaccess/releases/nodeaccess-release-0.1.0
  releases/
    nodeaccess-release-0.1.0/
    nodeaccess-release-0.0.9/
  shared/
    .env
    certs/
    backups/
```

Validar o `.env` antes de subir:

```bash
bash scripts/install/validate-env.sh .env
```

Essa validacao tambem confere se `DATABASE_URL` esta consistente com `DB_USER`, `DB_PASSWORD` e `DB_NAME`. Em producao, o host esperado na URL e `mysql`, pois a conexao ocorre pela rede interna do Docker Compose.

Exemplo rapido de TLS no `.env`:

```bash
TLS_MODE=provided    # ou off / selfsigned
APP_URL=https://nodeaccess.suaempresa.com
APP_FRONTEND_URL=https://nodeaccess.suaempresa.com
```

Exemplos validos por modo:

```bash
# ambiente interno sem HTTPS
TLS_MODE=off
APP_URL=http://nodeaccess.interno
APP_FRONTEND_URL=http://nodeaccess.interno

# HTTPS com certificado manual do host
TLS_MODE=provided
APP_URL=https://nodeaccess.empresa.com
APP_FRONTEND_URL=https://nodeaccess.empresa.com

# HTTPS bootstrap com self-signed
TLS_MODE=selfsigned
APP_URL=https://nodeaccess.interno
APP_FRONTEND_URL=https://nodeaccess.interno
```

Sequencia minima recomendada no host:

```bash
# 1. instalar a partir do pacote
bash scripts/deploy/install-all-nodeaccess.sh --archive /tmp/nodeaccess-release-0.1.0.tar.gz

# 2. diagnosticar arquivos, compose, imagens e certs
bash /opt/nodeaccess/current/scripts/deploy/doctor-nodeaccess.sh

# 3. validar health da aplicacao
bash /opt/nodeaccess/current/scripts/install/smoke-check.sh
```

Executar smoke check pos-subida:

```bash
bash scripts/install/smoke-check.sh
```

Recuperar acesso administrativo offline no servidor:

```bash
npm run admin:recover -w apps/backend -- promote --email admin@empresa.com
npm run admin:recover -w apps/backend -- reset-password --email admin@empresa.com --force-change
npm run admin:recover -w apps/backend -- clear-mfa --email admin@empresa.com --yes
```

Fluxo de emergência combinado:

```bash
npm run admin:recover -w apps/backend -- emergency --email admin@empresa.com --promote-platform-admin --reset-password --clear-mfa --force-change --yes
```

Backup MySQL:

```bash
bash scripts/backup/backup-mysql.sh ./backups
```

Restore MySQL:

```bash
bash scripts/backup/restore-mysql.sh ./backups/nodeaccess-mysql-nodeaccess-YYYYMMDD-HHMMSS.sql.gz --yes
```

Gerar pacote oficial de release:

```bash
bash scripts/release/build-release.sh 0.1.0
```

O pacote inclui tambem:
- `manifest.json`
- `VERSION`
- `RELEASE-NOTES.md`

Gerar pacote com bundle offline de imagens:

```bash
INCLUDE_OFFLINE_IMAGES=true \
BACKEND_IMAGE=nodeaccess-backend \
FRONTEND_IMAGE=nodeaccess-frontend \
bash scripts/release/build-release.sh 0.1.0
```

Gerar pacote com build automatico das imagens na mesma versao da release:

```bash
BUILD_RELEASE_IMAGES=true \
INCLUDE_OFFLINE_IMAGES=true \
BACKEND_IMAGE=nodeaccess-backend \
FRONTEND_IMAGE=nodeaccess-frontend \
bash scripts/release/build-release.sh 0.1.1
```

---

## ⚙️ Variáveis de ambiente

O arquivo `.env.example` contém todas as variáveis com descrições detalhadas. Abaixo, um resumo das mais importantes:

### 🔴 Obrigatórias

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | Connection string MySQL — `mysql://user:pass@host:3306/db` |
| `REDIS_URL` | Connection string Redis — `redis://host:6379` |
| `JWT_SECRET` | Mínimo 32 chars · recomendado: 64 hex |
| `PEM_ENCRYPTION_KEY` | Exatamente 64 chars hex (AES-256-GCM) |
| `APP_URL` | URL pública da API — ex.: `https://nodeaccess.empresa.com` |
| `APP_FRONTEND_URL` | URL pública do frontend |

### 🟡 Opcionais relevantes

| Variável | Padrão | Descrição |
|---|---|---|
| `APP_PORT_API` | `3000` | Porta da API REST |
| `APP_PORT_GATEWAY` | `3001` | Porta do Gateway WebSocket |
| `NODE_ENV` | `development` | `development` ou `production` |
| `GOOGLE_CLIENT_ID` | — | Client ID para SSO Google |
| `GOOGLE_CLIENT_SECRET` | — | Client Secret para SSO Google |
| `FEATURE_SESSION_AUDIT` | `false` | Habilita auditoria de sessões SSH |
| `FEATURE_MCP` | `false` | Habilita Model Context Protocol |
| `FEATURE_METRICS` | `false` | Expõe métricas para Prometheus |
| `VITE_API_URL` | — | URL da API embutida no build do frontend |
| `VITE_WS_URL` | — | URL WebSocket embutida no build do frontend |

---

## 🐳 Build e publicação das imagens

### Backend

```bash
VERSION=1.0.0
SHA=$(git rev-parse --short HEAD)
REGISTRY=registro.suaempresa.com

docker build \
  -f docker/backend.Dockerfile \
  --target prod \
  -t $REGISTRY/nodeaccess-backend:$VERSION \
  -t $REGISTRY/nodeaccess-backend:$SHA \
  -t $REGISTRY/nodeaccess-backend:latest \
  .

docker push $REGISTRY/nodeaccess-backend:$VERSION
docker push $REGISTRY/nodeaccess-backend:$SHA
docker push $REGISTRY/nodeaccess-backend:latest
```

### Frontend

> ⚠️ As variáveis `VITE_*` são **embutidas no bundle** durante o build. Configure-as com a URL definitiva de produção antes de buildar.

```bash
VERSION=1.0.0
REGISTRY=registro.suaempresa.com

docker build \
  -f docker/frontend.Dockerfile \
  --target prod \
  --build-arg VITE_API_URL=https://nodeaccess.empresa.com/api/v1 \
  --build-arg VITE_WS_URL=wss://nodeaccess.empresa.com/ws \
  -t $REGISTRY/nodeaccess-frontend:$VERSION \
  -t $REGISTRY/nodeaccess-frontend:latest \
  .

docker push $REGISTRY/nodeaccess-frontend:$VERSION
docker push $REGISTRY/nodeaccess-frontend:latest
```

---

## 🗺️ Estrutura do projeto

```
nodeaccess/
│
├── 📁 apps/
│   ├── 📁 backend/          API REST + Gateway WebSocket (Fastify + Prisma)
│   │   ├── 📁 prisma/       Schema do banco e migrations
│   │   └── 📁 src/          Módulos: auth, hosts, sessions, agents, audit…
│   │
│   ├── 📁 frontend/         Interface web (Vue 3 + Vite + xterm.js + Naive UI)
│   │   └── 📁 src/          Views, componentes, router, stores, i18n…
│   │
│   └── 📁 agent/            Agente de conectividade (relay SSH)
│
├── 📁 packages/
│   └── 📁 shared/           Schemas e tipos compartilhados (Zod + TypeScript)
│
├── 📁 docker/               Dockerfiles e configurações Nginx (dev + prod)
├── 📁 docs/                 Documentação técnica e PRDs
│
├── 🐳 docker-compose.yml    Ambiente de desenvolvimento
├── 📄 .env.example          Template de variáveis de ambiente
└── 📄 README.md             Este arquivo
```

---

## 🛠️ Scripts úteis

```bash
# ── Desenvolvimento ────────────────────────────────────────────
npm run dev              # Inicia API + Gateway + Frontend simultaneamente
npm run dev:warmup       # Repete manualmente o warm-up local da tela de Hosts

# ── Banco de dados ─────────────────────────────────────────────
npm run db:deploy        # Aplica migrations pendentes (produção)
npm run db:migrate       # Cria nova migration (desenvolvimento)
npm run db:studio        # Abre Prisma Studio — GUI visual do banco
npm run db:seed          # Popula dados iniciais

# ── Qualidade de código ────────────────────────────────────────
npm run typecheck        # Verifica tipos TypeScript (backend + frontend)
npm run lint             # ESLint em todo o projeto
npm run test             # Testes unitários com Vitest
npm run test:cov         # Testes com relatório de cobertura

# ── Build ──────────────────────────────────────────────────────
npm run build            # Compila backend + frontend para produção

# ── Operação / Deploy ──────────────────────────────────────────
bash scripts/deploy/install-all-nodeaccess.sh --archive <release> # Fluxo principal de instalacao
bash scripts/deploy/prepare-nodeaccess-host.sh          # Prepara layout e checks do host
bash scripts/deploy/install-from-tarball.sh <release>   # Extrai, promove e instala release
bash scripts/deploy/install-nodeaccess.sh               # Instala stack na release atual
bash scripts/deploy/update-nodeaccess.sh                # Atualiza stack existente
bash scripts/deploy/doctor-nodeaccess.sh                # Diagnóstico do host/stack
bash scripts/deploy/rollback-nodeaccess.sh <release>    # Volta para release anterior
bash scripts/deploy/switch-release.sh <release-dir>     # Promove release para current
```

---

## 📚 Documentação adicional

| Documento | Conteúdo |
|---|---|
| [`docs/DEPLOY-lite.md`](docs/DEPLOY-lite.md) | Guia rápido de deploy e configuração de Nginx |
| [`docs/DEPLOY-DATABASE-VERSIONING.md`](docs/DEPLOY-DATABASE-VERSIONING.md) | Estratégia de migrations, Expand-Contract e rollback |
| [`docs/PRD-lite.md`](docs/PRD-lite.md) | Visão de produto e regras de negócio |
| [`docs/PROJECT-functional-context-nodeaccess.md`](docs/PROJECT-functional-context-nodeaccess.md) | Contexto funcional completo da solução NodeAccess |
| [`docs/PROJECT-value-summary.md`](docs/PROJECT-value-summary.md) | Resumo de valor, benefícios e prova comercial |

> Manutenção obrigatória: sempre que uma nova funcionalidade, facilidade,
> integração, agente, relatório, permissão ou recurso operacional for adicionado,
> alterado ou removido, atualize também a documentação funcional aplicável:
> `docs/PROJECT-functional-context-nodeaccess.md`, `docs/PRD-lite.md`,
> `docs/PRD-map-lite.md`, `docs/PROJECT-value-summary.md`, este `README.md` e o
> PRD/guia operacional do domínio afetado.

---

<div align="center">

Feito com ☕ pela equipe de Infraestrutura

</div>
