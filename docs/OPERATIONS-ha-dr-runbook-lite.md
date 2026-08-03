# Operations - HA e DR Runbook Lite

## Objetivo

Padronizar os comandos minimos para validar recuperacao do NodeAccess antes de
evoluir para warm standby, VRRP, balanceador ou HA gerenciado.

Para executar o primeiro marco com duas maquinas, preencher e seguir
`docs/OPERATIONS-ha-two-node-milestone-guided-test.md`.

Para uma explicacao direta da arquitetura, replicacao e fluxos de falha, usar
`docs/OPERATIONS-ha-two-node-flow-lite.md`.

Em nos com MySQL/Redis externos, usar `docker-compose.ha.yml`,
`USE_EXTERNAL_STATEFUL_SERVICES=true` e os mesmos storages compartilhados nos
dois nos.

Este runbook cobre o estado single-node robusto:

- backup MySQL;
- backup dos chunks de auditoria SSH;
- restore isolado de MySQL;
- restore isolado da auditoria SSH;
- validacao de artefatos sensiveis de DR;
- doctor com smoke/deep health.

## Principios

- Backup sem restore testado nao conta como backup confiavel.
- `PEM_ENCRYPTION_KEY` nao deve ir dentro do backup, mas deve estar preservada
  em cofre/processo seguro.
- Dumps e chunks de auditoria podem conter dados sensiveis; proteger acesso,
  copia e retencao.
- Validacoes isoladas nao devem tocar no banco atual nem no volume atual.
- Em dev, `TLS_MODE=off` gera alerta esperado. Em producao, usar
  `TLS_MODE=provided` ou `TLS_MODE=selfsigned` apenas para bootstrap/lab.

## Backup

Gerar backup MySQL:

```bash
bash scripts/backup/backup-mysql.sh backups
```

Gerar backup da auditoria SSH:

```bash
ENV_FILE=.env COMPOSE_PROJECT_NAME=nodeaccess \
bash scripts/backup/backup-session-audit.sh backups
```

Saidas esperadas:

- `nodeaccess-mysql-*.sql.gz`
- `nodeaccess-mysql-*.manifest.json`
- `nodeaccess-mysql-*.sha256`
- `nodeaccess-session-audit-*.tar.gz`
- `nodeaccess-session-audit-*.manifest.json`
- `nodeaccess-session-audit-*.sha256`

## Check DR

Validar artefatos criticos:

```bash
TLS_MODE=off bash scripts/backup/check-dr-artifacts.sh
```

O check valida:

- `.env` presente;
- `JWT_SECRET` com tamanho minimo;
- `PEM_ENCRYPTION_KEY` em formato valido;
- certificados quando TLS exigir;
- backup MySQL, manifest e checksum;
- backup de auditoria SSH, manifest e checksum.

Resultado esperado em dev:

```text
failures: 0
warnings: 1
```

O warning esperado e `TLS_MODE=off`.

## Restore Isolado

Restaurar MySQL em ambiente temporario:

```bash
bash tools/deploy/restore-mysql-isolated-harness.sh \
  backups/nodeaccess-mysql-<db>-YYYYMMDD-HHMMSS.sql.gz
```

Restaurar auditoria SSH em volume temporario:

```bash
bash tools/deploy/restore-session-audit-isolated-harness.sh \
  backups/nodeaccess-session-audit-YYYYMMDD-HHMMSS.tar.gz
```

Ambos os harnesses fazem cleanup ao final. Para inspecionar o ambiente
temporario, rode com:

```bash
KEEP_RESTORE_HARNESS=true ...
```

## Validacao Agregada

Comando unico recomendado para validar DR local:

```bash
bash tools/deploy/dr-validation-harness.sh
```

## Standby Readiness

Antes de promover uma VM secundaria ou warm standby, rode:

```bash
TLS_MODE=off \
API_HEALTH_URL=http://127.0.0.1:3000/health/ready \
API_DEEP_HEALTH_URL=http://127.0.0.1:3000/health/deep \
GATEWAY_HEALTH_URL=http://127.0.0.1:3001/health/ready \
GATEWAY_DEEP_HEALTH_URL=http://127.0.0.1:3001/health/deep \
bash scripts/deploy/standby-readiness.sh
```

O script orquestra:

- gate obrigatorio de acesso ao Docker daemon;
- doctor com smoke/deep health;
- readiness de estado HA;
- check de artefatos DR;
- gates obrigatorios de API/gateway ready/deep retornando HTTP 200;
- opcionalmente restores isolados.

Para promocao real de standby, incluir restore isolado:

```bash
RUN_ISOLATED_RESTORE_CHECKS=true bash scripts/deploy/standby-readiness.sh
```

Resultado esperado:

- `failures: 0`;
- warnings revisados pelo operador;
- backups recentes;
- API/gateway saudaveis;
- storages stateful com leitura/escrita;
- restores isolados aprovados quando `RUN_ISOLATED_RESTORE_CHECKS=true`.

Para automacao e journal, os gates de replicacao oferecem saida estruturada sem
alterar o formato texto padrao:

```bash
OUTPUT_FORMAT=json CHECK_COMPONENT=mysql \
bash scripts/deploy/ha-state-replication-status.sh

OUTPUT_FORMAT=json CHECK_COMPONENT=redis \
bash scripts/deploy/ha-state-replication-status.sh

OUTPUT_FORMAT=json REQUIRE_SOURCE_MATCH=false \
bash scripts/deploy/ha-file-replica-status.sh
```

O contrato `nodeaccess-ha-status-v1` preserva o exit code do gate: `0` para
aprovado e diferente de zero para bloqueado.

## Preparar witness externo

O witness deve ser um host independente dos dois nos NodeAccess. A chave privada
nunca deve ser copiada para o primario, standby ou banco.

No host witness, gere o par de chaves uma unica vez:

```bash
bash scripts/deploy/ha-witness-keygen.sh /opt/nodeaccess-ha-witness/keys
```

Copie somente `witness-public.pem` para o standby em:

```text
/opt/nodeaccess/shared/ha/witness-public.pem
```

Quando o primario estiver comprovadamente desligado, bloqueado no hypervisor ou
isolado por outro mecanismo externo, emita uma evidencia curta no witness:

```bash
CONFIRM_PRIMARY_FENCED=true \
PRIVATE_KEY=/opt/nodeaccess-ha-witness/keys/witness-private.pem \
PRIMARY_NODE_ID=nodeaccess-b \
STANDBY_NODE_ID=nodeaccess-a \
TTL_SECONDS=300 \
OUTPUT_PREFIX=/tmp/nodeaccess-ha-fencing-evidence \
bash scripts/deploy/ha-witness-issue-evidence.sh
```

Transfira o arquivo `.txt` e sua assinatura `.sig` para o standby. A promocao
exige a assinatura valida, os identificadores exatos dos dois nos e evidencia
nao expirada:

```bash
CONFIRM_PROMOTION=true \
PRIMARY_NODE_ID=nodeaccess-b \
STANDBY_NODE_ID=nodeaccess-a \
WITNESS_EVIDENCE_FILE=/root/nodeaccess-ha-fencing-evidence.txt \
WITNESS_SIGNATURE_FILE=/root/nodeaccess-ha-fencing-evidence.sig \
WITNESS_PUBLIC_KEY=/opt/nodeaccess/shared/ha/witness-public.pem \
bash scripts/deploy/promote-ha-standby.sh
```

O script bloqueia a promocao antes de alterar MySQL, Redis, arquivos ou
aplicacao quando a evidencia estiver ausente, expirada, adulterada ou destinada
a outra topologia. `CONFIRM_PRIMARY_FENCED=true` nao desliga o primario: ele
declara que o operador ja realizou e verificou o isolamento por um mecanismo
externo.

## Failover Manual Active/Passive

Fluxo controlado para troca manual de VIP, DNS, proxy ou balanceador:

1. Avisar usuarios sobre possivel queda de sessoes SSH/WebSocket ativas.
2. Rodar pre-failover no no standby.
3. Trocar o trafego manualmente no mecanismo escolhido.
4. Rodar post-failover no destino promovido.
5. Validar login admin, hosts, terminal SSH, auditoria, SFTP e observabilidade.

Pre-failover:

```bash
RUN_BACKUP_AGGREGATE=true \
RUN_ISOLATED_RESTORE_CHECKS=true \
FAILOVER_TARGET=standby-01 \
TRAFFIC_SWITCH_METHOD=vrrp-manual \
bash scripts/deploy/pre-failover-check.sh
```

O backup agregado pode ser desligado em failover emergencial com
`RUN_BACKUP_AGGREGATE=false`, mas isso deve ser registrado como risco
operacional.

Depois da troca manual de trafego:

```bash
TLS_MODE=off \
API_HEALTH_URL=http://127.0.0.1:3000/health/ready \
API_DEEP_HEALTH_URL=http://127.0.0.1:3000/health/deep \
GATEWAY_HEALTH_URL=http://127.0.0.1:3001/health/ready \
GATEWAY_DEEP_HEALTH_URL=http://127.0.0.1:3001/health/deep \
bash scripts/deploy/post-failover-check.sh
```

Os scripts nao alteram roteamento. Eles apenas bloqueiam ou aprovam a decisao
operacional com base em backup, readiness, health e gates obrigatorios.

## Promocao, despromocao e responsabilidades

O escopo homologável da versão 2.0.28 é de dois nós de dados: um `PRIMARY` e
um `STANDBY`, com uma VIP e um único escritor. Witness/fencing externo é
obrigatório para uma promoção emergencial segura. O Keepalived não promove
banco, cache ou containers; ele só deve publicar a VIP depois da promoção e
dos checks profundos. Consulte `docs/DECISION-ha-two-node-v1.md`.

O `vrrp_script` deve usar `weight 0`: uma falha coloca a instância em `FAULT`
e retira a VIP. Peso negativo apenas reduz a prioridade e pode deixar um
`PRIMARY` degradado com a VIP quando não houver outro candidato elegível. O
health script também exige `NODEACCESS_HA_NODE_ROLE=PRIMARY`; portanto um
`STANDBY` saudável não assume a VIP antes de ser promovido.

### Onde informar a VIP

Ao clicar em **Anexar nó** na tela de Alta disponibilidade, preencha
**Endereço virtual (VIP)** com um IP livre da mesma rede dos nós, sem máscara.
Use exatamente o mesmo valor nas duas matrículas. A tela inclui esse valor no
argumento obrigatório `--virtual-ip` do instalador e o agente o persiste como
`NODEACCESS_HA_VIRTUAL_IP` em `/opt/nodeaccess-ha-agent/agent.env`.

Não confunda a VIP com o endereço administrativo do nó. O endereço
administrativo identifica cada servidor; a VIP é o endereço compartilhado que
acompanha o `PRIMARY`. Antes da instalação, reserve/exclua esse IP do DHCP e
confirme que nenhum outro equipamento o utiliza.

Baixar e executar o agente **não provisiona sozinho todos os componentes**.
Ele instala o reporter e timer, registra a VIP, envia heartbeat/inventário e
executa apenas ações governadas do catálogo atual (preparar/reverter/validar
diretórios). Docker, Compose, release NodeAccess, certificados, MySQL, Redis,
replicação de arquivos e Keepalived ainda precisam estar instalados/configurados
pelos scripts da release e validados pelo plano de provisionamento.

No rejoin, o script deriva a origem de arquivos de
`SESSION_AUDIT_HOST_DIR` (removendo o sufixo `/session-audit`). Se o storage
real não seguir esse layout, informe `FILE_SOURCE_ROOT` explicitamente. O
preflight deve mostrar o diretório efetivo antes de alterar a direção do sync.

No modelo single-writer, **despromover** significa retirar o antigo primario do
trafego e devolve-lo como replica somente leitura do primario atual. Nao se deve
apenas trocar uma variavel de papel, pois o no pode conter escritas feitas
durante a indisponibilidade.

| Etapa | Automatizada pelos scripts | Confirmacao ou acao manual |
| --- | --- | --- |
| Instalar agente HA | Gera credencial local protegida, reporter, service e timer systemd | Executar o comando como root no no correto e confirmar o heartbeat |
| Backup antes da troca planejada | `pre-failover-check.sh` executa o backup agregado quando `RUN_BACKUP_AGGREGATE=true` | Definir destino externo, retencao e confirmar copia fora das duas VMs |
| Sincronizacao final | `promote-ha-standby.sh` exige os gates e pode executar a barreira final de switchover | Garantir janela de manutencao e que novas escritas nao entrem pela origem |
| Promover MySQL e Redis | Interrompe/reset a replica MySQL, remove read-only, promove Redis e persiste a configuracao | Isolar o primario antigo antes da promocao |
| Alinhar arquivos e containers | Valida a replica de arquivos, ajusta `.env` e recria API, gateway e frontend contra o estado promovido | Confirmar storage externo, certificados e segredos que nao pertencem a replica local |
| Trocar trafego | Health checks e Keepalived podem retirar ou assumir a VIP | Fencing no hypervisor/rede e troca de DNS, proxy ou balanceador quando nao houver VRRP gerenciado |
| Despromover o antigo primario | `prepare-ha-rejoin.sh MODE=apply` protege MySQL, inverte MySQL/Redis e copia arquivos do primario atual | Informar o IP correto, fornecer chave de sync e decidir re-seed quando houver GTID errante |
| Validar retorno | Gates verificam MySQL, Redis, arquivos e paridade de GTID | Validar login, terminal, SFTP, auditoria e observar o ambiente antes de novo failback |

Durante um switchover planejado, pare o Keepalived do standby antes de executar
`promote-ha-standby.sh` caso ele tenha assumido a VIP assim que a origem foi
congelada. O plano recusa a promoção enquanto o candidato já reportar a VIP.
Após a promoção e o smoke check, o script persiste o agente como `PRIMARY`,
ajusta o Keepalived para `MASTER/110` e reinicia o serviço. No rejoin, o script
persiste `STANDBY`, ajusta `BACKUP/100`, remove o marcador de quiesce e religa os
timers. Os arquivos `.pre-promotion-*` e `.pre-rejoin-*` preservam rollback das
configurações.

Promocao planejada:

```bash
RUN_BACKUP_AGGREGATE=true RUN_ISOLATED_RESTORE_CHECKS=true \
FAILOVER_TARGET=standby-01 TRAFFIC_SWITCH_METHOD=vrrp-manual \
bash scripts/deploy/pre-failover-check.sh

CONFIRM_PROMOTION=true \
PRIMARY_NODE_ID=nodeaccess-a STANDBY_NODE_ID=nodeaccess-b \
WITNESS_EVIDENCE_FILE=/root/evidence.txt \
WITNESS_SIGNATURE_FILE=/root/evidence.sig \
bash scripts/deploy/promote-ha-standby.sh
```

Despromocao segura do antigo primario, depois de removido o VIP:

```bash
MODE=apply CONFIRM_REJOIN=true \
ACTIVE_NODE_IP=<ip-do-primario-atual> \
bash scripts/deploy/prepare-ha-rejoin.sh
```

### Matriz mínima para homologar a versão

Antes de publicar a release, guardar journal, horários e resultado de cada
cenário:

1. nó novo: matrícula sem VIP deve ser recusada; com VIP deve instalar o
   agente, iniciar o timer e produzir heartbeat/inventário;
2. reinício isolado de cada nó: agente, containers e Keepalived devem retornar
   no papel persistido, sem dois proprietários da VIP;
3. switchover planejado A → B e B → A, com backup, GTID, Redis, arquivos,
   containers, VIP, login, terminal, SFTP e auditoria validados;
4. falha parcial de MySQL, Redis, API, gateway e Keepalived: cada componente
   deve bloquear promoção ou retirar a VIP conforme sua responsabilidade;
5. perda de rede e perda total do primário: sem fencing/witness válido, a
   promoção deve permanecer bloqueada;
6. retorno do nó antigo: deve voltar somente como `STANDBY`, rejeitar GTID
   errante e preservar as escritas realizadas após a promoção;
7. falha induzida no meio da promoção: journal e saída do script devem indicar
   a etapa, e o rollback deve deixar um único nó gravável;
8. atualização rolling e rollback de release, confirmando digest/versão iguais
   nos dois nós ao final.

Harnesses locais obrigatórios:

```bash
npm run test:ha:lifecycle
npm run test:ha:web
```

Os harnesses não substituem os ensaios destrutivos nas duas VMs de homologação.
Esses ensaios devem ser executados fora de horário de uso, com snapshot/backup
recente e acesso ao hypervisor ou mecanismo de fencing.

Operações executadas diretamente no shell gravam seus checkpoints em
`/opt/nodeaccess/shared/ha/operations/*.jsonl`. Na versão 2.0.28, esses
arquivos ainda não são sincronizados para o journal exibido no painel; devem
ser coletados manualmente junto com o relatório de plano, rejoin e witness.

O script bloqueia o rejoin quando encontra GTID local inexistente no primario
atual. Nesse caso o operador deve escolher re-seed ou reconciliacao; os scripts
nao descartam dados automaticamente.

Harness agregado do ciclo:

```bash
npm run test:ha:lifecycle
```

Esse comando cobre instalacao isolada do agente, plano e witness, rejoin,
barreira de switchover, failover manual e a inversao real de replicacao MySQL em
containers temporarios.

## VRRP/Keepalived Manual

Use este passo apenas depois do failover manual estar ensaiado. O primeiro uso
deve ser assistido, com rollback manual definido.

Arquivos de referencia:

- `scripts/deploy/keepalived-health-check.sh`
- `docker/keepalived/keepalived-nodeaccess.conf.example`
- `docker/keepalived/keepalived-nodeaccess-node-a.conf.example`
- `docker/keepalived/keepalived-nodeaccess-node-b.conf.example`

Contrato do health check:

- exit `0`: o no pode manter ou assumir o VIP;
- exit diferente de `0`: o no deve perder prioridade;
- API `/health/ready` precisa responder HTTP 200;
- gateway `/health/ready` tambem precisa responder HTTP 200 por padrao.

Exemplo de instalacao no host:

```bash
sudo cp docker/keepalived/keepalived-nodeaccess.conf.example /etc/keepalived/keepalived.conf
sudo cp scripts/deploy/keepalived-health-check.sh /opt/nodeaccess/scripts/deploy/keepalived-health-check.sh
sudo chmod +x /opt/nodeaccess/scripts/deploy/keepalived-health-check.sh
```

Para par active/passive, prefira os exemplos separados:

```bash
# no A
sudo cp docker/keepalived/keepalived-nodeaccess-node-a.conf.example /etc/keepalived/keepalived.conf

# no B
sudo cp docker/keepalived/keepalived-nodeaccess-node-b.conf.example /etc/keepalived/keepalived.conf
```

Ajustes obrigatorios antes de iniciar:

- `interface`;
- `virtual_router_id`;
- `priority` diferente entre ativo e standby;
- `auth_pass`;
- `virtual_ipaddress`;
- URLs `API_HEALTH_URL` e `GATEWAY_HEALTH_URL`, se nao forem localhost.

Antes de colocar em producao:

```bash
bash tools/deploy/keepalived-health-check-harness.sh
bash tools/deploy/keepalived-active-passive-config-harness.sh
bash scripts/deploy/pre-failover-check.sh
```

Nao habilitar failover automatico enquanto o pos-failover manual nao estiver
validado no ambiente do cliente.

Rollback controlado:

1. Confirmar que o no original voltou a passar no `standby-readiness.sh`.
2. Executar `pre-failover-check.sh` apontando `FAILOVER_TARGET` para o no
   original.
3. Reduzir temporariamente a prioridade do no atual ou parar Keepalived nele.
4. Confirmar que o VIP voltou para o no original.
5. Executar `post-failover-check.sh`.
6. Restaurar prioridades padrao e registrar horario, motivo e impacto.

O harness executa:

1. check de artefatos DR;
2. restore MySQL isolado;
3. restore de auditoria SSH isolado;
4. doctor com smoke/deep health.

Para ambiente dev com API/gateway nas portas diretas:

```bash
TLS_MODE=off \
API_HEALTH_URL=http://127.0.0.1:3000/health/ready \
API_DEEP_HEALTH_URL=http://127.0.0.1:3000/health/deep \
GATEWAY_HEALTH_URL=http://127.0.0.1:3001/health/ready \
GATEWAY_DEEP_HEALTH_URL=http://127.0.0.1:3001/health/deep \
bash tools/deploy/dr-validation-harness.sh
```

## Doctor

Doctor com smoke e deep health:

```bash
TLS_MODE=off RUN_SMOKE_CHECK=true RUN_DEEP_HEALTH_CHECK=true \
API_HEALTH_URL=http://127.0.0.1:3000/health/ready \
API_DEEP_HEALTH_URL=http://127.0.0.1:3000/health/deep \
bash scripts/deploy/doctor-nodeaccess.sh
```

Saida saudavel em dev:

- API ready: OK;
- gateway ready: OK;
- API deep: OK;
- gateway deep: OK;
- backup MySQL recente: OK;
- backup auditoria SSH recente: OK;
- unico alerta esperado: `TLS_MODE=off`.

Para automacao:

```bash
DOCTOR_OUTPUT=json bash scripts/deploy/doctor-nodeaccess.sh
```

## Restore Real

Em ambiente alvo real, ordem recomendada:

1. Subir MySQL/Redis base.
2. Restaurar `.env` ou configurar valores equivalentes via cofre.
3. Garantir a mesma `PEM_ENCRYPTION_KEY` do ambiente de origem.
4. Restaurar MySQL:

```bash
bash scripts/backup/restore-mysql.sh backups/nodeaccess-mysql-<db>-YYYYMMDD-HHMMSS.sql.gz --yes
```

5. Restaurar auditoria SSH:

```bash
bash scripts/backup/restore-session-audit.sh backups/nodeaccess-session-audit-YYYYMMDD-HHMMSS.tar.gz --yes
```

6. Aplicar migrations da release alvo.
7. Subir a stack.
8. Rodar doctor com smoke/deep.
9. Rodar standby readiness antes de promover trafego.
10. Validar login admin, hosts, secrets/PEMs e sessao SSH de teste.

## Status Local Validado

Ultima validacao local registrada:

- check DR: `failures=0`, `warnings=1`;
- restore MySQL isolado: `users_count=33`, `hosts_count=930`,
  `prisma_migrations_count=109`;
- restore auditoria isolado: checksum OK, backup vazio com `restored_entries=0`;
- doctor smoke/deep: API e gateway OK;
- cleanup: sem containers/volumes temporarios remanescentes;
- unica degradacao esperada em dev: `TLS_MODE=off`.
