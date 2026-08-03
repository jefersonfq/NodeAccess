# Fluxo operacional HA com dois nos

Para instalar um novo nó, provisioná-lo pelo painel e executar switchover,
failover e rejoin, comece pelo guia consolidado:

```text
docs/OPERATIONS-ha-node-install-and-actions.md
```

Após uma troca concluída, use a reconciliação governada da tela para alinhar os
papéis configurados aos papéis observados. A ação só é liberada com dois
heartbeats atuais, um único `PRIMARY` com a VIP e um `STANDBY` sem a VIP.

## Cenario configurado

O ambiente validado e active/passive, sem TLS, com:

| Papel | Endereco | Funcao atual |
| --- | --- | --- |
| No B | `192.168.1.101` | Primario de aplicacao e estado |
| No A | `192.168.1.100` | Standby de aplicacao e replica de estado |
| VIP | `192.168.1.105` | Endereco usado pelos usuarios |

O Keepalived executa no host. B tem prioridade 110 e A prioridade 100. Somente
um no deve possuir o VIP. O health check retira um no da eleicao quando API ou
gateway deixam de responder.

```text
Usuarios
   |
   v
VIP 192.168.1.105
   |
   +-- B ativo: frontend + API + gateway
   |      |
   |      +-- MySQL B (primario gravavel)
   |      +-- Redis B (master)
   |      +-- arquivos B em /srv/nodeaccess-replica
   |
   +-- A standby: frontend + API + gateway
          |
          +-- usa MySQL/Redis do B enquanto standby
          +-- MySQL A local (replica somente leitura)
          +-- Redis A local (replica)
          +-- arquivos A em /srv/nodeaccess-shared
```

## Como cada estado e replicado

### MySQL

- replicacao assincrona GTID, binlog em formato ROW;
- B usa `server-id=2` e permite escrita;
- A usa `server-id=1`, `read_only=ON` e `super_read_only=ON`;
- a copia inicial e feita por dump/seed do B;
- depois do seed, A usa `SOURCE_AUTO_POSITION=1`;
- usuario de replicacao tem permissao apenas de replicacao;
- senha de replicacao deve ter no maximo 32 caracteres;
- gate esperado: IO e SQL em `Yes`, lag 0 e nenhum erro.

O MySQL local do A nao e usado pela aplicacao enquanto A e standby. Ele fica
reservado para uma promocao total controlada.

### Redis

- B opera como `master`;
- A inicia com `--replicaof 192.168.1.101 6380`;
- persistencia AOF esta habilitada;
- gate esperado: `role=slave` e `master_link_status=up`.

Nao existe Sentinel nem quorum. A promocao do Redis A deve ser manual.

### Auditoria, avatares e backups

- origem ativa no B: `/srv/nodeaccess-replica`;
- copia no A: `/srv/nodeaccess-shared`;
- replicacao assincrona via rsync sobre SSH;
- timer systemd executa a cada 60 segundos;
- `--delete` mantem a replica equivalente a origem;
- RPO nominal dos arquivos: ate aproximadamente 60 segundos, acrescido do
  tempo da sincronizacao em andamento.

### Aplicacao, segredos e sessoes

- frontend, API, gateway e guacd executam nos dois nos;
- ambos usam a mesma release;
- `.env`, `JWT_SECRET` e `PEM_ENCRYPTION_KEY` devem ser preservados;
- sessoes SSH/WebSocket em andamento nao sao replicadas;
- durante failover, o usuario pode precisar reabrir a sessao.

## Fluxos de falha

### Se o no A parar

Esse e o caso de menor impacto:

1. B ja possui o VIP e continua atendendo.
2. MySQL e Redis primarios continuam no B.
3. Apenas as replicas e a copia assincrona ficam temporariamente indisponiveis.
4. Nao ocorre promocao nem troca de trafego.
5. Quando A voltar, validar se a replicacao retomou; se perdeu a continuidade
   GTID, gerar novo seed antes de recoloca-lo como standby.

Impacto esperado: nenhum para novas conexoes, mas o ambiente fica sem
redundancia ate A retornar.

### Se apenas a aplicacao ou o Keepalived do B parar

Com MySQL, Redis e arquivos do B ainda acessiveis:

1. O health check do B falha ou o Keepalived para.
2. A deixa o estado BACKUP e assume o VIP.
3. A atende frontend, API e gateway.
4. A aplicacao continua usando MySQL e Redis primarios do B.
5. Quando B volta saudavel, a prioridade 110 devolve o VIP a B.

Esse fluxo foi validado na 2.0.5 com failover em 14 segundos.

### Se o no B parar por completo

Esse caso exige promocao total manual:

1. Confirmar por console/fencing que B esta realmente desligado.
2. Impedir que B volte como primario durante a operacao.
3. Congelar a sincronizacao de arquivos A <- B.
4. Executar os gates de readiness no A.
5. Promover MySQL A para gravavel e Redis A para master.
6. Alterar a aplicacao A para usar os servicos locais e os arquivos locais.
7. Validar deep health e somente depois permitir o VIP no A.

Sem fencing, a promocao automatica nao e segura: uma particao de rede pode
produzir dois MySQL/Redis primarios, caracterizando split-brain.

Quando B retornar, ele nao deve ser iniciado como antigo primario. Primeiro
deve ser reconstruido como replica do A e receber a sincronizacao reversa dos
arquivos.

## Elementos adicionados ao modo de operacao

- Keepalived/VRRP no host e VIP flutuante;
- health check de API e gateway integrado ao Keepalived;
- compose de aplicacao sem estado: `docker-compose.ha.yml`;
- compose separado de estado: `docker-compose.ha-state.yml`;
- override para ligar estado a rede da aplicacao:
  `docker-compose.ha-state-app-network.yml`;
- perfis MySQL de bootstrap, replica e promovido em `docker/mysql/ha`;
- Redis com AOF e modo replica configuravel;
- rsync sobre SSH com service/timer systemd;
- backups com manifest e checksum;
- gates de readiness, pre-failover, pos-failover e promoção;
- observador de falhas consecutivas e witness/fencing externo para promoção
  emergencial automática.

Nao foram adicionados load balancer dedicado, MySQL InnoDB Cluster, Redis
Sentinel, storage distribuido ou quorum distribuído. O desenho continua
active/passive de dois nós, com troca planejada assistida e failover
emergencial automático protegido por fencing externo.

## O que e automatico e o que ainda e manual

Nao basta executar um unico script para construir todo o HA. Os scripts
automatizam operacoes locais e validacoes, mas algumas decisoes de topologia
continuam intencionalmente manuais.

| Etapa | Situacao | Motivo |
| --- | --- | --- |
| Gerar e validar release | Automatizada | Processo identico em qualquer no |
| Extrair, promover release e carregar imagens | Automatizada | Operacao local e reversivel |
| Validar `.env`, compose e migrations | Automatizada | Gate repetivel |
| Criar usuario MySQL de replicacao | Manual | Exige definir origem, rede e segredo |
| Gerar e restaurar seed MySQL | Manual assistida | Define o ponto inicial da replica |
| Configurar `CHANGE REPLICATION SOURCE` | Manual | Depende dos enderecos e papeis atuais |
| Iniciar Redis como replica | Parametrizada no compose | Exige informar host/porta do master |
| Criar chave SSH para rsync | Manual | Credencial deve ser controlada pelo operador |
| Sincronizar arquivos periodicamente | Automatizada por timer | Executa depois da chave ser autorizada |
| Configurar Keepalived e firewall | Manual | Interface, VIP e regras variam por ambiente |
| Readiness e testes | Automatizados | Bloqueiam promocao sem os gates minimos |
| Promoção por degradação | Manual com confirmação | Usa quiesce e sincronização final enquanto a origem responde |
| Promoção por falha total | Automática com witness/fencing | Só ocorre após falhas consecutivas e isolamento confirmado da origem |

Os exemplos abaixo usam os IPs da POC. Em outro ambiente, substituir IPs,
interface, VIP, senhas e caminhos antes da execucao.

## Fluxo de instalacao utilizado

### 1. Gerar a release

```bash
BUILD_RELEASE_IMAGES=true \
INCLUDE_OFFLINE_IMAGES=true \
BACKEND_IMAGE=nodeaccess-backend \
FRONTEND_IMAGE=nodeaccess-frontend \
bash scripts/release/build-release.sh <versao>
```

O pacote offline inclui imagens, compose, scripts, configuracoes e
documentacao.

### 2. Validar e extrair em cada no

```bash
sha256sum -c nodeaccess-release-<versao>.checksums.txt

RUN_INSTALL=false DEPLOY_ROOT=/opt/nodeaccess \
bash scripts/deploy/install-from-tarball.sh \
  /tmp/nodeaccess-release-<versao>.tar.gz
```

`RUN_INSTALL=false` promove a release para `/opt/nodeaccess/current`, mas
permite configurar o papel HA antes de iniciar a stack.

### 3. Preparar o estado

No B, MySQL e Redis executam como primarios. No A:

1. iniciar MySQL com `replica-bootstrap.cnf`;
2. restaurar o dump GTID gerado no B;
3. trocar para `replica-node-a.cnf`;
4. configurar `CHANGE REPLICATION SOURCE` com auto-position;
5. iniciar Redis com `REDIS_REPLICA_HOST=192.168.1.101`;
6. validar MySQL e Redis antes de iniciar a aplicacao.

#### 3.1 Criar o usuario e o seed no B

```bash
# Gera 32 caracteres hexadecimais, limite aceito pelo metadata de replicacao.
REPL_PASSWORD="$(openssl rand -hex 16)"
DB_ROOT_PASSWORD="$(sed -n 's/^DB_ROOT_PASSWORD=//p' \
  /opt/nodeaccess/shared/.env)"

docker exec nodeaccess-state-mysql-1 \
  mysql -uroot -p"$DB_ROOT_PASSWORD" -e "
    CREATE USER IF NOT EXISTS
      'nodeaccess_replica'@'192.168.1.%'
      IDENTIFIED WITH caching_sha2_password BY '$REPL_PASSWORD';
    ALTER USER
      'nodeaccess_replica'@'192.168.1.%'
      IDENTIFIED WITH caching_sha2_password BY '$REPL_PASSWORD';
    GRANT REPLICATION SLAVE, REPLICATION CLIENT ON *.*
      TO 'nodeaccess_replica'@'192.168.1.%';
    FLUSH PRIVILEGES;
  "

docker exec nodeaccess-state-mysql-1 \
  mysqldump -uroot -p"$DB_ROOT_PASSWORD" \
    --all-databases \
    --single-transaction \
    --routines \
    --events \
    --triggers \
    --set-gtid-purged=ON \
    --source-data=2 \
    --no-tablespaces |
  gzip -1 > /tmp/nodeaccess-mysql-replica-seed.sql.gz

printf '%s\n' \
  'MYSQL_REPLICATION_USER=nodeaccess_replica' \
  "MYSQL_REPLICATION_PASSWORD=$REPL_PASSWORD" \
  > /tmp/replication.env
chmod 600 /tmp/replication.env
```

Por que:

- o usuario permite que A leia o binlog do B;
- o seed entrega uma fotografia consistente do estado;
- GTID permite que A continue exatamente do ponto coberto pelo dump;
- `--no-tablespaces` evita exigir privilegios administrativos adicionais.

Copiar o seed e `replication.env` para A por canal seguro. O arquivo
`replication.env` e sensivel e deve permanecer com permissao 600.

#### 3.2 Iniciar MySQL e Redis no A

```bash
install -d -m 0755 /opt/nodeaccess/shared/mysql/replica-a-conf
install -m 0644 \
  /opt/nodeaccess/current/docker/mysql/ha/replica-bootstrap.cnf \
  /opt/nodeaccess/shared/mysql/replica-a-conf/nodeaccess.cnf

# O no A usa server-id 1.
sed -i 's/server-id = 2/server-id = 1/' \
  /opt/nodeaccess/shared/mysql/replica-a-conf/nodeaccess.cnf

COMPOSE_PROJECT_NAME=nodeaccess-state \
MYSQL_BIND_ADDRESS=192.168.1.100 \
MYSQL_PUBLISHED_PORT=3307 \
MYSQL_CONFIG_DIR=/opt/nodeaccess/shared/mysql/replica-a-conf \
MYSQL_VOLUME_NAME=nodeaccess_mysql_data \
REDIS_BIND_ADDRESS=192.168.1.100 \
REDIS_PUBLISHED_PORT=6380 \
REDIS_REPLICA_HOST=192.168.1.101 \
REDIS_REPLICA_PORT=6380 \
REDIS_VOLUME_NAME=nodeaccess_redis_data \
docker compose \
  --env-file /opt/nodeaccess/shared/.env \
  -f /opt/nodeaccess/current/docker-compose.ha-state.yml \
  up -d
```

Por que o perfil `replica-bootstrap.cnf` e usado primeiro: o volume ainda
precisa criar usuarios e schemas. Ativar `super_read_only` antes disso impede a
inicializacao normal do MySQL.

#### 3.3 Restaurar o seed e ativar somente leitura no A

```bash
DB_ROOT_PASSWORD="$(sed -n 's/^DB_ROOT_PASSWORD=//p' \
  /opt/nodeaccess/shared/.env)"

gzip -dc /tmp/nodeaccess-mysql-replica-seed.sql.gz |
  docker exec -i nodeaccess-state-mysql-1 \
    mysql -uroot -p"$DB_ROOT_PASSWORD"

install -m 0644 \
  /opt/nodeaccess/current/docker/mysql/ha/replica-node-a.cnf \
  /opt/nodeaccess/shared/mysql/replica-a-conf/nodeaccess.cnf

docker restart nodeaccess-state-mysql-1
```

Por que: depois do restore, o perfil definitivo protege A contra escritas
acidentais com `read_only` e `super_read_only`.

#### 3.4 Conectar MySQL A ao B

```bash
set -a
source /srv/nodeaccess-shared/mysql/replication.env
set +a

docker exec nodeaccess-state-mysql-1 \
  mysql -uroot -p"$DB_ROOT_PASSWORD" -e "
    STOP REPLICA;
    RESET REPLICA ALL;
    CHANGE REPLICATION SOURCE TO
      SOURCE_HOST='192.168.1.101',
      SOURCE_PORT=3307,
      SOURCE_USER='${MYSQL_REPLICATION_USER}',
      SOURCE_PASSWORD='${MYSQL_REPLICATION_PASSWORD}',
      SOURCE_AUTO_POSITION=1,
      GET_SOURCE_PUBLIC_KEY=1;
    START REPLICA;
  "
```

Validar:

```bash
bash /opt/nodeaccess/current/scripts/deploy/ha-state-replication-status.sh
```

O processo somente pode continuar com IO/SQL em `Yes`, sem erros, e Redis com
`master_link_status=up`.

### 4. Configurar arquivos

No A, `/etc/sysconfig/nodeaccess-ha-file-sync` usa:

```text
SOURCE_RSYNC=root@192.168.1.101:/srv/nodeaccess-replica
REPLICA_ROOT=/srv/nodeaccess-shared
RSYNC_RSH=ssh -i /root/.ssh/nodeaccess_ha_ed25519 -o BatchMode=yes -o StrictHostKeyChecking=accept-new
```

Depois:

```bash
install -m 0755 \
  /opt/nodeaccess/current/scripts/deploy/ha-file-replica-sync.sh \
  /opt/nodeaccess/scripts/deploy/ha-file-replica-sync.sh
install -m 0644 \
  /opt/nodeaccess/current/systemd/nodeaccess-ha-file-sync.service \
  /etc/systemd/system/nodeaccess-ha-file-sync.service
install -m 0644 \
  /opt/nodeaccess/current/systemd/nodeaccess-ha-file-sync.timer \
  /etc/systemd/system/nodeaccess-ha-file-sync.timer

systemctl daemon-reload
systemctl start nodeaccess-ha-file-sync.service
systemctl enable --now nodeaccess-ha-file-sync.timer
```

Antes disso, gerar uma chave SSH dedicada no A e autorizar sua chave publica no
B. A sincronizacao deve funcionar sem solicitar senha:

```bash
ssh-keygen -t ed25519 -N '' \
  -f /root/.ssh/nodeaccess_ha_ed25519 \
  -C nodeaccess-ha-a-to-b

ssh -i /root/.ssh/nodeaccess_ha_ed25519 \
  -o BatchMode=yes root@192.168.1.101 true
```

### 5. Instalar a aplicacao

```bash
ENV_FILE=/opt/nodeaccess/shared/.env \
COMPOSE_FILE=/opt/nodeaccess/current/docker-compose.ha.yml \
USE_EXTERNAL_STATEFUL_SERVICES=true \
TLS_MODE=off \
RUN_SMOKE_CHECK=true \
bash /opt/nodeaccess/current/scripts/deploy/install-nodeaccess.sh
```

No standby A, `DATABASE_URL` e `REDIS_URL` apontam para B. Os caminhos de
auditoria, avatares e backups apontam para `/srv/nodeaccess-shared`.

### 6. Configurar o VIP

- B: estado MASTER, prioridade 110;
- A: estado BACKUP, prioridade 100;
- interface `enp0s3`;
- VRRP ID 51;
- VIP `192.168.1.105/24`;
- mesmo `auth_pass`;
- firewall permitindo protocolo VRRP 112 entre A e B.

Exemplo do gate de firewall no A:

```bash
iptables -I INPUT 1 \
  -s 192.168.1.101/32 \
  -p vrrp \
  -m comment --comment "NodeAccess HA VRRP B" \
  -j ACCEPT
```

Copiar o exemplo correspondente a cada no, ajustar os valores e testar antes de
iniciar:

```bash
keepalived -t -f /etc/keepalived/keepalived.conf
systemctl enable --now keepalived
```

Se houver nginx/httpd nativo no host ocupando 80/443, ele deve ser removido da
rota ou desabilitado antes de iniciar o frontend Docker.

## Inicio e conclusao do processo

O processo completo deve seguir estes gates:

1. validar checksum da release;
2. instalar B e confirmar que ele continua primario;
3. copiar para A o mesmo `.env`, preservando `PEM_ENCRYPTION_KEY`;
4. criar seed e reconstruir as replicas locais do A;
5. configurar e testar a sincronizacao de arquivos;
6. iniciar a aplicacao A apontando para o estado primario B;
7. configurar firewall e Keepalived;
8. executar `standby-readiness.sh`;
9. criar uma prova em MySQL, Redis e arquivos;
10. confirmar a mesma prova no A;
11. testar failover e failback do VIP;
12. remover as provas e registrar RTO/RPO.

O processo esta concluido somente quando:

- ambas as aplicacoes reportam a mesma versao;
- deep health local e pelo VIP esta `ok`;
- MySQL e Redis estao replicando;
- a copia de arquivos e recente;
- `standby-readiness.sh` termina com `failures: 0`;
- somente um no possui o VIP;
- failover e failback foram aprovados.

### Matrícula limpa e falhas controladas — 29/07/2026

O nó A (`192.168.1.100`) foi removido até o estado de host com Docker e recebeu
o comando `curl` exibido pela tela. O comando:

- instalou e ativou o timer do agente;
- registrou a VIP `192.168.1.105`;
- enviou heartbeat e inventário;
- reportou o nó como degradado, enumerando os componentes ausentes.

Ele não instala a release, MySQL, Redis, réplicas, containers ou Keepalived.
Assim, “anexar nó” significa matrícula e diagnóstico, não provisionamento
integral. O plano passou a mostrar stack, replicação e Keepalived/VIP como
etapas explícitas, e o status `READY` do plano é apresentado como “Plano
disponível”, não como nó pronto.

Durante o re-seed, A ficou temporariamente inacessível por rede. B permaneceu
`PRIMARY`, único dono da VIP e respondeu deep health `ok`; nenhuma promoção
foi tentada. Quando A retornou, o agente retomou heartbeat sem obter a VIP e o
seed já estava completo. Após fingerprints determinísticos idênticos, oito
GTIDs locais do bootstrap foram reconciliados no primário como transações
vazias, com journal. O gate final confirmou MySQL/Redis/arquivos `ok`,
`dataConsistency=ok` e `readyForFailback=true`.

Com B isolado como único nó disponível, falhas controladas confirmaram o modo
fail-closed da VIP:

| Falha em B | Retirada da VIP | Recuperação após restaurar |
|---|---:|---:|
| frontend | 10 s | 14 s |
| gateway SSH | 12 s | 20 s |
| API | 12 s | 20 s |
| Redis | 14 s | 12 s |
| MySQL | 2 s | 20 s |

O ensaio de frontend encontrou um gate ausente. O health script do Keepalived
passou a exigir também o frontend local; API e gateway já eram obrigatórios.

O ensaio também executou o pacote com nome local diferente do diretório interno.
O instalador foi corrigido para descobrir e validar a raiz versionada do
tarball; downloads feitos com `curl -o <outro-nome>.tar.gz` não dependem mais
do nome escolhido pelo operador.

Estado final: A `HEALTHY/STANDBY`, pronto para promoção e sem VIP; B
`HEALTHY/PRIMARY`, único dono da VIP; pacote `2.0.28` com SHA-256
`fdb3ef1932f59465c2681fc1fab31f0898187987d90ecf12a2b2da52cd488a6d`.

## Provisionamento assistido de release

O primeiro estágio mutável do provisionamento integral usa a ação catalogada
`INSTALL_RELEASE`. Depois de gerar e revisar um plano, o operador informa na
tela:

- URL HTTP(S) acessível pelo nó;
- SHA-256 publicado junto ao pacote.

A API persiste apenas esses parâmetros no job, entrega lease de 30 minutos e
mantém o journal da operação. O agente repete os gates localmente:

- papel `STANDBY` e ausência da VIP;
- Docker Engine e Compose disponíveis;
- HTTPS obrigatório, exceto laboratório com opt-in explícito;
- SHA-256 idêntico;
- uma única raiz `nodeaccess-release-<versão>` no tarball;
- instalador versionado presente.

Com os gates aprovados, o agente carrega as imagens offline e promove a release
em `/opt/nodeaccess/current` com `RUN_INSTALL=false`. Banco, Redis, réplicas,
containers e Keepalived não são iniciados por esta ação. A saída resumida fica
no journal do painel; falha de download, checksum ou estrutura encerra o job
como `FAILED`, sem liberar a VIP.

Segredos compartilhados e seed não devem ser adicionados a `params_json`.
Essas etapas exigem envelope cifrado, consumo único e remoção após uso antes de
entrarem no catálogo governado.

### Evidência do ensaio real da release 2.0.29

Em 2026-07-29, a ação foi executada de ponta a ponta no nó A
(`192.168.1.100`), enquanto o nó B (`192.168.1.101`) permaneceu como
`PRIMARY` e único dono da VIP `192.168.1.105`:

- operação `dcd62c11-6858-4d1f-a4a5-6fbc230dc287`;
- pacote `nodeaccess-release-2.0.29.tar.gz`;
- SHA-256 `13ee594abfbccf15d1a137255726690858de377f2be368df3a2b192150305b47`;
- transição observada: `QUEUED -> LEASED -> COMPLETED`;
- release promovida em `/opt/nodeaccess/current`, sem iniciar containers;
- diretório temporário de download vazio após a conclusão;
- ativação posterior e controlada dos containers `2.0.29` no standby;
- health profundo HTTP 200 nos dois nós;
- MySQL do standby com IO/SQL `Yes` e atraso de zero segundo;
- Redis do standby como `slave`, com link `up`;
- agentes ativos e com último resultado `success`;
- VIP ausente no standby e presente apenas no primário.

O servidor HTTP e a regra de firewall temporários usados exclusivamente no
ensaio foram removidos ao final.

## Provisionamento seguro da configuração

O segundo estágio usa a ação catalogada `APPLY_SHARED_SECRETS`. Na instalação,
o agente gera uma chave RSA de 3072 bits no próprio nó e publica somente a
chave pública no heartbeat. A chave privada permanece com permissão `0600` em
`/var/lib/nodeaccess-ha-agent`.

O painel aceita somente os seis valores necessários para alinhar a identidade
e o estado compartilhado:

- `JWT_SECRET`;
- `PEM_ENCRYPTION_KEY`;
- `MYSQL_ROOT_PASSWORD`;
- `MYSQL_PASSWORD`;
- `MYSQL_REPLICATION_PASSWORD`;
- `REDIS_PASSWORD`.

O backend cifra cada valor com RSA-OAEP/SHA-256 para a chave exclusiva do
standby. Texto aberto não entra em `params_json`, no journal ou na resposta de
conclusão. Depois que o agente conclui ou rejeita a ação, o envelope cifrado é
removido do job.

O agente repete os gates de papel `STANDBY` e ausência de VIP, decifra em
diretório `0700`, monta um arquivo candidato, troca o `.env` atomicamente e
remove os arquivos de trabalho. O arquivo anterior fica em
`/var/lib/nodeaccess-ha-agent/shared.env.previous`, com acesso restrito, para
rollback local.

Esta ação não reinicia containers, não muda replicação e não altera
Keepalived. O transporte pelo painel exige HTTPS sem exceção, inclusive em
laboratório. Portanto, no ambiente atual servido por HTTP, o controle aparece
bloqueado até a configuração de TLS.

### TLS provisório do laboratório

Em 2026-07-29, os dois nós passaram a usar o mesmo certificado autoassinado,
válido por sete dias, com SAN para `192.168.1.105`, `192.168.1.100` e
`192.168.1.101`. Fingerprint SHA-256:
`D3:EB:1A:6F:04:C2:9D:A5:22:E4:5B:E9:E9:A8:63:8A:F4:39:83:CA:53:61:07:6A:E7:15:8A:3E:09:B9:48:C2`.

Os arquivos ficam em `/opt/nodeaccess/shared/certs`, o nginx usa
`docker/nginx.https.conf`, HTTP responde 301 e os agentes usam
`https://192.168.1.105/api/v1`. A CA provisória foi adicionada ao trust store
do Rocky Linux nos dois nós.

O frontend do navegador mostrará aviso até que o certificado seja importado
como confiável na estação do operador. Para rollback, restaurar
`/opt/nodeaccess/shared/.env.before-temporary-tls`, recriar apenas o serviço
`frontend` com `docker/nginx.http.conf`, voltar a URL dos agentes para HTTP e
remover `/etc/pki/ca-trust/source/anchors/nodeaccess-ha-lab.crt`.

Ao ativar TLS, o redirect 301 do frontend inicialmente bloqueou o health check
do Keepalived e removeu corretamente a VIP. O script foi ajustado para seguir
o redirect local e validar o resultado final; a VIP voltou somente no
`PRIMARY`.

## Fechamento da release 2.0.30

Em 2026-07-29/30, a release `2.0.30` foi instalada de forma rolling nos dois
nós. O artefato final offline possui SHA-256
`8941f4a3cd66578649d09a826f7719dbb96b7b42105839d70df8238354a9d44e`.

O E2E de configuração segura comprovou:

- agente publicou chave RSA própria;
- seis valores sintéticos foram cifrados, consumidos e aplicados no standby;
- `params_json` foi apagado após consumo;
- nenhum valor apareceu no banco, journal ou logs da API;
- diretórios de decifragem foram removidos;
- rollback governado restaurou integralmente o `.env`;
- chave privada incorreta produziu operação `FAILED`, sem alterar configuração;
- certificado com hostname incorreto derrubou o agente, e a restauração do
  endpoint válido recuperou o heartbeat.

O ensaio encontrou e corrigiu a ausência de `X-Forwarded-Proto` no nginx HTTPS.
Também removeu o `TLS_MODE=off` fixo da promoção: o script agora preserva TLS,
escolhe o nginx correspondente e executa o smoke no IP administrativo do nó.

A troca planejada real `close-2030-b-to-a-20260729` foi concluída com:

- `.101` congelado e removido da VIP antes da evidência witness;
- paridade final de GTID e arquivos;
- nonce witness consumido uma única vez;
- promoção de MySQL, Redis, aplicação e Keepalived em `.100`;
- smoke HTTPS com verificação de certificado;
- `.101` reintegrado como standby protegido;
- MySQL IO/SQL `Yes`, lag zero e Redis `slave/up` no novo standby.

Estado final: `.100` é `PRIMARY` e único dono da VIP `192.168.1.105`; `.101`
é `STANDBY`, sem VIP; ambos respondem health profundo HTTP 200 na versão
`2.0.30`, com agentes e Keepalived ativos. O Playwright real e somente leitura
passou pela VIP HTTPS em `1440x1000` e `390x844`, sem findings, erros de
console, exceções ou divergências entre API e interface.

## Scripts utilizados nos testes

| Script | Uso |
| --- | --- |
| `scripts/release/build-release.sh` | Gera pacote e imagens offline |
| `scripts/deploy/install-from-tarball.sh` | Extrai e promove a release |
| `scripts/deploy/install-nodeaccess.sh` | Valida ambiente, aplica migrations e sobe a aplicacao |
| `scripts/deploy/doctor-nodeaccess.sh` | Valida compose, imagens, disco, backups e health |
| `scripts/deploy/ha-state-readiness.sh` | Valida segredos, storages, backups e endpoints |
| `scripts/deploy/standby-readiness.sh` | Orquestra todos os gates do standby |
| `scripts/deploy/ha-state-replication-status.sh` | Verifica MySQL e Redis |
| `scripts/deploy/ha-file-replica-sync.sh` | Sincroniza arquivos para o standby |
| `scripts/deploy/ha-file-replica-status.sh` | Verifica idade da ultima copia |
| `scripts/deploy/keepalived-health-check.sh` | Decide se o no pode manter o VIP |
| `scripts/deploy/pre-failover-check.sh` | Gate antes da troca de trafego |
| `scripts/deploy/post-failover-check.sh` | Gate depois da troca |
| `scripts/deploy/promote-ha-standby.sh` | Promocao total manual, com confirmacao explicita |
| `scripts/backup/backup-all-nodeaccess.sh` | Gera backups de todos os estados |
| `scripts/backup/check-dr-artifacts.sh` | Valida artefatos, manifests e checksums |
| `tools/deploy/dr-validation-harness.sh` | Testa restores isolados |

## Validacao final utilizada

1. deep health local nos dois nos;
2. deep health pelo VIP;
3. MySQL IO/SQL em `Yes`, lag 0;
4. Redis replica conectada;
5. mesmo identificador de prova em MySQL, Redis e arquivo;
6. `standby-readiness.sh` com `failures: 0`;
7. parada do Keepalived B;
8. VIP e deep health confirmados no A;
9. retorno do Keepalived B;
10. VIP e deep health confirmados novamente no B.

## Limite atual e evolucao para failover completo

O fluxo testado comprova replicacao, readiness e troca do VIP, mas a perda total
do no que mantem o estado ainda exige promocao controlada. Mover somente o VIP
nao promove MySQL, Redis nem a direcao da copia de arquivos.

O estado alvo esta detalhado em `docs/PRD-ha-redundancy-dr-lite.md` e inclui:

- promocao conjunta de MySQL, Redis, arquivos, frontend, API, SSH Gateway,
  guacd, jobs e VIP;
- operacao idempotente com journal, etapas visiveis e recuperacao;
- rollback automatico apenas antes de o novo primario aceitar escritas;
- witness ou fencing externo obrigatorio para failover automatico seguro;
- perfil HA opcional, sem alterar a instalacao single-node padrao;
- tela administrativa com topologia, replicacao, readiness e historico.

Enquanto witness/fencing e a orquestracao transacional nao forem implementados,
o procedimento seguro para perda total continua sendo promocao manual,
confirmacao explicita de isolamento do no antigo e validacao antes/depois pelos
scripts existentes.

### Matricula pelo painel

Com o entitlement comercial `ha` habilitado, um SuperAdmin acessa
`Plataforma > Alta disponibilidade`, seleciona `Anexar no` e informa um nome
para o standby. A tela gera um comando de instalacao com token de matricula.

O comando deve ser executado como root no standby em ate 15 minutos. HTTPS e
obrigatorio por padrao. Somente em uma POC local isolada pode-se antepor
`NODEACCESS_HA_ALLOW_HTTP=true`.

Depois da instalacao, o timer `nodeaccess-ha-agent.timer` envia a cada 30
segundos o estado de MySQL, Redis, arquivos, API, frontend, SSH Gateway e guacd.
O token fica em `/opt/nodeaccess-ha-agent/agent.env`, com permissao `600`.

O agente nao recebe comandos de shell e nao promove servicos. Neste corte ele
somente valida e notifica; promocao permanece bloqueada quando a tela indicar
`Pronto para promocao: Nao`.

O botao `Executar preflight` e seguro para uso durante operacao normal: ele
somente avalia o ultimo heartbeat e grava o resultado no journal. Mesmo quando
o resultado for `Pronto`, fencing ou witness continua pendente e nenhuma troca
de papel ou trafego e executada.

Durante o primeiro deploy da `2.0.6` em banco vazio, o utilitario
`create-superadmin.mjs` foi corrigido para localizar usuario por `email` e
`tenantId`. O schema nao define email como chave unica global; usar
`findUnique({ email })` impedia o bootstrap de um ambiente limpo.

O teste do download do agente na `2.0.6` tambem identificou que a rota estava
registrada, mas o arquivo nao fazia parte da imagem final do backend. O
`docker/backend.Dockerfile` passou a copiar `install-ha-agent.sh` para a imagem.
Na `2.0.6`, o teste pode usar a copia identica presente na release; releases
posteriores devem validar HTTP 200 em `/api/v1/ha/agent/install.sh`.

No primeiro heartbeat, a deteccao de frontend, gateway e guacd tambem foi
ajustada para consultar labels `com.docker.compose.*` diretamente no Docker.
Isso evita falsos negativos quando a stack usa `docker-compose.ha.yml`, mas o
comando e executado fora do contexto desse arquivo.

### Resultado do ensaio da versao 2.0.6

Ambiente em 27/07/2026:

- B `192.168.1.101`: primario, dono do VIP `192.168.1.105`;
- A `192.168.1.100`: standby;
- frontend, API e SSH Gateway em `2.0.6` nos dois nos;
- migrations `add_ha_nodes` e `add_ha_operations` aplicadas no B e recebidas
  pela replica A;
- MySQL IO/SQL `Yes`, lag zero;
- Redis replica conectada;
- replica de arquivos dentro de RPO;
- agente A matriculado e timer ativo;
- todos os componentes reportados como `ok`;
- `promotionReady=true`;
- preflight persistido como `READY`;
- fencing permaneceu `required`, sem promocao ou troca de trafego;
- deep health pelo VIP respondeu `version=2.0.6`.

Correcoes incorporadas ao fonte depois do pacote `2.0.6`:

- incluir o instalador HA no pacote de release;
- incluir o instalador HA na imagem backend para a rota de download;
- detectar containers pelos labels do Compose;
- corrigir bootstrap de SuperAdmin por email e tenant.

Essas correcoes devem compor a proxima release antes de repetir o teste de
download via `curl` sem copia auxiliar.

### Resultado do ensaio da versao 2.0.7

Ambiente em 27/07/2026:

- B `192.168.1.101`: primario e dono do VIP `192.168.1.105`;
- A `192.168.1.100`: standby;
- frontend, API e SSH Gateway em `2.0.7` nos dois nos;
- deep health local e pelo VIP com `status=ok` e `version=2.0.7`;
- MySQL com IO/SQL `Yes` e lag zero;
- Redis como replica, link ativo e sem sincronizacao pendente;
- replica de arquivos dentro do gate de 120 segundos;
- download do instalador em `/api/v1/ha/agent/install.sh` com HTTP 200 e
  conteudo identico ao script empacotado;
- reinstalacao idempotente do agente pelo script baixado via `curl`;
- timer do agente ativo e ultimo report concluido com `status=0/SUCCESS`;
- no A reportado como `HEALTHY`, `promotionReady=true` e todos os componentes
  em `ok`;
- preflight persistido como `READY`;
- acesso de um administrador sem privilegio de plataforma recusado com HTTP
  403;
- fencing permaneceu `required`; nenhuma promocao ou troca de trafego foi
  executada.

O no B terminou o ensaio com aproximadamente 3,1 GB livres. Antes de armazenar
ou extrair outra release offline, remova artefatos antigos de forma controlada
ou aumente o disco para evitar falha por falta de espaco durante uma atualizacao.

#### Limpeza e reteste posterior

Apos o ensaio, foram removidos apenas tarballs temporarios, releases anteriores
a `2.0.6` e imagens Docker sem uso. Volumes, banco, configuracao compartilhada,
backups e as releases `2.0.6` e `2.0.7` foram preservados. O espaco livre passou
para aproximadamente 9,4 GB no B e 8,9 GB no A.

Depois da limpeza:

- deep health dos dois nos continuou `ok`;
- MySQL permaneceu com IO/SQL `Yes` e lag zero;
- Redis permaneceu conectado como replica;
- arquivos permaneceram dentro do gate de 120 segundos;
- agente HA permaneceu ativo;
- ao parar apenas o Keepalived do B, o VIP `192.168.1.105` migrou para A e
  respondeu deep health com `version=2.0.7`;
- ao restaurar o Keepalived do B, o VIP retornou ao primario e continuou
  respondendo `status=ok`.

Esse teste valida somente a continuidade da camada de entrada enquanto o estado
primario continua acessivel. Ele nao substitui fencing nem promove MySQL, Redis
ou a direcao da replica de arquivos.

### Resultado do ensaio da versao 2.0.8

Ambiente em 27/07/2026:

- B e A atualizados para frontend, API e SSH Gateway `2.0.8`;
- deep health local e pelo VIP com `status=ok` e `version=2.0.8`;
- MySQL com IO/SQL `Yes` e lag zero;
- Redis conectado como replica;
- arquivos dentro do gate de 120 segundos;
- agente ativo e no A reportado como `HEALTHY`;
- todos os componentes reportados como `ok` e `promotionReady=true`;
- preflight persistido como `READY`, sem promocao;
- scripts de witness presentes e com sintaxe valida;
- evidencia assinada valida aceita e evidencia adulterada recusada;
- admin comum recusado com HTTP 403 ao alterar o entitlement HA;
- desativacao recusada com HTTP 409 enquanto existe no anexado.

O ensaio encontrou uma regressao no novo endpoint de ativacao pelo SuperAdmin:
o `PATCH /api/v1/ha/entitlement` retornou HTTP 500 porque tentava atualizar a
coluna inexistente `licenses.updated_at`. A consulta foi removida do fonte, mas
o ajuste requer uma release posterior a `2.0.8`. O entitlement existente
permaneceu habilitado e nenhuma configuracao HA foi perdida.

A troca manual do link `current` tambem exige recriar o link
`/opt/nodeaccess/current/.env` para `/opt/nodeaccess/shared/.env`. O instalador
completo deve continuar sendo preferido para preservar o layout compartilhado.

### Resultado do ensaio da versao 2.0.9

Ambiente em 27/07/2026:

- rolling update executado primeiro no standby A e depois no primario B;
- B e A executando frontend, API e SSH Gateway `2.0.9`;
- deep health local e pelo VIP com `status=ok` e `version=2.0.9`;
- MySQL com IO/SQL `Yes` e lag zero;
- Redis conectado como replica;
- arquivos dentro do gate de 120 segundos;
- agente ativo e no A reportado como `HEALTHY`;
- todos os componentes em `ok` e `promotionReady=true`;
- preflight persistido como `READY`, sem promocao;
- ativacao idempotente do entitlement HA por SuperAdmin respondeu HTTP 200;
- tentativa do admin comum respondeu HTTP 403;
- tentativa de desabilitar HA com no anexado respondeu HTTP 409;
- bundle do frontend contem o CTA `Habilitar alta disponibilidade`.

A regressao de `licenses.updated_at` encontrada na `2.0.8` foi corrigida e nao
se repetiu. A topologia existente permaneceu habilitada durante todo o ensaio.

#### Falhas controladas na versao 2.0.9

Foram executadas e restauradas, uma por vez, falhas somente no standby A:

- `STOP REPLICA` no MySQL mudou o no para `DEGRADED` e
  `promotionReady=false`; apos `START REPLICA`, o lag retornou a zero;
- parada temporaria do Redis mudou o no para `DEGRADED` e bloqueou promocao;
- marcador de arquivos com 300 segundos, acima do RPO de 120 segundos, reportou
  somente `files=unknown` e bloqueou promocao;
- restauracao do marcador seguida de sincronizacao devolveu arquivos ao gate;
- ao final, o no voltou a `HEALTHY`, todos os componentes `ok`,
  `promotionReady=true` e deep health pelo VIP `status=ok`.

O ensaio identificou que o agente `2.0.9` executa o gate de MySQL e Redis de
forma agregada. Assim, a falha isolada de qualquer um deles reporta ambos como
`down`, embora o bloqueio de promocao esteja correto. O fonte foi ajustado para
`ha-state-replication-status.sh` aceitar `CHECK_COMPONENT=mysql|redis|all` e o
agente executar os dois checks separadamente. A correcao requer nova release.

### Resultado do ensaio da versao 2.0.10

Em 27/07/2026, o ambiente foi retomado depois de um reinicio inesperado e
atualizado por rolling update, primeiro no standby A e depois no primario B:

- B e A executando frontend, API e SSH Gateway `2.0.10`;
- deep health local e pelo VIP com `status=ok` e `version=2.0.10`;
- B permaneceu primario e dono do VIP `192.168.1.105`;
- MySQL A com IO/SQL em `Yes` e lag zero;
- Redis A como replica com link ativo;
- arquivos dentro do gate de 120 segundos;
- agente HA reinstalado no A e timer ativo;
- no A reportado como `HEALTHY`, todos os componentes em `ok` e
  `promotionReady=true`.

As falhas controladas confirmaram o diagnostico independente introduzido nesta
versao:

- com `STOP REPLICA` somente no MySQL A, o agente reportou `mysql=down`,
  `redis=ok` e `files=ok`;
- com somente o Redis A parado, o agente reportou `mysql=ok`, `redis=down` e
  `files=ok`;
- nos dois casos o no mudou para `DEGRADED` e `promotionReady=false`;
- depois da restauracao, MySQL voltou a lag zero, Redis voltou com link `up` e
  o no retornou a `HEALTHY` com `promotionReady=true`.

Nenhuma promocao de estado foi executada. O fencing continuou obrigatorio para
um failover total.

### Resultado do ensaio da versao 2.0.11

Em 27/07/2026, foi iniciado o contrato estruturado dos gates necessario para a
orquestracao assistida:

- `ha-state-replication-status.sh` e `ha-file-replica-status.sh` passaram a
  aceitar `OUTPUT_FORMAT=json`;
- o contrato `nodeaccess-ha-status-v1` foi validado em sucesso e falha,
  preservando os exit codes existentes;
- o formato texto permaneceu como padrao para compatibilidade;
- o agente passou a consumir o contrato MySQL e enviar `lagSeconds`;
- rolling update foi executado primeiro no standby A e depois no primario B;
- deep health local e pelo VIP respondeu `status=ok` e `version=2.0.11`;
- o heartbeat persistido reportou MySQL e Redis em `ok`, `lagSeconds=0`,
  `promotionReady=true` e no `HEALTHY`;
- B retomou o VIP `192.168.1.105` depois do health check.

Os pacotes temporarios enviados para `/tmp` foram removidos. As releases
`2.0.10` e `2.0.11` foram preservadas para rollback. Releases mais antigas
continuam ocupando espaco e devem ser removidas de forma controlada antes da
proxima geracao.

### Resultado do ensaio da versao 2.0.12

Em 28/07/2026, o fluxo assistido de retorno do no foi entregue e validado:

- rolling update executado primeiro no standby A e depois no primario B;
- B e A executando frontend, API e SSH Gateway `2.0.12`;
- deep health local nos dois nos e pela VIP respondeu `status=ok`;
- B permaneceu primario e dono da VIP `192.168.1.105`;
- MySQL A com IO/SQL em `Yes` e lag zero;
- Redis A como replica com link ativo;
- replica de arquivos dentro do gate de 120 segundos;
- `prepare-ha-rejoin.sh` em modo `check` reportou MySQL, Redis e arquivos em
  `ok`, com `readyForFailback=true`;
- timers do agente HA e da sincronizacao de arquivos permaneceram ativos;
- migrations confirmaram 107 migrations aplicadas e nenhuma pendencia.

Durante a atualizacao do A, a recriacao manual do frontend sem exportar
`NGINX_CONFIG_FILE` usou o default HTTPS e reiniciou por ausencia de
certificados. O servico foi recriado com `TLS_MODE=off` e
`NGINX_CONFIG_FILE=./docker/nginx.http.conf`, retornando ao estado saudavel.
Em atualizacoes manuais com `docker compose`, essas duas variaveis devem ser
informadas explicitamente; o fluxo pelos scripts de instalacao resolve essa
selecao automaticamente.

Os pacotes temporarios enviados para `/tmp` foram removidos. As releases
`2.0.11` e `2.0.12` foram preservadas para rollback.

### Resultado do ensaio da versao 2.0.14

Em 28/07/2026, a topologia visual e a telemetria do no primario foram
validadas no ambiente:

- B reportou `PRIMARY`, `ownsVip=true`, IP administrativo `192.168.1.101` e
  VIP `192.168.1.105`;
- A reportou `STANDBY`, `ownsVip=false`, IP administrativo `192.168.1.100` e
  `promotionReady=true`;
- ambos os nos ficaram `HEALTHY`, sem bloqueadores e com heartbeat recente;
- a tela passou a separar VIP e IP administrativo, centralizar o fluxo
  VIP para nos e explicar preflight, retorno, fencing, witness e prontidao;
- acoes de promocao deixaram de ser exibidas no no PRIMARY;
- Playwright validou estados saudavel, degradado, vazio, sem licenca, erro e
  loading em desktop e mobile, sem overflow ou findings;
- rolling update terminou com A e B em `2.0.14`, 108 migrations aplicadas e
  deep health da VIP em `status=ok`.

### Protecoes da proxima promocao assistida

- o plano somente leitura usa `OPERATION_ID` e persiste os gates fora do
  MySQL;
- a promocao mantem um journal JSONL por operacao no armazenamento
  compartilhado;
- a evidencia do witness tem nonce de uso unico, consumido atomicamente apenas
  quando a promocao efetiva comeca;
- o preflight da API exige um unico PRIMARY, um unico dono da VIP, confirma
  que esse dono e o PRIMARY e bloqueia o candidato caso ele ja possua a VIP;
- `npm run test:ha:promotion-plan` valida o caminho feliz, o bloqueio por
  estado degradado e a rejeicao de replay;
- o harness e o plano nao promovem MySQL, Redis, aplicacao ou VIP.

### Gate de retorno e failback

- `prepare-ha-rejoin.sh` aceita `ACTIVE_NODE_IP` também em `MODE=check`;
- o relatorio diferencia saude dos componentes de consistencia com o no ativo;
- `readyForFailback=true` exige MySQL, Redis e arquivos saudaveis, nenhum GTID
  errante e nenhuma transacao do ativo ausente no no recuperado;
- sem `ACTIVE_NODE_IP`, `dataConsistency=not-checked` e o failback permanece
  bloqueado;
- o harness isolado confirma que o registro criado em B durante a queda de A
  chega ao A após a inversao controlada da replicacao;
- esse gate nao move VIP e nao altera o papel do ambiente vivo.

Quando A e B possuem fingerprints determinísticos idênticos, mas A conserva
GTIDs históricos ausentes em B, `reconcile-ha-empty-gtids.sh` pode registrar o
intervalo como transações vazias no ativo. A operação exige confirmação
explícita, confirmação separada da igualdade dos fingerprints, intervalo GTID
contínuo e journal persistente. Fingerprints divergentes exigem reconciliação de
dados ou re-seed; nunca devem usar esse procedimento.

No switchover planejado, `quiesce-ha-primary.sh` cria a barreira de escrita na
origem antes de liberar a VIP. A operação exige confirmação, journal e marcador
persistente. Qualquer falha antes da promoção executa rollback automático,
remove `read_only/super_read_only` e reinicia o Keepalived da origem. A promoção
do destino continua separada e exige paridade final e witness válido.

### Resultado pós-switchover da versão 2.0.20

Em 28/07/2026, após o retorno controlado do papel PRIMARY para A:

- A permaneceu gravável, dono da VIP `192.168.1.105` e com deep health `ok`;
- B permaneceu protegido por `read_only/super_read_only`, com MySQL IO/SQL em
  `Yes`, lag zero e Redis conectado ao A;
- o gate `prepare-ha-rejoin.sh` em modo `check`, comparando B com A, reportou
  `readyForFailback=true`;
- a tela real pelo VIP passou no Playwright em `1440x1000` e `390x844`, sem
  mutações, erros de console, exceções ou overflow horizontal;
- papel observado, IP administrativo, prontidão e lag foram confirmados nos
  dois nós;
- a suíte isolada dos gates pode ser repetida com
  `npm run test:ha:control-plane`.

### Resultado do ensaio da versão 2.0.21

Em 28/07/2026, os invariantes globais anti-split-brain foram publicados:

- o preflight passou a exigir um único PRIMARY e um único dono da VIP;
- o PRIMARY foi confirmado como dono da VIP e o candidato como não proprietário;
- testes unitários cobriram a topologia saudável e o bloqueio de dois
  PRIMARY/dois donos da VIP;
- a suíte `npm run test:ha:control-plane` permaneceu aprovada;
- rolling update foi executado primeiro no standby B e depois no PRIMARY A;
- A e B responderam deep health `ok` na versão `2.0.21`, com 108 migrations
  aplicadas e nenhuma pendência;
- A permaneceu gravável e dona da VIP `192.168.1.105`;
- B permaneceu read-only, com MySQL IO/SQL em `Yes`, lag zero e timers HA ativos;
- o preflight real do B terminou em `READY` com todos os novos gates em `ok`;
- fencing ou witness continuou explicitamente pendente e nenhuma promoção foi
  executada.

### Inventário e plano de provisionamento

O agente HA pode ser matriculado antes de o Docker estar instalado. A cada
heartbeat ele envia apenas inventário operacional não sensível:

- hostname, sistema operacional e arquitetura;
- quantidade de CPUs, memória total e espaço livre na raiz;
- presença e versão do Docker Engine;
- presença do plugin Docker Compose.

A ação `Avaliar provisionamento` cria um journal somente leitura. Sistema e
arquitetura incompatíveis bloqueiam o plano; Docker, Compose e capacidade abaixo
da recomendação aparecem como etapas pendentes. O plano sempre exige aprovação
antes de qualquer execução futura e não instala pacotes, altera serviços,
replicação ou VIP.

### Resultado do ensaio da versão 2.0.22

Em 28/07/2026:

- a migration 109 adicionou o inventário dos nós e foi aplicada no PRIMARY A,
  replicando para o standby B;
- os agentes de A e B foram reinstalados com coleta de inventário;
- A e B responderam deep health `ok` na versão `2.0.22`;
- o Playwright live confirmou inventário, papel, IP, prontidão e lag em
  `1440x1000` e `390x844`, sem findings, overflow ou erros de console;
- o plano real do B terminou em `READY`;
- Linux, arquitetura, Docker e Compose passaram;
- a capacidade ficou pendente para revisão, pois o laboratório possui
  aproximadamente `1778 MB` de RAM e `4812 MB` livres no B, abaixo da
  recomendação do plano;
- a aprovação permaneceu pendente e nenhuma instalação ou alteração de
  topologia foi executada.

### Executor governado do agente

O primeiro contrato de execução remota usa uma fila persistente por nó:

- somente SuperAdmin pode enfileirar uma ação;
- é obrigatório existir plano de provisionamento `READY`;
- a confirmação aceita somente `REFRESH_INVENTORY`;
- apenas uma ação pode ficar pendente ou em lease por nó;
- o agente recebe lease de 90 segundos e não recebe shell ou comandos livres;
- ação desconhecida pelo catálogo local é recusada;
- início, conclusão e falha atualizam o journal da operação;
- `REFRESH_INVENTORY` apenas confirma o caminho interface, API e agente; não
  instala pacotes nem altera serviços.

Etapas mutáveis futuras devem entrar individualmente no catálogo, com
pré-condições, confirmação, idempotência e rollback próprios.

### Resultado do ensaio da versão 2.0.23

Em 28/07/2026:

- a migration 110 criou a fila persistente `ha_agent_jobs`;
- rolling update foi executado primeiro no B e depois no A;
- os agentes foram reinstalados com consumo da fila governada;
- uma ação real `REFRESH_INVENTORY` foi aprovada para o B;
- a operação passou por `QUEUED`, lease do agente e `COMPLETED`;
- o journal confirmou aprovação explícita e execução concluída;
- nenhuma ação livre, instalação de pacote, alteração de serviço, replicação
  ou VIP foi permitida;
- os seis testes de serviço, typecheck e Playwright desktop/mobile passaram.

## Preparação governada de diretórios — versão 2.0.24

O catálogo do agente passou a aceitar duas ações mutáveis e fechadas:

- `PREPARE_STORAGE_DIRECTORIES`: cria somente os diretórios ausentes em
  `/srv/nodeaccess-replica` para auditoria, avatares e backups;
- `ROLLBACK_STORAGE_DIRECTORIES`: usa apenas `rmdir` nos caminhos que o próprio
  agente registrou como criados, preservando diretórios com arquivos.

As duas ações exigem plano `READY`, confirmação explícita e nó observado como
`STANDBY` sem posse da VIP. A API e o agente repetem essa proteção; não existe
entrada de comando shell livre pela interface.

### Resultado do ensaio da versão 2.0.24

Em 28/07/2026:

- rolling update foi executado primeiro no B e depois no A;
- A permaneceu como único dono da VIP `192.168.1.105`;
- ambos os nós e agentes ficaram na versão `2.0.24`;
- preparação real no B passou por fila, lease e `COMPLETED`;
- os diretórios já existiam, portanto o agente reportou zero criações;
- rollback real também concluiu e reportou zero remoções, preservando todos os
  diretórios preexistentes;
- MySQL no B permaneceu com IO/SQL `Yes` e lag zero;
- health pela VIP ficou `ok`, incluindo banco, Redis, storage e migrations;
- oito testes de serviço, typecheck e Playwright desktop/mobile passaram sem
  achados.

## Gate governado de escrita do storage — versão 2.0.25

A ação `VALIDATE_STORAGE_WRITE_ACCESS` valida permissões efetivas antes da
configuração de replicação de arquivos:

- exige plano `READY`, confirmação explícita e nó `STANDBY` sem VIP;
- recusa diretórios ausentes e links simbólicos;
- cria um arquivo-probe com modo `0600` em cada diretório permitido;
- grava e remove o probe no mesmo ciclo;
- não lê, altera ou remove arquivos da aplicação.

### Resultado do ensaio da versão 2.0.25

Em 28/07/2026:

- rolling update foi executado primeiro no B e depois no A;
- A permaneceu como único dono da VIP `192.168.1.105`;
- preparação idempotente foi repetida no B para estabelecer o estado anterior;
- `VALIDATE_STORAGE_WRITE_ACCESS` passou por fila, lease e `COMPLETED`;
- escrita foi validada em `session-audit`, `user-avatars` e `backups`;
- nenhum arquivo-probe permaneceu no filesystem;
- MySQL no B permaneceu com IO/SQL `Yes` e lag zero;
- health pela VIP ficou `ok` na versão `2.0.25`;
- nove testes de serviço, typecheck e Playwright desktop/mobile passaram sem
  achados.
