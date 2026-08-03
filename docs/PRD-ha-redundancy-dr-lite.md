# PRD Lite - Alta disponibilidade, redundancia e recuperacao

> Escopo homologável da versão 2.0.28: dois nós de dados, sendo um `PRIMARY`
> e um `STANDBY`. Garantias, limites e evolução estão registrados em
> `docs/DECISION-ha-two-node-v1.md`.

## Objetivo
Definir uma trilha pratica para preparar o NodeAccess para operacao resiliente,
com redundancia, backups confiaveis, recuperacao rapida e evolucao progressiva
para balanceamento de recursos.

Este documento cobre duas frentes:

- arquitetura do NodeAccess;
- arquitetura recomendada no ambiente do cliente, incluindo virtualizador, VRRP,
  balanceador, storage, backup e runbooks.

## Resposta curta
O NodeAccess ja e adequado para operacao em Docker e tem separacao entre
frontend, API, gateway SSH, MySQL, Redis e Nginx. Isso permite evoluir para HA.

Porem, a stack atual deve ser tratada como **single-node produtivo com caminho
claro para redundancia**, nao como active-active completo pronto para distribuir
todos os containers em maquinas diferentes sem ajustes.

Para HA real, os pontos que precisam ser desenhados explicitamente sao:

- MySQL altamente disponivel ou externo/gerenciado;
- Redis altamente disponivel ou com comportamento seguro em falha;
- armazenamento compartilhado ou replicado para auditoria de sessoes;
- sticky sessions ou roteamento consistente para WebSocket/gateway SSH;
- politica clara para sessoes SSH em queda de gateway;
- backup e restore testados com RTO/RPO definidos;
- observabilidade e health checks por componente;
- runbook de failover e rollback.

## Premissas atuais
Stack de referencia:

- frontend estatico via Nginx;
- API REST Fastify em `APP_MODE=api`;
- gateway SSH/WebSocket em `APP_MODE=gateway`;
- MySQL 8 como fonte primaria dos dados;
- Redis 7 como cache/estado auxiliar;
- guacd para protocolos graficos;
- volume `session_audit_data` para chunks de auditoria SSH;
- volume `user_avatar_data` para avatares de usuario;
- scripts de backup/restore em `scripts/backup`, incluindo backup agregado.

O fluxo principal e:

```text
browser -> HTTPS/WSS -> Nginx -> API/Gateway -> SSH/guacd/host
```

## Riscos que impedem active-active ingenuo
Rodar containers em maquinas diferentes sem arquitetura comum pode gerar
instabilidade por estes motivos:

1. **Sessoes SSH/WebSocket sao stateful**
   - Uma sessao viva fica presa ao gateway que abriu o SSH.
   - Se o balanceador mandar o WebSocket para outro gateway durante a sessao, a
     conexao nao sera retomada automaticamente.

2. **Auditoria de sessao usa armazenamento compartilhado**
   - Chunks em `SESSION_AUDIT_STORAGE_DIR` precisam sobreviver ao restart e ser
     acessiveis pelo backend que processa leitura/replay.
   - Em multi-node, volume local por maquina cria fragmentacao.

3. **MySQL e a fonte primaria**
   - Se MySQL cair, login, hosts, auditoria, permissoes e configuracoes ficam
     indisponiveis ou degradados.
   - Compose local com um MySQL unico e simples, mas e ponto unico de falha.

4. **Redis precisa de semantica definida**
   - Redis pode ser cache, coordenacao e estado temporario.
   - Em HA, precisa Sentinel/Cluster/servico gerenciado ou regras claras de
     degradacao.

5. **Segredos precisam ser identicos entre nos**
   - `JWT_SECRET` e `PEM_ENCRYPTION_KEY` devem ser iguais em todos os nos.
   - Mismatch quebra autenticacao ou descriptografia de PEM/secrets.

## Estado alvo recomendado
### Nivel 1 - Producao single-node robusta
Indicado para primeiro deploy controlado.

Componentes:

- 1 VM ou servidor;
- Docker Compose;
- MySQL local em volume persistente;
- Redis local em volume persistente ou cache descartavel documentado;
- Nginx no mesmo host;
- backup MySQL automatico;
- snapshot da VM antes de upgrades;
- monitoramento basico de CPU, memoria, disco e disponibilidade HTTP.

Objetivo:

- reduzir risco operacional;
- validar instalacao, backup e restore;
- criar base de runbooks.

Limites:

- falha do host derruba a plataforma;
- restore depende de backup e tempo manual;
- sessoes SSH ativas caem se o host cair.

### Nivel 2 - Active/passive com warm standby
Indicado como primeiro passo realista de redundancia.

Componentes:

- VM primaria;
- VM secundaria preparada com mesma release, `.env` e certificados;
- MySQL replicado ou restore frequente para standby;
- backup externo;
- IP virtual via VRRP/Keepalived ou troca DNS controlada;
- storage/auditoria replicado ou backupado;
- runbook de failover.

Objetivo:

- reduzir tempo de recuperacao;
- evitar reinstalacao manual em desastre;
- manter custo operacional baixo.

RTO/RPO sugeridos para primeira meta:

- RTO: 30 a 60 minutos;
- RPO: 15 a 60 minutos, conforme frequencia de backup/replicacao.

Observacao:

- sessoes SSH ativas ainda caem no failover;
- usuarios reconectam manualmente apos a troca.

### Nivel 3 - Active/passive automatizado
Indicado apos estabilizar backup/restore e health checks.

Componentes:

- 2 ou mais VMs;
- VRRP com health check real da aplicacao;
- MySQL com replicacao primaria/secundaria ou servico gerenciado;
- Redis Sentinel ou Redis gerenciado;
- auditoria em storage compartilhado/replicado;
- Nginx/HAProxy/Traefik com failover;
- alertas e dashboard.

Objetivo:

- failover mais rapido;
- menos intervencao manual;
- ambiente preparado para manutencao programada.

RTO/RPO sugeridos:

- RTO: 5 a 15 minutos;
- RPO: 1 a 15 minutos.

### Nivel 4 - Active-active parcial
Indicado quando houver escala, multiplos clientes ou requisito forte de uptime.

Componentes:

- multiplas instancias de frontend/API;
- multiplas instancias de gateway;
- balanceador L7 com suporte a WebSocket;
- sticky session para `/ws/` e rotas stateful de gateway;
- MySQL HA;
- Redis HA;
- storage compartilhado para auditoria;
- observabilidade centralizada;
- deploy rolling com draining de gateways.

Regras importantes:

- API REST pode ser mais facilmente horizontalizada;
- gateway SSH exige afinidade por conexao;
- sessoes ativas nao devem migrar de um gateway para outro no MVP;
- antes de derrubar gateway, deve haver draining:
  - parar novas sessoes naquele gateway;
  - aguardar sessoes existentes encerrarem ou avisar usuarios;
  - encerrar de forma controlada se necessario.

## Arquitetura recomendada por componente
Antes de replicar containers, manter o inventario de estado atualizado em
`docs/OPERATIONS-ha-state-inventory-lite.md`. Ele define quais dados podem ser
volateis, quais precisam de backup e quais precisam ser compartilhados entre
nos.

### Frontend/Nginx
Pode ser replicado com baixo risco.

Requisitos:

- build estatico identico em todos os nos;
- TLS consistente;
- headers e proxy iguais;
- cache de assets seguro.

Em HA:

- usar balanceador na frente;
- ou usar Nginx em cada no atras de VIP VRRP;
- manter `/api/` e `/ws/` roteados corretamente.

### API REST
Boa candidata para escala horizontal.

Requisitos:

- sem estado local obrigatorio;
- mesmos segredos em todos os nos;
- acesso ao mesmo MySQL;
- acesso ao mesmo Redis;
- logs centralizados.

Cuidados:

- jobs assincornos devem ter lock distribuido se puderem rodar em mais de um no;
- operacoes idempotentes reduzem risco em retry;
- migrations devem rodar uma vez por release, nao em todos os containers ao
  mesmo tempo.

### Gateway SSH/WebSocket
E o componente mais sensivel para HA.

Requisitos:

- roteamento WebSocket com `Upgrade`;
- timeout alto;
- sticky session por conexao;
- health check especifico do gateway;
- draining antes de restart;
- politica clara quando gateway cair.

Comportamento recomendado no MVP:

- se gateway cair, sessoes SSH daquele gateway caem;
- UI deve informar queda e permitir reconexao manual;
- auditoria deve registrar fim anormal quando possivel.

Evolucao futura:

- registry de sessoes distribuido;
- draining por instancia;
- indicador de gateway por sessao para suporte;
- retomada controlada de sessao quando tecnicamente seguro.

### MySQL
E o principal ponto de consistencia.

Opcoes:

1. MySQL local com backup frequente.
2. MySQL primario/secundario com replicacao.
3. MySQL gerenciado com HA.
4. Galera/InnoDB Cluster, apenas quando houver maturidade operacional.

Recomendacao pragmatica:

- fase 1: backup + restore testado;
- fase 2: replica ou servico gerenciado;
- fase 3: failover documentado e testado.

Cuidados:

- migrations sempre com backup antes;
- rollback de app nao garante rollback de schema;
- monitorar conexoes, locks, slow queries, disco e lag de replica.

### Redis
Redis deve ser tratado conforme o uso real.

Opcoes:

- single Redis local no nivel 1;
- Redis Sentinel no nivel 3;
- Redis gerenciado no nivel 3/4.

Requisitos em HA:

- URL comum para todos os nos;
- politica de persistencia definida;
- monitorar memoria e evictions;
- revisar quais dados podem ser perdidos sem quebrar seguranca.

### Auditoria de sessoes
Chunks de auditoria nao podem depender de disco efemero local em HA.

Opcoes:

1. volume persistente local com backup no nivel 1;
2. replicacao de diretorio para standby no nivel 2;
3. NFS/SMB/volume compartilhado no nivel 3;
4. object storage/S3-compativel no nivel 4.

Recomendacao:

- curto prazo: incluir `session_audit_data` no plano de backup;
- medio prazo: mover chunks para storage compartilhado ou object storage;
- longo prazo: separar metadados em MySQL e blob em storage externo com
  retencao configuravel.

### guacd / protocolos graficos
`guacd` pode ser replicado, mas conexoes graficas tambem sao stateful.

Requisitos:

- roteamento consistente;
- health check;
- draining para manutencao;
- decisao se cada gateway usa um guacd local ou pool compartilhado.

## Backups
### O que deve entrar no backup
Obrigatorio:

- MySQL;
- `.env` protegido ou cofre com valores equivalentes;
- `PEM_ENCRYPTION_KEY`;
- `JWT_SECRET`;
- certificados TLS quando gerenciados localmente;
- chunks de auditoria SSH;
- avatares de usuario;
- manifest da versao/release.

Rotina operacional recomendada:

```bash
bash scripts/backup/backup-all-nodeaccess.sh ./backups
```

O backup agregado executa MySQL, auditoria SSH e avatares no mesmo fluxo e pode
rodar a validacao de artefatos DR ao final. Em instalacoes antigas ou em
transicao, `REQUIRE_STATEFUL_BACKUPS=false` permite seguir quando um backup
stateful ainda nao existir, mas a rotina completa de HA deve operar em modo
estrito.

Nao recomendado embutir automaticamente:

- segredos em claro dentro do pacote de backup;
- tokens externos sem protecao;
- dumps sem criptografia em destino compartilhado.

### Frequencia inicial sugerida
Para ambiente pequeno/medio:

- dump MySQL diario;
- backup incremental ou copia de auditoria a cada 15-60 minutos se auditoria for
  critica;
- snapshot antes de upgrade;
- retencao:
  - diarios: 7 a 14 dias;
  - semanais: 4 a 8 semanas;
  - mensais: 6 a 12 meses, conforme contrato/compliance.

### Teste de restore
Backup so deve ser considerado confiavel se houver restore testado.

Checklist minimo mensal:

- restaurar MySQL em ambiente isolado;
- subir mesma release;
- validar login admin;
- listar hosts;
- abrir tela de auditoria;
- validar PEM/secrets cifrados com a mesma `PEM_ENCRYPTION_KEY`;
- abrir sessao SSH de teste.

## Recuperacao de desastre
### RTO e RPO
Definir por cliente:

- RTO: tempo maximo aceitavel para voltar a operar;
- RPO: perda maxima aceitavel de dados.

Tabela inicial:

| Perfil | RTO alvo | RPO alvo | Arquitetura sugerida |
|---|---:|---:|---|
| Piloto interno | 4-8h | 24h | single-node + backup diario |
| Producao pequena | 1-2h | 1h | single-node robusto + backup frequente + standby manual |
| Producao critica | 15-60min | 5-15min | active/passive + replica DB + storage replicado |
| Missao critica | 5-15min | <5min | HA gerenciado + LB + Redis HA + DB HA |

### Runbook de restore
1. Identificar versao da release usada no backup.
2. Preparar VM/host limpo.
3. Instalar Docker/Compose.
4. Restaurar `.env` seguro com `PEM_ENCRYPTION_KEY` correta.
5. Restaurar MySQL.
6. Restaurar chunks de auditoria.
7. Subir MySQL/Redis.
8. Aplicar migrations se a release exigir.
9. Subir API/gateway/frontend.
10. Validar login, hosts, auditoria, secrets e SSH.
11. Apontar DNS/VIP para o ambiente recuperado.

## Cliente com virtualizador, VRRP e balanceador
### Desenho active/passive simples
```text
            usuarios
               |
            DNS/VIP
               |
        VRRP/Keepalived
          /          \
   NodeAccess A   NodeAccess B
   ativo          standby
      |              |
      +-- backup/replicacao --+
```

Uso recomendado:

- uma VM ativa;
- uma VM standby;
- VIP via Keepalived;
- health check chamando endpoint HTTP real;
- backup ou replicacao do MySQL;
- sincronizacao controlada de certificados, `.env` e auditoria.

### Desenho com balanceador
```text
            usuarios
               |
        HAProxy/Nginx/LB
        /              \
   frontend/API A   frontend/API B
        \              /
        MySQL HA / Redis HA
               |
      storage auditoria compartilhado
```

Regras:

- `/api/` pode balancear entre APIs saudaveis;
- `/ws/` precisa preservar conexao WebSocket e afinidade;
- gateway deve ter draining antes de manutencao;
- health checks devem diferenciar API, gateway, MySQL e Redis.

### Tecnicas possiveis no cliente
Virtualizador:

- snapshots antes de upgrade;
- anti-affinity entre VMs quando houver cluster;
- storage redundante;
- backup externo ao cluster.

VRRP/Keepalived:

- VIP unico para NodeAccess;
- failover active/passive;
- script de health check que valide HTTP e dependencia basica.

Balanceador:

- HAProxy, Nginx, Traefik ou appliance;
- suporte a WebSocket;
- timeouts longos para `/ws/`;
- sticky session para gateway;
- TLS termination centralizada ou passthrough.

Storage:

- volume local com backup no nivel 1;
- replicacao no nivel 2;
- NFS/SMB/volume compartilhado no nivel 3;
- object storage no nivel 4.

Banco:

- MySQL gerenciado quando possivel;
- replica com failover documentado quando self-hosted;
- backup mesmo quando houver replicacao.

## Observabilidade minima
Coletar:

- disponibilidade HTTP do frontend;
- health da API;
- health do gateway;
- conexoes WebSocket ativas;
- sessoes SSH ativas;
- uso de CPU/memoria por container;
- disco dos volumes;
- MySQL conexoes, locks, slow queries, uso de disco;
- Redis memoria, evictions e reconexoes;
- tamanho e crescimento de auditoria;
- duracao e resultado de backups;
- tempo de restore em teste.

Alertas minimos:

- API indisponivel;
- gateway indisponivel;
- MySQL indisponivel;
- Redis indisponivel;
- disco acima de 80%;
- backup nao executado ou checksum ausente;
- crescimento anormal de auditoria;
- erro recorrente em WebSocket/SSH.

## Mudancas recomendadas no NodeAccess
### Curto prazo
- Documentar claramente que a topologia atual e single-node produtiva.
- Incluir `session_audit_data` no plano de backup.
- Criar health checks explicitos para API e gateway.
- Criar script de doctor que valide:
  - MySQL;
  - Redis;
  - storage de auditoria;
  - segredos obrigatorios;
  - versao/migrations.
- Documentar restore completo incluindo auditoria.

### Medio prazo
- Suportar storage externo para chunks de auditoria.
- Adicionar draining de gateway.
- Identificar instancia/gateway em sessao ativa e auditoria.
- Melhorar health check do gateway.
- Padronizar metricas Prometheus ou endpoint de metrics.
- Criar runbook de failover active/passive.

### Longo prazo
- Suporte formal a multi-node.
- Redis HA documentado.
- MySQL HA documentado por perfil.
- Balanceamento de API e gateway com afinidade.
- Jobs com lock distribuido.
- Deploy rolling sem derrubar sessoes quando possivel.

## Criterios de pronto para dizer "HA suportado"
Antes de declarar suporte formal a HA, validar:

- 2 APIs rodando contra o mesmo MySQL/Redis sem divergencia;
- 2 gateways com WebSocket sticky funcionando;
- queda de uma API nao quebra login/listagens;
- queda de um gateway derruba apenas sessoes daquele gateway e gera feedback claro;
- auditoria continua acessivel apos troca de no;
- backup e restore completos foram testados;
- failover active/passive tem runbook e tempo medido;
- upgrade com rollback operacional foi ensaiado;
- segredos e certificados sao sincronizados com seguranca.

## Testes recomendados
### Harness tecnico
- carga de API com 100/200/500 sessoes simuladas;
- gateway SSH com conexoes reais e comandos;
- CDP/browser com multiplas abas;
- queda controlada de API;
- queda controlada de gateway;
- reinicio de Redis;
- indisponibilidade temporaria de MySQL;
- disco quase cheio no volume de auditoria;
- restore em ambiente limpo.

### Testes de cliente
- failover VRRP manual;
- failover VRRP por health check;
- troca de DNS/VIP;
- restore em VM nova;
- snapshot antes/depois de upgrade;
- teste de perda de uma VM;
- teste de perda de storage local;
- teste de expiracao/renovacao TLS.

## Decisao recomendada
Para evoluir com seguranca:

1. Consolidar **single-node robusto** com backup/restore completo.
2. Implementar **warm standby** com runbook.
3. Evoluir para **active/passive com VRRP**.
4. So depois partir para **active-active parcial**, com API horizontal e gateway
   sticky.

Essa trilha evita vender HA antes de medir failover, preserva a estabilidade do
terminal e reduz risco de perda de auditoria ou secrets.

## Plano inicial de execucao
### Principios
Comecar por mudancas pequenas e testaveis, mantendo funcionamento total da
plataforma atual. HA nao deve entrar como refatoracao ampla do produto; deve
nascer como camada operacional incremental, com health checks, doctor, backup,
restore e harnesses antes de VRRP ou balanceamento.

Regras para as primeiras entregas:

- nao quebrar o compose single-node atual;
- manter API e gateway desacoplados;
- manter sessoes SSH stateful no gateway ate haver desenho formal de draining;
- adicionar endpoints e scripts de forma retrocompativel;
- toda etapa deve ter teste ou smoke check correspondente;
- preferir observabilidade e runbook antes de automacao agressiva.

### Etapa 1 - Health checks reais
Objetivo: diferenciar processo vivo de servico realmente operacional.

Hoje existem:

- `/health` na API retornando `status=ok`, `mode=api` e timestamp;
- `/health` no gateway retornando `status=ok`, `mode=gateway` e timestamp;
- healthcheck Docker para MySQL com `mysqladmin ping`;
- healthcheck Docker para Redis com `redis-cli ping`;
- `scripts/install/smoke-check.sh` validando API e gateway;
- `scripts/deploy/doctor-nodeaccess.sh` validando arquivos, compose, imagens,
  TLS e smoke check opcional.

Lacunas:

- `/health` da API ainda nao valida MySQL, Redis, migrations ou storage;
- `/health` do gateway ainda nao valida Redis, MySQL, storage de auditoria,
  buses internos ou capacidade de aceitar WebSocket;
- nao ha endpoint agregado para UI administrativa;
- nao ha historico de amostras de saude;
- nao ha degradacao separada entre `ok`, `degraded` e `down`.

Entregaveis recomendados:

- `/health/live`: processo vivo, barato, sem dependencias;
- `/health/ready`: pronto para receber trafego, validando dependencias criticas;
- `/health/deep`: diagnostico detalhado para admin/doctor, com timeout curto;
- health check do gateway com validacao de dependencias do gateway;
- resultado padronizado:
  - `status`: `ok`, `degraded`, `down`;
  - `mode`: `api` ou `gateway`;
  - `version`;
  - `timestamp`;
  - `checks[]` com `name`, `status`, `latencyMs`, `message`;
  - sem expor segredo, DSN, token ou caminho sensivel.

Status inicial implementado:

- API e gateway registram `/health`, `/health/live`, `/health/ready` e
  `/health/deep`;
- `/health` permanece compativel como liveness simples;
- readiness valida MySQL, Redis e storage de auditoria;
- deep adiciona verificacao de `_prisma_migrations`;
- `scripts/install/smoke-check.sh` passa a usar `/health/ready` por padrao;
- `scripts/deploy/doctor-nodeaccess.sh` pode consumir `/health/deep` da API e
  do gateway com `RUN_DEEP_HEALTH_CHECK=true`;
- testes unitarios cobrem sucesso, falha de dependencia, ausencia de vazamento
  de DSN/segredo e contrato HTTP via `Fastify.inject`.

Proximos ajustes dessa etapa:

- adicionar health detalhado de buses internos do gateway;
- decidir se `degraded` deve retornar HTTP 200 ou 503 por perfil de uso
  `LB/VRRP/UI`.

### Etapa 2 - Doctor operacional fortalecido
Objetivo: o operador conseguir diagnosticar antes de abrir chamado ou acionar
failover.

Pendencias para o `doctor-nodeaccess.sh`:

- validar MySQL por query simples;
- validar Redis por ping;
- validar volume de auditoria com teste de escrita/leitura nao destrutivo;
- validar versao da release e migrations;

Status inicial implementado:

- doctor mantem smoke check opcional via `RUN_SMOKE_CHECK=true`;
- doctor adiciona deep health opcional via `RUN_DEEP_HEALTH_CHECK=true`;
- deep health consulta:
  - API em `APP_URL + /health/deep`, ou `API_DEEP_HEALTH_URL` quando
    informado;
  - gateway em `GATEWAY_DEEP_HEALTH_URL`, padrao
    `http://127.0.0.1:3001/health/deep`;
- para TLS self-signed, o doctor aceita `curl -k` automaticamente em URL HTTPS
  quando `TLS_MODE=selfsigned`, ou explicitamente com
  `DOCTOR_HEALTH_INSECURE=true`.
- doctor valida espaco livre do projeto, diretorio de backups e volumes Docker
  declarados no compose;
- doctor valida backup MySQL recente em `BACKUP_DIR`, considerando
  `MAX_BACKUP_AGE_HOURS` como limite operacional.
- scripts operacionais de install/update/doctor/smoke/backup/restore carregam
  `.env` por parser seguro de `KEY=VALUE`, sem executar valores via `source`.
- doctor suporta saida estruturada com `DOCTOR_OUTPUT=json`, preservando texto
  humano como padrao;
- harness `tools/deploy/doctor-nodeaccess-harness.cjs` valida `.env` com regex,
  modo texto, modo JSON, backup recente e compose/Docker simulados.

Validacao local em 2026-07-23:

- alerta anterior de Docker daemon sem permissao foi confirmado como efeito do
  sandbox da automacao; no terminal real o doctor acessa Docker normalmente;
- backup MySQL inicial foi gerado em `backups/`, com dump, manifest e checksum;
- volume Docker `nodeaccess_session_audit_data` foi criado para alinhar o
  ambiente ao compose;
- doctor real passou a concluir com dois alertas esperados em dev:
  - `TLS_MODE=off`;
  - smoke check desligado por padrao.
- smoke/deep dependem de reiniciar ou subir API/gateway com os endpoints
  `/health/ready` e `/health/deep` carregados; os processos atuais em
  `3000/3001` ainda retornam 404 nesses endpoints.
- validacao posterior confirmou API e gateway respondendo 200 diretamente em
  `127.0.0.1:3000/health/*` e `127.0.0.1:3001/health/*`;
- falha 404 em `APP_URL + /health/*` foi identificada como roteamento ausente
  no Nginx; configs `docker/nginx.http.conf`, `docker/nginx.https.conf`,
  `docker/nginx.prod.conf` e `docker/nginx.dev.conf` passam a proxyar
  `/health` e `/health/*` para a API.

### Etapa 3 - Backup e restore completos
Objetivo: antes de HA, garantir recuperacao confiavel.

Entregaveis:

- incluir `session_audit_data` no plano de backup;
- documentar backup seguro de `.env`, certificados e segredos;
- manifest com versao, checksums, data e origem;
- backup de auditoria SSH separado em
  `scripts/backup/backup-session-audit.sh`, gerando `.tar.gz`, manifest e
  checksum;
- restore de auditoria SSH separado em
  `scripts/backup/restore-session-audit.sh`, exigindo checksum por padrao e
  `--yes` para substituir destino nao vazio;
- backup e restore de avatares separados em
  `scripts/backup/backup-user-avatars.sh` e
  `scripts/backup/restore-user-avatars.sh`, com `.tar.gz`, manifest e checksum;
- backup agregado em `scripts/backup/backup-all-nodeaccess.sh`, reunindo MySQL,
  auditoria SSH, avatares e check DR opcional;
- `docker-compose.prod.yml` monta `user_avatar_data` em
  `/var/lib/nodeaccess/user-avatars` na API;
- update e rollback executam backups stateful opcionais de auditoria SSH e
  avatares quando `RUN_BACKUP=true` e `RUN_STATEFUL_BACKUPS=true`;
- check de artefatos DR em `scripts/backup/check-dr-artifacts.sh`, validando
  `.env`, segredos criticos, TLS/certificados conforme modo, backup MySQL,
  backup de auditoria, backup de avatares, manifests e checksums;
- restore MySQL exige checksum por padrao, com escape operacional explicito via
  `RESTORE_REQUIRE_CHECKSUM=false`;
- harness `tools/deploy/restore-mysql-isolated-harness.sh` restaura dump em
  MySQL temporario isolado, sem tocar no banco atual;
- harness `tools/deploy/restore-session-audit-isolated-harness.sh` restaura
  backup de auditoria em volume Docker temporario, sem tocar no volume atual;
- harness agregado `tools/deploy/dr-validation-harness.sh` executa check DR,
  restore MySQL isolado, restore de auditoria isolado e doctor com smoke/deep;
- smoke pos-restore:
  - login admin;
  - listagem de hosts;
  - leitura de PEM/secrets;
  - auditoria;
  - sessao SSH de teste.

Validacao local em 2026-07-23:

- restore isolado do backup `nodeaccess-mysql-sshplatform-20260723-104912.sql.gz`
  concluido com checksum OK;
- validacao minima pos-restore encontrou:
  - `users_count=33`;
  - `hosts_count=930`;
  - `prisma_migrations_count=109`.
- doctor passa a validar backup recente de auditoria SSH procurando
  `nodeaccess-session-audit-*.tar.gz` ou manifest correspondente em
  `BACKUP_DIR`.
- doctor passa a validar backup recente de avatares procurando
  `nodeaccess-user-avatars-*.tar.gz` ou manifest correspondente em
  `BACKUP_DIR`.
- backup local de auditoria SSH gerado com `.tar.gz`, manifest, checksum e
  validado pelo doctor;
- restore isolado do backup de auditoria SSH validado em volume Docker
  temporario;
- backup/restore isolado de avatares validado via
  `tools/deploy/backup-user-avatars-harness.sh`;
- harness isolado do backup agregado em
  `tools/deploy/backup-all-nodeaccess-harness.sh`;
- backups de auditoria vazios registram `entryCount=0`, ignorando apenas a
  entrada raiz do tar.
- check local de artefatos DR executado com:
  - `.env` presente;
  - `JWT_SECRET` e `PEM_ENCRYPTION_KEY` em formato minimo valido;
  - backup MySQL, manifest e checksum validos;
  - backup de auditoria SSH, manifest e checksum validos;
  - zero falhas e um alerta esperado de `TLS_MODE=off` em dev.
- harness agregado de DR validado localmente com restores isolados e doctor;
  unica degradacao esperada em dev: `TLS_MODE=off`.
- execucao agregada validada:
  - check DR: `failures=0`, `warnings=1`;
  - restore MySQL isolado: `users_count=33`, `hosts_count=930`,
    `prisma_migrations_count=109`;
  - restore auditoria isolado: checksum OK, `restored_entries=0` para backup
    vazio;
  - doctor smoke/deep: API e gateway OK;
  - cleanup: sem containers/volumes temporarios remanescentes.

### Etapa 4 - Harness de falhas controladas
Objetivo: medir comportamento real antes de VRRP/balanceador.

Cenarios:

- API reiniciada durante uso normal;
- gateway reiniciado com sessao SSH ativa;
- Redis indisponivel temporariamente;
- MySQL indisponivel temporariamente;
- storage de auditoria sem permissao de escrita;
- disco proximo do limite;
- restore em VM/ambiente novo;
- carga leve apos restore.

Resultado esperado:

- falha clara para usuario;
- logs suficientes para suporte;
- sem perda silenciosa de auditoria;
- reconexao manual quando gateway cair;
- nenhum segredo exposto.

Status inicial implementado:

- harness seguro `tools/deploy/failure-readiness-harness.sh` valida baseline
  com doctor/smoke/deep e check DR;
- o harness simula falhas sem parar containers:
  - API readiness indisponivel por URL invalida;
  - API deep indisponivel por URL invalida;
  - backup MySQL vencido por threshold artificial;
- degradacoes esperadas validam a presenca do alerta emitido pelo `doctor`,
  preservando exit code 0 para estado operacional degradado, mas nao fatal;
- cenarios destrutivos reais ficam atras de `RUN_DESTRUCTIVE_FAILURES=true`;
- por padrao, o harness destrutivo reinicia apenas `api ssh-gateway`, podendo
  receber `DESTRUCTIVE_SERVICES="api ssh-gateway redis mysql"` em janela
  controlada;
- apos cada reinicio, o harness aguarda recuperacao via `doctor` com
  smoke/deep antes de seguir para o proximo servico;
- se o health responder por processo externo ao Docker, mas o servico nao tiver
  container ativo no compose, o harness marca aviso e ignora o restart para
  evitar falso positivo;
- ainda nao valida uma sessao SSH real ativa durante restart do gateway; esse
  cenario deve entrar quando o harness integrar o gerador de sessao/terminal.

Validacao local em 2026-07-23:

- modo seguro: `5 pass`, `1 warn`, `0 fail`; aviso esperado por destrutivos
  desabilitados;
- modo destrutivo leve com `api ssh-gateway`: `5 pass`, `2 warn`, `0 fail`;
  os dois avisos ocorreram porque os health checks respondiam em `3000/3001`,
  mas os containers `api` e `ssh-gateway` nao estavam ativos no compose;
- modo destrutivo real com `redis`: `3 pass`, `1 warn`, `0 fail`; Redis foi
  reiniciado e recuperou health na primeira tentativa;
- MySQL nao foi reiniciado nesta rodada para evitar impacto maior fora de janela
  dedicada.

### Etapa 4.1 - Base de observabilidade operacional
Objetivo: criar uma fonte estruturada para uma futura tela Admin de
observabilidade sem acoplar o frontend a Docker, shell scripts ou comandos do
sistema operacional.

Status inicial implementado:

- rota administrativa somente leitura
  `GET /api/v1/admin/observability/summary`;
- acesso restrito a administradores do tenant;
- snapshot com cache curto para evitar executar `docker stats` e `df` a cada
  abertura ou refresh da tela;
- historico curto em memoria por processo para tendencia visual de CPU,
  memoria, disco e indisponibilidades recentes;
- metricas do servidor:
  - hostname, plataforma, arquitetura e uptime;
  - CPU cores, modelo e load average de 1/5/15 minutos;
  - memoria total, livre, usada e memoria do processo Node;
  - disco para projeto, auditoria de sessoes e diretorio de backups;
- thresholds operacionais configuraveis para degradar o snapshot quando CPU,
  memoria, disco ou idade de backup ultrapassarem o limite esperado;
- metricas de containers via `docker stats --no-stream --format json`:
  - CPU, memoria, rede e bloco por container;
- health consolidado:
  - API e gateway via `/health/ready`;
  - MySQL via `SELECT 1`;
  - Redis via `PING`;
  - guacd via conexao TCP;
- backups:
  - ultimo backup MySQL encontrado;
  - ultimo backup de auditoria SSH encontrado;
  - data, idade em horas e status por tipo;
- coleta best-effort: se Docker ou disco estiver indisponivel, o endpoint
  responde `degraded` com `warnings`, sem derrubar a API.
- escopo explicitamente local por no:
  - o snapshot atual representa a maquina/container onde a API respondeu;
  - em ambiente HA com containers distribuidos em varias maquinas, sera
    necessario um agregador que consulte cada no ou receba snapshots por push;
  - a tela global deve diferenciar `node local`, `node remoto` e `cluster`.

Proximos incrementos:

- criar agregador multi-node para HA, com identidade do no, ultima coleta,
  status e recursos por maquina;
- persistir ou exportar snapshots quando for necessario historico entre
  reinicios, comparacao entre servidores ou analise de capacidade de longo
  prazo.

Tela inicial implementada:

- rota frontend `Admin > Observabilidade` em `/admin/observability`;
- visoes de status geral, CPU, memoria, host, componentes, backups, disco e
  containers;
- graficos compactos de tendencia recente usando o historico curto local em
  memoria;
- exibicao dos limites operacionais aplicados ao snapshot para reduzir
  ambiguidade quando o estado geral ficar em atencao;
- refresh manual somente leitura;
- aviso explicito de snapshot local por no;
- harness `tools/frontend/observability-cdp-harness.cjs` cobre desktop
  saudavel, desktop degradado e mobile saudavel com API mockada;
- validacao do harness em 2026-07-23: zero achados, sem erro de console e sem
  overflow horizontal.

Acao futura: backup manual pela tela:

- faz sentido expor `Executar backup` no card de backups, mas nao como chamada
  HTTP sincrona simples;
- a acao deve criar job assincrono para evitar timeout, clique duplicado e falsa
  percepcao de falha em backups demorados;
- opcoes previstas:
  - Backup MySQL;
  - Backup auditoria SSH;
  - Backup completo;
- antes de iniciar, exibir modal de confirmacao com:
  - destino do backup;
  - idade do ultimo backup;
  - espaco livre disponivel;
  - impacto operacional esperado;
- o backend deve registrar:
  - `queued`, `running`, `succeeded` ou `failed`;
  - `requestedBy`, `startedAt`, `finishedAt`;
  - tipo de backup;
  - resumo do resultado e caminho/manifest/checksum quando aplicavel;
- registrar auditoria administrativa da solicitacao e do resultado, sem guardar
  conteudo do backup;
- a tela deve exibir estado `Backup em execucao`, resultado final e erro
  amigavel quando falhar;
- manter a tela somente leitura ate existir o job backend e as travas de
  concorrencia/espaco em disco.

### Etapa 5 - Warm standby
Objetivo: reduzir RTO sem mexer no caminho feliz atual.

Passos:

1. Validar o inventario de estado em
   `docs/OPERATIONS-ha-state-inventory-lite.md`.
2. Preparar VM secundaria com mesma release.
3. Replicar `.env` seguro, certificados e compose.
4. Restaurar banco periodicamente ou configurar replica.
5. Replicar ou restaurar auditoria e avatares.
6. Rodar doctor na secundaria.
7. Ensaiar troca manual de DNS/VIP.
8. Medir RTO/RPO real.

### Etapa 6 - VRRP/active-passive
Objetivo: automatizar failover apenas depois de health checks confiaveis.

Passos:

- Keepalived/VRRP com VIP;
- health script chamando `/health/ready`;
- criterio para mover VIP;
- runbook para volta controlada ao primario;
- teste mensal de failover.

Status inicial:

- health script `scripts/deploy/keepalived-health-check.sh` criado com contrato
  de exit code compativel com `vrrp_script`;
- exemplo `docker/keepalived/keepalived-nodeaccess.conf.example` criado como
  ponto de partida para cliente/lab;
- exemplos separados `docker/keepalived/keepalived-nodeaccess-node-a.conf.example`
  e `docker/keepalived/keepalived-nodeaccess-node-b.conf.example` criados para
  par active/passive com prioridades distintas;
- harness `tools/deploy/keepalived-health-check-harness.sh` valida API/gateway
  saudaveis, API indisponivel e gateway indisponivel.
- harness `tools/deploy/keepalived-active-passive-config-harness.sh` valida
  coerencia basica dos exemplos node A/B.

### Etapa 7 - Balanceamento parcial
Objetivo: escalar com baixo risco.

Ordem recomendada:

1. frontend/Nginx;
2. API REST stateless;
3. gateway apenas com sticky session;
4. draining de gateway antes de manutencao;
5. active-active parcial depois de metricas e runbooks.

## Tela de monitoramento operacional
### Viabilidade
Faz sentido criar uma tela administrativa de monitoramento, mas ela nao deve
consumir diretamente os `/health` publicos atuais como fonte final.

Os `/health` atuais servem bem para:

- Docker healthcheck;
- smoke check;
- VRRP;
- load balancer;
- troubleshooting basico.

Eles ainda nao sao suficientes para uma tela rica porque:

- retornam apenas `status=ok`;
- nao detalham dependencias;
- nao indicam latencia por componente;
- nao informam uso de disco, backup, auditoria ou filas;
- nao tem historico;
- nao diferenciam degradacao de indisponibilidade total.

### Abordagem recomendada
Criar um endpoint autenticado e agregado, por exemplo:

```text
GET /api/v1/platform/health
```

Escopo:

- somente admin/plataforma;
- agrega API, gateway, MySQL, Redis, storage de auditoria, backups e versao;
- usa timeouts curtos;
- nunca expõe segredos;
- retorna dados prontos para UI;
- pode armazenar snapshots curtos para historico.

Exemplo de resposta:

```json
{
  "status": "degraded",
  "generatedAt": "2026-07-23T12:00:00.000Z",
  "components": [
    { "name": "api", "status": "ok", "latencyMs": 8 },
    { "name": "gateway", "status": "ok", "latencyMs": 12 },
    { "name": "mysql", "status": "ok", "latencyMs": 5 },
    { "name": "redis", "status": "ok", "latencyMs": 2 },
    { "name": "session_audit_storage", "status": "degraded", "message": "free disk below threshold" },
    { "name": "backup", "status": "degraded", "message": "last backup older than policy" }
  ]
}
```

### UX recomendada
Tela em `Admin > Operacao` ou `Admin > Saude da plataforma`.

Primeiro corte:

- cards compactos por componente;
- status geral no topo;
- ultima verificacao;
- latencia por check;
- erros recentes;
- backup mais recente;
- uso de disco dos volumes;
- botoes:
  - atualizar;
  - copiar diagnostico;
  - abrir doctor/runbook.

Estados:

- `ok`: tudo operacional;
- `degraded`: plataforma opera, mas ha risco ou dependencia degradada;
- `down`: componente critico indisponivel;
- `unknown`: check sem dados ou timeout.

### Regras de seguranca
- acesso apenas para admin;
- nao exibir secrets, DSN, senhas ou tokens;
- mascarar caminhos sensiveis;
- limitar taxa de refresh;
- registrar consulta manual se virar recurso de suporte/auditoria;
- health publico continua minimo; health detalhado fica autenticado.

### Ordem para implementar a tela
1. Padronizar health checks backend.
2. Criar agregador autenticado.
3. Criar testes unitarios do agregador.
4. Criar harness de falhas simuladas.
5. Criar tela admin simples.
6. Adicionar historico/snapshots depois.

## Etapa 8 - Readiness de estado para HA
Objetivo: transformar o inventario de estado em validacao automatica antes de
testes com standby, VRRP ou balanceador.

Status inicial:

- script `scripts/deploy/ha-state-readiness.sh` criado para validar variaveis,
  diretorios stateful, backups e opcionalmente health/observabilidade;
- suporta saida texto e JSON via `HA_READINESS_OUTPUT`;
- health checks de API/gateway sao opt-in via `RUN_HEALTH_CHECKS=true`;
- observabilidade admin e opt-in via `RUN_OBSERVABILITY_CHECK=true`;
- harness isolado `tools/deploy/ha-state-readiness-harness.sh` valida caminho
  feliz com `.env`, storages e backups temporarios.
- orquestrador `scripts/deploy/standby-readiness.sh` criado para combinar gate
  de Docker, doctor, readiness de estado, check DR, gates obrigatorios de
  API/gateway e restores isolados opcionais antes de promocao manual de
  standby;
- harness `tools/deploy/standby-readiness-harness.sh` valida caminho feliz,
  caminho sem restore isolado e falha de check obrigatorio.
- scripts `scripts/deploy/pre-failover-check.sh` e
  `scripts/deploy/post-failover-check.sh` criados para failover manual
  active/passive sem alterar roteamento automaticamente;
- harness `tools/deploy/manual-failover-harness.sh` valida caminho feliz,
  bloqueio pre-failover e bloqueio post-failover por endpoint indisponivel.

Escopo inicial:

- validar `DATABASE_URL`, `REDIS_URL`, `SESSION_AUDIT_STORAGE_DIR`,
  `USER_AVATAR_STORAGE_DIR`, `BACKUP_DIR`, `JWT_SECRET` e
  `PEM_ENCRYPTION_KEY`;
- testar escrita/leitura nos diretorios stateful;
- verificar backup recente de MySQL, auditoria SSH e avatares quando existir
  rotina de backup de avatares;
- consultar `/health/ready`, `/health/deep` e observabilidade;
- exigir HTTP 200 em API/gateway ready/deep no standby readiness;
- emitir relatorio texto e JSON para anexar em runbooks;
- executar `standby-readiness.sh` antes de promover trafego para uma VM
  secundaria ou warm standby;
- executar `pre-failover-check.sh`, trocar trafego manualmente e executar
  `post-failover-check.sh` no destino promovido.

Fora do escopo inicial:

- failover automatico;
- alteracao de balanceador;
- migracao para Redis Sentinel ou MySQL HA;
- retomada automatica de sessoes SSH apos queda de gateway.

## Requisito alvo - failover completo e operacao assistida

Esta secao registra o estado alvo. Ela nao declara que o failover completo ja
esta implementado. O cenario validado atualmente continua sendo active/passive
com replicacao e promocao controlada por scripts.

### Unidade de failover

O failover deve promover o no como uma unidade operacional completa, incluindo:

- MySQL gravavel;
- Redis primario;
- storages de auditoria, avatares e demais arquivos stateful;
- frontend/Nginx;
- API/backend;
- SSH Gateway;
- guacd e protocolos graficos;
- jobs e rotinas agendadas;
- VIP ou outro ponto unico de entrada.

Nao basta mover o VIP. A promocao somente pode concluir quando o destino estiver
apto a servir todos os componentes obrigatorios e existir exatamente um MySQL
gravavel, um Redis primario e um dono do VIP.

Sessoes SSH, RDP ou WebSocket ja estabelecidas no no que falhou podem ser
interrompidas. O objetivo inicial e restaurar novos acessos e registrar de forma
clara quais sessoes foram afetadas; migracao transparente de conexoes vivas nao
faz parte do primeiro corte.

### Coordenacao, quorum e fencing

Dois nos isolados nao conseguem distinguir com seguranca uma queda real de uma
particao de rede. Portanto, failover de estado totalmente automatico nao deve
ser habilitado apenas com A e B sem uma evidencia externa de fencing ou quorum.
Isso evita split-brain e escrita simultanea em bancos divergentes.

O modo automatico completo exige um terceiro elemento leve, que nao precisa ser
um terceiro NodeAccess:

- witness/control plane independente; ou
- integracao de fencing com hypervisor, cloud ou equipamento de energia; ou
- servicos externos gerenciados para banco, Redis e storage.

Sem esse elemento, o produto deve manter a promocao assistida, exigir confirmacao
de isolamento do antigo primario e explicar o bloqueio na interface.

### Fluxo transacional de promocao

A orquestracao deve usar uma maquina de estados persistente, idempotente e
retomavel:

1. detectar ou receber a solicitacao de falha;
2. bloquear novas alteracoes concorrentes na topologia;
3. confirmar fencing do primario anterior;
4. validar heartbeat, lag, GTID, replica Redis, arquivos, segredos e release;
5. promover MySQL;
6. promover Redis;
7. interromper/inverter a replicacao de arquivos;
8. ativar frontend, API, SSH Gateway, guacd e jobs no destino;
9. atribuir VIP ou atualizar o ponto de entrada;
10. executar smoke, deep health e testes de escrita;
11. registrar resultado e liberar a operacao;
12. posteriormente reconstruir o no antigo como replica.

Cada etapa deve publicar inicio, fim, timeout, erro, evidencia e proxima acao.
Reexecucao nao pode duplicar efeitos nem executar comandos arbitrarios.

### Rollback e recuperacao progressiva

A promocao deve seguir o padrao `prepare`, `commit` e `compensate`, mas rollback
nao e seguro em todos os pontos:

- antes de fencing e promocao do estado: rollback automatico e seguro;
- depois de promover banco/Redis, mas antes de liberar trafego: compensacao
  somente se for comprovado que nao houve escrita;
- depois de liberar VIP ou aceitar escrita: nao retornar automaticamente ao
  primario antigo. Manter o novo primario, concluir por recuperacao progressiva
  e reconstruir o antigo como replica.

Assim, a interface deve diferenciar `rollback seguro`, `recuperacao progressiva`
e `intervencao manual`. Uma falha no modulo HA nunca deve derrubar nem modificar
uma instalacao single-node que nao habilitou HA.

### Isolamento, SOLID e contratos

HA deve ser um modulo opcional, sem entrar no caminho critico de autenticacao,
sessao ou SSH da instalacao unica. O instalador single-node, o compose padrao e
os scripts atuais continuam funcionando sem agente, witness ou configuracao HA.

Separacao recomendada:

- dominio `ha-orchestration`: regras e maquina de estados;
- `TopologyRepository`: topologia, papeis e versoes;
- `HealthProvider`: saude e prontidao dos componentes;
- `NodeExecutor`: execucao allowlisted no no;
- `FencingProvider`: confirmacao de isolamento/quorum;
- `OperationJournal`: checkpoints, evidencias e auditoria;
- adaptadores para scripts, agente local, witness e infraestrutura do cliente.

Os scripts permanecem utilizaveis diretamente por CLI e passam a oferecer saida
JSON versionada. Um `nodeaccess-ha-agent`, instalado apenas no perfil HA, deve
executar somente operacoes catalogadas, com autenticacao mutua, menor privilegio,
timeouts e auditoria. A API nao deve aceitar shell arbitrario nem guardar senha
SSH de root para operar os nos.

O journal da operacao nao pode depender exclusivamente do MySQL que esta sendo
promovido. Ele deve sobreviver a reinicio da API e permitir consulta/retomada por
um agente ou control plane independente.

### Experiencia e observabilidade HA

Quando HA estiver habilitado, criar a area administrativa
`Administracao > Alta disponibilidade`. Em single-node, manter a experiencia
atual e apresentar no maximo a opcao explicita de configurar HA.

A tela deve mostrar:

- estado geral: `single-node`, `HA saudavel`, `degradado`,
  `failover em andamento`, `risco de split-brain` ou `intervencao necessaria`;
- no ativo e standby, papeis esperados e observados, dono do VIP, release e
  idade do ultimo heartbeat;
- frontend, API, SSH Gateway, guacd e jobs por no;
- MySQL: source/replica, IO/SQL, lag, GTID e modo read-only;
- Redis: papel, link de replicacao e diferenca de offset;
- arquivos: ultima sincronizacao, duracao, idade e RPO estimado;
- igualdade por fingerprint, sem revelar JWT, PEM encryption key ou secrets;
- backups, capacidade de restore e espaco em disco;
- indicador unico `Pronto para failover: sim/nao`, com bloqueadores;
- linha do tempo de configuracoes, testes, promocoes, rollbacks e failbacks.

Durante uma operacao, exibir a etapa atual, progresso, no afetado, tempo,
evidencia, camada do erro, script/acao que falhou e proximo passo seguro. As
camadas minimas de erro sao comunicacao, host, Docker, release, segredos, MySQL,
Redis, arquivos, VRRP/VIP, aplicacao e fencing/control plane.

A acao de promocao e critica: requer permissao administrativa especifica,
preflight aprovado, confirmacao do no de destino e evidencia de fencing. Status
nao pode depender somente de cor; deve usar texto, icone, timestamps e foco
visivel, com funcionamento por teclado e em telas menores.

### Criterios adicionais de aceite

- instalacao e atualizacao single-node continuam sem passos ou dependencias HA;
- HA e habilitado por perfil/feature flag e pode ser desativado sem afetar o
  funcionamento single-node;
- teste de perda total valida banco, Redis, arquivos, frontend, API, gateway,
  guacd, jobs e VIP;
- nunca existem dois bancos gravaveis, dois Redis primarios ou dois donos do
  VIP na mesma topologia;
- operacao interrompida pode ser consultada e retomada apos reinicio da API;
- cada etapa e idempotente e possui compensacao ou recuperacao documentada;
- a UI mostra dados atuais, idade da medicao e bloqueadores sem expor segredos;
- failover automatico completo permanece bloqueado sem witness/fencing valido;
- failback sempre ressincroniza e valida o no antigo antes de devolver trafego.

### Evolucao recomendada

1. Padronizar contratos JSON e codigos de erro dos scripts existentes.
2. Entregar inventario, preflight e observabilidade HA somente leitura.
3. Adicionar agente allowlisted e configuracao assistida de replica.
4. Orquestrar promocao manual/assistida com journal e recuperacao.
5. Habilitar failover automatico completo apenas com witness/fencing.
6. Automatizar reintegracao do no recuperado e failback controlado.
7. Manter testes web E2E do painel HA com Playwright e diagnostico complementar
   via Chromium/CDP.

O primeiro item foi iniciado depois da validacao da `2.0.10`. Os gates
`ha-state-replication-status.sh` e `ha-file-replica-status.sh` aceitam
`OUTPUT_FORMAT=json` e retornam o contrato versionado
`nodeaccess-ha-status-v1`, com componente, status, instante observado, detalhes
e codigo de erro. O formato texto permanece padrao para compatibilidade com os
runbooks e scripts de promocao existentes. O agente HA consome o contrato do
MySQL e inclui `lagSeconds` no heartbeat quando o gate retorna uma medicao
valida.

O sexto item passou a exigir paridade bidirecional de GTID antes de
`readyForFailback=true`. O check compara transacoes ausentes no no recuperado e
GTIDs errantes em relacao ao no ativo. Saude da replica e lag zero sem
`ACTIVE_NODE_IP` continuam uteis para diagnostico, mas nao aprovam failback.
O harness MySQL isolado valida registros criados em A, promocao de B, novas
gravacoes em B, retorno de A como replica, igualdade de linhas e paridade GTID.
GTIDs historicos extras somente podem ser reconciliados como transacoes vazias
quando fingerprints determinísticos de schema e dados forem identicos. O fluxo
deve exigir duas confirmacoes independentes, recusar intervalos parciais e
persistir relatorio fora do MySQL. Se os fingerprints divergirem, o failback
continua bloqueado e exige reconciliacao de dados ou re-seed.

## Primeiro corte de implementacao da gestao HA

Regras incorporadas ao primeiro corte:

- `ha` e um entitlement comercial separado em `featureEntitlementsJson`;
- somente SuperAdmin (`isPlatformAdmin`) acessa endpoints e tela HA;
- somente SuperAdmin pode habilitar ou desabilitar o entitlement HA pela tela;
- desabilitar HA e bloqueado enquanto houver nos anexados;
- admin de tenant pode consultar a licenca, mas nao habilita, remove ou altera o
  entitlement HA pelo editor comum;
- um novo no e anexado por matricula com token aleatorio, armazenado somente
  como hash e inicialmente valido por 15 minutos;
- o instalador do agente pode ser obtido por `curl`, exige HTTPS por padrao e
  permite HTTP apenas com opt-in explicito para POC isolada;
- o agente HA possui finalidade exclusiva de health/replicacao, nao aceita
  shell arbitrario e envia relatorio estruturado a cada 30 segundos;
- heartbeat atrasado, componente critico ausente/degradado ou papel diferente
  de standby bloqueia `promotionReady`;
- a tela destaca ao SuperAdmin qualquer no nao promovivel e lista os
  bloqueadores por componente.

Este corte ainda nao executa promocao. Ele estabelece licenciamento, matricula,
identidade do agente, observabilidade e o gate seguro que a futura maquina de
estados de promocao consumira.

### Segundo corte - journal e preflight assistido

- tabela `ha_operations` registra operacao, no, autor, etapas, resultado,
  camada do erro e timestamps;
- o SuperAdmin pode executar um preflight somente leitura em cada standby;
- o preflight cria um snapshot auditavel do heartbeat, papel e componentes;
- fencing aparece como gate obrigatorio pendente, mas nao e executado;
- a tela apresenta os ultimos 50 resultados e diferencia `Pronto` de
  `Bloqueado`;
- nenhuma acao deste corte promove banco, Redis, arquivos ou VIP;
- o journal central atende diagnostico e historico de preflight. Antes da
  promocao real, checkpoints de execucao tambem devem ser espelhados no agente
  para sobreviver a indisponibilidade do MySQL primario.

### Terceiro corte - evidencia externa de fencing

- witness externo possui uma chave privada RSA que nunca e instalada nos nos
  NodeAccess;
- standby armazena somente a chave publica;
- evidencia assinada identifica primario, standby, instante de emissao,
  expiracao e nonce;
- validade maxima e de 15 minutos, com recomendacao operacional de 5 minutos;
- evidencia adulterada, expirada ou emitida para outra topologia bloqueia a
  promocao antes de qualquer alteracao de estado;
- emissao assistida exige confirmacao explicita de que o primario ja foi
  isolado por hypervisor, cloud, energia ou procedimento externo equivalente;
- instalacao single-node nao gera chaves, nao instala witness e nao passa por
  esse gate.

Este corte estabelece o contrato do `FencingProvider` para promocao por CLI.
Automacao do mecanismo externo continua obrigatoria antes de habilitar failover
automatico.

### Quarto corte - plano, journal persistente e nonce de uso unico

- `plan-ha-promotion.sh` avalia witness, MySQL, Redis, arquivos e ausencia da
  VIP no destino sem executar mutacoes;
- cada plano possui `OPERATION_ID` e grava relatorio persistente fora do MySQL;
- a promocao grava checkpoints JSONL em
  `/opt/nodeaccess/shared/ha/operations`;
- a evidencia de witness somente e consumida no inicio da promocao efetiva;
- o nonce consumido e registrado atomicamente e uma segunda tentativa e
  recusada;
- o harness cobre plano aprovado, gate degradado e replay de nonce;
- a promocao continua assistida e exige `CONFIRM_PROMOTION=true`.

### Quinto corte - validacao web automatizada

- Playwright deve ser a ferramenta principal para fluxos E2E repetiveis;
- Chromium/CDP pode complementar a suite com captura de console, requests,
  respostas, WebSocket, performance e diagnostico de renderizacao;
- o teste deve autenticar como SuperAdmin, abrir
  `Plataforma > Alta disponibilidade` e validar loading, erro, vazio, saudavel,
  degradado e sem permissao;
- os valores exibidos para heartbeat, papel, status, `promotionReady`,
  bloqueadores, componentes e `lagSeconds` devem ser comparados com as respostas
  reais da API, sem depender apenas de texto ou cor;
- o fluxo deve cobrir habilitacao do entitlement, matricula de no, atualizacao
  do heartbeat, preflight e historico do journal;
- um admin comum deve continuar recebendo HTTP 403 nas operacoes exclusivas de
  plataforma;
- screenshots, trace, console e respostas relevantes devem ser preservados
  quando houver falha;
- a suite smoke padrao deve ser somente leitura e nunca promover estado, parar
  containers, alterar VIP ou emitir evidencia de fencing;
- cenarios de falha controlada devem exigir opt-in explicito, executar somente
  no laboratorio HA, restaurar o componente afetado e validar o retorno a
  `HEALTHY`;
- validar desktop e uma largura reduzida, navegacao por teclado, foco visivel e
  comunicacao de status sem depender somente de cor.

Gate de aceite:

- frontend e API concordam sobre os dados apresentados;
- nenhuma falha silenciosa no console ou request inesperadamente 5xx;
- estados operacionais principais possuem assercoes deterministicas;
- artefatos permitem diagnosticar rapidamente a camada da falha;
- testes destrutivos permanecem separados, identificados e bloqueados por
  variavel de ambiente.
