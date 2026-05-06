# Proposta Tecnica - Webhooks no NodeAccess

## Resposta curta

Sim. Vale subir essa frente.

Mas o desenho correto e:

- modulo proprio de `webhooks`
- eventos internos de dominio
- `outbox` persistente
- dispatcher assíncrono
- payload automatico no MVP
- payload customizado validado como fase seguinte

O NodeAccess deve ser emissor confiavel de eventos. `n8n`, `Zapier`, `Make` e integradores similares ficam responsaveis por orquestracao e conectores.

## Objetivo tecnico

Traduzir o `PRD-webhooks-lite.md` em um plano tecnico implementavel, incremental e de baixo risco para disponibilizar webhooks de saida auditaveis, desacoplados e flexiveis.

## Premissas

- sem acoplar dominios do produto a transporte HTTP externo
- sem quebrar login, terminal, MCP, auditoria ou sessoes existentes
- sem criar dependencia de plataforma especifica como `n8n` ou `Zapier`
- payload deve ser estavel, assinado e sem dados sensiveis por padrao
- falha de entrega nunca pode bloquear o fluxo principal do produto

## Escopo recomendado

### MVP

- subscriptions por tenant
- eventos de alto valor e baixa frequencia
- entrega `POST`
- payload `automatic`
- assinatura HMAC
- retries com backoff
- UI admin minima
- consulta operacional de deliveries

### Fase seguinte

- `PUT`
- payload `custom` validado por schema
- preview de payload
- teste de webhook
- replay controlado

### Fora do corte inicial

- `GET` generico como modo padrao
- streaming de terminal
- fan-out por broker externo pesado
- transformacao arbitraria por script do usuario
- conectores dedicados por fornecedor dentro do backend

## Arquitetura sugerida

```txt
Frontend Admin
  Webhook Subscriptions / Deliveries
        |
        v
Backend API
  webhooks module
    - subscription CRUD
    - event mapping
    - delivery scheduling
    - delivery listing
        |
        +--> database outbox tables
        |
        +--> dispatcher worker
                |
                +--> signed HTTP delivery
```

## Regra principal

O dominio so publica evento.

O modulo de webhook decide:

- se alguem assina aquele evento
- qual payload sera usado
- quando a entrega sera tentada
- como retry e falha serao tratados

## Modulo sugerido

```txt
apps/backend/src/modules/webhooks/
```

Arquivos sugeridos:

```txt
webhook.routes.ts
webhook.controller.ts
webhook.service.ts
webhook.repository.ts
webhook-dispatcher.service.ts
webhook-event-publisher.ts
webhook-event-mapper.ts
webhook-signer.service.ts
webhook-http-client.ts
webhook.schemas.ts
webhook.types.ts
webhook.audit.ts
```

Frontend:

```txt
apps/frontend/src/views/admin/WebhooksView.vue
apps/frontend/src/services/webhooks.service.ts
apps/frontend/src/components/admin/webhooks/
```

## Modelo de dados

### WebhookSubscription

Tabela sugerida: `webhook_subscriptions`

Campos:

- `id`
- `tenantId`
- `name`
- `description` nullable
- `targetUrl`
- `httpMethod` (`POST`, depois `PUT`)
- `status` (`active`, `paused`, `failed`)
- `subscribedEventsJson`
- `secretEncrypted`
- `headersJson` nullable
- `payloadMode` (`automatic`, `custom`)
- `payloadTemplateJson` nullable
- `payloadSchemaJson` nullable
- `timeoutMs`
- `maxRetries`
- `lastTriggeredAt` nullable
- `lastSuccessAt` nullable
- `lastFailureAt` nullable
- `createdByUserId`
- `updatedByUserId` nullable
- `createdAt`
- `updatedAt`

Indices sugeridos:

- `(tenant_id, status)`
- `(tenant_id, created_at)`

### WebhookDelivery

Tabela sugerida: `webhook_deliveries`

Campos:

- `id`
- `tenantId`
- `subscriptionId`
- `eventId`
- `eventType`
- `eventVersion`
- `resourceType`
- `resourceId`
- `status` (`pending`, `processing`, `delivered`, `retry_scheduled`, `dead`)
- `payloadJson`
- `idempotencyKey`
- `attemptCount`
- `nextAttemptAt`
- `lastAttemptAt` nullable
- `responseStatus` nullable
- `responseLatencyMs` nullable
- `responseBodySnippet` nullable
- `lastErrorCode` nullable
- `lastErrorMessage` nullable
- `createdAt`
- `updatedAt`

Indices sugeridos:

- `(status, next_attempt_at)`
- `(subscription_id, created_at)`
- `(tenant_id, event_type, created_at)`
- `(tenant_id, status, created_at)`

### WebhookEventOutbox

Opcao recomendada para manter publish desacoplado:

- `id`
- `tenantId`
- `eventType`
- `eventVersion`
- `resourceType`
- `resourceId`
- `eventPayloadJson`
- `occurredAt`
- `correlationId` nullable
- `processedAt` nullable
- `createdAt`

Indice sugerido:

- `(processed_at, created_at)`

Observacao:

- se quiser simplificar muito o MVP, o sistema pode gravar deliveries diretamente em vez de ter uma tabela outbox separada;
- mesmo assim, o conceito deve continuar assíncrono.

## Envelope publico do evento

Formato recomendado:

```json
{
  "id": "evt_01H...",
  "type": "action_run.completed",
  "version": 1,
  "occurredAt": "2026-04-23T18:20:00.000Z",
  "tenantId": "tenant_123",
  "environment": "prod",
  "correlationId": "req_123",
  "resource": {
    "type": "action_run",
    "id": "run_123"
  },
  "data": {
    "status": "completed"
  }
}
```

## Eventos recomendados no MVP

Entrar pequeno:

- `action_run.created`
- `action_run.approved`
- `action_run.completed`
- `action_run.failed`
- `mcp_token.revoked`
- `mcp_interactive_ssh_session.closed`

Fase 2:

- `session.started`
- `session.ended`
- `host.created`
- `host.updated`
- `host.deleted`
- `user.deactivated`

## Publish de eventos pelos dominios

Padrao recomendado:

- o dominio emite um evento interno pequeno
- o `WebhookEventPublisher` recebe esse evento
- o mapper traduz para evento publico
- o repositorio grava no outbox

Exemplos de pontos de integracao:

- `ai-ssh-actions`
  - ao criar, aprovar, finalizar ou falhar `ActionRun`
- `mcp`
  - ao revogar token MCP
  - ao fechar sessao interativa MCP
- `sessions`
  - ao iniciar ou encerrar sessao SSH
- `hosts`
  - ao criar, atualizar ou remover host

## Payload automatico e customizado

### Automatico

Sempre envia o envelope padrao do evento.

Vantagens:

- contrato simples
- melhor compatibilidade com `n8n`, `Zapier`, `Make`
- menor risco operacional

### Customizado

Entrar depois.

Modelo recomendado:

- `payloadTemplateJson`
- placeholders com lista branca
- validacao por `payloadSchemaJson`

Exemplo:

```json
{
  "event": "{{event.type}}",
  "resourceId": "{{resource.id}}",
  "status": "{{data.status}}"
}
```

Guardrails:

- sem script
- sem eval
- sem expressao arbitraria
- tamanho maximo de payload
- preview antes de salvar

## Assinatura

Headers recomendados:

- `X-NodeAccess-Event`
- `X-NodeAccess-Delivery`
- `X-NodeAccess-Timestamp`
- `X-NodeAccess-Signature`

Calculo:

```txt
signature = HMAC_SHA256(secret, timestamp + "." + deliveryId + "." + rawBody)
```

Formato:

```txt
sha256=<hex>
```

## Dispatcher

### Regras

- loop assíncrono com batch pequeno
- usar `SELECT ... FOR UPDATE SKIP LOCKED` ou equivalente seguro para evitar concorrencia dupla
- marcar `processing` antes do POST externo
- timeout curto
- truncar resposta armazenada
- reclassificar como `retry_scheduled` ou `dead`

### Backoff sugerido

Exemplo:

- tentativa 1: imediato
- tentativa 2: +30s
- tentativa 3: +2min
- tentativa 4: +10min
- tentativa 5: +1h

Depois:

- `dead`

### Status HTTP

Recomendacao:

- `2xx` = sucesso
- `408`, `429`, `5xx`, erro de rede = retry
- `4xx` fixo como `400`, `401`, `403`, `404`, `410`, `422` = falha terminal por padrao

## Endpoints admin sugeridos

### Subscriptions

- `GET /api/v1/webhooks/subscriptions`
- `POST /api/v1/webhooks/subscriptions`
- `GET /api/v1/webhooks/subscriptions/:id`
- `PATCH /api/v1/webhooks/subscriptions/:id`
- `POST /api/v1/webhooks/subscriptions/:id/pause`
- `POST /api/v1/webhooks/subscriptions/:id/activate`
- `POST /api/v1/webhooks/subscriptions/:id/rotate-secret`
- `DELETE /api/v1/webhooks/subscriptions/:id`

### Deliveries

- `GET /api/v1/webhooks/deliveries`
- `GET /api/v1/webhooks/deliveries/:id`
- `POST /api/v1/webhooks/deliveries/:id/retry`

### Teste

- `POST /api/v1/webhooks/subscriptions/:id/test`

## Regras de autorizacao

- somente admin do tenant pode criar, editar, pausar, ativar, testar ou remover subscription
- leitura de deliveries tambem deve ser admin-only no primeiro corte
- nenhuma operacao cross-tenant por padrao

## UI admin sugerida

### Lista de subscriptions

Colunas:

- nome
- status
- URL
- metodo
- eventos
- ultimo sucesso
- ultima falha
- criado por

### Formulario

Campos:

- nome
- URL
- metodo
- segredo
- timeout
- retries
- eventos
- payload mode
- payload customizado
- schema de validacao

### Estados obrigatorios

- loading
- vazio
- erro
- teste bem-sucedido
- teste falho com mensagem util
- subscription pausada

## Auditoria

Eventos minimos:

- subscription criada
- subscription editada
- subscription pausada
- subscription reativada
- subscription removida
- secret rotacionado
- teste disparado
- delivery marcada como `dead`

## Observabilidade

Metricas recomendadas:

- deliveries pendentes
- deliveries por status
- taxa de sucesso
- taxa de erro
- retries por minuto
- idade da fila
- latencia de entrega p50/p95

## Integracao com `n8n`, `Zapier` e similares

O NodeAccess nao precisa conhecer o integrador.

Para essas ferramentas, o que importa e:

- endpoint HTTPS generico
- JSON previsivel
- assinatura HMAC
- retries
- idempotencia

Isso cobre o caso de uso real:

1. NodeAccess emite evento
2. `n8n` ou `Zapier` recebe
3. o fluxo externo decide:
   - notificar
   - abrir ticket
   - chamar API do NodeAccess
   - chamar outra API
   - enriquecer dados

## Plano incremental

### Fase 1

- schema Prisma e migration
- repository + service + rotas admin de subscription
- outbox ou deliveries persistidas
- dispatcher simples no backend
- `POST` + payload automatico
- eventos `action_run.*`, `mcp_token.revoked`, `mcp_interactive_ssh_session.closed`
- tela admin minima

### Fase 2

- listagem detalhada de deliveries
- teste de subscription
- replay de delivery
- payload customizado validado
- preview e placeholders controlados

### Fase 3

- processo worker dedicado
- melhorias de locks e escala
- `PUT`
- presets de UX para integradores populares
- politicas por ambiente

## Riscos e trade-offs

- se o catalogo de eventos nascer grande demais, a operacao vira ruido
- se o payload nascer rico demais, o acoplamento cresce rapido
- se retry for mal calibrado, pode amplificar falha do cliente
- se o worker ficar dentro do processo API por muito tempo, escala horizontal fica mais sensivel

## Proximo passo recomendado

Implementar a Fase 1 primeiro:

1. schema Prisma
2. subscriptions admin-only
3. deliveries persistidas
4. dispatcher simples
5. eventos de alto valor
6. tela admin minima

Esse corte ja entrega valor real para `n8n`, `Zapier` e integracoes proprietarias sem comprometer o nucleo do NodeAccess.
