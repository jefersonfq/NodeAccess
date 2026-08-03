# Guia operacional: instalar, provisionar e operar um nó HA

Este guia descreve o procedimento suportado pela release `2.0.30` para uma
topologia com exatamente um `PRIMARY` e um `STANDBY`.

Use este documento como ponto de entrada. O histórico técnico e as evidências
do laboratório permanecem em
`docs/OPERATIONS-ha-two-node-flow-lite.md`.

## 1. Limites e responsabilidades

O painel e o agente automatizam:

- matrícula e heartbeat;
- inventário do servidor;
- instalação e promoção da release offline;
- preparação e validação dos diretórios permitidos;
- transporte cifrado dos segredos compartilhados;
- rollback da configuração aplicada pelo agente;
- journal das ações governadas.

Continuam exigindo preparação operacional:

- instalação do sistema operacional, Docker Engine, Compose, `curl` e
  `openssl`;
- criação da VIP na rede e definição da interface correta;
- configuração inicial de MySQL, Redis e cópia de arquivos;
- instalação/configuração do Keepalived;
- chave e evidência de witness/fencing;
- promoção, rejoin e eventual re-seed;
- certificado TLS confiável.

O Keepalived não promove banco ou estado. Ele só pode publicar a VIP depois de
MySQL, Redis, aplicação e gates de fencing estarem aprovados.

Portanto, apenas cadastrar o nó e instalar o agente não deixa o HA pronto. O
agente conduz as etapas que aparecem no painel, mas o operador ainda deve
configurar e validar replicação, Keepalived, witness/fencing e a primeira
sincronização.

## 2. Informações que devem ser definidas antes

Preencha e guarde na mudança:

| Informação | Exemplo |
| --- | --- |
| IP administrativo do primeiro nó | `192.168.1.100` |
| IP administrativo do segundo nó | `192.168.1.101` |
| VIP usada pelos usuários | `192.168.1.105` |
| Interface da VIP | `enp0s3` |
| Nó atualmente gravável | `PRIMARY` |
| Nó candidato | `STANDBY` |
| URL do painel | `https://192.168.1.105` |
| URL do pacote | `https://servidor/releases/nodeaccess-release-X.tar.gz` |
| SHA-256 do pacote | 64 caracteres hexadecimais |
| RPO/RTO aceitos | conforme política do ambiente |
| Método de fencing/witness | hypervisor, PDU, cloud ou witness externo |

A VIP é informada na tela ao criar a matrícula e aparece no comando como
`--virtual-ip`. Use exatamente o mesmo endereço nos dois nós.

## 3. Pré-requisitos do servidor

No nó que será anexado:

```bash
id -u
command -v curl
command -v openssl
docker version
docker compose version
ip -4 address
df -h /
```

Requisitos:

- execução como `root` ou via `sudo`;
- relógio sincronizado;
- resolução/rota entre os dois IPs administrativos;
- acesso HTTPS à VIP;
- portas da aplicação e da replicação liberadas conforme a arquitetura;
- certificado da VIP confiável no servidor;
- espaço para pacote, imagens, release anterior e rollback.

Não prossiga se o nó já possuir a VIP ou estiver gravável como outro
`PRIMARY`.

## 4. Cadastrar o nó e instalar o agente

Na interface:

1. Acesse **Plataforma → Alta disponibilidade**.
2. Abra **Configurações**.
3. Clique em **Anexar nó**.
4. Informe nome, IP administrativo, papel desejado e a VIP.
5. Para um novo nó, selecione `STANDBY`.
6. Clique em **Gerar matrícula**.
7. Copie o comando e execute no servidor em até 15 minutos.

Formato do comando gerado:

```bash
curl -fsSL 'https://VIP/api/v1/ha/agent/install.sh' |
  sudo NODEACCESS_HA_ENROLLMENT_TOKEN='TOKEN_TEMPORARIO' bash -s -- \
  --api-url 'https://VIP/api/v1' \
  --node-id 'UUID_DO_NO' \
  --role 'STANDBY' \
  --virtual-ip 'VIP'
```

Execute o comando exatamente como exibido pela tela. Não salve o token em
documentos ou tickets.

Em laboratório HTTP, o comando pode conter
`NODEACCESS_HA_ALLOW_HTTP=true`. Essa exceção permite heartbeat/download, mas
o transporte de segredos continua bloqueado até existir HTTPS.

O instalador cria:

- `/opt/nodeaccess-ha-agent/agent.env`, modo `0600`;
- `/opt/nodeaccess-ha-agent/report-health.sh`, modo `0700`;
- `/var/lib/nodeaccess-ha-agent/provisioning-private.pem`, modo `0600`;
- chave pública de provisionamento;
- serviço e timer `nodeaccess-ha-agent`.

## 5. Validar a matrícula

No servidor:

```bash
systemctl is-active nodeaccess-ha-agent.timer
systemctl show nodeaccess-ha-agent.service -p Result
journalctl -u nodeaccess-ha-agent.service -n 50 --no-pager
```

Na tela, aguarde até 30 segundos e confirme:

- heartbeat atual;
- inventário preenchido;
- papel observado `STANDBY`;
- VIP ausente;
- chave segura disponível;
- nenhum bloqueador inesperado.

Se o heartbeat atrasar, valide primeiro URL HTTPS, certificado, rota, DNS,
relógio e logs do serviço.

## 6. Sequência correta de provisionamento

### 6.1 Avaliar o servidor

Clique em **Avaliar provisionamento**.

O plano é somente leitura. Revise sistema operacional, arquitetura, CPU,
memória, disco, Docker, Compose, stack, estado e Keepalived. Só continue com
plano `READY`.

### 6.2 Instalar a release pelo agente

Clique em **Instalar release** e informe:

- URL HTTPS acessível pelo servidor;
- SHA-256 publicado junto ao pacote.

O agente:

1. confirma `STANDBY` e ausência da VIP;
2. baixa em diretório temporário;
3. valida SHA-256 e estrutura do tarball;
4. carrega imagens offline;
5. promove `/opt/nodeaccess/current`;
6. remove o download temporário.

Essa ação usa `RUN_INSTALL=false`: não inicia banco, Redis, containers ou
Keepalived.

Valide no nó:

```bash
readlink -f /opt/nodeaccess/current
docker image ls | grep nodeaccess
```

Depois, ative a aplicação de forma controlada, preservando o TLS:

```bash
cd /opt/nodeaccess/current
TLS_MODE=provided \
NGINX_CONFIG_FILE=/opt/nodeaccess/current/docker/nginx.https.conf \
docker compose -p nodeaccess \
  --env-file /opt/nodeaccess/shared/.env \
  -f /opt/nodeaccess/current/docker-compose.ha.yml \
  up -d --no-deps --force-recreate api ssh-gateway frontend guacd
```

### 6.3 Preparar storage

Clique em **Preparar diretórios** e depois em **Validar escrita**.

O agente atua somente nos diretórios permitidos e não remove conteúdo. Use
**Reverter diretórios** apenas quando os diretórios criados pelo agente ainda
estiverem vazios.

### 6.4 Aplicar configuração segura

Pré-requisitos:

- painel acessado por HTTPS;
- agente atualizado e chave pública publicada;
- plano `READY`;
- nó `STANDBY`, sem VIP.

Clique em **Aplicar configuração segura** e informe os mesmos valores do
primário:

- `JWT_SECRET`;
- `PEM_ENCRYPTION_KEY`;
- `MYSQL_ROOT_PASSWORD`;
- `MYSQL_PASSWORD`;
- `MYSQL_REPLICATION_PASSWORD`;
- `REDIS_PASSWORD`.

Cada valor é cifrado para a chave exclusiva do agente. O plaintext não deve
aparecer no job, journal ou logs. O agente preserva o arquivo anterior em:

```text
/var/lib/nodeaccess-ha-agent/shared.env.previous
```

A ação altera o `.env`, mas não reinicia serviços. Valide o journal antes de
qualquer restart. Em falha, use **Reverter configuração**.

## 7. Configurar estado e tráfego

Antes de considerar o nó pronto:

- MySQL deve estar `read_only/super_read_only`;
- MySQL IO/SQL devem estar `Yes`;
- lag deve estar dentro do RPO;
- Redis deve reportar `slave` e `master_link_status:up`;
- arquivos devem estar sincronizados;
- backups recentes devem passar nos checks;
- Keepalived deve estar ativo, mas impedido de publicar a VIP no standby;
- apenas um nó pode possuir a VIP.

Execute:

```bash
ENV_FILE=/opt/nodeaccess/shared/.env \
TLS_MODE=provided \
bash /opt/nodeaccess/current/scripts/deploy/standby-readiness.sh

bash /opt/nodeaccess/current/scripts/deploy/ha-state-replication-status.sh

REPLICA_ROOT=/srv/nodeaccess-shared \
bash /opt/nodeaccess/current/scripts/deploy/ha-file-replica-status.sh
```

O caminho de storage pode variar. Use o valor configurado em
`/etc/sysconfig/nodeaccess-ha-file-sync`.

## 8. Checklist antes de uma troca planejada

1. Comunique possível queda de sessões SSH/WebSocket.
2. Confirme backup recente e restore testado.
3. Confirme um único `PRIMARY` e um único dono da VIP.
4. Confirme standby sem VIP, MySQL/Redis/arquivos alinhados.
5. Gere um `OPERATION_ID` único.
6. Prepare chave pública do witness no standby.
7. Garanta acesso ao mecanismo externo de fencing.
8. Execute o pre-failover:

```bash
TLS_MODE=provided \
RUN_BACKUP_AGGREGATE=true \
RUN_ISOLATED_RESTORE_CHECKS=true \
bash /opt/nodeaccess/current/scripts/deploy/pre-failover-check.sh
```

Não emita evidência de fencing antes de isolar ou congelar o primário.

Na tela, o standby apresenta **Promover este nó** como ação principal. O modal
é um guia operacional: executa os preflights governados e fornece o comando
com os identificadores do ambiente, mas não executa fencing nem shell
privilegiado remotamente. Revise os placeholders antes de copiar o comando.

Durante a janela posterior à promoção, o antigo primário pode apresentar
**Retornar como standby**. A ação orienta o rejoin e valida a paridade; ela não
libera automaticamente o nó antigo como gravável.

Provisionamento, instalação, storage, rollback e verificações isoladas ficam
em **Validações e opções avançadas**, recolhidas por padrão em cada cartão.

## 9. Switchover planejado

### 9.1 Congelar o primário

No `PRIMARY`:

```bash
CONFIRM_QUIESCE=true \
MODE=apply \
OPERATION_ID='OPERACAO_UNICA' \
bash /opt/nodeaccess/current/scripts/deploy/quiesce-ha-primary.sh
```

O script ativa somente leitura, interrompe Keepalived, remove a VIP e grava
journal. Se falhar durante essa etapa, executa rollback automático.

Rollback explícito:

```bash
MODE=rollback \
OPERATION_ID='OPERACAO_UNICA' \
bash /opt/nodeaccess/current/scripts/deploy/quiesce-ha-primary.sh
```

### 9.2 Emitir evidência witness

Em host externo ao par de dados:

```bash
CONFIRM_PRIMARY_FENCED=true \
PRIVATE_KEY='/caminho/witness-private.pem' \
PRIMARY_NODE_ID='ID_PRIMARIO' \
STANDBY_NODE_ID='ID_STANDBY' \
TTL_SECONDS=600 \
OUTPUT_PREFIX='/tmp/ha-fencing-OPERACAO' \
bash scripts/deploy/ha-witness-issue-evidence.sh
```

Copie evidência, assinatura e chave pública para o standby por canal seguro.

### 9.3 Promover o standby

No `STANDBY`:

```bash
CONFIRM_PROMOTION=true \
OPERATION_ID='OPERACAO_UNICA' \
PRIMARY_NODE_ID='ID_PRIMARIO' \
STANDBY_NODE_ID='ID_STANDBY' \
WITNESS_EVIDENCE_FILE='/caminho/evidencia.txt' \
WITNESS_SIGNATURE_FILE='/caminho/evidencia.sig' \
WITNESS_PUBLIC_KEY='/opt/nodeaccess/shared/ha/witness-public.pem' \
FINAL_SYNC_SOURCE_IP='IP_PRIMARIO_CONGELADO' \
NODE_IP='IP_DESTE_STANDBY' \
APP_TLS_MODE=provided \
APP_NGINX_CONFIG_FILE=/opt/nodeaccess/current/docker/nginx.https.conf \
bash /opt/nodeaccess/current/scripts/deploy/promote-ha-standby.sh
```

O script valida paridade final, witness, nonce, arquivos, MySQL e Redis antes
de publicar a VIP.

### 9.4 Reconciliar os papéis no painel

Depois que a promoção e o rejoin terminarem, a tela pode indicar que os papéis
observados diferem dos papéis configurados. Use **Confirmar papéis observados**
somente quando:

- os dois heartbeats estiverem atuais;
- existir exatamente um `PRIMARY` com a VIP;
- existir exatamente um `STANDBY` sem a VIP;
- nenhuma operação HA estiver em andamento.

A ação não move a VIP e não altera serviços. Ela persiste os papéis observados
como configuração desejada e registra `ROLE_RECONCILIATION` no journal. Aguarde
o próximo heartbeat antes de considerar os bloqueadores resolvidos.

## 10. Reintegrar o nó antigo

O nó antigo não pode voltar automaticamente como primário.

No antigo primário, já sem VIP:

```bash
MODE=apply \
CONFIRM_REJOIN=true \
ACTIVE_NODE_IP='IP_NOVO_PRIMARIO' \
ACTIVE_MYSQL_PORT=3307 \
ACTIVE_REDIS_PORT=6380 \
NODE_IP='IP_DESTE_NO' \
REPLICATION_ENV='/srv/nodeaccess-shared/mysql/replication.env' \
MYSQL_REPLICA_CONFIG_SOURCE='/opt/nodeaccess/current/docker/mysql/ha/replica.cnf' \
MYSQL_REPLICA_CONFIG='/opt/nodeaccess/shared/mysql/replica-conf/nodeaccess.cnf' \
FILE_SOURCE_ROOT='/srv/nodeaccess-shared' \
FILE_REPLICA_ROOT='/srv/nodeaccess-shared' \
REPORT_PATH='/opt/nodeaccess/shared/ha/operations/rejoin.json' \
bash /opt/nodeaccess/current/scripts/deploy/prepare-ha-rejoin.sh
```

Adapte os diretórios à instalação. GTIDs errantes ou fingerprints divergentes
bloqueiam o rejoin e exigem reconciliação ou re-seed.

## 11. Failover emergencial

Use este fluxo somente quando o primário não puder ser congelado pelo
procedimento planejado:

1. Confirme a expiração do heartbeat por mais de uma observação.
2. Confirme a falha por um caminho independente do painel.
3. Isole o primário por hypervisor, PDU, cloud ou outro mecanismo de fencing.
4. Confirme que ele não possui mais VIP nem acesso à rede de dados.
5. Registre o último GTID/lag conhecido e a possível perda dentro do RPO.
6. Emita a evidência witness somente depois do isolamento.
7. Execute a promoção sem `FINAL_SYNC_SOURCE_IP`, pois a origem está
   indisponível.
8. Valide o novo primário e a VIP.
9. Quando o nó antigo voltar, mantenha-o isolado e execute rejoin/re-seed.

Não use a ausência de ping como prova de fencing e não permita que o nó antigo
retorne automaticamente como `PRIMARY`. Sem isolamento comprovado, interrompa
o failover para evitar split-brain.

## 12. Validação pós-troca

```bash
TLS_MODE=provided \
API_HEALTH_URL=http://127.0.0.1:3000/health/ready \
API_DEEP_HEALTH_URL=http://127.0.0.1:3000/health/deep \
bash /opt/nodeaccess/current/scripts/deploy/post-failover-check.sh

curl --cacert /caminho/ca.pem https://VIP/health/deep
```

Confirme:

- novo primário gravável;
- antigo primário em somente leitura;
- VIP em exatamente um nó;
- MySQL IO/SQL `Yes` e lag aceitável no standby;
- Redis `slave/up`;
- health profundo HTTP 200;
- agentes com resultado `success`;
- tela sem bloqueadores inesperados;
- journal `COMPLETED`.

## 13. Logs e evidências

Preserve:

- journal da tela;
- `/opt/nodeaccess/shared/ha/operations/*.jsonl`;
- relatórios de plano, sync e rejoin;
- `journalctl -u nodeaccess-ha-agent.service`;
- `journalctl -u keepalived`;
- `docker logs nodeaccess-api-1`;
- checksum e versão do pacote;
- fingerprint/validade do certificado;
- evidência e assinatura witness;
- estimativa de perda de dados em failover emergencial.

Nunca anexe tokens, chaves privadas ou segredos em tickets.

## 14. Falhas comuns

| Sintoma | Verificação |
| --- | --- |
| Heartbeat atrasado | URL do agente, certificado, rota, relógio e systemd |
| CTA seguro desabilitado | HTTPS, chave pública, plano `READY`, papel e VIP |
| VIP em nenhum nó | health check do Keepalived, papel e frontend/API |
| VIP em dois nós | isolar imediatamente; não promover banco |
| Release falha | URL, espaço, SHA-256 e estrutura do tarball |
| MySQL lag/IO/SQL falha | rede, usuário de réplica, GTID e read-only |
| Redis link down | rota, porta, autenticação e `REPLICAOF` |
| Rejoin bloqueado | GTIDs errantes, dados divergentes ou arquivos |
| HTTPS retorna bloqueio | `X-Forwarded-Proto`, `TRUST_PROXY` e certificado |

## 15. Critério de conclusão

O nó está pronto somente quando:

- matrícula e heartbeat estão atuais;
- release e configuração estão alinhadas;
- storage e backups passaram;
- MySQL, Redis e arquivos estão sincronizados;
- standby permanece sem VIP e somente leitura;
- Keepalived respeita papel e health;
- witness/fencing está disponível;
- promoção e rollback foram ensaiados;
- operador sabe onde consultar journal e logs.
