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

Variáveis úteis:

- `WS_BASE_URL`: base do gateway. Padrão: `ws://localhost:3001`.
- `SSH_WS_PATH`: caminho do WebSocket. Padrão: `/ws/ssh`.
- `CONCURRENCY`: sessões simultâneas. Padrão: `5`.
- `HOLD_MS`: tempo para manter cada sessão aberta após conectar. Padrão: `60000`.
- `CONNECT_TIMEOUT_MS`: timeout de conexão SSH/WebSocket. Padrão: `30000`.
- `COMMAND_INTERVAL_MS`: intervalo entre comandos. Padrão: `10000`.
- `PING_INTERVAL_MS`: intervalo de ping para o gateway. Padrão: `15000`.
- `START_STAGGER_MS`: atraso entre abertura de sessões. Padrão: `250`.

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
