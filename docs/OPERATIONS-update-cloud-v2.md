# Atualizar somente a v2 na nuvem

Procedimento aplicado em 09/09/2026: 2.0.1 → 2.0.2. Backups concluídos;
138 migrations encontradas, nenhuma pendente; API, gateway e frontend iniciados
com imagens 2.0.2. Usuário informou funcionamento inicial do portal.

## Identidade do ambiente

- v1: projeto Compose **current**, arquivo `/opt/nodeaccess/current/docker-compose.prod.yml`.
- v2: projeto **nodeaccess-v2**, diretório `/opt/nodeaccess/v2`.
- `.env` da v2 é link para `/opt/nodeaccess/config/.env.v2`.
- `certs` da v2 é link para `/opt/nodeaccess/shared/certs`.
- Não executar atalhos de alternância nem `down -v` para atualizar.
- Manter o nome de projeto e os caminhos preserva a seleção dos volumes existentes.

## Preparar a release

Envie o tarball e seu arquivo de checksums para `/tmp`. Ajuste a versão abaixo:

```bash
version=2.0.2
cd /tmp
sha256sum -c "nodeaccess-release-${version}.checksums.txt"
```

Continue somente com checksum OK. Extraia em diretório novo, sem sobrescrever release existente:

```bash
bash -c '
set -euo pipefail
version="$1"
release="/opt/nodeaccess/releases/nodeaccess-release-$version"
test ! -e "$release"
mkdir -p /opt/nodeaccess/releases
tar -xzf "/tmp/nodeaccess-release-$version.tar.gz" -C /opt/nodeaccess/releases
cd "$release"
sha256sum -c RELEASE-CHECKSUMS.txt
docker load -i "nodeaccess-images-$version.tar.gz"
docker image inspect "nodeaccess-backend:$version" "nodeaccess-frontend:$version" --format "{{join .RepoTags \", \"}}"
' bash "$version" </dev/null
```

Compare o Compose atual e o novo:

```bash
diff -u /opt/nodeaccess/v2/docker-compose.prod.yml \
  "/opt/nodeaccess/releases/nodeaccess-release-$version/docker-compose.prod.yml"
```

Código 1 do diff significa diferenças. Em 2.0.2, mudaram apenas as três tags de
imagem. O procedimento seguinte usa essa condição: se houver outras diferenças,
revise volumes, portas, variáveis e arquivos montados antes de atualizar.
Em versões futuras, confira também as notas da release e mudanças nos arquivos
`docker/` e scripts. A atualização abaixo preserva os arquivos locais e troca
somente o Compose e as imagens da aplicação.

## Atualizar

Salve o bloco abaixo em `/tmp/nodeaccess-update-v2.sh` e execute como arquivo.
Não execute o corpo diretamente por `bash <<EOF`: comandos Docker interativos
podem consumir o restante do script pela entrada padrão. Use redirecionamento
`</dev/null` como abaixo. O encerramento de um heredoc usado para **gravar** o
arquivo com `cat` deve ficar sem espaços.

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
version="${1:?Informe a versao da release}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
release="/opt/nodeaccess/releases/nodeaccess-release-$version"
backup="/opt/nodeaccess/backups/v2-pre-$version-$(date +%Y%m%d-%H%M%S)"
export COMPOSE_PROJECT_NAME=nodeaccess-v2
export COMPOSE_FILE=/opt/nodeaccess/v2/docker-compose.prod.yml
export ENV_FILE=/opt/nodeaccess/config/.env.v2
compose_v2() {
  docker compose -p nodeaccess-v2 -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@" </dev/null
}
trap 'echo "Falha na linha $LINENO. Pare e examine o erro. Backup: $backup"' ERR
cd /opt/nodeaccess/v2
test -s "$release/docker-compose.prod.yml"
docker image inspect "nodeaccess-backend:$version" "nodeaccess-frontend:$version" >/dev/null
compose_v2 config --quiet
# Bloqueia substituicao automatica se houver mudancas alem das tags de imagem.
normalize_compose() {
  sed -E 's/(image: nodeaccess-(backend|frontend):)[^[:space:]]+/\1VERSION/' "$1"
}
diff -u <(normalize_compose "$COMPOSE_FILE") <(normalize_compose "$release/docker-compose.prod.yml")
mkdir -p "$backup"
cp -a "$COMPOSE_FILE" "$backup/docker-compose.prod.yml"
cp -L "$ENV_FILE" "$backup/env.v2"
cp -a docker "$backup/docker"
echo "Backup: $backup"
compose_v2 stop frontend api ssh-gateway
compose_v2 exec -T mysql sh -c '
  export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
  exec mysqldump -uroot --single-transaction --quick --no-tablespaces \
    --set-gtid-purged=OFF --routines --triggers --events "$MYSQL_DATABASE"
' | gzip > "$backup/mysql.sql.gz"
gzip -t "$backup/mysql.sql.gz"
gzip -dc "$backup/mysql.sql.gz" | awk '
  /^-- Dump completed on / { completed = 1 }
  END { exit(completed ? 0 : 1) }
'
bash "$release/scripts/backup/backup-session-audit.sh" "$backup" </dev/null
bash "$release/scripts/backup/backup-user-avatars.sh" "$backup" </dev/null
cp "$release/docker-compose.prod.yml" "$COMPOSE_FILE"
compose_v2 config --quiet
compose_v2 run -T --rm --no-deps api npx prisma migrate deploy
compose_v2 up -d --no-deps --force-recreate api ssh-gateway frontend
compose_v2 ps -a
echo "Servicos iniciados. Valide saude e portal. Backup: $backup"
```

Execução (interrompe sessões da v2):

```bash
bash /tmp/nodeaccess-update-v2.sh 2.0.2 </dev/null
```

O MySQL, Redis, guacd e a v1 permanecem em execução. O comando de migrations
usa a imagem nova e não recria dependências. Não usar o script geral de update
sem revisar suas opções: ele também pode atualizar/recriar infraestrutura.

## Validar e tratar falhas

```bash
curl --fail --silent --show-error http://127.0.0.1:3000/health/ready
curl --fail --silent --show-error http://127.0.0.1:3001/health/ready
```

Valide login, hosts e abertura/fechamento de SSH. `Started` sozinho não certifica
saúde. Preserve imagens anteriores e backups. Avisos de atualização do npm não
exigem atualização manual dentro dos containers.

Se houver falha após `stop`, a aplicação pode permanecer indisponível. Não
continue cegamente nem restaure o banco automaticamente. Antes das migrations,
pode-se avaliar reiniciar os containers anteriores com `compose start`; após
migrations iniciadas, avaliar compatibilidade e estado do banco antes de voltar.
Nunca usar `down -v` ou remoção de volumes como recuperação.

Incidente observado na primeira execução: script passado por stdin terminou
logo após o dump, sem chegar às migrations. A retomada foi feita com arquivo de
script e stdin fechado, novo dump conferido e backups de auditoria/avatares.
O backup bem-sucedido dessa atualização está em:
`/opt/nodeaccess/backups/v2-pre-2.0.2-20260909-162128`, sendo o dump validado
`mysql-resume-20260909-162350.sql.gz`.

## Agente Windows

Atualizar as imagens do servidor não atualiza automaticamente o MSI já instalado
nos computadores. A versão do agente é independente da versão web. Em caso de
falha no assistente, conferir o executável instalado e o registro conforme
`OPERATIONS-agent-windows-installer.md`. Não compartilhar tokens ou logs de URLs
com parâmetros de autenticação.
