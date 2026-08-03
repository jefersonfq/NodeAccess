# NodeAccess Load Tests

Pacote inicial para medir capacidade de API e sessões SSH/WebSocket sem alterar o produto.

## Objetivo

- Medir baseline de API: auth opcional, hosts, dashboards e auditoria.
- Medir capacidade do gateway: conexões WebSocket simultâneas para hosts que o usuário já pode acessar.
- Separar gargalos de API, gateway SSH, banco e Redis antes de misturar cenários.

## Dados de Teste

Copie `tools/load-tests/data/profile.model.json` para um arquivo local, por exemplo:

```bash
cp tools/load-tests/data/profile.model.json tools/load-tests/data/profile.local.json
```

Preencha somente usuários e hosts de teste. Cada usuário deve ter acesso real aos hosts definidos, porque o gateway mantém a validação normal de permissão.

Preferência para testes de terminal:

- use `accessToken` já emitido para evitar acoplar o teste ao MFA;
- escolha hosts de homologação, não produção;
- evite hosts que peçam credenciais interativas, a menos que `sshUsername` e `sshPassword` estejam preenchidos no perfil local;
- mantenha auditoria ligada e desligada em rodadas separadas para comparar impacto.

Para uma rodada local controlada, use o SSH mock e o seed de massa ficticia:

```bash
node tools/load-tests/scripts/mock-ssh-server.js
LOADTEST_USER_COUNT=10 node tools/load-tests/scripts/seed-local-loadtest.js
```

O seed local tambem prepara inventario e ACL de conexao para que os usuarios comuns gerados consigam abrir os hosts pelo gateway atual.

Para habilitar auditoria SSH no tenant de teste:

```bash
node tools/load-tests/scripts/set-loadtest-audit-policy.js
```

O backend também expõe métricas Prometheus em `/metrics` no ambiente de desenvolvimento. Em produção, use `FEATURE_METRICS=true` e proteja com `METRICS_TOKEN`.

## API Baseline

Requer `k6` instalado localmente.

```bash
k6 run -e BASE_URL=http://localhost:3000/api/v1 tools/load-tests/k6/baseline-api.js
```

Variáveis úteis:

- `PROFILE_FILE`: caminho do perfil JSON relativo ao script k6. Padrão: `../data/profile.example.json`.
- `BASE_URL`: base da API. Padrão: `http://localhost:3000/api/v1`.
- `API_VUS`: usuários virtuais. Padrão: `5`.
- `API_DURATION`: duração. Padrão: `2m`.
- `API_INCLUDE_ADMIN`: `1` para chamar endpoints admin com tolerância a `403`. Padrão: `0`.

Exemplo:

```bash
k6 run \
  -e PROFILE_FILE=../data/profile.local.json \
  -e BASE_URL=https://nodeaccess-hml.example.com/api/v1 \
  -e API_VUS=25 \
  -e API_DURATION=15m \
  tools/load-tests/k6/baseline-api.js
```

## Gateway SSH/WebSocket Baseline

Usa Node.js e o pacote `ws` já presente no workspace.

```bash
node tools/load-tests/ws/baseline-gateway.js --profile tools/load-tests/data/profile.local.json
```

Para gerar relatorio com correlacao basica de CPU e memoria:

```bash
WS_BASE_URL=ws://localhost:3001 \
CONCURRENCY=10 \
HOLD_MS=300000 \
node tools/load-tests/scripts/run-gateway-with-metrics.js --profile tools/load-tests/data/profile.local.json
```

## Terminal Web via Playwright

Para simular a visao do usuario com multiplas abas reais, use o harness Playwright. Ele abre contextos isolados, injeta token/host do `profile.local.json`, navega para `/terminal`, foca o xterm, envia comandos e gera screenshots quando falhar.

```bash
FRONTEND_BASE=http://127.0.0.1:5173 \
PROFILE_FILE=tools/load-tests/data/profile.local.json \
CONCURRENCY=5 \
BROWSER=chromium \
HOLD_MS=15000 \
COMMAND_INTERVAL_MS=5000 \
node tools/frontend/terminal-playwright-load.cjs
```

Use `BROWSER=firefox` para comparar comportamento fora do Chromium. O relatorio inclui CPU/memoria/disco da maquina, processos relevantes e `docker stats` dos containers filtrados por `CONTAINER_NAME_PATTERN` ou `CONTAINER_NAMES`.

Variaveis uteis:

- `PLAYWRIGHT_EXECUTABLE_PATH`: usa um navegador ja instalado no sistema, por exemplo `/usr/bin/chromium-browser`.
- `HEADLESS=0`: abre o navegador visivel para depuracao local.
- `SCREENSHOTS=0`: desliga screenshots de sucesso/falha.
- `SCREENSHOT_MODE`: `all`, `failure` ou `off`. Para carga visual, prefira `failure` para reduzir custo de screenshot de sucesso.
- `ARTIFACTS_DIR`: diretorio dos screenshots. Padrao: `/tmp/nodeaccess-terminal-playwright-artifacts`.
- `ACTION_TIMEOUT_MS`, `NAVIGATION_TIMEOUT_MS`, `TERMINAL_READY_TIMEOUT_MS`, `SESSION_TIMEOUT_MS`: timeouts do fluxo visual.
- `COMMAND_SEND_TIMEOUT_MS`: timeout especifico para digitar comando e pressionar Enter.
- `COMMAND_INPUT_MODE`: modo de input. `hook` usa evento local de teste/localhost para estabilidade do harness; `keys` usa teclado real do Playwright; `insert` e `paste` ficam como diagnostico.
- `CACHE_DIAGNOSTICS=0`: desliga snapshots do registry de cache frontend. Por padrao, em dev/localhost, o relatorio inclui `cacheSummary` por cache com hits, misses, entradas, clears e chaves mais acessadas.
- `CACHE_DIAGNOSTICS_DETAIL=1`: inclui o snapshot bruto do registry. Use apenas para debug pontual, pois aumenta bastante o JSON.

Antes de rodadas longas, renove o perfil local se ele tiver apenas `accessToken` e nao tiver `refreshToken`:

```bash
LOADTEST_USER_COUNT=20 \
LOADTEST_HOST_COUNT=100 \
LOADTEST_SSH_PORT=2223 \
LOADTEST_TOKEN_EXPIRES_IN=8h \
node tools/load-tests/scripts/seed-local-loadtest.js
```

Para reduzir ruido do Vite dev ao validar estabilidade visual, prefira tambem uma rodada contra build/preview de producao. Em WSL/OneDrive, se `vite build` falhar ao escrever em `apps/frontend/dist`, gere o build em `/tmp`:

```bash
cd apps/frontend
npx vite build --outDir /tmp/nodeaccess-frontend-dist --emptyOutDir
npx vite preview --outDir /tmp/nodeaccess-frontend-dist --host 127.0.0.1 --port 4173
```

Exemplo local validado para 5 sessoes:

```bash
FRONTEND_BASE=http://127.0.0.1:4173 \
PROFILE_FILE=tools/load-tests/data/profile.local.json \
CONCURRENCY=5 \
BROWSER=chromium \
PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium-browser \
COMMAND_INPUT_MODE=hook \
SCREENSHOT_MODE=failure \
TERMINAL_READY_TIMEOUT_MS=180000 \
SESSION_TIMEOUT_MS=360000 \
HOLD_MS=3000 \
COMMAND_INTERVAL_MS=2000 \
DISK_PATHS=/tmp \
CONTAINER_NAME_PATTERN=nodeaccess \
node tools/frontend/terminal-playwright-load.cjs
```

O relatorio separa `terminalReady` de `connectedUi`, lista `responseErrors` 4xx/5xx por URL e registra `commandInputMode`, timeouts e duracao por sessao. Ele tambem inclui `apiSummary`, agrupando chamadas `/api/v1` por metodo e endpoint normalizado, com contagem, status, duracao e tamanho aproximado para orientar cache/lazy loading. Em dev/localhost, inclui tambem `cacheSummary` e snapshots por sessao para comparar hits/misses entre `/hosts`, detalhe do host, terminal pronto e final do teste. Em perfis com usuarios sem permissao total, 403 em paineis auxiliares podem aparecer sem indicar falha do terminal SSH. Na rodada local validada, 10 sessoes em production preview passaram com `TERMINAL_READY_TIMEOUT_MS=180000` e `SESSION_TIMEOUT_MS=360000`.

## Hosts via Chromium/CDP

Para avaliar renderizacao e cache da tela de Hosts, abra um Chromium com CDP e rode:

```bash
chromium-browser --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9339 \
  --user-data-dir=/tmp/nodeaccess-hosts-perf \
  --window-size=1440,1000 about:blank

FRONTEND_BASE=http://127.0.0.1:5173 \
CDP_BASE=http://127.0.0.1:9339 \
PERF_MODES=normal,list-minimal,no-presence \
REPORT_PATH=/tmp/nodeaccess-hosts-perf-cache.json \
node tools/frontend/hosts-cdp-perf.cjs
```

O relatorio inclui `apiSummary`, `cacheSummary` por cenario e `warmCacheDeltas` nos cliques repetidos. Use esses campos para identificar misses repetidos em `hosts:list`, `hosts:sidebar-bootstrap`, `inventory:list`, `features`, snippets ou chamadas auxiliares antes de propor novo cache. Use `CACHE_DIAGNOSTICS_DETAIL=1` somente quando precisar investigar o snapshot bruto do registry.

## Terminal Web via Chromium/CDP

Para simular o usuario usando o terminal no browser, use o harness CDP. Ele abre multiplas paginas do Chromium, injeta token/host do `profile.local.json`, navega para `/terminal`, foca o xterm, envia comandos e mede frames WebSocket.

```bash
chromium-browser --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9362 \
  --user-data-dir=/tmp/nodeaccess-terminal-load-cdp \
  --window-size=1440,1000 about:blank

FRONTEND_BASE=http://127.0.0.1:5173 \
CDP_BASE=http://127.0.0.1:9362 \
CONCURRENCY=5 \
HOLD_MS=15000 \
COMMAND_INTERVAL_MS=5000 \
CDP_OPEN_TIMEOUT_MS=15000 \
CDP_COMMAND_TIMEOUT_MS=45000 \
CDP_SETUP_RETRIES=2 \
node tools/frontend/terminal-cdp-load.cjs
```

Esse teste e mais caro que `baseline-gateway.js`, porque renderiza UI/xterm. Use concorrencias menores por maquina ou distribua em multiplos workers quando quiser medir muitos usuarios visuais. O relatorio tambem inclui CPU/memoria/disco da maquina, processos relevantes e `docker stats` dos containers filtrados por `CONTAINER_NAME_PATTERN` ou `CONTAINER_NAMES`.
Em rampas maiores, `CDP_OPEN_TIMEOUT_MS`, `CDP_COMMAND_TIMEOUT_MS` e `CDP_SETUP_RETRIES` ajudam a reduzir falsos negativos causados pelo proprio DevTools Protocol durante a abertura de muitas abas.

## Matriz de Capacidade

Para estimar limites saudaveis por quantidade de hosts cadastrados e sessoes simultaneas, use o orquestrador:

```bash
DRY_RUN=1 node tools/load-tests/scripts/run-capacity-matrix.js
```

Para uma rodada local controlada com seed automatico e SSH mock:

```bash
SEED_LOCAL=1 \
DRY_RUN=0 \
HOST_COUNTS=100,250,500,1000,2000 \
SESSION_COUNTS=100,200,300,500 \
LOADTEST_USER_COUNT=100 \
HOLD_MS=300000 \
COMMAND_INTERVAL_MS=10000 \
node tools/load-tests/scripts/run-capacity-matrix.js \
  --profile tools/load-tests/data/profile.local.json
```

O script executa ondas progressivas, coleta CPU/memoria/disco da maquina, `docker stats` dos containers, processos Node, estados TCP e, quando `METRICS_URL` ou `METRICS_URLS` estiver configurado, agrega metricas Prometheus. Por padrao ele para a proxima onda do mesmo tamanho de massa quando um cenario deixa de ser saudavel.

Para coletar API e gateway separadamente:

```bash
METRICS_URLS=api=http://localhost:3000/metrics,gateway=http://localhost:3001/metrics
```

Use `METRICS_TOKEN` quando os endpoints estiverem protegidos.

Limites configuraveis:

- `MAX_FAILURE_RATE`: padrao `0.01`
- `MAX_CONNECT_P95_MS`: padrao `5000`
- `MAX_FIRST_OUTPUT_P95_MS`: padrao `6000`
- `MAX_COMMAND_LATENCY_P95_MS`: padrao `3000`
- `MAX_CPU_PERCENT`: padrao `85`
- `MAX_MEMORY_PERCENT`: padrao `85`
- `MAX_DISK_PERCENT`: padrao `90`
- `MAX_CONTAINER_CPU_PERCENT`: padrao `200`; em Docker esse valor pode passar de `100%` em maquinas com multiplos cores
- `MAX_CONTAINER_MEMORY_PERCENT`: padrao `85`

O relatorio consolidado fica em `tools/load-tests/reports/capacity-matrix/` e calcula `recommendedSessionLimit` como 70% da maior concorrencia saudavel medida.
Cada onda tambem inclui recomendacoes automaticas sobre falhas, latencia, CPU, memoria, TIME_WAIT e endpoint Prometheus incorreto.

Variáveis úteis:

- `WS_BASE_URL`: base do gateway. Padrão: `ws://localhost:3001`.
- `SSH_WS_PATH`: caminho do WebSocket. Padrão: `/ws/ssh`.
- `CONCURRENCY`: sessões simultâneas. Padrão: `5`.
- `HOLD_MS`: tempo para manter cada sessão aberta após conectar. Padrão: `60000`.
- `HOLD_JITTER_MS`: variacao aleatoria aplicada ao tempo de sessao para simular entradas e saidas desencontradas. Padrao: `0`.
- `CONNECT_TIMEOUT_MS`: timeout de conexão SSH/WebSocket. Padrão: `30000`.
- `COMMAND_INTERVAL_MS`: intervalo entre comandos. Padrão: `10000`.
- `PING_INTERVAL_MS`: intervalo de ping para o gateway. Padrão: `15000`.
- `START_STAGGER_MS`: atraso entre abertura de sessões. Padrão: `250`.
- `METRICS_URL`: endpoint Prometheus unico. Exemplo: `http://localhost:3000/metrics`.
- `METRICS_URLS`: endpoints Prometheus nomeados. Exemplo: `api=http://localhost:3000/metrics,gateway=http://localhost:3001/metrics`.
- `DISK_PATHS`: caminhos para monitorar uso de disco, separados por virgula. Padrao: workspace atual e `/tmp`.
- `CONTAINER_NAMES`: nomes exatos de containers Docker para monitorar, separados por virgula.
- `CONTAINER_NAME_PATTERN`: regex para filtrar containers quando `CONTAINER_NAMES` nao for informado. Padrao: `nodeaccess`.

Exemplo:

```bash
WS_BASE_URL=wss://nodeaccess-gateway-hml.example.com \
CONCURRENCY=50 \
HOLD_MS=900000 \
node tools/load-tests/ws/baseline-gateway.js --profile tools/load-tests/data/profile.local.json
```

## Roteiro Recomendado

1. Rodar API baseline com `5 VUs` por `2m`.
2. Rodar gateway baseline com `5` sessões por `1m`.
3. Subir para `10`, `25`, `50` e `100` sessões, mantendo a mesma massa.
4. Repetir com auditoria SSH ligada e desligada.
5. Registrar p95/p99, erro %, CPU, memória, conexões MySQL, Redis e logs do gateway.

O passo a passo operacional fica em `tools/load-tests/RUNBOOK.md`.
O roteiro reprodutível dos testes executados fica em `tools/load-tests/REPRODUCIBILITY.md`.

## Critérios Iniciais

- API: `http_req_failed < 1%`, p95 menor que `800ms` no baseline.
- Gateway: nenhuma queda inesperada no baseline; tempo de conexão SSH medido e reportado.
- Auditoria: comparar volume de chunks, latência percebida e consumo de banco/Redis.

Os thresholds devem ser ajustados depois da primeira rodada real em homologação.
