# Deploy Lite

Guia curto para subir o NodeAccess em desenvolvimento ou empacotar para outro servidor.

## Variaveis sensiveis obrigatorias

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

## Subir em desenvolvimento

O `docker-compose.yml` atual usa target `dev` e volumes do codigo local.

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

Aplicar migrations no servidor:

```bash
docker compose -f docker-compose.prod.yml run --rm api npm run db:deploy
```

Subir:

```bash
docker compose -f docker-compose.prod.yml up -d
```

Logs:

```bash
docker compose -f docker-compose.prod.yml logs -f api ssh-gateway frontend
```

## Certificados HTTPS

O `docker/nginx.prod.conf` espera:

```text
/etc/nginx/certs/fullchain.pem
/etc/nginx/certs/privkey.pem
```

No compose sugerido, esses arquivos devem existir em:

```text
./certs/fullchain.pem
./certs/privkey.pem
```

Para ambiente interno/lab sem HTTPS, ajuste o Nginx antes de usar em producao.
