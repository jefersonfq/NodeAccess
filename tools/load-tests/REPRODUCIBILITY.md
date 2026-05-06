# Reproduzindo os Testes de Capacidade SSH

Este guia reproduz os testes locais usados para estimar capacidade de sessões SSH simultâneas no NodeAccess.

## Escopo Do Teste

O cenário local mede:

- WebSocket do browser para o SSH Gateway;
- criação de sessão SSH via `ssh2`;
- validação de JWT;
- validação de acesso ao host no banco;
- registro de sessão no MySQL;
- heartbeat e troca de comandos simples;
- CPU/memória da máquina durante a carga.

O cenário local não mede completamente:

- rede real até hosts remotos;
- bastion real;
- stdout pesado;
- SFTP/túneis;
- navegação simultânea no frontend;
- auditoria SSH pesada, a menos que seja habilitada no tenant/política de teste.

## Pré-Requisitos

- MySQL e Redis configurados em `apps/backend/.env`;
- dependências instaladas;
- API e Gateway funcionando localmente;
- porta `2222` livre para o SSH mock;
- Node.js com acesso ao workspace.

## 1. Iniciar API e Gateway

Em um terminal:

```bash
npm run dev
```

Validar:

```bash
curl http://localhost:3000/health
curl http://localhost:3001/health
```

## 2. Iniciar SSH Mock

Em outro terminal:

```bash
node tools/load-tests/scripts/mock-ssh-server.js
```

Saída esperada:

```text
Mock SSH listening on 127.0.0.1:2222
Credentials: loadtest/loadtest
```

## 3. Criar Massa Fictícia E Tokens

Em outro terminal:

```bash
LOADTEST_USER_COUNT=10 node tools/load-tests/scripts/seed-local-loadtest.js
```

Isso cria/atualiza:

- tenant `loadtest`;
- usuários `loadtest-01@nodeaccess.local` até `loadtest-10@nodeaccess.local`;
- hosts pessoais apontando para `127.0.0.1:2222`;
- `tools/load-tests/data/profile.local.json` com JWTs temporários.

Se aparecer `Token inválido ou expirado`, rode o seed novamente para renovar os JWTs.

## 4. Rodar Ondas Curtas

Use ondas de `60s` para achar degradação inicial.

```bash
WS_BASE_URL=ws://localhost:3001 CONCURRENCY=100 HOLD_MS=60000 COMMAND_INTERVAL_MS=10000 node tools/load-tests/scripts/run-gateway-with-metrics.js --profile tools/load-tests/data/profile.local.json
WS_BASE_URL=ws://localhost:3001 CONCURRENCY=200 HOLD_MS=60000 COMMAND_INTERVAL_MS=10000 node tools/load-tests/scripts/run-gateway-with-metrics.js --profile tools/load-tests/data/profile.local.json
WS_BASE_URL=ws://localhost:3001 CONCURRENCY=300 HOLD_MS=60000 COMMAND_INTERVAL_MS=10000 node tools/load-tests/scripts/run-gateway-with-metrics.js --profile tools/load-tests/data/profile.local.json
```

Cada execução salva um relatório em:

```text
tools/load-tests/reports/gateway-load-*.json
```

## 5. Rodar Teste Sustentado

Depois que as ondas curtas passarem limpas, rode pelo menos `15 min`.

```bash
WS_BASE_URL=ws://localhost:3001 \
CONCURRENCY=300 \
HOLD_MS=900000 \
COMMAND_INTERVAL_MS=15000 \
node tools/load-tests/scripts/run-gateway-with-metrics.js --profile tools/load-tests/data/profile.local.json
```

## 6. Consolidar Resultados

Para listar os principais números dos relatórios:

```bash
node -e 'const fs=require("fs"); const files=fs.readdirSync("tools/load-tests/reports").filter(f=>f.startsWith("gateway-load-")&&f.endsWith(".json")).map(f=>"tools/load-tests/reports/"+f).sort(); for (const file of files) { const r=JSON.parse(fs.readFileSync(file,"utf8")); const g=r.gatewaySummary||{}; const m=r.machineSummary||{}; if (!g.concurrency) continue; console.log(JSON.stringify({file, concurrency:g.concurrency, connected:g.connected, failed:g.failed, commandsSent:g.commandsSent, connectP95:g.connectMs?.p95, outputP95:g.firstOutputMs?.p95, cpuAvg:m.cpuPercent?.avg, cpuMax:m.cpuPercent?.max, memMax:m.memoryUsedPercent?.max, memMbMax:m.memoryUsedMb?.max})); }'
```

## 7. Critérios De Leitura

Considere uma onda estável quando:

- `failed` for `0` ou dentro do erro aceitável;
- `connectMs.p95` não degradar abruptamente;
- `firstOutputMs.p95` não degradar abruptamente;
- CPU média ficar abaixo de `70%`;
- CPU pico ficar abaixo de `85%`;
- memória não crescer continuamente;
- logs do gateway não indicarem timeout, handshake ou fechamento anormal recorrente.

Estimativa conservadora:

```text
capacidade operacional recomendada = 70% da maior concorrência estável medida
```

## 7.1. Métricas Internas

Em desenvolvimento, o backend expõe métricas Prometheus em:

```bash
curl http://localhost:3001/metrics
```

Em produção, habilite explicitamente:

```bash
FEATURE_METRICS=true METRICS_TOKEN=change-me npm run dev:gateway -w apps/backend
```

Com token:

```bash
curl -H "Authorization: Bearer change-me" http://localhost:3001/metrics
```

Métricas principais:

- `nodeaccess_ssh_gateway_connections_active`
- `nodeaccess_ssh_gateway_sessions_started_total`
- `nodeaccess_ssh_gateway_connect_duration_ms`
- `nodeaccess_session_audit_chunks_total`
- `nodeaccess_session_audit_chunk_flush_duration_ms`
- `nodeaccess_session_audit_chunk_raw_bytes`
- `nodeaccess_session_audit_chunk_compressed_bytes`
- `nodeaccess_session_audit_buffered_sessions`

## 8. Próximos Cenários

Após validar o mock local:

1. habilitar auditoria SSH para o tenant/grupo de teste e repetir `100/200/300`;
2. repetir com host SSH real na rede;
3. repetir com bastion;
4. separar MySQL e Redis em instâncias próprias;
5. separar API e SSH Gateway;
6. testar dois gateways dividindo a carga.

## 9. Rodar Com Auditoria SSH

Habilite licença e política de auditoria no tenant `loadtest`:

```bash
node tools/load-tests/scripts/set-loadtest-audit-policy.js
```

Reinicie o gateway com a flag ativa:

```bash
FEATURE_SESSION_AUDIT=true npm run dev:gateway -w apps/backend
```

Rode novamente uma onda curta antes do sustentado:

```bash
WS_BASE_URL=ws://localhost:3001 \
CONCURRENCY=100 \
HOLD_MS=60000 \
COMMAND_INTERVAL_MS=10000 \
node tools/load-tests/scripts/run-gateway-with-metrics.js --profile tools/load-tests/data/profile.local.json
```

Depois rode o sustentado:

```bash
WS_BASE_URL=ws://localhost:3001 \
CONCURRENCY=300 \
HOLD_MS=900000 \
COMMAND_INTERVAL_MS=15000 \
node tools/load-tests/scripts/run-gateway-with-metrics.js --profile tools/load-tests/data/profile.local.json
```

Para desabilitar a política de auditoria do tenant de teste:

```bash
LOADTEST_AUDIT_ENABLED=0 node tools/load-tests/scripts/set-loadtest-audit-policy.js
```

## 10. Rodar Com Saída Pesada

Para forçar mais escrita de stdout e múltiplos chunks de auditoria por sessão, reinicie o SSH mock atualizado e gere o profile com comando pesado:

```bash
LOADTEST_COMMAND_SET=heavy-output LOADTEST_USER_COUNT=10 node tools/load-tests/scripts/seed-local-loadtest.js
```

O comando `burst 400 80` gera centenas de KB por sessão em uma onda de 60s com `COMMAND_INTERVAL_MS=10000`.

Onda curta recomendada:

```bash
METRICS_URL=http://localhost:3011/metrics \
WS_BASE_URL=ws://localhost:3011 \
CONCURRENCY=100 \
HOLD_MS=60000 \
COMMAND_INTERVAL_MS=10000 \
node tools/load-tests/scripts/run-gateway-with-metrics.js --profile tools/load-tests/data/profile.local.json
```

Quando `METRICS_URL` é informado, o relatório passa a incluir:

- `prometheusSummary`;
- deltas de chunks;
- deltas de bytes brutos/comprimidos;
- deltas de cache da política de auditoria (`hits`, `misses`, `errors`);
- sessões iniciadas vistas pelas métricas internas;
- snapshots Prometheus em `prometheusSamples`.
