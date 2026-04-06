# PRD Load Testing Tech Proposal

## Objetivo
Traduzir o `PRD-load-testing-lite.md` em um plano tecnico executavel, incremental e de baixo risco para medir capacidade, gargalos e degradacao do NodeAccess.

Base relacionada:
- [docs/PRD-load-testing-lite.md](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/docs/PRD-load-testing-lite.md)
- [docs/PRD-platform-tuning-lite.md](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/docs/PRD-platform-tuning-lite.md)

## Premissas
- nao acoplar scripts de carga ao produto
- separar medicao de `API` e `gateway SSH`
- preservar ambientes de desenvolvimento do time
- comecar por cenarios simples e reproduziveis
- preferir coleta de metrica externa ao produto, com telemetria minima interna

## Arquitetura atual relevante
### API
- backend Fastify exposto em [server.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/backend/src/server.ts)
- rotas quentes em:
  - [auth](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/backend/src/modules/auth)
  - [hosts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/backend/src/modules/hosts)
  - [dashboard](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/backend/src/modules/dashboard)
  - [user-dashboard](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/backend/src/modules/user-dashboard)

### Gateway
- fluxo principal em [ssh.gateway.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/backend/src/modules/ssh/ssh.gateway.ts)
- compartilhamento em [shared-sessions](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/backend/src/modules/shared-sessions)

### Dados
- MySQL via Prisma
- Redis para sessao/refresh

## Recomendacao de stack de teste
### HTTP/API
- `k6` como ferramenta principal
- cenarios versionados em pasta propria fora do runtime do produto

### WebSocket/Gateway
- worker Node dedicado para:
  - abrir websocket
  - autenticar
  - abrir sessao SSH
  - enviar input controlado
  - medir roundtrip

### Metricas
- primeira fase:
  - logs estruturados
  - resumo do k6
  - medicao de CPU/memoria/conexoes do host
- fase seguinte:
  - Prometheus/Grafana ou equivalente

## Estrutura recomendada
### Pasta
Sugestao:
- `tools/load-tests/`

### Conteudo inicial
- `tools/load-tests/k6/`
- `tools/load-tests/ws/`
- `tools/load-tests/data/`
- `tools/load-tests/README.md`

### Separacao
- `k6/` para API
- `ws/` para gateway
- `data/` para massa de usuarios/hosts/credenciais de teste

## Fases tecnicas
### Fase 1. Baseline API
#### Objetivo
Medir comportamento basico de rotas principais sob concorrencia moderada.

#### Cenarios
- login
- refresh
- `GET /hosts`
- `GET /dashboard/stats`
- `GET /user-dashboard/summary`

#### Entregavel
- script `k6` unico com cenarios por grupo
- p50/p95/p99
- throughput
- erro %

### Fase 2. Baseline Gateway
#### Objetivo
Medir abertura e manutencao de sessoes websocket/SSH.

#### Cenarios
- abrir websocket autenticado
- abrir sessao SSH
- manter sessao ativa por 5 a 15 minutos
- enviar comandos simples:
  - `pwd`
  - `whoami`
  - `uptime`

#### Metricas
- tempo de handshake websocket
- tempo de conexao SSH
- latencia media de ida e volta
- erro de conexao
- encerramento inesperado

### Fase 3. Carga operacional combinada
#### Objetivo
Medir o comportamento do uso mais realista.

#### Mix sugerido
- 60% navegacao HTTP
- 30% sessoes SSH simultaneas
- 10% features acessorias:
  - snippets
  - acessos locais
  - dashboard admin

### Fase 4. Sessao compartilhada
#### Objetivo
Medir impacto da colaboracao em cima do gateway.

#### Cenarios
- owner abre sessao
- viewers entram
- request/grant/revoke de controle
- manter viewer em read-only por varios minutos

#### Observacao
- esta fase deve vir depois do baseline do gateway

## Massa de dados recomendada
### Usuarios
- ao menos:
  - 1 admin
  - 20 usuarios comuns
  - 1 a 3 usuarios focados em sessao compartilhada

### Hosts
- 30 a 100 hosts de teste
- parte com bastion
- parte direta
- variedade de escopos

### Dados de negocio
- grupos
- tags
- snippets
- acessos locais
- eventos administrativos suficientes para dashboards

## Metricas minimas por fase
### API
- req/s
- p50
- p95
- p99
- erro %

### Gateway
- websockets ativos
- sessoes SSH ativas
- tempo ate `connected`
- roundtrip medio
- roundtrip p95

### Infra
- CPU
- memoria
- conexoes MySQL
- uso de Redis
- tamanho de logs

## Hooks de observabilidade recomendados
### Sem acoplamento grande
- logar tempo de resposta por rota no Fastify
- logar tempo de abertura de sessao SSH
- logar total de conexoes websocket ativas

### Sem alterar contrato funcional
- tudo deve ser observabilidade opcional
- habilitacao por env ou log level

## Ambientes recomendados
### Homolog
- preferivel para primeira rodada
- massa de dados proxima do real
- sem usuarios humanos concorrendo

### Local
- serve para smoke de scripts
- nao serve para validar capacidade real

## Backlog tecnico sugerido
### Fase 1
- criar pasta `tools/load-tests`
- criar `README` com como rodar
- criar script `k6` baseline API
- definir dataset minimo

### Fase 2
- criar worker websocket baseline
- medir abertura/manutencao de terminal
- criar relatorio curto de gargalos

### Fase 3
- cenario combinado
- cenario de sessao compartilhada
- regressao apos tuning

## Saidas esperadas
- relatorio por rodada
- tabela simples:
  - cenario
  - usuarios virtuais
  - duracao
  - p95
  - erro %
  - gargalo observado
- backlog de tuning por evidencia

## Riscos e cuidados
- nao usar hosts produtivos
- nao misturar stress com auditoria humana ativa
- cuidado com ruido de logs sob carga
- proteger credenciais e segredos de teste
- manter scripts e massa de dados fora do caminho de build/deploy da app

## Proximo passo recomendado
Implementar primeiro:
1. `tools/load-tests/k6/baseline-api.js`
2. `tools/load-tests/ws/baseline-gateway.ts`
3. `tools/load-tests/README.md`
4. roteiro curto de coleta de metricas por rodada
