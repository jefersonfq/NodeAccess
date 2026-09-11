# Desempenho e latencia da API

## Objetivo

Permitir que suporte e administradores identifiquem lentidao recorrente, picos e
erros da API sem registrar URL sensivel, query string, token ou corpo da
requisicao.

## Fluxo

```text
resposta HTTP concluida
  -> rota normalizada + status + duracao
    -> histograma Prometheus
    -> janela local em memoria
    -> evento api.slow_request quando excede o limite
      -> tela Plataforma > Observabilidade
```

## Configuracao

```env
SLOW_REQUEST_THRESHOLD_MS=1000
API_PERFORMANCE_WINDOW_MINUTES=15
API_PERFORMANCE_MAX_SAMPLES=5000
API_ERROR_RATE_WARNING_PERCENT=2
```

- `SLOW_REQUEST_THRESHOLD_MS`: limite que gera log de atencao e entra na lista
  de ocorrencias lentas.
- `API_PERFORMANCE_WINDOW_MINUTES`: periodo mantido localmente por processo.
- `API_PERFORMANCE_MAX_SAMPLES`: protecao de memoria para instalacoes com maior
  volume.
- `API_ERROR_RATE_WARNING_PERCENT`: limite de respostas 5xx que degrada o
  snapshot operacional.

A janela local reinicia ao reiniciar a API e nao agrega nos em HA. Para manter
historico, habilite o endpoint Prometheus:

```env
FEATURE_METRICS=true
METRICS_TOKEN=um-token-longo-e-aleatorio
```

Metricas HTTP publicadas:

```text
nodeaccess_http_requests_total
nodeaccess_http_errors_total
nodeaccess_http_request_duration_ms_bucket
nodeaccess_http_request_duration_ms_sum
nodeaccess_http_request_duration_ms_count
```

Os labels usam somente metodo, rota normalizada, classe HTTP e modo do processo.
IDs de host, usuario, tenant e tokens nao sao labels, evitando vazamento e alta
cardinalidade.

## Leitura recomendada

- p50 representa a experiencia habitual.
- p95 evidencia lentidao recorrente percebida pelos usuarios.
- p99 evidencia a cauda e picos relevantes.
- maximo ajuda na investigacao, mas nao deve ser usado sozinho.
- taxa 5xx diferencia lentidao de falha real.

## Diagnostico rapido

```bash
docker compose logs --since=15m api | grep 'api.slow_request'
curl -fsS -H "Authorization: Bearer $METRICS_TOKEN" \
  http://127.0.0.1:3000/metrics | grep 'nodeaccess_http_'
```

Uma rota lenta nao identifica sozinha a causa. Correlacione o `requestId` com os
demais logs e verifique a latencia de MySQL, Redis, gateway e integracoes na
mesma tela.
