# PRD Inbound Webhooks Lite

## Objetivo
Criar uma base futura para o NodeAccess receber eventos enviados por plataformas externas, sem misturar esse fluxo com os webhooks de saida ja existentes.

O objetivo e permitir que sistemas como monitoramento, CMDB, ITSM, pipelines, ferramentas de aprovacao ou automacoes internas enviem eventos para o NodeAccess de forma segura, auditavel e desacoplada.

Exemplos:
- monitoramento informa que um host esta indisponivel
- CMDB atualiza criticidade, owner ou metadados de um host
- sistema externo aprova ou recusa acesso JIT
- ITSM informa abertura, fechamento ou mudanca de severidade de incidente
- ferramenta de inventario sinaliza host novo ou desativado
- automacao interna solicita criacao de aviso operacional em um host

## Decisao principal
Inbound webhooks devem ser um modulo separado dos webhooks atuais.

Separacao conceitual:
- `Outbound Webhooks`: NodeAccess envia eventos para plataformas externas
- `Inbound Webhooks`: plataformas externas enviam eventos para o NodeAccess

Motivo:
- o fluxo de seguranca e diferente
- o ciclo de vida e diferente
- outbound foca em entrega, retry e assinatura do NodeAccess
- inbound foca em autenticacao do emissor, validacao, idempotencia, normalizacao e processamento interno
- misturar os dois no mesmo service tende a violar responsabilidade unica e aumentar acoplamento

## Problema
O NodeAccess ja consegue emitir eventos para sistemas externos, mas ainda nao possui uma porta governada para receber eventos externos.

Sem inbound webhooks, integracoes tendem a depender de:
- operacao manual
- polling de API
- scripts com credenciais amplas
- automacoes acopladas a detalhes internos
- atualizacoes feitas fora do fluxo auditavel do NodeAccess

Isso reduz a capacidade do NodeAccess de atuar como centro operacional do host e da rotina de acesso.

## Resultado esperado
O NodeAccess deve conseguir receber um evento externo, validar sua origem, registrar o recebimento, normalizar o payload e acionar um caso de uso interno de forma segura.

O fluxo desejado:

```txt
Plataforma externa
  -> Inbound Webhook Endpoint
  -> autenticacao/assinatura
  -> idempotencia
  -> registro do recebimento
  -> normalizacao
  -> fila/processamento assíncrono
  -> caso de uso interno
  -> auditoria e status
```

## Principios
- modulo proprio e desacoplado
- responsabilidade unica por camada
- validacao antes de processamento
- idempotencia obrigatoria
- processamento assíncrono para nao depender do tempo do provedor
- isolamento por tenant
- assinatura ou token tecnico por integracao
- payload bruto armazenado com cuidado e retencao definida
- dados sensiveis mascarados em logs
- acoes internas sempre passam por use cases existentes ou portas explicitas
- nenhuma acao critica deve ser executada apenas por payload nao confiavel
- cada provider deve ter adapter/mapper proprio quando necessario

## Casos de uso iniciais recomendados
### 1. Aviso operacional por host
Uma ferramenta externa informa que um host esta indisponivel, em manutencao ou degradado.

Resultado interno:
- criar uma notificacao temporaria do host
- exibir badge/lista/aviso no ciclo do host
- registrar origem externa
- permitir reconhecimento e resolucao pelo NodeAccess

Relacionamento:
- conecta diretamente com `docs/PRD-host-notifications-knowledge-lite.md`

### 2. Atualizacao de metadados por CMDB
Uma CMDB envia mudanca de owner, criticidade, ambiente ou tag operacional.

Resultado interno possivel:
- registrar evento recebido
- sugerir atualizacao para admin
- aplicar mudanca se a politica permitir
- logar quem/provedor originou a mudanca

Recomendacao:
- primeiro corte deve ser `review required`, sem aplicacao automatica ampla

### 3. Aprovacao externa de JIT
Um sistema externo decide se um pedido de acesso temporario pode ser aprovado.

Resultado interno possivel:
- anexar decisao ao pedido JIT
- aprovar/rejeitar se houver correlacao valida
- registrar evidencias da decisao

Recomendacao:
- exige desenho especifico de seguranca antes de automatizar

### 4. Evento de incidente ou ticket
ITSM envia que incidente foi aberto, atualizado ou resolvido.

Resultado interno:
- criar/atualizar contexto operacional do host
- vincular ticket a host
- alimentar timeline

## Fora do escopo do MVP
- executar comandos SSH diretamente a partir de inbound webhook
- permitir payload externo criar usuario admin
- aplicar mudanca sensivel sem politica explicita
- aceitar provider generico sem assinatura ou token
- transformar inbound webhook em API publica sem governanca
- processar payload pesado de forma sincrona
- criar linguagem de regras complexa no primeiro corte
- substituir APIs autenticadas por webhook generico

## Arquitetura recomendada
Modulo:

```txt
apps/backend/src/modules/inbound-webhooks/
```

Camadas sugeridas:

```txt
inbound-webhook.routes.ts
inbound-webhook.controller.ts
inbound-webhook.service.ts
inbound-webhook.repository.ts
inbound-webhook-signature.service.ts
inbound-webhook-idempotency.service.ts
inbound-webhook-normalizer.ts
inbound-webhook-worker.service.ts
inbound-webhook.types.ts
```

Responsabilidades:
- `routes`: endpoint publico de recepcao e endpoints admin de consulta/configuracao
- `controller`: traduz HTTP para comandos de aplicacao
- `service`: orquestra validacao, registro e enfileiramento
- `repository`: persistencia de providers, recebimentos e status
- `signature service`: valida HMAC/token/provider-specific signature
- `idempotency service`: bloqueia evento duplicado
- `normalizer`: converte payload externo para evento interno canonico
- `worker`: processa evento recebido de forma assíncrona

## Endpoint sugerido
Nao expor tenantId simples como unica protecao.

Opcoes:

```txt
POST /api/v1/inbound-webhooks/:integrationKey
```

ou:

```txt
POST /api/v1/inbound-webhooks/:provider/:endpointToken
```

Recomendacao inicial:
- usar `endpointToken` opaco e rotacionavel
- associar token a tenant, provider, status e segredo de validacao
- permitir desativar endpoint sem remover historico

## Modelo de dados sugerido
### InboundWebhookEndpoint
- `id`
- `tenantId`
- `provider`
- `name`
- `description`
- `endpointTokenHash`
- `secretEncrypted`
- `secretIv`
- `status` (`ACTIVE`, `PAUSED`, `REVOKED`)
- `allowedEventTypesJson`
- `mappingMode` (`GENERIC`, `PROVIDER_ADAPTER`)
- `createdByUserId`
- `updatedByUserId`
- `lastReceivedAt`
- `lastAcceptedAt`
- `lastRejectedAt`
- `createdAt`
- `updatedAt`

### InboundWebhookReceipt
- `id`
- `tenantId`
- `endpointId`
- `provider`
- `externalEventId`
- `eventType`
- `idempotencyKey`
- `status` (`RECEIVED`, `ACCEPTED`, `REJECTED`, `PROCESSING`, `PROCESSED`, `FAILED`, `IGNORED`)
- `receivedAt`
- `processedAt`
- `sourceIp`
- `signatureValid`
- `payloadHash`
- `payloadJson`
- `normalizedEventJson`
- `errorCode`
- `errorMessage`
- `correlationId`
- `createdAt`
- `updatedAt`

Indices recomendados:
- `(tenant_id, endpoint_id, received_at)`
- `(tenant_id, status, received_at)`
- `(endpoint_id, idempotency_key)` unico quando idempotencyKey existir
- `(tenant_id, provider, external_event_id)` quando provider fornecer ID

## Contrato canonico interno
Payload recebido deve ser normalizado antes de acionar modulo interno.

Formato sugerido:

```json
{
  "id": "in_evt_01...",
  "provider": "monitoring",
  "type": "host.unavailable",
  "occurredAt": "2026-06-12T12:00:00.000Z",
  "tenantId": 1,
  "correlationId": "external-123",
  "resource": {
    "type": "host",
    "externalId": "srv-01",
    "nodeAccessId": 123
  },
  "data": {
    "severity": "critical",
    "message": "Host sem resposta no monitoramento"
  }
}
```

## Validacao e seguranca
Obrigatorio:
- limite de tamanho do body
- content-type permitido
- validacao de assinatura ou token
- idempotency key
- rate limit por endpoint
- status ativo/pausado/revogado
- tenant resolvido pelo endpoint, nao pelo payload
- logs sem segredo
- mascaramento de campos sensiveis

Recomendado:
- aceitar apenas HTTPS na configuracao de callbacks futuros
- permitir allowlist de IP por endpoint em fase posterior
- rotacao de segredo
- replay controlado para receipts falhos
- retencao configuravel do payload bruto

## UX administrativa
Na tela de Webhooks, manter explicacao clara:
- outbound: disponivel
- inbound: planejado

Quando inbound for implementado, a UI deve separar:
- `Outbound Webhooks`
- `Inbound Webhook Endpoints`
- `Recebimentos`
- `Falhas`
- `Mapeamentos`

Primeiro corte visual:
- painel recolhivel explicando inbound/outbound
- inbound marcado como planejado
- sem botao de criar inbound enquanto backend nao existir

## MVP recomendado
Implementar em cortes:

### Fase 0 - UX e documentacao
- painel explicativo inbound/outbound
- PRD inbound separado
- documentar diferenca entre enviar e receber webhooks

### Fase 1 - Fundacao backend
- tabela de endpoints inbound
- tabela de receipts
- endpoint receptor com token opaco
- validacao HMAC generica
- idempotencia
- registro do payload recebido
- status e consulta admin

### Fase 2 - Primeiro caso de uso
- provider generico `monitoring`
- evento `host.unavailable`
- criar notificacao temporaria no host
- registrar origem externa na timeline

### Fase 3 - Providers e acoes controladas
- adapters para CMDB/ITSM quando houver necessidade real
- aprovacao externa de JIT com correlacao forte
- politicas por endpoint e tipo de evento

## Criterios de aceite
- outbound continua funcionando sem mudancas de contrato
- inbound nao reutiliza service de entrega outbound
- endpoint inbound rejeita assinatura invalida
- evento duplicado nao processa duas vezes
- payload recebido fica rastreavel
- erro de processamento nao derruba API principal
- processamento interno e assíncrono
- tenant e endpoint sao resolvidos de forma segura
- logs administrativos indicam endpoint, provider, status e erro sem expor segredo

## Riscos
- inbound generico demais pode virar API insegura
- acao automatica em host pode gerar impacto operacional se nao houver politica
- payload bruto pode conter dado sensivel
- providers diferentes possuem assinaturas e semanticas distintas
- deduplicacao mal desenhada pode gerar eventos duplicados

Mitigacao:
- iniciar por recebimento e registro
- exigir assinatura/token
- processar primeiro caso de uso pequeno
- aplicar politica explicita para qualquer acao interna
- manter adapters por provider separados do core
