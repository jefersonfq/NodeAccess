# Operations Inbound Webhooks Lite

## Objetivo
Guia rapido para validar e integrar plataformas externas que enviam eventos para o NodeAccess via inbound webhook.

Este guia cobre o primeiro corte implementado:
- criar endpoint inbound pela API administrativa ou pela UI
- receber evento externo por token opaco
- exigir idempotencia
- validar assinatura HMAC quando o endpoint possui segredo
- registrar receipts para rastreabilidade

## Quando Usar
Use inbound webhook quando uma plataforma externa precisa informar algo ao NodeAccess.

Exemplos:
- monitoramento informa `host.unavailable`
- monitoramento informa `host.recovered`
- CMDB informa alteracao de metadados
- ITSM informa abertura ou resolucao de incidente
- automacao interna envia contexto operacional para um host

Nao usar inbound webhook para:
- substituir APIs autenticadas de administracao
- executar comando SSH direto
- criar usuario ou permissao critica
- aplicar mudanca sensivel sem politica explicita

## Endpoint Publico

```txt
POST /api/v1/inbound-webhooks/{provider}/{endpointToken}
```

Campos:
- `provider`: chave curta do emissor, como `monitoring`, `cmdb` ou `itsm`
- `endpointToken`: token opaco gerado na criacao do endpoint

O `endpointToken` aparece apenas na resposta de criacao. Se for perdido, crie outro endpoint ou implemente rotacao futura.

## Headers Recomendados

```txt
Content-Type: application/json
X-NodeAccess-Idempotency-Key: evt-monitoring-0001
X-NodeAccess-Signature: sha256=<hmac_sha256_hex>
X-Correlation-Id: inc-12345
```

Regras:
- `X-NodeAccess-Idempotency-Key` e obrigatorio, exceto quando o payload tiver `id` ou `eventId`
- `X-NodeAccess-Signature` e obrigatorio quando o endpoint foi criado com segredo HMAC
- tambem e aceito `X-Hub-Signature-256`
- a assinatura pode vir como `sha256=<hex>` ou apenas `<hex>`

## Payload Generico

```json
{
  "id": "evt-monitoring-0001",
  "type": "host.unavailable",
  "correlationId": "inc-12345",
  "resource": {
    "host": "srv-app-01",
    "ip": "10.10.10.20"
  },
  "data": {
    "severity": "critical",
    "message": "Host sem resposta no monitoramento",
    "clientAware": true
  }
}
```

Campos reconhecidos pelo primeiro corte:
- tipo do evento: `type`, `eventType` ou header `X-NodeAccess-Event`
- id externo: `id`, `eventId` ou header `X-NodeAccess-Event-Id`
- correlacao: `correlationId` ou header `X-Correlation-Id`
- recurso: `resource`

## Criar Endpoint Pela API

Requer usuario admin autenticado.

```bash
curl \
  -X POST "http://127.0.0.1:3000/api/v1/inbound-webhooks/endpoints" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "monitoring",
    "name": "Monitoramento de hosts",
    "description": "Recebe indisponibilidade e recuperacao de hosts",
    "secret": "segredo-hmac-com-ao-menos-8-caracteres",
    "allowedEventTypes": ["host.unavailable", "host.recovered"],
    "mappingMode": "GENERIC"
  }'
```

Resposta esperada:

```json
{
  "endpoint": {
    "id": 1,
    "provider": "monitoring",
    "name": "Monitoramento de hosts",
    "status": "ACTIVE",
    "hasSecret": true,
    "allowedEventTypes": ["host.unavailable", "host.recovered"],
    "mappingMode": "GENERIC"
  },
  "endpointToken": "inwh_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

Guarde o `endpointToken` no sistema externo. Ele nao deve ser exibido novamente.

## Enviar Evento Sem Segredo

Use apenas para endpoint criado sem `secret`.

```bash
curl \
  -X POST "http://127.0.0.1:3000/api/v1/inbound-webhooks/monitoring/$ENDPOINT_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-NodeAccess-Idempotency-Key: evt-monitoring-0001" \
  -H "X-Correlation-Id: inc-12345" \
  -d '{
    "id": "evt-monitoring-0001",
    "type": "host.unavailable",
    "resource": { "host": "srv-app-01", "ip": "10.10.10.20" },
    "data": {
      "severity": "critical",
      "message": "Host sem resposta no monitoramento",
      "clientAware": true
    }
  }'
```

Resposta esperada:

```json
{
  "accepted": true,
  "duplicate": false,
  "receiptId": 10,
  "status": "ACCEPTED"
}
```

## Enviar Evento Com HMAC

O HMAC e calculado sobre o JSON exatamente enviado no corpo da requisicao.

Antes de executar, defina:

```bash
export WEBHOOK_SECRET='segredo-hmac-com-ao-menos-8-caracteres'
export ENDPOINT_TOKEN='inwh_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
```

```bash
PAYLOAD='{"id":"evt-monitoring-0002","type":"host.recovered","resource":{"host":"srv-app-01","ip":"10.10.10.20"},"data":{"message":"Host voltou a responder"}}'
SIGNATURE=$(node -e "const crypto=require('crypto'); const secret=process.env.WEBHOOK_SECRET; const payload=process.argv[1]; console.log(crypto.createHmac('sha256', secret).update(payload).digest('hex'))" "$PAYLOAD")

curl \
  -X POST "http://127.0.0.1:3000/api/v1/inbound-webhooks/monitoring/$ENDPOINT_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-NodeAccess-Idempotency-Key: evt-monitoring-0002" \
  -H "X-NodeAccess-Signature: sha256=$SIGNATURE" \
  -d "$PAYLOAD"
```

## Consultar Receipts

Requer usuario admin autenticado.

```bash
curl \
  "http://127.0.0.1:3000/api/v1/inbound-webhooks/endpoints/$ENDPOINT_ID/receipts" \
  -H "Authorization: Bearer $TOKEN"
```

Filtrar rejeitados:

```bash
curl \
  "http://127.0.0.1:3000/api/v1/inbound-webhooks/endpoints/$ENDPOINT_ID/receipts?status=REJECTED" \
  -H "Authorization: Bearer $TOKEN"
```

## Cenarios De Validacao

### Aceito
Conforme:
- endpoint existe
- `provider` da URL bate com o endpoint
- endpoint esta `ACTIVE`
- idempotencia foi informada
- assinatura HMAC e valida, quando houver segredo
- `type` esta permitido em `allowedEventTypes`, quando a lista nao esta vazia

Retorno:

```json
{
  "accepted": true,
  "duplicate": false,
  "receiptId": 10,
  "status": "ACCEPTED"
}
```

### Duplicado
Enviar novamente a mesma chave de idempotencia retorna o receipt ja existente.

Retorno:

```json
{
  "accepted": true,
  "duplicate": true,
  "receiptId": 10,
  "status": "ACCEPTED"
}
```

### Rejeitado Por Assinatura
Quando o endpoint tem segredo e a assinatura esta ausente ou invalida.

Retorno:

```json
{
  "accepted": false,
  "duplicate": false,
  "receiptId": 11,
  "status": "REJECTED"
}
```

O receipt registra:
- `errorCode`: `INVALID_SIGNATURE`
- `signatureValid`: `false`

### Rejeitado Por Evento Nao Permitido
Quando `allowedEventTypes` esta preenchido e o payload envia outro tipo.

O receipt registra:
- `errorCode`: `EVENT_TYPE_NOT_ALLOWED`

### Rejeitado Por Idempotencia Ausente
Quando nao ha header `X-NodeAccess-Idempotency-Key` e o payload nao tem `id` nem `eventId`.

O receipt registra:
- `errorCode`: `IDEMPOTENCY_KEY_REQUIRED`

## Checklist Rapido

- criar endpoint inbound pela UI ou API
- copiar `endpointToken` na hora da criacao
- configurar segredo HMAC no sistema externo, se aplicavel
- enviar primeiro evento valido
- reenviar mesmo evento para confirmar duplicidade
- enviar evento com assinatura invalida para confirmar rejeicao
- conferir receipts na UI ou API
- pausar endpoint e confirmar rejeicao por status
- reativar endpoint apos teste

## Observacoes De Seguranca

- trate `endpointToken` como credencial tecnica
- prefira sempre segredo HMAC em integracoes reais
- use chaves de idempotencia unicas por evento externo
- nao envie segredos, senhas ou chaves privadas no payload
- mantenha `allowedEventTypes` restrito ao minimo necessario
- use `X-Correlation-Id` para rastrear incidente, ticket ou execucao externa
