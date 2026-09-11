# Operacao single-node com duas versoes independentes

## Objetivo

Manter NodeAccess v1 e v2 na mesma maquina, com imagens, containers e volumes
independentes. Apenas uma stack fica ativa porque ambas publicam as mesmas
portas. O banco da v2 nunca deve migrar ou substituir o banco da v1.

## Layout

```text
/opt/nodeaccess/
  v1/
  v2/
  config/
    .env.v1
    .env.v2
  shared/certs/
```

Cada diretorio de versao deve ter links locais esperados pelo Compose:

```bash
ln -s /opt/nodeaccess/config/.env.v2 /opt/nodeaccess/v2/.env
ln -s /opt/nodeaccess/shared/certs /opt/nodeaccess/v2/certs
```

Use tags imutaveis (`1.0.0`, `2.0.0`), nunca `latest`.

## Isolamento

- v1 usa seu nome de projeto original, normalmente `nodeaccess`.
- v2 usa `nodeaccess-v2`.
- o nome do projeto prefixa containers, redes e volumes nomeados.
- nunca use `down -v`, `volume prune` ou `system prune --volumes`.

Confirme antes de trocar:

```bash
docker compose ls
docker volume ls | grep nodeaccess
```

## Primeira subida da v2

Pare a v1 sem apagar volumes:

```bash
docker compose -p nodeaccess -f /opt/nodeaccess/v1/docker-compose.prod.yml \
  --env-file /opt/nodeaccess/config/.env.v1 down
```

Prepare banco e migrations exclusivos da v2:

```bash
docker compose -p nodeaccess-v2 -f /opt/nodeaccess/v2/docker-compose.prod.yml \
  --env-file /opt/nodeaccess/config/.env.v2 up -d mysql redis

docker compose -p nodeaccess-v2 -f /opt/nodeaccess/v2/docker-compose.prod.yml \
  --env-file /opt/nodeaccess/config/.env.v2 run --rm api npx prisma migrate deploy

docker compose -p nodeaccess-v2 -f /opt/nodeaccess/v2/docker-compose.prod.yml \
  --env-file /opt/nodeaccess/config/.env.v2 up -d
```

## Voltar para a v1

```bash
docker compose -p nodeaccess-v2 -f /opt/nodeaccess/v2/docker-compose.prod.yml \
  --env-file /opt/nodeaccess/config/.env.v2 down

docker compose -p nodeaccess -f /opt/nodeaccess/v1/docker-compose.prod.yml \
  --env-file /opt/nodeaccess/config/.env.v1 up -d
```

Para retornar a v2, execute `down` na v1 e `up -d` na v2. Nao e necessario
reaplicar migrations quando o volume da v2 ja foi inicializado.

## Bootstrap do primeiro administrador

Uma instalacao vazia precisa de tenant, licenca e usuario inicial. O seed oficial
cria `admin@nodeaccess.local` como `ADMIN` e `isPlatformAdmin=true`, alem da raiz
do inventario corporativo e da ACL herdavel do papel ADMIN. Execute o
seed no ambiente de build/instalacao antes de liberar a aplicacao. Em recuperacao,
prefira `apps/backend/scripts/recover-admin-access.mjs` ou o script empacotado
`scripts/reset-admin-password.sh`.

Um admin de tenant sem `isPlatformAdmin=true` nao enxerga as telas de
`/platform`. Depois de promover o usuario, encerre a sessao e autentique novamente
para emitir um JWT com o novo escopo.

Se um bootstrap manual antigo criou o tenant depois das migrations, confirme que
existe um `inventory_nodes.type=ROOT` para o tenant e uma ACL `ROLE/2` nessa raiz.
Sem esses registros, a arvore corporativa fica vazia e nenhuma pasta possui um
pai valido para criacao.

## Checklist

- `config --images` mostra tags da versao correta.
- MySQL e Redis estao `healthy`.
- migrations terminaram sem erro.
- API, gateway e frontend estao ativos.
- login local e troca obrigatoria de senha funcionam.
- administrador inicial enxerga Plataforma.
- volumes das duas versoes continuam listados.
