# Marco HA - Guia de implantacao e ensaio com dois nos

## Objetivo

Implantar e validar o primeiro ambiente NodeAccess active/passive com dois nos,
VIP via Keepalived, estado comum e failover controlado.

## Automacao web

A primeira camada foi implementada em
`tools/frontend/ha-playwright-smoke.cjs` e pode ser executada com
`npm run test:ha:web`. Ela usa Playwright com Chromium, respostas de API
controladas e operacao somente leitura.

A camada com API real esta em
`tools/frontend/ha-playwright-live-readonly.cjs` e usa
`npm run test:ha:web:live`. A execucao exige `HA_TEST_ACCESS_TOKEN` ou
`HA_TEST_EMAIL`, `HA_TEST_PASSWORD` e `HA_TEST_TOTP_CODE` (ou
`HA_TEST_TOTP_SECRET`). O harness bloqueia no navegador qualquer metodo
diferente de GET sob `/api/v1/ha/`.

Cobertura atual:

1. sessao simulada de SuperAdmin e acesso ao painel HA;
2. carregamento da topologia, heartbeat, componentes e journal;
3. comparacao de `status`, `promotionReady`, bloqueadores e `lagSeconds` entre
   API e interface;
4. estados loading, vazio, erro, saudavel, degradado e recurso sem licenca;
5. viewport desktop e reduzido;
6. acesso ao CTA principal por teclado e indicador visual de foco;
7. deteccao de overflow horizontal, erros de console e excecoes da pagina;
8. screenshots, relatorio JSON e trace Playwright de cenarios com falha em
   `/tmp`.

Proximas camadas:

1. executar o fluxo com login e API reais no laboratorio HA;
2. preflight real controlado e conferencia do journal;
3. bloqueio de admin comum e validacao explicita do HTTP 403;
4. diagnostico complementar de rede/WebSocket via Chromium/CDP.

O smoke web padrao nao pode promover MySQL/Redis, alterar VIP, parar containers
ou emitir fencing. Falhas controladas devem ficar em uma suite separada,
habilitada apenas por opt-in explicito no laboratorio e com restauracao
obrigatoria ao final.

## Ensaio isolado de retorno do antigo primario

O harness `tools/deploy/mysql-ha-rejoin-harness.sh` valida a preservacao dos
registros escritos durante um failover sem acessar as bases reais:

```bash
RUN_HA_REJOIN_HARNESS=true npm run test:ha:mysql-rejoin
```

O cenario cria dois MySQL temporarios com GTID, grava dados em A, replica para
B, interrompe A, promove B, grava novos dados em B e retorna A como replica de
B. O gate final exige o mesmo conteudo nos dois nos, A em somente leitura e
replicacao IO/SQL saudavel. Containers e rede temporarios sao removidos ao
final, inclusive em caso de falha.

Esse desenho nao usa multi-primary nem replicacao bidirecional simultanea. A
regra operacional permanece single-writer: depois da promocao, B e a unica
fonte de escrita; A somente pode retornar como replica de B apos fencing e
rejoin controlado. Se A receber escritas independentes durante a particao, o
rejoin deve ser bloqueado e exigir reconciliacao ou re-seed.

### Preparacao operacional do no que retornou

O script `scripts/deploy/prepare-ha-rejoin.sh` executa somente os gates no modo
padrao:

```bash
MODE=check bash scripts/deploy/prepare-ha-rejoin.sh
```

Para preparar A como replica do primario atual B:

```bash
MODE=apply \
CONFIRM_REJOIN=true \
ACTIVE_NODE_IP=192.168.1.101 \
bash scripts/deploy/prepare-ha-rejoin.sh
```

Antes de qualquer reconfiguracao, o script recusa a operacao quando:

- o no que retornou ainda possui o VIP;
- as credenciais de replicacao estao ausentes;
- existem GTIDs locais que nao existem no primario atual.

No caminho aprovado, ele protege o MySQL local com `read_only` e
`super_read_only`, inverte a replicacao MySQL e Redis, configura a copia de
arquivos do primario atual e aguarda todos os gates. O resultado estruturado
fica em `/tmp/nodeaccess-ha-rejoin-readiness.json`. O script prepara o no, mas
nao move VIP nem o promove.

Na interface, `Validar retorno` registra uma operacao `FAILBACK` somente
leitura. O journal mostra heartbeat, papel standby, MySQL, lag zero, Redis,
arquivos e as pendencias de congelamento final de escrita e fencing.

Harnesses relacionados:

```bash
# Check, confirmacao, split-brain e apply simulado
npm run test:ha:prepare-rejoin

# Dois MySQL reais temporarios: A -> B, queda, escrita em B e B -> A
RUN_HA_REJOIN_HARNESS=true npm run test:ha:mysql-rejoin

# Interface e journal FAILBACK em Chromium
npm run test:ha:web
```

O resumo operacional do desenho validado esta em
`docs/OPERATIONS-ha-two-node-flow-lite.md`.

Este marco deve produzir:

- no A ativo e no B standby com a mesma release;
- VIP acessivel pelos usuarios;
- MySQL, Redis e storages consistentes entre os nos;
- failover manual aprovado;
- failover por health check ensaiado;
- rollback aprovado;
- RTO e RPO medidos;
- evidencias suficientes para decidir o proximo marco.

Este guia registra os marcos históricos da implantação. O HA simples de dois
nós foi consolidado posteriormente com witness/fencing externo e failover
automático. Sessões SSH/WebSocket ativas ainda podem cair durante a troca e
precisam ser reabertas pelo usuário.

## Padrao validado no POC 2.0.1

O ensaio de 2026-07-26 validou o seguinte desenho sem TLS:

- no A `192.168.1.100`, no B `192.168.1.101` e VIP `192.168.1.105`;
- interface `enp0s3`, VRRP ID 51 e prioridades 110/100;
- aplicacao em ambos os nos com `docker-compose.ha.yml`;
- MySQL `192.168.1.100:3307` e Redis `192.168.1.100:6380`;
- auditoria e avatares em NFS exportado pelo no A;
- Keepalived no host e health check em
  `/opt/nodeaccess/scripts/deploy/keepalived-health-check.sh`;
- failover A para B e retorno para A com `/health/ready` respondendo `status=ok`.

No no A, os containers da aplicacao usam `mysql:3306` e `redis:6379` pela rede
Docker. No no B, usam os enderecos publicados `192.168.1.100:3307` e
`192.168.1.100:6380`. Isso evita depender de hairpin NAT no host A.

Este desenho prova a redundancia da camada de aplicacao e do VIP. Como MySQL,
Redis e NFS continuam no no A, ele nao prova tolerancia a perda total do no A.
O proximo marco deve externalizar ou replicar esses tres componentes.

## Evolucao validada com a release 2.0.2

Em 2026-07-26, os dois nos foram atualizados para `2.0.2` preservando `.env`,
`PEM_ENCRYPTION_KEY`, banco e storages. O VIP continuou em `192.168.1.105` e o
deep health confirmou `version=2.0.2` e todas as dependencias saudaveis.

### MySQL

Foi validada replicacao GTID assincrona:

- A: `server-id=1`, binlog ROW, GTID ativo, escrita habilitada;
- B: `server-id=2`, GTID ativo, `read_only` e `super_read_only`;
- threads IO e SQL: `Yes`;
- `Seconds_Behind_Source`: `0` no encerramento do ensaio;
- 105 migrations presentes na replica;
- gravacao em schema de prova replicada e conferida no no B.

A inicializacao da replica deve usar primeiro
`docker/mysql/ha/replica-bootstrap.cnf`. O perfil definitivo
`docker/mysql/ha/replica.cnf` somente pode ser aplicado depois que o entrypoint
inicializar usuarios e schema; ativar `super_read_only` antes disso bloqueia o
bootstrap.

A senha do usuario de replicacao deve possuir no maximo 32 caracteres para o
metadata de replicacao desta versao do MySQL. O dump de seed deve usar
`--no-tablespaces`, `--set-gtid-purged=ON` e ser importado selecionando
explicitamente o banco `nodeaccess`.

### Redis

Foi validada replica assincrona com AOF:

- A em papel `master`, publicado em `192.168.1.100:6380`;
- B em papel `slave`, publicado em `192.168.1.101:6380`;
- `master_link_status=up`;
- sincronizacao inicial concluida;
- chave temporaria de prova replicada e conferida no no B.

Promocao automatica ainda nao deve ser habilitada. Sem quorum/fencing, promover
MySQL ou Redis automaticamente pode produzir dois primarios durante uma
particao de rede.

### Pendencia de storage

Auditoria, avatares e backups continuam em NFS no no A. MySQL e Redis agora
possuem copias no no B, mas a perda total do no A ainda bloqueia o NFS. Para o
proximo gate, escolher uma destas opcoes:

1. NFS externo/gerenciado, preferido por simplicidade operacional;
2. terceiro host de storage;
3. DRBD/Pacemaker com fencing real;
4. replica assincrona para DR, aceitando RPO e promocao manual.

Nao usar NFS ativo/ativo gravavel nos dois nos sem um filesystem distribuido ou
coordenacao adequada.

### Ajustes descobertos

- o smoke check precisa aguardar readiness após recriar containers;
- `mysqldump` com usuario da aplicacao deve usar `--no-tablespaces`;
- o compose de estado deve usar projeto separado (`nodeaccess-state`);
- o perfil MySQL do no deve ser fornecido por um unico diretorio montado em
  `/etc/mysql/conf.d`;
- Redis deve persistir com AOF antes de servir como candidato a promocao.
- o check de DR deve selecionar o backup completo mais recente, com manifest e
  checksum, ignorando dumps auxiliares de seed sem esses artefatos.

## Ensaio de promocao total com 2.0.3

Em 2026-07-26 foi ensaiada a perda logica completa do no A:

- sincronizacao final de MySQL, Redis e arquivos aprovada;
- aplicacao do no B parada antes de desmontar o NFS;
- timer de arquivos congelado para impedir `--delete` contra origem ausente;
- Keepalived, NFS, aplicacao, MySQL e Redis parados no no A;
- MySQL e Redis do no B promovidos manualmente;
- aplicacao do no B alterada para os storages locais replicados;
- VIP `192.168.1.105` assumido pelo no B;
- deep health final aprovado em `version=2.0.3`;
- escrita direta aprovada no MySQL e Redis promovidos.

Resultado observado:

| Medida | Resultado |
| --- | --- |
| RPO configurado dos arquivos | ate 120 segundos |
| Idade da copia no momento da promocao | 75 segundos |
| Lag MySQL antes da falha | 0 segundos |
| Link Redis antes da falha | `up` |
| RTO total observado | 204 segundos |

O RTO inclui diagnostico de uma primeira tentativa. Containers Docker nao
conseguiram acessar de forma confiavel `192.168.1.101:3307/6380` no proprio host.
O padrao corrigido conecta os containers de estado a `nodeaccess_default` com
aliases `mysql` e `redis`; a aplicacao usa `mysql:3306` e `redis:6379`.

Estado ao final do ensaio:

- no B e o primario gravavel;
- MySQL B: `read_only=0`, `super_read_only=0`;
- Redis B: `role=master`;
- auditoria e avatares usam `/srv/nodeaccess-replica`;
- no A permanece isolado e nao deve ser reiniciado como primario;
- antes de reativar A, transforma-lo em replica de B e executar sincronizacao
  reversa dos arquivos.

O script de promocao exige `CONFIRM_PROMOTION=true`, desabilita o timer de
replicacao e guarda uma copia do `.env`. Promocao nao significa failback:
religar o antigo primario sem re-seed pode causar split-brain.

## Reconstrucao do standby e validacao com 2.0.4

Em 2026-07-26 o no A, antigo primario isolado, foi reconstruido como standby do
no B sem descartar os volumes que ainda possuíam um conjunto GTID compativel:

- release 2.0.4 instalada nos dois nos e deep health aprovado;
- MySQL A configurado com `server-id=1`, `read_only=1` e
  `super_read_only=1`;
- replicacao MySQL B para A com IO/SQL em `Yes`, lag de 0 segundos e sem erro;
- Redis A em `role=slave`, `master_link_status=up`;
- arquivos sincronizados de B para A a cada 60 segundos via rsync sobre SSH;
- B configurado com prioridade Keepalived 110 e A com prioridade 100;
- prova unica confirmada em MySQL, Redis e auditoria com o mesmo identificador;
- failover somente da aplicacao/VIP B para A aprovado em 13 segundos;
- retorno automatico do VIP ao B aprovado, com deep health em `version=2.0.4`.

O aplicativo no standby A usa o MySQL e Redis primarios publicados pelo B. As
replicas locais do A permanecem somente leitura ate uma promocao total
controlada. Isso evita que health checks ou tarefas da aplicacao tentem gravar
em uma replica.

Para a sincronizacao reversa, configurar no standby:

```text
SOURCE_RSYNC=root@192.168.1.101:/srv/nodeaccess-replica
REPLICA_ROOT=/srv/nodeaccess-shared
RSYNC_RSH=ssh -i /root/.ssh/nodeaccess_ha_ed25519 -o BatchMode=yes -o StrictHostKeyChecking=accept-new
```

O arquivo deve ficar em `/etc/sysconfig/nodeaccess-ha-file-sync`, com permissao
600. A chave SSH deve ser dedicada a replicacao. O diretorio montado em
`/etc/mysql/conf.d` precisa ser 755 e os arquivos `.cnf`, 644; um diretorio 700
faz o container MySQL reiniciar com `OS errno 13 - Permission denied`.

Esse teste nao promoveu o estado do A durante o failover do VIP. Um failover
total futuro ainda deve usar o gate de promocao, congelar a sincronizacao no
sentido antigo e inverter novamente o sentido somente depois da promocao.

## Reconstrucao limpa e validacao com 2.0.5

Em 2026-07-27 o no A retornou sem o estado da instalacao anterior e foi
reconstruido do zero usando o no B como fonte:

- release 2.0.5 instalada nos dois nos;
- `.env` do B reutilizado no A, preservando `PEM_ENCRYPTION_KEY` e segredos;
- seed MySQL novo gerado no B e restaurado no A;
- MySQL B para A com IO/SQL em `Yes`, lag 0 e A em somente leitura;
- Redis A com `master_link_status=up`;
- arquivos B para A sincronizados por rsync/SSH;
- prova unica confirmada em MySQL, Redis e arquivos;
- failover do VIP B para A aprovado em 14 segundos;
- failback para B aprovado com deep health em `version=2.0.5`.

A senha usada por `CHANGE REPLICATION SOURCE` deve ter no maximo 32
caracteres. Para gerar uma senha hexadecimal compativel, usar
`openssl rand -hex 16`. Uma senha de 48 caracteres falha com erro MySQL 3056.

Em host limpo, desabilitar qualquer nginx/httpd local antes de subir o frontend,
pois as portas 80/443 pertencem ao compose. Tambem ajustar no exemplo do
Keepalived a interface real, o VIP e o `auth_pass`, e permitir protocolo VRRP
112 entre os dois nos antes da regra final de rejeicao do firewall.

## Limite arquitetural

Nao use um MySQL e um Redis locais e independentes em cada no. Isso cria
divergencia de dados, nao HA.

Para o primeiro ensaio, os dois nos devem usar:

- o mesmo MySQL;
- o mesmo Redis;
- o mesmo storage de auditoria SSH;
- o mesmo storage de avatares;
- a mesma release e migrations;
- os mesmos segredos criticos.

Se MySQL, Redis ou storage comum estiverem hospedados no no A, o ensaio valida
falha da aplicacao, gateway, proxy ou VIP, mas **nao** valida perda total do no
A. Desligar o no A nesse desenho tambem derruba o estado comum.

Para validar perda total de qualquer maquina, MySQL, Redis e storage precisam
ser externos, gerenciados ou possuir replicacao/failover previamente ensaiado.

## Topologia do primeiro marco

```text
Usuarios
   |
   v
VIP <VIP>:443
   |
   +---- no A <IP_NO_A>  prioridade 110  (ativo inicial)
   |
   +---- no B <IP_NO_B>  prioridade 100  (standby)
              |
              +---- MySQL comum  <HOST_MYSQL>:3306
              +---- Redis comum  <HOST_REDIS>:6379
              +---- auditoria compartilhada
              +---- avatares compartilhados
```

Keepalived roda no host. A stack NodeAccess continua em Docker.

## Registro do ambiente

Preencher antes de executar qualquer alteracao:

| Item | Valor |
| --- | --- |
| Data/janela | `<AAAA-MM-DD HH:MM TZ>` |
| Responsavel | `<nome>` |
| Rede/CIDR | `<ex.: 10.20.30.0/24>` |
| Interface VRRP | `<ex.: ens192>` |
| IP do no A | `<IP_NO_A>` |
| IP do no B | `<IP_NO_B>` |
| VIP livre | `<VIP>` |
| Prefixo do VIP | `<ex.: /24>` |
| `virtual_router_id` | `<1-255, exclusivo na rede>` |
| Release/versao | `<versao ou checksum>` |
| Host MySQL | `<hostname/IP>` |
| Host Redis | `<hostname/IP>` |
| Storage de auditoria | `<mount/path>` |
| Storage de avatares | `<mount/path>` |
| Diretorio de backup | `<mount/path>` |
| DNS/TLS usado | `<nome e emissor>` |
| RTO alvo | `<minutos>` |
| RPO alvo | `<minutos/horas>` |
| Metodo de rollback | `<VIP/manual/snapshot>` |

Antes de escolher o VIP, confirmar com a equipe de rede que ele esta reservado
e nao responde em outro equipamento.

## Criterios de bloqueio

Nao iniciar o failover se qualquer item abaixo estiver pendente:

- backup completo sem checksum ou restore testado;
- release diferente entre os nos;
- migrations diferentes;
- `JWT_SECRET` diferente;
- `PEM_ENCRYPTION_KEY` diferente;
- MySQL ou Redis apontando para instancias independentes;
- storage de auditoria ou avatares local e divergente;
- VIP sem reserva;
- interface, CIDR ou `virtual_router_id` incertos;
- firewall bloqueando VRRP ou portas do NodeAccess;
- no B sem acesso ao Docker;
- ausencia de rollback definido.

Nunca copie os valores dos segredos para este documento ou para logs de
evidencia. Registre apenas que hashes comparativos conferem.

## Fase 1 - Descoberta sem alteracao

Executar em **cada no** e guardar a saida:

```bash
hostnamectl
ip -brief address
ip route
docker version
docker compose version
timedatectl status
```

Confirmar a interface de rede que recebera o VIP:

```bash
ip route get <IP_GATEWAY_DA_REDE>
```

Validar comunicacao entre os nos e com as dependencias:

```bash
ping -c 3 <IP_DO_OUTRO_NO>
nc -vz <HOST_MYSQL> 3306
nc -vz <HOST_REDIS> 6379
```

Se `nc` nao estiver instalado, usar a ferramenta de diagnostico aprovada pela
equipe do sistema operacional.

Confirmar com a equipe de rede:

- VRRP protocolo IP 112 permitido entre A e B;
- unicast necessario caso multicast VRRP seja bloqueado;
- portas 80/443 e as portas publicadas pela stack permitidas;
- VIP e DNS reservados;
- ausencia de outro `virtual_router_id` igual no mesmo dominio L2.

**Gate 1:** topologia, enderecos, interface, portas e responsabilidade pelas
dependencias registrados.

## Fase 2 - Estado comum e identidade da release

### 2.1 Release

Instalar exatamente o mesmo artefato nos dois nos. Registrar versao e checksum.
Nao usar builds gerados separadamente.

No diretorio da release:

```bash
sha256sum docker-compose.prod.yml
docker compose -f docker-compose.prod.yml --env-file .env config --quiet
```

### 2.2 Segredos

Os dois nos devem possuir os mesmos valores aplicaveis de:

- `JWT_SECRET`;
- `PEM_ENCRYPTION_KEY`;
- credenciais de MySQL e Redis;
- certificados/chaves TLS quando o TLS for local;
- demais credenciais externas usadas pela release.

Comparar sem imprimir o segredo:

```bash
awk -F= '/^(JWT_SECRET|PEM_ENCRYPTION_KEY)=/{print $1 "=" $2}' .env \
  | sha256sum
```

Execute localmente em cada no e compare somente o hash. Garanta que o arquivo
`.env` esteja com permissao restrita.

### 2.3 MySQL e Redis

No `.env` dos dois nos, `DATABASE_URL` e `REDIS_URL` devem apontar para as
mesmas dependencias comuns. Hostnames Docker locais como `mysql` e `redis`
normalmente indicam instancias por no e nao servem para este desenho sem uma
camada externa de HA.

Para MySQL/Redis externos, usar `docker-compose.ha.yml` e configurar:

```env
USE_EXTERNAL_STATEFUL_SERVICES=true
DB_HOST=<HOST_MYSQL>
DB_PORT=3306
DATABASE_URL=mysql://<USUARIO>:<SENHA>@<HOST_MYSQL>:3306/nodeaccess
REDIS_URL=redis://<HOST_REDIS>:6379
SESSION_AUDIT_HOST_DIR=<PATH_AUDITORIA_COMPARTILHADA>
USER_AVATAR_HOST_DIR=<PATH_AVATARES_COMPARTILHADO>
```

O Compose HA nao declara servicos locais `mysql` ou `redis`. Nao combinar os
dois arquivos Compose; selecionar apenas `docker-compose.ha.yml` nos nos HA.

### 2.4 Auditoria, avatares e backups

Montar storage compartilhado ou replicado no mesmo caminho operacional de cada
no e configurar:

```env
SESSION_AUDIT_STORAGE_DIR=<PATH_AUDITORIA>
USER_AVATAR_STORAGE_DIR=<PATH_AVATARES>
BACKUP_DIR=<PATH_BACKUPS>
```

Validar em A que um arquivo temporario aparece em B e, depois, fazer o caminho
inverso. Use um subdiretorio exclusivo do ensaio e remova apenas os arquivos
temporarios que ele criou.

**Gate 2:** mesma release, hashes de segredo equivalentes, dependencias comuns
e leitura/escrita cruzada dos storages aprovadas.

## Fase 3 - Subir e validar cada no sem VIP

Antes de habilitar Keepalived, valide os nos pelos respectivos IPs.

No no A, usando estado externo:

```bash
USE_EXTERNAL_STATEFUL_SERVICES=true \
COMPOSE_FILE="$PWD/docker-compose.ha.yml" \
ENV_FILE="$PWD/.env" \
bash scripts/deploy/install-nodeaccess.sh

docker compose -p nodeaccess -f docker-compose.ha.yml --env-file .env ps
```

No no B, execute a mesma sequencia. Durante este marco, confirme que os
servicos podem operar simultaneamente contra o estado comum sem executar jobs
duplicados. Se essa garantia ainda nao existir, mantenha o no B como warm
standby e suba sua stack apenas para os gates de promocao.

Em cada no:

```bash
curl -fsS http://127.0.0.1:3000/health/ready
curl -fsS http://127.0.0.1:3000/health/deep
curl -fsS http://127.0.0.1:3001/health/ready
curl -fsS http://127.0.0.1:3001/health/deep
```

Executar readiness completo no no B:

```bash
TLS_MODE=<off|provided|selfsigned> \
ENV_FILE="$PWD/.env" \
COMPOSE_FILE="$PWD/docker-compose.ha.yml" \
BACKUP_DIR=<PATH_BACKUPS> \
USE_EXTERNAL_STATEFUL_SERVICES=true \
API_HEALTH_URL=http://127.0.0.1:3000/health/ready \
API_DEEP_HEALTH_URL=http://127.0.0.1:3000/health/deep \
GATEWAY_HEALTH_URL=http://127.0.0.1:3001/health/ready \
GATEWAY_DEEP_HEALTH_URL=http://127.0.0.1:3001/health/deep \
RUN_ISOLATED_RESTORE_CHECKS=true \
bash scripts/deploy/standby-readiness.sh
```

Para rollback de uma release HA, informar:

```bash
TARGET_COMPOSE_BASENAME=docker-compose.ha.yml \
bash scripts/deploy/rollback-nodeaccess.sh <DIRETORIO_RELEASE_ALVO>
```

Resultado exigido:

- `failures: 0`;
- warnings entendidos e aceitos;
- API e gateway ready/deep em HTTP 200;
- restore isolado aprovado;
- nenhum container/volume temporario remanescente.

**Gate 3:** A e B saudaveis individualmente e standby elegivel.

## Fase 4 - Configurar Keepalived sem automatizar o primeiro failover

Validar primeiro os artefatos do repositorio:

```bash
bash tools/deploy/keepalived-health-check-harness.sh
bash tools/deploy/keepalived-active-passive-config-harness.sh
```

Copiar para cada host:

```bash
sudo install -d -m 0755 /opt/nodeaccess/scripts/deploy
sudo install -m 0755 scripts/deploy/keepalived-health-check.sh \
  /opt/nodeaccess/scripts/deploy/keepalived-health-check.sh
```

No A, partir de:

```text
docker/keepalived/keepalived-nodeaccess-node-a.conf.example
```

No B, partir de:

```text
docker/keepalived/keepalived-nodeaccess-node-b.conf.example
```

Alterar obrigatoriamente:

- `interface`;
- `virtual_router_id`;
- `auth_pass`;
- `virtual_ipaddress`;
- URLs do health check, caso nao sejam localhost;
- modo unicast, se exigido pela rede.

Nao guardar o `auth_pass` real no Git. Keepalived usa apenas os primeiros oito
caracteres de `auth_pass` no modo PASS; trate-o como controle de vizinhanca,
nao como criptografia forte.

Validar sintaxe conforme a versao instalada:

```bash
sudo keepalived --config-test --config-file=/etc/keepalived/keepalived.conf
```

Testar o health check diretamente em cada no:

```bash
sudo /opt/nodeaccess/scripts/deploy/keepalived-health-check.sh
echo $?
```

O retorno exigido e `0`.

Instalar/iniciar Keepalived usando o gerenciador de pacotes e o procedimento
aprovado para a distribuicao. Depois:

```bash
sudo systemctl enable --now keepalived
sudo systemctl status keepalived --no-pager
```

Confirmar que o VIP existe somente no no A:

```bash
ip address show dev <INTERFACE>
```

De outra maquina da mesma rede:

```bash
ping -c 3 <VIP>
curl -kfsS https://<VIP>/health/ready
```

Se TLS depender de hostname, usar o DNS definitivo ou `curl --resolve`.

**Gate 4:** VIP somente em A, acesso externo aprovado e B em BACKUP.

## Fase 5 - Failover manual controlado

Abrir dois terminais de observacao:

```bash
sudo journalctl -u keepalived -f
```

Antes da troca, executar no destino B:

```bash
RUN_BACKUP_AGGREGATE=true \
RUN_ISOLATED_RESTORE_CHECKS=true \
FAILOVER_TARGET=<HOST_NO_B> \
TRAFFIC_SWITCH_METHOD=vrrp-manual \
TLS_MODE=<off|provided|selfsigned> \
BACKUP_DIR=<PATH_BACKUPS> \
bash scripts/deploy/pre-failover-check.sh
```

O resultado deve conter `Pre-failover aprovado`.

Registrar `T0` imediatamente antes da acao:

```bash
date --iso-8601=ns
```

Mover o VIP de forma controlada conforme o procedimento aprovado. Um metodo de
laboratorio e parar Keepalived no no A:

```bash
sudo systemctl stop keepalived
```

Nao pare Docker nem desligue a maquina neste primeiro teste.

De uma terceira maquina, observar ate o servico responder pelo VIP:

```bash
while true; do
  date --iso-8601=ns
  curl -kfsS --max-time 2 https://<VIP>/health/ready && break
  sleep 1
done
```

O primeiro HTTP 200 define `T1`. Calcular:

```text
RTO observado = T1 - T0
```

No no B promovido:

```bash
TLS_MODE=<off|provided|selfsigned> \
BACKUP_DIR=<PATH_BACKUPS> \
API_HEALTH_URL=http://127.0.0.1:3000/health/ready \
API_DEEP_HEALTH_URL=http://127.0.0.1:3000/health/deep \
GATEWAY_HEALTH_URL=http://127.0.0.1:3001/health/ready \
GATEWAY_DEEP_HEALTH_URL=http://127.0.0.1:3001/health/deep \
bash scripts/deploy/post-failover-check.sh
```

Validacao funcional manual pelo VIP:

- login administrativo;
- listagem e busca de hosts;
- abertura de uma nova sessao SSH;
- comando simples em host de teste;
- leitura de auditoria anterior ao failover;
- nova entrada de auditoria apos o failover;
- navegacao e transferencia SFTP de teste;
- carregamento de avatar;
- observabilidade sem componente critico `down`.

Validar RPO comparando o ultimo dado confirmado antes do failover com o
primeiro dado disponivel depois dele. No desenho com estado comum e consistente,
o alvo esperado e RPO proximo de zero para dados persistidos; operacoes em voo
e sessoes SSH nao sao retomadas.

**Gate 5:** B assumiu o VIP, pos-failover e fluxo funcional aprovados, RTO/RPO
registrados.

## Fase 6 - Rollback para o no A

Antes do rollback, validar o no A:

```bash
RUN_ISOLATED_RESTORE_CHECKS=true \
TLS_MODE=<off|provided|selfsigned> \
BACKUP_DIR=<PATH_BACKUPS> \
bash scripts/deploy/standby-readiness.sh
```

Executar o pre-failover apontando para A. Depois iniciar Keepalived em A e
reduzir/parar Keepalived em B conforme o procedimento definido:

```bash
sudo systemctl start keepalived
```

Confirmar que apenas A possui o VIP e executar
`scripts/deploy/post-failover-check.sh` em A.

**Gate 6:** VIP voltou a A, aplicacao aprovada e nenhum estado criado em B foi
perdido.

## Fase 7 - Failover por health check

Executar somente depois do failover manual e rollback aprovados.

Manter Keepalived ativo nos dois nos. Simular uma falha reversivel e restrita da
API ou gateway no no A, usando o mecanismo operacional aprovado para a stack.
Nao desligar a maquina e nao remover volumes.

Antes do teste:

- confirmar backup recente;
- registrar nome exato do servico/container que sera interrompido;
- preparar o comando de recuperacao;
- observar logs do Keepalived em A e B;
- monitorar continuamente o VIP de uma terceira maquina.

Resultado esperado:

- o health check falha duas vezes (`fall 2`);
- a prioridade efetiva de A cai;
- B assume o VIP;
- o VIP volta a responder dentro do RTO alvo;
- a recuperacao de A nao causa flapping;
- rollback controlado continua possivel.

Se houver oscilacao repetida de VIP, split-brain ou VIP simultaneo, interromper
o ensaio, restaurar o ultimo estado conhecido e investigar antes de repetir.

**Gate 7:** failover por health check e recuperacao aprovados, sem split-brain.

## Plano de rollback imediato

Disparar rollback se ocorrer:

- VIP simultaneo em A e B;
- perda de acesso administrativo;
- divergencia de banco ou auditoria;
- health checks alternando continuamente;
- falha funcional critica apos promocao;
- RTO acima do limite acordado;
- dependencia comum instavel.

Sequencia:

1. interromper o Keepalived no no que nao deve possuir o VIP;
2. confirmar a saude do no escolhido como ativo;
3. iniciar/confirmar Keepalived somente nesse no;
4. confirmar um unico dono do VIP;
5. executar o post-failover check;
6. validar login, hosts e terminal;
7. preservar logs e nao apagar volumes;
8. registrar incidente e causa antes de novo teste.

## Evidencias obrigatorias

Guardar em diretorio protegido, fora do Git quando houver dados do ambiente:

- ficha do ambiente preenchida, sem secrets;
- versao/checksum da release em A e B;
- hashes comparativos de configuracao sensivel;
- saida do standby readiness;
- saida do pre e post-failover;
- horario `T0` e `T1`;
- RTO e RPO observados;
- logs do Keepalived no intervalo;
- dono do VIP antes, durante e depois;
- resultado da validacao funcional;
- falhas, warnings e decisoes tomadas.

Modelo de resultado:

| Criterio | Resultado | Evidencia/observacao |
| --- | --- | --- |
| Mesma release | `PASS/FAIL` | |
| Estado comum | `PASS/FAIL` | |
| Standby readiness | `PASS/FAIL` | |
| VIP inicial em A | `PASS/FAIL` | |
| Failover manual A -> B | `PASS/FAIL` | |
| RTO observado | `<tempo>` | |
| RPO observado | `<tempo>` | |
| Validacao funcional em B | `PASS/FAIL` | |
| Rollback B -> A | `PASS/FAIL` | |
| Failover por health check | `PASS/FAIL/NA` | |
| Split-brain ausente | `PASS/FAIL` | |
| Sessoes SSH em voo | `<impacto>` | |

## Criterio de aceite do marco

O marco e aprovado quando:

- todos os gates obrigatorios estao aprovados;
- ha somente um dono do VIP em cada instante;
- o standby usa a mesma release e o mesmo estado;
- pre e post-failover terminam com `failures: 0`;
- fluxo funcional passa no no promovido;
- rollback foi ensaiado;
- RTO/RPO foram medidos e aceitos;
- impacto sobre sessoes SSH foi observado e documentado;
- nenhuma divergencia ou perda de dado persistido foi detectada.

Se o teste usar MySQL/Redis/storage hospedados no no A, registrar o resultado
como **HA da camada de aplicacao/VIP**, nao como tolerancia a perda completa de
maquina.

## Proximo marco

Depois deste aceite:

1. corrigir achados do ensaio;
2. repetir ate obter resultado previsivel;
3. definir HA das dependencias stateful;
4. testar perda completa de uma maquina;
5. avaliar active/active parcial para API;
6. manter gateway com afinidade e draining antes de escalar horizontalmente.

## Referencias

- `docs/OPERATIONS-ha-dr-runbook-lite.md`
- `docs/OPERATIONS-ha-state-inventory-lite.md`
- `docs/PRD-ha-redundancy-dr-lite.md`
- `scripts/deploy/standby-readiness.sh`
- `scripts/deploy/pre-failover-check.sh`
- `scripts/deploy/post-failover-check.sh`
- `scripts/deploy/keepalived-health-check.sh`
- `docker/keepalived/keepalived-nodeaccess-node-a.conf.example`
- `docker/keepalived/keepalived-nodeaccess-node-b.conf.example`
