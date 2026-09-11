# Nginx, slugs de tenant e TLS

Este documento registra a configuracao esperada do Nginx para o NodeAccess, o impacto nos slugs de tenant e o procedimento operacional para certificados.

## Veredito da revisao

A configuracao atual esta correta para o fluxo de login por slug quando usada junto com `TENANT_BASE_DOMAIN`.

Arquivos revisados:

- `docker/nginx.http.conf`
- `docker/nginx.https.conf`
- `docker/nginx.prod.conf`
- `docker-compose.prod.yml`
- `docs/auth-login-slugs.md`

Pontos corretos:

- `/api/v1/hosts/test-connection` vai para `ssh-gateway`, antes da regra generica de `/api/`.
- `/api/` vai para `api`.
- `/ws/` vai para `ssh-gateway` com `Upgrade` e timeouts longos.
- `location /` usa fallback de SPA para `index.html`, portanto rotas como `/auth/login`, `/dashboard` e rotas internas do Vue continuam funcionando.
- `X-Tenant-Slug` e enviado para API/gateway.
- `Host`, `X-Real-IP` e `X-Forwarded-For` sao preservados.

Ponto de atencao:

- O Nginx envia `X-Tenant-Slug $host`. Isso e adequado para subdominios, mas depende de `TENANT_BASE_DOMAIN` no backend.
- Sem `TENANT_BASE_DOMAIN`, um host como `cliente-a.nodeaccess.com.br` vira slug normalizado `cliente-a-nodeaccess-com-br`, e pode cair no fallback `default`.

## Como o slug e resolvido

No login, o backend usa esta ordem:

1. `tenantSlug` no body da requisicao.
2. Header `X-Tenant-Slug`.
3. Fallback `default`.

Com:

```env
TENANT_BASE_DOMAIN=nodeaccess.com.br
```

o header:

```text
X-Tenant-Slug: cliente-a.nodeaccess.com.br
```

resolve para:

```text
cliente-a
```

Regras praticas:

- `cliente-a.nodeaccess.com.br` resolve o tenant `cliente-a`.
- `nodeaccess.com.br` nao resolve tenant especifico; tende a usar fallback.
- Para tenant por subdominio, o DNS deve apontar cada subdominio para o mesmo Nginx.
- Para wildcard, use `*.nodeaccess.com.br` apontando para o servidor do NodeAccess.

## Checklist de `.env`

Para HTTPS com subdominios por tenant:

```env
APP_URL=https://nodeaccess.com.br
APP_FRONTEND_URL=https://nodeaccess.com.br
TENANT_BASE_DOMAIN=nodeaccess.com.br
TRUST_PROXY=true
TLS_MODE=provided
NGINX_CONFIG_FILE=./docker/nginx.https.conf
```

Para laboratorio HTTP:

```env
APP_URL=http://nodeaccess.local
APP_FRONTEND_URL=http://nodeaccess.local
TENANT_BASE_DOMAIN=nodeaccess.local
TRUST_PROXY=true
TLS_MODE=off
NGINX_CONFIG_FILE=./docker/nginx.http.conf
```

Use `TRUST_PROXY=true` apenas quando API/gateway estiverem atras do Nginx ou de outro proxy confiavel.

## Certificados esperados

O compose de producao monta:

```yaml
./certs:/etc/nginx/certs:ro
```

Quando `TLS_MODE=provided` ou `TLS_MODE=selfsigned`, o Nginx espera:

```text
certs/fullchain.pem
certs/privkey.pem
```

Esses arquivos aparecem dentro do container como:

```text
/etc/nginx/certs/fullchain.pem
/etc/nginx/certs/privkey.pem
```

## Precisa recriar containers?

Depende da mudanca:

| Mudanca | Precisa rebuild? | Precisa recriar container? | Basta reload? |
| --- | --- | --- | --- |
| Trocar conteudo de `certs/fullchain.pem` ou `certs/privkey.pem` | Nao | Nao | Sim |
| Trocar `NGINX_CONFIG_FILE` | Nao | Sim, para remontar o arquivo correto | Nao |
| Alterar arquivo Nginx ja montado no mesmo caminho | Nao | Nao | Sim |
| Trocar imagem frontend/backend | Sim | Sim | Nao |
| Alterar `.env` usado por API/gateway | Nao | Sim, para recriar processos com env nova | Nao |

Reload do Nginx:

```bash
docker compose -f docker-compose.prod.yml --env-file .env exec frontend nginx -s reload
```

Recriar apenas o frontend quando mudar montagem/config:

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d --force-recreate frontend
```

Recriar a stack:

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d
```

## Certificado self-signed

Certificado self-signed serve para laboratorio, rede interna ou bootstrap. Navegadores vao alertar que o certificado nao e confiavel ate a CA/certificado ser confiado no cliente.

Gerar usando script do projeto:

```bash
TLS_MODE=selfsigned \
APP_URL=https://nodeaccess.local \
bash scripts/deploy/generate-self-signed-cert.sh
```

Ou informando host explicitamente:

```bash
TLS_MODE=selfsigned \
SELF_SIGNED_CERT_HOST=nodeaccess.local \
CERTS_DIR=./certs \
bash scripts/deploy/generate-self-signed-cert.sh
```

Subir com HTTPS self-signed:

```bash
TLS_MODE=selfsigned \
NGINX_CONFIG_FILE=./docker/nginx.https.conf \
docker compose -f docker-compose.prod.yml --env-file .env up -d
```

## Certbot / Let's Encrypt

Certbot nao gera certificado autoassinado. Certbot normalmente emite certificado valido da Let's Encrypt.

Opcoes recomendadas:

### Opcao A: Certbot no host com standalone

Use quando o servidor esta exposto na internet e as portas 80/443 apontam para ele.

1. Pare temporariamente o frontend para liberar porta 80:

```bash
docker compose -f docker-compose.prod.yml --env-file .env stop frontend
```

2. Emita o certificado:

```bash
certbot certonly --standalone \
  -d nodeaccess.com.br \
  -d '*.nodeaccess.com.br'
```

Wildcard normalmente exige DNS challenge. Se nao usar wildcard, liste cada subdominio:

```bash
certbot certonly --standalone \
  -d nodeaccess.com.br \
  -d cliente-a.nodeaccess.com.br \
  -d cliente-b.nodeaccess.com.br
```

3. Copie ou sincronize para o layout esperado:

```bash
mkdir -p ./certs
cp /etc/letsencrypt/live/nodeaccess.com.br/fullchain.pem ./certs/fullchain.pem
cp /etc/letsencrypt/live/nodeaccess.com.br/privkey.pem ./certs/privkey.pem
chmod 644 ./certs/fullchain.pem
chmod 600 ./certs/privkey.pem
```

4. Suba o frontend:

```bash
TLS_MODE=provided \
NGINX_CONFIG_FILE=./docker/nginx.https.conf \
docker compose -f docker-compose.prod.yml --env-file .env up -d frontend
```

### Opcao B: Certbot por DNS challenge

Use para wildcard ou quando nao quer parar o Nginx.

Exemplo conceitual:

```bash
certbot certonly --manual --preferred-challenges dns \
  -d nodeaccess.com.br \
  -d '*.nodeaccess.com.br'
```

Depois copie os arquivos para `./certs` e recarregue o Nginx.

### Renovacao

Depois de renovar, os arquivos montados no container precisam ser atualizados e o Nginx recarregado:

```bash
certbot renew
cp /etc/letsencrypt/live/nodeaccess.com.br/fullchain.pem ./certs/fullchain.pem
cp /etc/letsencrypt/live/nodeaccess.com.br/privkey.pem ./certs/privkey.pem
docker compose -f docker-compose.prod.yml --env-file .env exec frontend nginx -s reload
```

Se `./certs` for symlink direto para `/etc/letsencrypt/live/...`, normalmente basta o reload apos o `certbot renew`.

## Validacao rapida

Validar Nginx dentro do container:

```bash
docker compose -f docker-compose.prod.yml --env-file .env exec frontend nginx -t
```

Validar HTTP para HTTPS:

```bash
curl -I http://nodeaccess.com.br
```

Validar certificado:

```bash
openssl s_client -connect nodeaccess.com.br:443 -servername nodeaccess.com.br </dev/null
```

Validar subdominio/slug:

```bash
curl -k -I https://cliente-a.nodeaccess.com.br
```

Validar API:

```bash
curl -k https://cliente-a.nodeaccess.com.br/api/v1/health
```

Se o login cair no tenant errado:

1. confirme `TENANT_BASE_DOMAIN`;
2. confirme DNS/subdominio;
3. confirme se o proxy envia `X-Tenant-Slug`;
4. confirme se o tenant existe com slug igual ao subdominio;
5. verifique se o fallback para `default` mascarou erro de slug.

## Recomendacoes

- Para producao publica, use `TLS_MODE=provided` com certificado valido.
- Para laboratorio, use `TLS_MODE=selfsigned`.
- Para ambiente atras de proxy externo que ja termina TLS, use `TLS_MODE=off` apenas na rede interna.
- Para multi-tenant por subdominio, configure `TENANT_BASE_DOMAIN`.
- Para wildcard real em producao, prefira certificado wildcard emitido por DNS challenge.
## Portas do frontend e reverse proxy existente

As portas configuradas no `.env` representam as portas publicadas no host. O
frontend continua ouvindo em `80` e `443` dentro do container. O ambiente de
desenvolvimento tambem nao muda: o Vite permanece em `http://localhost:5173`.

### Fluxo 1: NodeAccess exposto diretamente

```text
Browser
  -> servidor NodeAccess :80/:443
    -> Nginx do container frontend
      -> API :3000 / gateway WebSocket :3001 pela rede Docker
```

```env
APP_URL=https://nodeaccess.example.com
APP_FRONTEND_URL=https://nodeaccess.example.com
NODEACCESS_BIND_ADDRESS=0.0.0.0
NODEACCESS_HTTP_PORT=80
NODEACCESS_HTTPS_PORT=443
NODEACCESS_BEHIND_REVERSE_PROXY=false
TLS_MODE=provided
NGINX_CONFIG_FILE=./docker/nginx.https.conf
TRUST_PROXY=true
```

Use este modo quando as portas 80/443 estiverem livres e o proprio NodeAccess
for responsavel pelo certificado.

### Fluxo 2: Nginx existente na frente do NodeAccess

```text
Browser :443
  -> Nginx existente (TLS/certificado)
    -> 127.0.0.1:8080
      -> Nginx HTTP do container frontend
        -> API / gateway WebSocket pela rede Docker
```

```env
APP_URL=https://nodeaccess.example.com
APP_FRONTEND_URL=https://nodeaccess.example.com
NODEACCESS_BIND_ADDRESS=127.0.0.1
NODEACCESS_HTTP_PORT=8080
NODEACCESS_HTTPS_PORT=8443
NODEACCESS_BEHIND_REVERSE_PROXY=true
TLS_MODE=off
NGINX_CONFIG_FILE=./docker/nginx.http.conf
TRUST_PROXY=true
```

`APP_URL` descreve a URL publica e, portanto, continua como HTTPS. `TLS_MODE=off`
descreve somente o trecho local entre o proxy existente e o container. A porta
8443 evita conflito na publicacao do Compose, mas nao recebe trafego enquanto a
configuracao HTTP estiver ativa.

Exemplo para o Nginx existente no host:

```nginx
map $http_upgrade $nodeaccess_connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    server_name nodeaccess.example.com;

    ssl_certificate     /caminho/fullchain.pem;
    ssl_certificate_key /caminho/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $nodeaccess_connection_upgrade;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

Antes de subir, valide o resultado efetivo:

```bash
bash scripts/install/validate-env.sh .env
docker compose -f docker-compose.prod.yml --env-file .env config --quiet
docker compose -f docker-compose.prod.yml --env-file .env config | sed -n '/frontend:/,/^[^ ]/p'
```

Depois de subir, valide tanto a origem local quanto a URL publica:

```bash
curl -fsS http://127.0.0.1:8080/health
curl -fsS https://nodeaccess.example.com/health
```

Se o terminal abrir a interface mas nao conectar, revise primeiro os cabecalhos
`Upgrade` e `Connection` e os timeouts do proxy externo.
