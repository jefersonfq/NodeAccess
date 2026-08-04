# Deploy Lite

Guia curto para subir o NodeAccess em desenvolvimento ou empacotar para outro servidor.

## Variaveis sensiveis obrigatorias

Arquivos oficiais do primeiro corte operacional:
- `docker-compose.prod.yml`
- `.env.example.prod`
- `scripts/install/validate-env.sh`
- `scripts/install/smoke-check.sh`
- `scripts/deploy/prepare-nodeaccess-host.sh`
- `scripts/deploy/install-nodeaccess.sh`
- `scripts/deploy/install-from-tarball.sh`
- `scripts/deploy/update-nodeaccess.sh`
- `scripts/deploy/doctor-nodeaccess.sh`
- `scripts/deploy/rollback-nodeaccess.sh`
- `scripts/deploy/switch-release.sh`
- `apps/backend/scripts/recover-admin-access.mjs`
- `scripts/backup/backup-mysql.sh`
- `scripts/backup/restore-mysql.sh`
- `scripts/backup/backup-session-audit.sh`
- `scripts/backup/restore-session-audit.sh`
- `scripts/backup/check-dr-artifacts.sh`
- `tools/deploy/dr-validation-harness.sh`
- `scripts/release/build-release.sh`

### `JWT_SECRET`
Use uma string aleatoria forte.

Gerar com o proprio `node` do ambiente:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

Exemplo no `.env`:

```env
JWT_SECRET=cole_aqui_o_valor_gerado
```

### `PEM_ENCRYPTION_KEY`
Use uma chave de 32 bytes em hex para criptografia de PEMs e segredos operacionais.

Gerar com o proprio `node` do ambiente:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Exemplo no `.env`:

```env
PEM_ENCRYPTION_KEY=cole_aqui_o_hex_gerado
```

Regras importantes:
- nunca versionar `.env` com esses valores
- se o banco for novo, gere uma nova `PEM_ENCRYPTION_KEY`
- se migrar um banco existente para outro servidor, leve a mesma `PEM_ENCRYPTION_KEY`
- trocar `PEM_ENCRYPTION_KEY` com dados ja cifrados impede descriptografar PEMs/secrets antigos

## IA local opcional com Ollama

Se quiser habilitar o Assistente local com provider local, adicione no `.env`:

```env
FEATURE_LOCAL_AI=true
```

Preset atual do produto para o tenant:
- `provider local`: `ollama`
- `base URL local`: `http://localhost:11434`
- `modelo local`: `qwen2.5-coder:3b`
- `modo`: `read_only`
- `politica`: `local_only`

Observacoes:
- isso nao habilita o modulo sozinho na licenca do tenant
- isso nao baixa modelo automaticamente
- o objetivo e reduzir atrito de configuracao, nao acoplar o startup do NodeAccess ao runtime da IA

### Script Linux para instalar Ollama + Qwen

O repositorio possui um script operacional:

```bash
bash scripts/setup-ollama-qwen.sh
```

Ou com modelo explicito:

```bash
bash scripts/setup-ollama-qwen.sh qwen2.5-coder:7b
```

Esse script:
- instala o Ollama se necessario
- sobe o servico
- faz `pull` do modelo
- imprime os valores sugeridos para configurar no NodeAccess

### Importante quando o backend roda em Docker

Se o `api` do NodeAccess estiver em container e o Ollama estiver no host:
- `http://localhost:11434` dentro do container nao aponta para o host
- use uma URL acessivel pelo container, por exemplo:

```text
http://host.docker.internal:11434
```

ou o IP/hostname da maquina host.

Depois de configurar o Assistente local na UI:
- salve a configuracao
- use `Testar conexao`
- opcionalmente use `Abrir diagnostico via NodeAccess`

## Pre-requisitos por tipo de ambiente

Desenvolvimento local:
- exige `Node.js 20 LTS` e `npm` no host
- exige `docker` e `docker compose` para banco e Redis

Deploy operacional com release:
- exige `docker` e `docker compose`
- nao exige `npm` no host para instalar a stack

Validacao rapida no host:

```bash
node -v
npm -v
docker -v
docker compose version
```

Se `npm` nao existir, isso bloqueia fluxo de desenvolvimento, mas nao bloqueia o fluxo de release com `install-from-tarball.sh`.

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

## Subir em desenvolvimento

O `docker-compose.yml` atual usa target `dev` e volumes do codigo local.

Para desenvolvimento direto com `npm run dev`, a tela de Hosts possui warm-up local automático. O comportamento, as variáveis e o diagnóstico de cold start estão em [DEVELOPMENT-warmup-lite.md](DEVELOPMENT-warmup-lite.md). Esse mecanismo é exclusivo de desenvolvimento e não deve ser configurado contra produção.

Subir:

```bash
docker compose up -d --build
```

Acompanhar logs:

```bash
docker compose logs -f api ssh-gateway
```

Rodar migrations:

```bash
docker compose exec api npm run db:deploy
```

Validar quais configuracoes nao sensiveis do `.env` podem ser persistidas no banco:

```bash
docker compose exec api npm run config:sync-env
```

Aplicar somente insercoes seguras suportadas pelo script:

```bash
docker compose exec api npm run config:sync-env -- --apply
```

Comportamento atual do script:
- cria a licença do tenant se ela ainda nao existir
- usa `LICENSE_MAX_USERS`, `LICENSE_MULTI_CONNECT`, `SESSION_MAX_ACTIVE_PER_USER`, `SESSION_MAX_ACTIVE_PER_TENANT` e hash de `LICENSE_KEY`, quando existir
- nao sobrescreve licença existente
- nao move `JWT_SECRET`, `PEM_ENCRYPTION_KEY`, `DATABASE_URL` ou Redis para o banco

Ordem recomendada apos mudar schema/configuracao:

```bash
docker compose up -d --build
docker compose exec api npm run db:deploy
docker compose exec api npm run config:sync-env
docker compose exec api npm run config:sync-env -- --apply
```

Parar:

```bash
docker compose down
```

## Build local sem Docker

Validacao antes de empacotar:

```bash
npm run typecheck
npm run build -w packages/shared
npm run build -w apps/backend
npm run build -w apps/frontend
```

## Gerar imagens para producao

Build das imagens usando os targets `prod`:

```bash
docker build -f docker/backend.Dockerfile --target prod -t nodeaccess-backend:0.1.0 .
docker build -f docker/frontend.Dockerfile --target prod -t nodeaccess-frontend:0.1.0 .
```

Exportar imagens para levar a outro servidor sem registry:

```bash
docker save nodeaccess-backend:0.1.0 nodeaccess-frontend:0.1.0 | gzip > nodeaccess-images-0.1.0.tar.gz
```

Importar no servidor destino:

```bash
gunzip -c nodeaccess-images-0.1.0.tar.gz | docker load
```

## Compose de producao sugerido

Crie um `docker-compose.prod.yml` no servidor destino:

```yaml
services:
  mysql:
    image: mysql:8.0
    restart: unless-stopped
    env_file: .env
    volumes:
      - mysql_data:/var/lib/mysql

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redis_data:/data

  api:
    image: nodeaccess-backend:0.1.0
    restart: unless-stopped
    env_file: .env
    environment:
      APP_MODE: api
    depends_on:
      - mysql
      - redis

  ssh-gateway:
    image: nodeaccess-backend:0.1.0
    restart: unless-stopped
    env_file: .env
    environment:
      APP_MODE: gateway
    depends_on:
      - mysql
      - redis

  frontend:
    image: nodeaccess-frontend:0.1.0
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./certs:/etc/nginx/certs:ro
    depends_on:
      - api
      - ssh-gateway

volumes:
  mysql_data:
  redis_data:
```

Preparacao inicial do host:

```bash
bash scripts/deploy/prepare-nodeaccess-host.sh
```

Tentativa automatica de instalar Docker no host:

```bash
AUTO_INSTALL_DOCKER=true bash scripts/deploy/prepare-nodeaccess-host.sh
```

Observacao para sistemas legados:
- `CentOS/RHEL 7` podem exigir ajustes manuais mesmo com `AUTO_INSTALL_DOCKER=true`
- `Node.js 20` nao e suportado nativamente nesse host por causa de `glibc` antigo
- nesses casos, prefira fluxo de release/Docker e evite tratar esse host como ambiente de desenvolvimento

Instalacao simplificada:

```bash
bash scripts/deploy/install-nodeaccess.sh
```

Atualizacao simplificada:

```bash
bash scripts/deploy/update-nodeaccess.sh
```

Diagnostico rapido:

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
- o `prepare-nodeaccess-host` cria `releases/`, `shared/`, `certs/` e `backups/` e valida prerequisitos basicos do host
- o `prepare-nodeaccess-host` pode tentar instalar Docker automaticamente com `AUTO_INSTALL_DOCKER=true`
- aplicam migrations via `docker compose run --rm api npx prisma migrate deploy`
- executam `smoke-check` ao final
- no update, fazem backup antes da troca por padrao
- o `doctor` sinaliza alertas de certs, imagens, compose e health sem mudar a stack
- o `switch-release` organiza `releases/`, `shared/` e `current`, com `.env`, `certs` e `backups` compartilhados via symlink
- o `install-from-tarball` extrai a release em `releases/`, promove para `current`, carrega bundle offline se existir e roda a instalacao
- o `rollback` usa a release alvo como fonte de compose/scripts, faz backup antes da troca, reaplica migrations da versao alvo e promove a release para `current` ao final

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

Validar o ambiente antes de subir:

```bash
bash scripts/install/validate-env.sh .env
```

Fluxo direto a partir do pacote:

```bash
bash scripts/deploy/prepare-nodeaccess-host.sh
bash scripts/deploy/install-from-tarball.sh /tmp/nodeaccess-release-0.1.0.tar.gz
```

Smoke check pos-subida:

```bash
bash scripts/install/smoke-check.sh
```

Fluxo manual equivalente:

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d mysql redis
docker compose -f docker-compose.prod.yml --env-file .env run --rm api npx prisma migrate deploy
docker compose -f docker-compose.prod.yml --env-file .env up -d
```

Logs:

```bash
docker compose -f docker-compose.prod.yml logs -f api ssh-gateway frontend
```

## Recuperacao administrativa offline

Quando nenhum admin conseguir acessar a UI, use o script oficial no servidor com o `.env` correto carregado.

Promover usuario existente para `platform admin`:

```bash
npm run admin:recover -w apps/backend -- promote --email admin@empresa.com
```

Gerar senha temporaria:

```bash
npm run admin:recover -w apps/backend -- reset-password --email admin@empresa.com --force-change
```

Limpar MFA com confirmacao explicita:

```bash
npm run admin:recover -w apps/backend -- clear-mfa --email admin@empresa.com --yes
```

Fluxo de emergencia combinado:

```bash
npm run admin:recover -w apps/backend -- emergency --email admin@empresa.com --promote-platform-admin --reset-password --clear-mfa --force-change --yes
```

Observacoes:
- trate a senha temporaria como dado sensivel
- reconfigure o MFA imediatamente apos recuperar o acesso
- mantenha a mesma `PEM_ENCRYPTION_KEY` ao restaurar bancos existentes

## Backup MySQL

Gerar backup com dump comprimido, manifest e checksum:

```bash
bash scripts/backup/backup-mysql.sh ./backups
```

Saida esperada:
- `nodeaccess-mysql-<db>-<timestamp>.sql.gz`
- `nodeaccess-mysql-<db>-<timestamp>.manifest.json`
- `nodeaccess-mysql-<db>-<timestamp>.sha256`

Observacoes:
- o backup contem apenas o dump MySQL
- `PEM_ENCRYPTION_KEY` nao vai dentro do backup
- preserve a mesma `PEM_ENCRYPTION_KEY` do ambiente de origem para continuar descriptografando PEMs e secrets

## Backup de Auditoria SSH

Gerar backup dos chunks de auditoria SSH com archive, manifest e checksum:

```bash
ENV_FILE=.env COMPOSE_PROJECT_NAME=nodeaccess bash scripts/backup/backup-session-audit.sh ./backups
```

Saida esperada:
- `nodeaccess-session-audit-<timestamp>.tar.gz`
- `nodeaccess-session-audit-<timestamp>.manifest.json`
- `nodeaccess-session-audit-<timestamp>.sha256`

Observacoes:
- por padrao usa o volume Docker `nodeaccess_session_audit_data`
- para diretorio local, use `SESSION_AUDIT_SOURCE_DIR=/caminho`
- chunks de auditoria podem conter dados sensiveis de terminal

## Restore MySQL

Restaurar dump em ambiente alvo:

```bash
bash scripts/backup/restore-mysql.sh ./backups/nodeaccess-mysql-nodeaccess-YYYYMMDD-HHMMSS.sql.gz --yes
```

Validacoes minimas do script:
- checksum, quando presente
- confirmacao explicita ao restaurar sobre banco nao vazio
- contagem basica de `users`, `hosts` e `_prisma_migrations`

Checklist pos-restore recomendada:
- validar `bash scripts/install/validate-env.sh .env`
- rodar `docker compose -f docker-compose.prod.yml --env-file .env run --rm api npm run db:deploy`
- subir a stack
- validar login admin
- validar leitura de hosts
- validar que PEMs/secrets continuam acessiveis com a mesma `PEM_ENCRYPTION_KEY`
- abrir uma sessao SSH de teste

## Restore de Auditoria SSH

Restaurar auditoria SSH em ambiente alvo:

```bash
bash scripts/backup/restore-session-audit.sh ./backups/nodeaccess-session-audit-YYYYMMDD-HHMMSS.tar.gz --yes
```

Validacoes minimas do script:
- checksum obrigatorio por padrao
- manifest detectado quando presente
- `--yes` exigido para substituir destino nao vazio

## Validacao DR Agregada

Validar artefatos, restore isolado MySQL, restore isolado da auditoria e doctor:

```bash
bash tools/deploy/dr-validation-harness.sh
```

Para ambiente dev com API/gateway fora do Nginx:

```bash
TLS_MODE=off \
API_HEALTH_URL=http://127.0.0.1:3000/health/ready \
API_DEEP_HEALTH_URL=http://127.0.0.1:3000/health/deep \
GATEWAY_HEALTH_URL=http://127.0.0.1:3001/health/ready \
GATEWAY_DEEP_HEALTH_URL=http://127.0.0.1:3001/health/deep \
bash tools/deploy/dr-validation-harness.sh
```

Tambem existe um runbook dedicado em:

```text
docs/OPERATIONS-ha-dr-runbook-lite.md
```

Para instalação do agente, provisionamento de um novo nó e operação completa
do HA de dois nós, use:

```text
docs/OPERATIONS-ha-node-install-and-actions.md
```

## Pacote de release

Gerar pacote oficial com compose, env template, scripts e release notes:

```bash
bash scripts/release/build-release.sh 0.1.0
```

Saida esperada:
- `dist/releases/nodeaccess-release-0.1.0/`
- `dist/releases/nodeaccess-release-0.1.0.tar.gz`
- `dist/releases/nodeaccess-release-0.1.0.checksums.txt`
- `dist/releases/nodeaccess-release-0.1.0/manifest.json`

Gerar pacote com bundle offline de imagens:

```bash
INCLUDE_OFFLINE_IMAGES=true \
BACKEND_IMAGE=nodeaccess-backend \
FRONTEND_IMAGE=nodeaccess-frontend \
bash scripts/release/build-release.sh 0.1.0
```

Observacoes:
- o bundle offline exige que as imagens `${BACKEND_IMAGE}:<versao>` e `${FRONTEND_IMAGE}:<versao>` ja existam localmente
- backend e frontend devem compartilhar a mesma versao de release

Gerar pacote com build automatico das imagens na mesma versao da release:

```bash
BUILD_RELEASE_IMAGES=true \
INCLUDE_OFFLINE_IMAGES=true \
BACKEND_IMAGE=nodeaccess-backend \
FRONTEND_IMAGE=nodeaccess-frontend \
bash scripts/release/build-release.sh 0.1.1
```

## Roteamento API, Gateway e Agent

O backend roda em dois modos:

- `api`: REST, autenticacao, cadastro, listagens e regras administrativas
- `gateway`: WebSocket SSH, WebSocket do Agent e operacoes que precisam do registry em memoria do Agent

Em desenvolvimento com `npm run dev`:

- API: `localhost:3000`
- Gateway: `localhost:3001`
- Frontend/Vite: `localhost:5173`

Regras obrigatorias do proxy/reverse proxy:

```text
/api/v1/hosts/test-connection -> gateway:3001
/api/v1/*                     -> api:3000
/ws/*                         -> gateway:3001
/*                             -> frontend
```

Motivo:
- o Agent conecta em `/ws/agent`, que roda no Gateway
- a ponte TCP via Agent existe no registry em memoria do Gateway
- o teste de conexao via Agent tambem precisa rodar no Gateway
- se `/api/v1/hosts/test-connection` for enviado para a API, a tela pode mostrar Agent online, mas o teste nao consegue usar a ponte do Agent

O `docker/nginx.dev.conf`, o `docker/nginx.https.conf`, o `docker/nginx.http.conf` e o proxy do Vite ja possuem essa regra especifica para `/api/v1/hosts/test-connection`.

Rotas principais:

```text
GET  /ws/agent                       Agent -> NodeAccess Gateway
GET  /ws/ssh/:hostId                 Browser -> Gateway -> SSH/Agent
POST /api/v1/hosts/test-connection   Browser -> Gateway -> SSH/Agent
GET  /api/v1/agents/status           Browser -> API
```

Em producao com proxy externo proprio, replique essa separacao antes da regra generica de `/api/`.

Para registrar corretamente o IP WAN de origem em logs, agentes e sessoes SSH:

- configure o proxy para enviar `X-Real-IP` e `X-Forwarded-For` para `/api/`, `/api/v1/hosts/test-connection` e `/ws/`;
- habilite `TRUST_PROXY=true` somente quando API/gateway estiverem atras de proxy confiavel;
- mantenha `TRUST_PROXY=false` se o backend estiver exposto diretamente, para evitar confiar em headers falsificados pelo cliente.

## Certificados HTTPS

Detalhes operacionais de Nginx, slugs de tenant, self-signed e Certbot ficam em `docs/OPERATIONS-nginx-tls-slugs.md`.

Quando `TLS_MODE=provided` ou `TLS_MODE=selfsigned`, o `docker/nginx.https.conf` espera:

```text
/etc/nginx/certs/fullchain.pem
/etc/nginx/certs/privkey.pem
```

No compose sugerido, esses arquivos devem existir em:

```text
./certs/fullchain.pem
./certs/privkey.pem
```

Direcao operacional:

- `TLS_MODE=off`
  - usa `docker/nginx.http.conf`
  - sobe sem HTTPS
  - indicado para ambiente interno controlado ou reverse proxy externo
- `TLS_MODE=provided`
  - usa `docker/nginx.https.conf`
  - exige `fullchain.pem` e `privkey.pem`
- `TLS_MODE=selfsigned`
  - usa `docker/nginx.https.conf`
  - pode gerar certificado local via `scripts/deploy/generate-self-signed-cert.sh`
