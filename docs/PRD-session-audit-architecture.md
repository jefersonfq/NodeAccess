# Session Audit Architecture

## Objetivo
Traduzir o PRD lite de auditoria de sessao para um desenho implementavel com baixo custo operacional inicial e caminho claro de evolucao para IA, guardrails e integracao com tickets.

## Principios
- nao degradar o caminho critico do terminal
- manter captura bruta como fonte de verdade
- separar captura, persistencia, enriquecimento e apresentacao
- evitar microservicos prematuros
- permitir evolucao progressiva por feature flag

## Arquitetura alvo inicial
### Componentes
1. `SSH Gateway`
- continua responsavel por websocket, resize, input e output
- passa a emitir eventos de auditoria de forma nao bloqueante

2. `Session Audit Module`
- modulo novo no backend principal
- expoe APIs de consulta, download, resumo e administracao
- persiste metadados e status

3. `Session Audit Worker`
- processo separado ou modo extra do backend
- consome fila
- agrega chunks por sessao
- grava artefatos
- dispara jobs derivados

4. `Storage`
- MySQL para metadados e indices
- storage de arquivo para chunks:
  - local persistente no inicio
  - MinIO/S3 depois

5. `AI Jobs`
- executados pelo worker
- geram resumo, classificacao e artefatos derivados

6. `Ticket Adapter`
- adaptador externo desacoplado
- leitura inicial de ticket
- escrita posterior de comentario/anexo

## Recomendacao de deploy por estagio
### Estagio 1
- mesmo backend atual
- worker como novo modo de execucao
- `Redis Streams` como fila
- storage local persistente

### Estagio 2
- worker separado do backend API/gateway
- MinIO ou S3 para storage
- IA assincrona com fila propria ou stream separado

### Estagio 3
- so avaliar RabbitMQ ou servicos dedicados se houver:
  - picos claros de throughput
  - backlog recorrente de jobs
  - necessidade de retries isolados
  - SLA diferente entre captura e enriquecimento

## Fluxo principal
### Captura
1. usuario inicia sessao SSH
2. gateway cria `sessionId`
3. gateway verifica se `sessionAudit` esta habilitado
4. gateway publica `session_started`
5. durante a sessao publica:
- `stdin`
- `stdout`
- `resize`
- `session_error`
6. ao encerrar publica `session_ended`

### Persistencia
1. worker le eventos por `sessionId`
2. agrega em buffer por janela curta
3. compacta chunk
4. grava chunk no storage
5. atualiza metadados no MySQL

### Derivacao
1. ao receber `session_ended`, worker agenda job de pos-processamento
2. job gera:
- resumo
- estatisticas da sessao
- tentativa de extracao de comandos
3. opcionalmente agenda integracao com ticket

## Contrato de evento
### Envelope
```json
{
  "version": 1,
  "eventId": "uuid",
  "sessionId": "123",
  "tenantId": 1,
  "userId": 10,
  "hostId": 6,
  "seq": 42,
  "timestamp": "2026-03-31T14:00:00.000Z",
  "type": "stdout",
  "source": "gateway",
  "payload": {}
}
```

### Tipos
#### `session_started`
```json
{
  "hostName": "srv-app-01",
  "hostIp": "10.0.0.12",
  "connectionMethod": "direct",
  "cols": 120,
  "rows": 30,
  "ticket": {
    "provider": "jira",
    "key": "OPS-123",
    "url": "https://jira.exemplo/browse/OPS-123"
  }
}
```

#### `stdin`
```json
{
  "encoding": "base64",
  "data": "bHMgLWxhCg=="
}
```

#### `stdout`
```json
{
  "encoding": "base64",
  "data": "dG90YWwgMA0K"
}
```

#### `resize`
```json
{
  "cols": 140,
  "rows": 40
}
```

#### `session_error`
```json
{
  "code": "SSH_CONNECT_FAILED",
  "message": "Falha ao conectar ao host"
}
```

#### `session_ended`
```json
{
  "reason": "client_closed"
}
```

## Chunks e storage
### Estrategia
- chunkar por tamanho ou tempo
- recomendacao inicial:
  - flush a cada `256 KB` ou `2s`
- compactacao:
  - `gzip`
- formato:
  - `jsonl`

### Exemplo de registro interno no chunk
```json
{"seq":1,"ts":"2026-03-31T14:00:00.000Z","type":"stdin","data":"bHMgLWxhCg=="}
{"seq":2,"ts":"2026-03-31T14:00:00.120Z","type":"stdout","data":"dG90YWwgMA0K"}
```

### Chave de storage sugerida
```text
tenant/{tenantId}/session-audit/{yyyy}/{mm}/{dd}/{sessionId}/chunk-{seq}.jsonl.gz
```

## Modelo inicial de dados
### `SessionAudit`
- `id`
- `sessionId`
- `tenantId`
- `userId`
- `hostId`
- `hostNameSnapshot`
- `hostIpSnapshot`
- `connectionMethod`
- `ticketProvider`
- `ticketKey`
- `ticketUrl`
- `startedAt`
- `endedAt`
- `status`
- `auditEnabled`
- `storageDriver`
- `chunkCount`
- `bytesIn`
- `bytesOut`
- `aiSummaryStatus`
- `aiSummaryText`
- `aiRiskLevel`
- `createdAt`
- `updatedAt`

### `SessionAuditChunk`
- `id`
- `sessionAuditId`
- `seq`
- `startedAt`
- `endedAt`
- `eventCount`
- `storageKey`
- `compression`
- `compressedSize`
- `rawSize`
- `createdAt`

### `SessionAuditDerivedCommand`
- `id`
- `sessionAuditId`
- `seq`
- `timestamp`
- `commandText`
- `normalizedCommand`
- `confidence`
- `source`
- `riskLevel`
- `createdAt`

### `SessionAuditGuardrailEvent`
- `id`
- `sessionAuditId`
- `timestamp`
- `ruleId`
- `decision`
- `rawInput`
- `normalizedInput`
- `confidence`
- `reason`
- `createdAt`

### `SessionAuditAiArtifact`
- `id`
- `sessionAuditId`
- `kind`
- `model`
- `status`
- `storageKey`
- `metadataJson`
- `createdAt`

## APIs iniciais
### Admin
- `GET /api/v1/session-audit`
- `GET /api/v1/session-audit/:sessionId`
- `GET /api/v1/session-audit/:sessionId/download`
- `GET /api/v1/session-audit/:sessionId/summary`

### Operacao
- `POST /api/v1/session-audit/:sessionId/reprocess`
- `POST /api/v1/session-audit/:sessionId/ticket-sync`

### Filtros minimos
- `userId`
- `hostId`
- `ticketKey`
- `dateFrom`
- `dateTo`
- `status`
- `aiRiskLevel`

## UX inicial
### Lista
- usuario
- host
- inicio
- duracao
- status
- ticket
- indicador de resumo pronto
- botao de download

### Detalhe
- cabecalho com metadados
- resumo por IA
- estatisticas:
  - bytes in/out
  - quantidade de chunks
  - duracao
- comandos derivados com `confidence`
- acoes:
  - baixar sessao bruta
  - reprocessar resumo
  - sincronizar ticket

## IA
### Entrada recomendada
- stream bruto ou chunkado
- metadados da sessao
- ticket associado, quando existir

### Saidas minimas
- objetivo presumido
- principais acoes executadas
- riscos percebidos
- resultado final
- proximos passos sugeridos

### Regras
- IA nunca substitui trilha bruta
- qualquer resumo deve indicar:
  - modelo
  - horario de geracao
  - possibilidade de erro

## Guardrails
### Fase inicial
- apenas observacao offline
- classificacao de eventos arriscados

### Fase seguinte
- `warn` e `confirm`
- antes do `block`, exigir:
  - politica por tenant
  - auditoria da decisao
  - bypass administrativo

## Integracao com ticket
### Modelo recomendado
- conceito generico de `work item provider`
- primeiro adaptador: `jira`

### Fluxo MVP
- usuario informa `ticketKey`
- backend resolve dados do ticket em background
- sessao fica associada ao ticket
- ao fim da sessao, resumo e download ficam disponiveis

### Fluxo posterior
- comentar no ticket
- anexar arquivo
- publicar link do replay

## Flags sugeridas
- `sessionAudit`
- `sessionAuditAiSummary`
- `sessionAuditGuardrails`
- `sessionAuditTicketContext`
- `sessionAuditTicketWriteback`

## Ordem de implementacao
### Fase A
- emitir eventos no gateway
- criar worker
- persistir metadados
- persistir chunks
- API basica de listagem e download

### Fase B
- detalhe de sessao no admin
- resumo por IA pos-sessao
- filtros
- estatisticas de processamento

### Fase C
- vinculo com ticket
- leitura de ticket
- resumo contextual
- download amigavel

### Fase D
- comandos derivados
- guardrails em `observe`
- score de risco

### Fase E
- `warn`
- `confirm`
- integracao de comentario/anexo no ticket

## Impacto esperado no gateway
### Aceitavel
- serializacao leve
- envio assincrono para stream
- buffer curto em memoria

### Nao aceitavel
- chamada sincrona a IA
- chamada sincrona a ticket provider
- compressao pesada por evento
- escrita em banco por tecla

## Observabilidade
### Metricas minimas
- eventos emitidos por sessao
- tamanho medio do chunk
- tempo de flush
- lag do worker
- tempo de geracao do resumo
- falhas de sincronizacao com ticket

### Logs uteis
- `Session audit event queued`
- `Session audit chunk flushed`
- `Session audit summary generated`
- `Session audit ticket sync failed`

## Decisoes abertas
- usar `Redis Streams` ou `RabbitMQ` no MVP?
- storage inicial local ou MinIO?
- resumo de IA por todas as sessoes ou apenas com ticket?
- derivacao de comandos entra na Fase B ou D?
- o nome comercial sera `Auditoria de Sessao`, `Session Recording` ou ambos?
