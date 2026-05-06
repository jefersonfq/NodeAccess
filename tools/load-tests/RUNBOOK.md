# Runbook de Teste de Carga

Este roteiro usa massa local derivada de `data/profile.model.json`.

## 1. Preparar Massa Local

```bash
cp tools/load-tests/data/profile.model.json tools/load-tests/data/profile.local.json
```

Edite `tools/load-tests/data/profile.local.json`:

- troque `accessToken` por tokens reais de usuarios de homologacao;
- ajuste `id` dos hosts para hosts reais do NodeAccess;
- mantenha apenas hosts que o usuario selecionado pode acessar;
- use hosts de laboratorio, nao producao.

O arquivo `profile.local.json` fica ignorado pelo Git.

Para criar uma massa ficticia local diretamente no banco e gerar tokens:

```bash
node tools/load-tests/scripts/mock-ssh-server.js
```

Em outro terminal:

```bash
LOADTEST_USER_COUNT=10 node tools/load-tests/scripts/seed-local-loadtest.js
```

Esse fluxo cria:

- tenant `loadtest`;
- usuarios `loadtest-01@nodeaccess.local` em diante;
- hosts pessoais apontando para `127.0.0.1:2222`;
- tokens JWT em `tools/load-tests/data/profile.local.json`.

## 2. Subir Ambiente

Em outro terminal:

```bash
npm run dev
```

Por padrao:

- API: `http://localhost:3000/api/v1`
- Gateway SSH: `ws://localhost:3001`

## 3. Rodar Baseline de API

```bash
k6 run \
  -e PROFILE_FILE=../data/profile.local.json \
  -e BASE_URL=http://localhost:3000/api/v1 \
  -e API_VUS=5 \
  -e API_DURATION=2m \
  tools/load-tests/k6/baseline-api.js
```

Com endpoints admin:

```bash
k6 run \
  -e PROFILE_FILE=../data/profile.local.json \
  -e BASE_URL=http://localhost:3000/api/v1 \
  -e API_VUS=10 \
  -e API_DURATION=5m \
  -e API_INCLUDE_ADMIN=1 \
  tools/load-tests/k6/baseline-api.js
```

## 4. Rodar Baseline de Sessoes SSH

```bash
WS_BASE_URL=ws://localhost:3001 \
CONCURRENCY=5 \
HOLD_MS=60000 \
node tools/load-tests/ws/baseline-gateway.js --profile tools/load-tests/data/profile.local.json
```

## 5. Rodar Rampa de Concorrencia

Execute em ondas, observando CPU, memoria, MySQL, Redis e logs do gateway.

```bash
WS_BASE_URL=ws://localhost:3001 CONCURRENCY=10 HOLD_MS=300000 node tools/load-tests/ws/baseline-gateway.js --profile tools/load-tests/data/profile.local.json
WS_BASE_URL=ws://localhost:3001 CONCURRENCY=25 HOLD_MS=300000 node tools/load-tests/ws/baseline-gateway.js --profile tools/load-tests/data/profile.local.json
WS_BASE_URL=ws://localhost:3001 CONCURRENCY=50 HOLD_MS=300000 node tools/load-tests/ws/baseline-gateway.js --profile tools/load-tests/data/profile.local.json
```

Com correlacao basica de CPU/memoria da maquina:

```bash
WS_BASE_URL=ws://localhost:3001 \
CONCURRENCY=10 \
HOLD_MS=300000 \
node tools/load-tests/scripts/run-gateway-with-metrics.js --profile tools/load-tests/data/profile.local.json
```

O relatorio JSON sera salvo em `tools/load-tests/reports/`.

Para teste sustentado de 15 minutos:

```bash
WS_BASE_URL=ws://localhost:3001 \
CONCURRENCY=50 \
HOLD_MS=900000 \
COMMAND_INTERVAL_MS=15000 \
node tools/load-tests/ws/baseline-gateway.js --profile tools/load-tests/data/profile.local.json
```

## 6. Comparar Auditoria SSH

Rode a mesma onda duas vezes:

1. auditoria SSH habilitada;
2. auditoria SSH desabilitada ou fora da politica do usuario/grupo.

Compare:

- `connected` versus `failed`;
- `connectMs.p95`;
- `firstOutputMs.p95`;
- consumo de CPU/memoria no gateway;
- conexoes MySQL;
- crescimento de `session_audit_chunks`;
- erros no log do gateway.

## 7. Interpretar Saida do Gateway

Exemplo de campos:

```json
{
  "concurrency": 25,
  "connected": 25,
  "failed": 0,
  "commandsSent": 100,
  "bytesIn": 140000,
  "connectMs": { "p50": 840, "p95": 1600, "max": 2100 },
  "firstOutputMs": { "p50": 950, "p95": 1800, "max": 2300 }
}
```

Sinais de atencao:

- `failed` maior que zero no baseline;
- `connectMs.p95` crescendo muito entre ondas;
- `firstOutputMs.p95` alto com CPU baixa, indicando possivel gargalo em SSH, rede, bastion ou banco;
- quedas depois de alguns minutos, indicando timeout, heartbeat ou limite de sessao.

## 8. Estimar Capacidade

Use a maior onda em que:

- `failed` ficou em `0` ou abaixo do erro aceitavel;
- `connectMs.p95` nao degradou de forma abrupta em relacao a onda anterior;
- CPU media ficou abaixo de 70% e pico abaixo de 85%;
- memoria nao cresceu continuamente ate o fim do teste;
- MySQL e Redis nao apresentaram saturacao;
- terminal continuou responsivo para comandos curtos.

A estimativa inicial de capacidade deve ser conservadora: use 70% da maior concorrencia estavel medida.

## 9. Reproducibilidade

O roteiro completo para reproduzir as ondas locais com SSH mock, seed de usuarios ficticios, tokens e relatorios esta em:

```text
tools/load-tests/REPRODUCIBILITY.md
```
