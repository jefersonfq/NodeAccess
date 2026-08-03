# PRD Load Testing Lite

## Objetivo
Definir uma frente de testes de carga e desempenho para o NodeAccess, com foco em medir limites reais da plataforma, identificar gargalos e orientar tuning sem quebrar comportamento funcional.

## Problema
Hoje o produto evoluiu em varias frentes, mas ainda falta uma estrategia clara de carga para responder perguntas como:
- quantos usuarios simultaneos a plataforma suporta com conforto
- como API, gateway SSH e banco se comportam sob uso real
- quais fluxos degradam primeiro
- qual a diferenca entre uso normal, pico e stress

Sem isso, existe risco de:
- otimizar pontos irrelevantes
- descobrir gargalos apenas em ambiente real
- misturar tuning com percepcao subjetiva
- degradar terminal, dashboard e auditoria sem aviso

## Principios
- testes de carga nao devem exigir acoplamento novo no produto
- preferir cenarios proximos do uso real antes de stress artificial
- separar API e gateway nos testes, porque o produto ja opera assim
- medir antes de otimizar
- toda carga deve ser reproduzivel
- resultados devem virar backlog tecnico claro

## Objetivos especificos
1. medir capacidade operacional basica da plataforma
2. identificar gargalos por camada: frontend, API, gateway, banco e Redis
3. validar estabilidade de sessoes SSH e websocket sob concorrencia
4. validar impacto de features acessorias como dashboard, auditoria, snippets e acessos locais
5. criar base objetiva para tuning e para discussao interna de capacidade

## Escopo
### Em escopo
- login, refresh e MFA
- listagem de hosts e dashboards
- abertura de terminal e manutencao de sessoes websocket
- uso simultaneo de terminal, snippets, acessos locais e sessao ao vivo
- impacto de auditoria e logs
- carga em API separada de carga em gateway SSH

### Fora de escopo inicial
- benchmark synthetic-only de frontend no browser
- chaos engineering completo
- failover multi-regiao
- tuning profundo de infra antes da primeira rodada de medicao

## Camadas a medir
### API
- latencia media e p95/p99 por endpoint principal
- throughput
- taxa de erro
- comportamento de auth/refresh

### Gateway SSH
- quantidade de conexoes websocket simultaneas
- tempo medio de conexao SSH
- latencia de input/output
- estabilidade de sessoes longas

### Banco e Redis
- queries quentes
- locks e saturacao
- uso de CPU/memoria
- filas, TTLs e comportamento de sessao

### Frontend
- tempo de abertura de telas principais
- comportamento sob polling e websockets ativos
- erros de sessao, chunk e stale state sob carga

Para testes de pagina com navegador real, tempos de API, payloads e renderizacao, usar o procedimento operacional em `docs/OPERATIONS-page-performance-testing-lite.md`.
Para estabilidade percebida do usuario no terminal web, usar tambem `docs/OPERATIONS-terminal-browser-stability-lite.md`.

## Perfis de carga recomendados
### 1. Baseline
- poucos usuarios
- medir tempo normal de resposta
- criar referencia limpa por endpoint e fluxo

### 2. Carga operacional
- volume proximo do uso esperado
- foco em estabilidade e p95
- medir comportamento sustentado por 15 a 30 minutos

### 3. Pico
- subida mais rapida de usuarios
- medir degradacao controlada
- identificar primeiro gargalo

### 4. Stress
- acima da capacidade alvo
- objetivo nao e aprovar, e sim descobrir limite e comportamento de falha

## Cenarios recomendados
### Cenario A. Login e navegacao basica
- login
- refresh
- hosts
- dashboard pessoal
- dashboard admin

### Cenario B. Operacao de hosts
- listar hosts
- abrir detalhes
- editar host
- historico de host key

### Cenario C. Terminal SSH
- abrir sessao
- manter websocket
- enviar comandos curtos
- validar pings e reconexao

### Cenario D. Sessao compartilhada
- owner abre sessao
- viewers entram
- solicitacao e concessao de controle
- retomada do owner

### Cenario E. Produtividade
- execucao de snippets
- abertura de acessos locais
- abertura de acesso web

### Cenario F. Auditoria e admin
- leitura de logs
- leitura de auditoria de sessao
- dashboard de adocao e operacional

## Metricas minimas
### Aplicacao
- req/s
- erro %
- p50/p95/p99
- tempo medio de login
- tempo medio de abertura de terminal
- tempo medio de abertura de dashboard

### Gateway
- conexoes websocket ativas
- sessoes SSH ativas
- latencia media de roundtrip
- falhas de handshake

### Infra
- CPU
- memoria
- conexoes MySQL
- latencia Redis
- tamanho de logs e impacto de auditoria

## Ferramentas sugeridas
### Fase inicial
- `k6` para API e fluxos HTTP
- script dedicado para websocket/SSH simulado
- dashboards simples em Prometheus/Grafana ou logs estruturados

### Observacao
- se websocket puro ficar dificil no `k6`, manter API no `k6` e usar worker/script separado para gateway
- evitar acoplar o produto a uma ferramenta especifica
- para terminal web, separar carga alta de gateway headless da carga visual em browser; a carga visual deve usar Playwright em concorrencias menores por maquina

## Estrategia recomendada
### 1. Medicao separada por camada
- API primeiro
- gateway depois
- cenario combinado por ultimo

### 2. Ambientes
- ambiente controlado de homologacao
- massa de dados realista
- Redis e MySQL configurados de forma proxima ao real

### 3. Dados de teste
- usuarios reais de teste
- grupos, hosts e tags suficientes
- ao menos alguns hosts com bastion
- sessoes compartilhadas e logs suficientes para cenarios admin

## Entregaveis esperados
### Fase 1
- roteiro de carga
- cenarios priorizados
- scripts base
- metricas-alvo

### Fase 2
- primeira rodada de testes
- relatorio curto com gargalos
- backlog tecnico de tuning

### Fase 3
- rodada de regressao apos tuning
- capacidade recomendada por perfil de uso

## Criticos de sucesso
- conseguir reproduzir carga sem alterar fluxo funcional do produto
- identificar gargalos por camada
- gerar backlog tecnico objetivo
- reduzir incerteza sobre capacidade e degradacao

## Sugestoes praticas de inicio
1. medir primeiro `login`, `hosts`, `dashboard`, `terminal open`
2. separar claramente `API load` de `gateway load`
3. incluir um teste sustentado de websocket por 15 minutos
4. medir impacto de auditoria ligada vs desligada
5. usar os resultados para alimentar `PRD-platform-tuning-lite.md`

## Proximos passos recomendados
1. escolher ferramenta e formato dos scripts
2. definir capacidade-alvo inicial
3. montar massa de dados realista
4. rodar baseline
5. abrir backlog de tuning por evidência

## Implementacao inicial no repositorio
- scripts e roteiro: `tools/load-tests/`
- API baseline: `tools/load-tests/k6/baseline-api.js`
- gateway SSH/WebSocket baseline: `tools/load-tests/ws/baseline-gateway.js`
- massa exemplo: `tools/load-tests/data/profile.example.json`
- modelo operacional de massa: `tools/load-tests/data/profile.model.json`
- runbook de execucao: `tools/load-tests/RUNBOOK.md`

### Uso recomendado
1. copiar `profile.example.json` para um arquivo local nao versionado
2. preencher tokens e hosts de homologacao que cada usuario pode acessar
3. rodar primeiro API com poucos VUs
4. rodar gateway com poucas sessoes
5. subir concorrencia em ondas: 10, 25, 50, 100
6. comparar rodadas com auditoria SSH ligada e desligada

## Detalhe tecnico relacionado
- proposta tecnica em `docs/PRD-load-testing-tech-proposal.md`
- estabilidade visual do terminal em `docs/OPERATIONS-terminal-browser-stability-lite.md`
