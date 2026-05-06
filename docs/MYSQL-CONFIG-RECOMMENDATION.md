# Recomendacao de configuracao MySQL para NodeAccess

Data: 2026-04-20

## Objetivo

Definir uma base segura e pragmatica de configuracao do MySQL 8.0 para o NodeAccess, considerando:

- ate 300 sessoes SSH simultaneas;
- auditoria de sessao habilitada;
- API e gateway acessando o mesmo banco;
- Redis para cache curto;
- possibilidade de rodar tudo em uma maquina ou separar MySQL em host dedicado.

Este documento filtra a configuracao recebida e separa o que faz sentido manter, ajustar ou evitar.

Perfil escolhido para a proxima etapa: **Perfil A: MySQL na mesma maquina da API/gateway**.

Arquivo aplicado no repositorio:

```text
docker/mysql/conf.d/nodeaccess.cnf
```

## Principio de tuning

Para o NodeAccess, o MySQL deve priorizar:

- consistencia de dados;
- previsibilidade;
- diagnostico de queries lentas;
- bom uso de memoria;
- limite realista de conexoes;
- configuracao compativel com container;
- seguranca por padrao.

Nao vale otimizar agressivamente sacrificando durabilidade, principalmente porque o banco guarda usuarios, hosts, politicas, sessoes, auditorias, licencas e configuracoes operacionais.

## Configuracao sugerida

### Perfil A: MySQL na mesma maquina da API/gateway

Use quando o ambiente roda tudo junto: API, gateway, MySQL e Redis.

Assumindo host com 8 vCPU e 24 a 32 GB RAM.

```cnf
[mysqld]
#####################################
## NodeAccess - MySQL 8.0 baseline ##
#####################################

# Geral
transaction-isolation = READ-COMMITTED
sql_mode = ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION
default_time_zone = '+00:00'
character-set-server = utf8mb4
collation-server = utf8mb4_0900_ai_ci

# Segurança / operação
local_infile = 0
skip_name_resolve = 1

# Logs
log-error = /var/log/mysql/error.log
slow_query_log = 1
slow_query_log_file = /var/log/mysql/mysql-slow.log
log_slow_admin_statements = 1
long_query_time = 2

# Binlog
binlog_expire_logs_seconds = 604800

# Conexões
max_connections = 500
max_connect_errors = 1000
connect_timeout = 10
wait_timeout = 300
interactive_timeout = 600
max_allowed_packet = 128M

# InnoDB
innodb_file_per_table = 1
innodb_buffer_pool_size = 8G
innodb_buffer_pool_instances = 4
innodb_flush_log_at_trx_commit = 1
innodb_doublewrite = 1
innodb_log_file_size = 512M
innodb_log_buffer_size = 64M

# Tabelas / cache
table_open_cache = 2000
table_definition_cache = 1000
table_open_cache_instances = 8

# I/O
innodb_io_capacity = 1000
innodb_io_capacity_max = 3000
innodb_read_io_threads = 4
innodb_write_io_threads = 4
innodb_thread_concurrency = 0
```

### Perfil B: MySQL dedicado

Use quando MySQL roda em maquina separada, com NVMe e sem competir com API/gateway.

Assumindo host dedicado com 4 a 8 vCPU e 16 a 32 GB RAM.

```cnf
[mysqld]
########################################
## NodeAccess - MySQL dedicado 8.0    ##
########################################

# Geral
transaction-isolation = READ-COMMITTED
sql_mode = ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION
default_time_zone = '+00:00'
character-set-server = utf8mb4
collation-server = utf8mb4_0900_ai_ci

# Segurança / operação
local_infile = 0
skip_name_resolve = 1

# Logs
log-error = /var/log/mysql/error.log
slow_query_log = 1
slow_query_log_file = /var/log/mysql/mysql-slow.log
log_slow_admin_statements = 1
long_query_time = 2

# Binlog
binlog_expire_logs_seconds = 604800

# Conexões
max_connections = 800
max_connect_errors = 1000
connect_timeout = 10
wait_timeout = 300
interactive_timeout = 600
max_allowed_packet = 128M

# InnoDB
innodb_file_per_table = 1
innodb_buffer_pool_size = 12G
innodb_buffer_pool_instances = 6
innodb_flush_log_at_trx_commit = 1
innodb_doublewrite = 1
innodb_log_file_size = 1G
innodb_log_buffer_size = 128M

# Tabelas / cache
table_open_cache = 3000
table_definition_cache = 1500
table_open_cache_instances = 8

# I/O
innodb_io_capacity = 2000
innodb_io_capacity_max = 5000
innodb_read_io_threads = 4
innodb_write_io_threads = 4
innodb_thread_concurrency = 0
```

## Avaliacao da configuracao original

### Manter ou aceitar com ajuste

| Opcao | Decisao | Motivo |
|---|---|---|
| `transaction-isolation = READ-COMMITTED` | Manter | Reduz lock/gap lock em cenarios concorrentes. Bom para app web, desde que regras de negocio nao dependam de snapshot repeatable-read. |
| `sql_mode = ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION` | Manter | Modo estrito ajuda a evitar dados inconsistentes e queries ambiguas. |
| `slow_query_log = 1` | Manter | Essencial para fase 2 dos testes. |
| `log_slow_admin_statements = 1` | Manter | Ajuda a diagnosticar manutencao/migrations lentas. |
| `long_query_time = 5` | Ajustar para `2` | Para tuning inicial, 5s e alto. Com 2s capturamos problemas antes. Em investigacao fina, pode baixar para 1s temporariamente. |
| `binlog_expire_logs_seconds=172800` | Ajustar para `604800` | 2 dias pode ser curto para recuperacao operacional. 7 dias e um baseline melhor, dependendo de backup/replica. |
| `max_connect_errors = 4000` | Ajustar para `1000` | 4000 e permissivo demais. Melhor manter margem sem mascarar problema de rede/app. |
| `interactive_timeout = 600` | Manter, mas adicionar `wait_timeout=300` | A aplicacao usa conexoes nao interativas. `wait_timeout` e mais relevante para pool. |
| `innodb_file_per_table = 1` | Manter | Padrao bom para operacao e manutencao. |
| `innodb_flush_log_at_trx_commit = 1` | Manter | Mais seguro para dados. Pode virar `2` apenas se aceitarmos perder ate 1s em crash. |
| `table_open_cache = 2500` | Aceitar | Valor razoavel. Ajustar conforme `Opened_tables`. |
| `table_definition_cache = 1000` | Aceitar | Valor razoavel para schema atual. |
| `table_open_cache_instances = 8` | Manter | Ajuda concorrencia. |
| `innodb_thread_concurrency = 0` | Manter | Deixa InnoDB gerenciar concorrencia. |
| `innodb_read_io_threads = 4` | Manter | Bom baseline. |
| `innodb_write_io_threads = 4` | Manter | Bom baseline. |

### Ajustar com cuidado

| Opcao original | Problema | Recomendacao |
|---|---|---|
| `max_allowed_packet = 1G` | Muito alto. Aumenta risco de consumo excessivo de memoria por conexao e mascara payloads grandes demais. | Usar `64M` ou `128M`. Para NodeAccess, `128M` e suficiente como baseline. |
| `max_connections = 3000` | Muito alto para MySQL sem pool/proxy. Pode consumir memoria e esconder vazamento de conexoes. | Usar `300` a `500` single-node; `800` dedicado. Controlar pool Prisma/API/gateway. |
| `innodb_buffer_pool_size = 4G` | Pode ser pouco ou muito, depende da RAM e se MySQL e dedicado. | Single-node 32 GB: `8G`; dedicado 16 GB: `8G` a `12G`; dedicado 32 GB: `20G` a `24G`. |
| `innodb_buffer_pool_instances = 4` | Bom para 4G/8G, mas deve acompanhar buffer pool. | 4 para `8G`; 6 a 8 para `12G+`. |
| `innodb_io_capacity = 3000` | Pode ser alto se o storage nao for NVMe real. | Single-node: `1000`; dedicado NVMe: `2000`; subir apos medir I/O. |
| `innodb_io_capacity_max = 5000` | Pode ser alto em disco compartilhado. | Single-node: `3000`; dedicado NVMe: `5000`. |
| `net_buffer_length = 999424` | Valor incomum e geralmente desnecessario. | Remover e manter default, salvo evidencia especifica. |

### Evitar por seguranca ou durabilidade

| Opcao | Decisao | Motivo |
|---|---|---|
| `local_infile=1` | Evitar | Habilita `LOAD DATA LOCAL INFILE`; aumenta superficie de ataque. Usar `0`, habilitar temporariamente so em importacao controlada. |
| `innodb_doublewrite = 0` | Evitar | Risco de corrupcao em crash/power loss. Para producao, manter `1`. |
| `log_bin_trust_function_creators = 1` | Evitar por padrao | So necessario se houver functions/triggers com binlog e restricoes. O NodeAccess/Prisma nao precisa disso como baseline. |
| `datadir`, `socket`, `pid-file`, `innodb_data_home_dir` | Nao versionar no app | Em container oficial `mysql:8.0`, prefira defaults da imagem e volumes. Ajustar apenas no host final se necessario. |

## Conexoes e Prisma

O valor de `max_connections` no MySQL deve ser definido junto com o pool da aplicacao.

Para 300 sessoes, nao significa que precisamos de 3000 conexoes MySQL. Sessao SSH aberta nao deveria manter uma conexao dedicada no banco o tempo todo.

Recomendacao inicial:

- API: pool entre 20 e 50 conexoes;
- gateway: pool entre 20 e 50 conexoes;
- margem para jobs, migrations e administracao;
- MySQL single-node: `max_connections=500`;
- MySQL dedicado: `max_connections=800`.

Se necessario, configurar o `DATABASE_URL` com parametro de pool do Prisma, por exemplo:

```env
DATABASE_URL="mysql://user:pass@mysql:3306/sshplatform?connection_limit=30&pool_timeout=10"
```

Valores exatos devem ser validados em teste com API e gateway separados.

## Observabilidade minima

Durante fase 2, coletar:

- `Threads_connected`;
- `Threads_running`;
- `Max_used_connections`;
- `Aborted_connects`;
- `Slow_queries`;
- `Innodb_buffer_pool_reads`;
- `Innodb_buffer_pool_read_requests`;
- `Innodb_row_lock_time`;
- `Innodb_row_lock_waits`;
- `Created_tmp_disk_tables`;
- `Opened_tables`;
- uso de disco do datadir;
- crescimento de binlog;
- tamanho das tabelas de auditoria.

Comandos uteis:

```sql
SHOW GLOBAL STATUS LIKE 'Threads_connected';
SHOW GLOBAL STATUS LIKE 'Threads_running';
SHOW GLOBAL STATUS LIKE 'Max_used_connections';
SHOW GLOBAL STATUS LIKE 'Slow_queries';
SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_reads';
SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_read_requests';
SHOW GLOBAL STATUS LIKE 'Innodb_row_lock%';
SHOW GLOBAL VARIABLES LIKE 'max_connections';
SHOW GLOBAL VARIABLES LIKE 'innodb_buffer_pool_size';
```

## Como aplicar em Docker

Criar um arquivo, por exemplo:

```text
docker/mysql/conf.d/nodeaccess.cnf
```

Montar no servico MySQL:

```yaml
services:
  mysql:
    image: mysql:8.0
    volumes:
      - mysql_data:/var/lib/mysql
      - ./docker/mysql/conf.d:/etc/mysql/conf.d:ro
```

Depois de subir, validar:

```bash
docker compose exec mysql mysql -uroot -p -e "SHOW VARIABLES LIKE 'transaction_isolation';"
docker compose exec mysql mysql -uroot -p -e "SHOW VARIABLES LIKE 'max_connections';"
docker compose exec mysql mysql -uroot -p -e "SHOW VARIABLES LIKE 'innodb_buffer_pool_size';"
```

## Recomendacao final

Para a proxima fase do NodeAccess, usar como baseline:

- `transaction-isolation=READ-COMMITTED`;
- `sql_mode` estrito;
- `slow_query_log=1`;
- `long_query_time=2`;
- `max_connections=500` em single-node ou `800` em MySQL dedicado;
- `max_allowed_packet=128M`;
- `innodb_doublewrite=1`;
- `innodb_flush_log_at_trx_commit=1`;
- `innodb_buffer_pool_size` dimensionado pela RAM;
- `local_infile=0`;
- `wait_timeout=300`;
- `skip_name_resolve=1`.

Nao aplicar:

- `max_connections=3000` sem prova de necessidade;
- `max_allowed_packet=1G`;
- `innodb_doublewrite=0`;
- `local_infile=1`;
- `log_bin_trust_function_creators=1` sem necessidade real.

## Proximo passo sugerido

1. Escolher perfil A ou B conforme a topologia do ambiente.
2. Criar `docker/mysql/conf.d/nodeaccess.cnf` com o perfil escolhido.
3. Subir MySQL e validar `SHOW VARIABLES`.
4. Rodar fase 2 de carga com 300 sessoes por 15 minutos.
5. Coletar status MySQL antes/depois do teste.
6. Ajustar `max_connections`, buffer pool e I/O com base em dados reais.
