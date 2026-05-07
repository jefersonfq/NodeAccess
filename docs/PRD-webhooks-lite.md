# PRD Webhooks Lite

## Objetivo

Adicionar webhooks ao NodeAccess para integracoes server-to-server, mantendo baixo acoplamento com os modulos atuais, boa auditabilidade, entrega resiliente e flexibilidade para crescer por tenant e por dominio.

Objetivo complementar:

- servir como camada generica de integracao de saida para ferramentas como `n8n`, `Zapier`, `Make` e fluxos proprietarios do cliente, sem acoplamento do NodeAccess a um integrador especifico.

## Problema

Hoje o NodeAccess concentra bem:

- UI web
- API autenticada
- terminal SSH via browser
- trilhas de auditoria e operacao

Mas ainda depende demais de polling ou integracoes sob medida quando um sistema externo precisa reagir a eventos como:

- usuario criado, desativado ou revogado
- host criado, alterado ou removido
- sessao aberta ou encerrada
- token MCP revogado
- `ActionRun` criado, aprovado, falhado ou concluido
- sessao MCP shell encerrada por admin

Sem uma frente de webhooks, cada integracao tende a inventar seu proprio acoplamento.

Isso fica ainda mais relevante quando o cliente quer plugar NodeAccess em:

- `n8n`
- `Zapier`
- `Make`
- gateways internos
- funcoes serverless
- automacoes proprietarias

Nesses cenarios, o melhor papel do NodeAccess e emitir eventos confiaveis e previsiveis. A orquestracao, enriquecimento e roteamento adicional ficam no integrador externo.

## Decisao de arquitetura

Webhooks devem nascer como modulo proprio, assíncrono e orientado a eventos de dominio.

Diretriz principal:

- o dominio gera eventos internos;
- o modulo de webhooks decide se algum subscriber deve receber aquilo;
- a entrega HTTP acontece fora do fluxo principal da requisicao;
- falha de webhook nunca pode quebrar login, SSH, terminal, MCP, audit ou operacao principal.

## Principios

- baixo acoplamento entre dominio e entrega HTTP
- responsabilidade unica por modulo
- contratos de evento estaveis e versionados
- entrega assinada e auditavel
- retries controlados
- idempotencia prevista desde o inicio
- isolamento por tenant
- rollout com feature flag
- flexibilidade configuravel sem transformar webhook em codigo arbitrario
- interoperabilidade boa com plataformas de automacao generalistas

## O que nao fazer

- nao disparar `fetch`/`axios` para o endpoint externo dentro de service critico do dominio
- nao espalhar logica de assinatura, retry e serializacao em cada modulo
- nao acoplar payload de webhook a DTO interno de tela ou resposta HTTP existente
- nao depender de `admin_logs` como fila de entrega
- nao bloquear criacao de sessao, login ou `ActionRun` por indisponibilidade do receptor externo
- nao criar acoplamento prematuro com SDK, formato ou semantica especifica de `n8n`, `Zapier` ou outra ferramenta

## Modelo recomendado

### Camadas

1. `Domain Event`
- evento interno emitido por um modulo de dominio
- sem conhecimento de webhook, URL externa ou retry

2. `Webhook Event Mapper`
- traduz evento interno em evento publico de webhook
- define:
  - `eventType`
  - `eventVersion`
  - payload publico
  - chaves de idempotencia e correlacao

3. `Webhook Subscription`
- cadastro administrativo por tenant
- define quem recebe quais eventos e com que configuracao

4. `Webhook Delivery Queue`
- persistencia das entregas pendentes
- retries e proximas tentativas

5. `Webhook Dispatcher Worker`
- worker que busca entregas pendentes e envia HTTP
- atualiza status, erro, latencia e tentativas

6. `Webhook Audit/Observability`
- consulta operacional da assinatura, falhas, retries e DLQ

### Regra critica

O fluxo sincrono do produto deve terminar antes do POST externo ser tentado.

## Contrato de eventos

Formato base recomendado:

```json
{
  "id": "evt_01...",
  "type": "action_run.completed",
  "version": 1,
  "occurredAt": "2026-04-23T18:20:00.000Z",
  "tenantId": "tn_123",
  "environment": "prod",
  "correlationId": "req_...",
  "resource": {
    "type": "action_run",
    "id": "ar_123"
  },
  "data": {}
}
```

Diretrizes:

- `type` estavel e legivel
- `version` inteiro por evento publico
- `data` so com campos necessarios
- evitar segredo, token, password, PEM, cookie ou output sensivel completo
- incluir IDs e metadados suficientes para correlacao
- manter envelope simples para que integradores no-code/low-code consigam consumir sem adaptador complexo

## Eventos iniciais recomendados

Comecar pequeno. Primeira leva:

- `user.created`
- `user.deactivated`
- `host.created`
- `host.updated`
- `host.deleted`
- `session.started`
- `session.ended`
- `action_run.created`
- `action_run.approved`
- `action_run.completed`
- `action_run.failed`
- `mcp_token.revoked`
- `mcp_interactive_ssh_session.opened`
- `mcp_interactive_ssh_session.closed`

Evitar no MVP:

- streaming de output de terminal
- eventos muito frequentes de presenca
- eventos de buffer do shell interativo

Observacao de integracao:

- para `n8n`, `Zapier` e equivalentes, eventos de alto valor e baixa frequencia tendem a gerar melhor operacao e menor custo;
- evitar eventos granulares demais no primeiro corte.

## Assinaturas

Tabela sugerida: `webhook_subscriptions`

- `id`
- `tenantId`
- `name`
- `targetUrl`
- `httpMethod`
- `secretEncrypted`
- `status` (`active`, `paused`, `failed`)
- `subscribedEventsJson`
- `headersJson` opcional
- `payloadMode` (`automatic`, `custom`)
- `payloadTemplateJson` opcional
- `payloadSchemaJson` opcional
- `timeoutMs`
- `maxRetries`
- `createdByUserId`
- `lastTriggeredAt`
- `lastSuccessAt`
- `lastFailureAt`
- `createdAt`
- `updatedAt`

Regra:

- secret em repouso deve ficar cifrado
- URL deve ser validada e normalizada
- suportar pausa sem excluir configuracao
- `httpMethod` deve começar restrito a `POST` e `PUT`; `GET` so faz sentido como excecao controlada, porque reduz seguranca e rastreabilidade do payload

## Destino, metodo e conteudo

Faz sentido permitir personalizacao de:

- destino
- metodo HTTP
- conteudo do payload

Mas isso deve ser controlado.

### Destino

Cada subscription pode definir:

- `targetUrl` completa
- opcional futuro: presets por integracao, como `Slack`, `Teams`, `Jira`, `generic HTTPS`

Para integradores como `n8n` e `Zapier`, `generic HTTPS` deve ser suficiente no primeiro corte.

Diretriz:

- o MVP deve aceitar URL completa por subscription
- o backend valida protocolo, host, porta e formato
- em producao, preferir `https`
- presets especificos por integrador podem existir depois apenas para melhorar UX, nao como dependencia arquitetural

### Metodo HTTP

Recomendacao por fases:

- MVP: `POST`
- Fase seguinte: `POST` e `PUT`
- `GET` nao deve ser default para evento de saida

Motivo:

- webhook de evento normalmente envia body
- `GET` com query string tende a expor mais dados em logs intermediarios
- `POST`/`PUT` simplificam assinatura e validacao do payload

Se houver demanda real por `GET`:

- limitar a casos especificos
- restringir tamanho do payload
- serializar apenas campos seguros

### Conteudo do payload

Aqui vale ter dois modos.

#### Modo 1 - automatico

NodeAccess envia o envelope padrao do evento.

Uso indicado:

- integracao rapida
- menor risco de configuracao incorreta
- payload estavel e versionado pelo produto
- integradores como `n8n` e `Zapier`, que conseguem mapear JSON recebido com facilidade

#### Modo 2 - customizado

Admin define um payload derivado do evento.

Exemplo conceitual:

```json
{
  "event": "{{event.type}}",
  "hostId": "{{resource.id}}",
  "status": "{{data.status}}",
  "occurredAt": "{{occurredAt}}"
}
```

Regra importante:

- isso nao deve ser template arbitrario executavel
- deve ser apenas mapeamento controlado de campos permitidos do evento
- sem script, sem eval, sem transformacao dinamica livre

## Validacao de payload

Faz sentido exigir validador JSON.

Modelo recomendado:

- `payloadTemplateJson`: objeto com placeholders permitidos
- `payloadSchemaJson`: JSON Schema para validar o payload final

Fluxo:

1. evento publico e gerado
2. subscription escolhe `automatic` ou `custom`
3. se for `custom`, o mapper resolve placeholders permitidos
4. payload final passa pelo `payloadSchemaJson`
5. so depois a entrega entra na fila

Beneficios:

- reduz erro de configuracao
- permite previsibilidade no contrato
- evita que a UI salve webhook quebrado
- permite que o cliente adapte o payload ao formato esperado pelo fluxo do `n8n` ou `Zapier` sem pedir nova feature ao NodeAccess

Guardrails:

- tamanho maximo de payload
- profundidade maxima do JSON
- lista branca de placeholders
- bloquear campos sensiveis do envelope
- preview e validacao antes de salvar

## Placeholders recomendados

Em vez de expor o evento inteiro sem controle, usar campos conhecidos:

- `{{event.id}}`
- `{{event.type}}`
- `{{event.version}}`
- `{{occurredAt}}`
- `{{tenantId}}`
- `{{resource.type}}`
- `{{resource.id}}`
- `{{data.status}}`
- `{{data.summary}}`

Evolucao segura:

- cada tipo de evento pode expor sua lista de placeholders suportados
- a UI mostra apenas os campos validos para aquele evento

Nao recomendado:

- acesso livre a qualquer propriedade interna do backend
- expressao customizada
- JavaScript inline
- transformador arbitrario por usuario

## Entregas

Tabela sugerida: `webhook_deliveries`

- `id`
- `subscriptionId`
- `tenantId`
- `eventId`
- `eventType`
- `eventVersion`
- `payloadJson`
- `status` (`pending`, `processing`, `delivered`, `retry_scheduled`, `dead`)
- `attemptCount`
- `nextAttemptAt`
- `lastAttemptAt`
- `responseStatus`
- `responseBodySnippet`
- `responseLatencyMs`
- `lastErrorCode`
- `lastErrorMessage`
- `idempotencyKey`
- `createdAt`
- `updatedAt`

Observacao:

- `payloadJson` pode manter o snapshot do evento enviado
- `responseBodySnippet` deve ser truncado
- nao armazenar resposta inteira sem limite

## Seguranca

### Assinatura

Assinar toda entrega com HMAC SHA-256.

Headers recomendados:

- `X-NodeAccess-Event`
- `X-NodeAccess-Delivery`
- `X-NodeAccess-Timestamp`
- `X-NodeAccess-Signature`

Assinatura sobre:

- timestamp
- id da entrega
- body bruto

Exemplo conceitual:

```text
sha256=<hex>
```

### Regras

- timeout curto, por exemplo `3s` a `10s`
- somente `https` em producao, salvo excecao local controlada
- opcional futuro: allowlist de IP/CIDR de destino
- bloquear redirects por padrao ou limitar fortemente
- segredo rotacionavel

## Performance e resiliencia

### Padrao recomendado

Usar `outbox pattern` simplificado com banco + worker.

Fluxo:

1. modulo de dominio conclui sua operacao normal
2. grava evento publico ou entrega pendente em tabela propia, de preferencia na mesma transacao logica
3. worker independente coleta pendencias
4. envia webhook
5. atualiza status da entrega

### Por que isso atende melhor

- evita acoplamento temporal com o receptor externo
- facilita retry e DLQ
- melhora auditabilidade
- reduz risco de regressao em fluxos criticos

### Worker

Para o estado atual do NodeAccess, o corte mais simples e suficiente e:

- persistir no MySQL
- usar um worker no backend API ou processo dedicado
- opcionalmente usar Redis apenas para wake-up, lock curto ou rate coordination

Nao comecaria com broker pesado se o volume inicial for moderado.

## SOLID aplicado

### Single Responsibility

- modulo de dominio emite evento
- modulo de webhook decide assinatura e entrega
- worker entrega HTTP
- UI admin apenas gerencia subscriptions e consulta status

### Open/Closed

- novos eventos entram via mapper/registry
- nao precisa reescrever dispatcher para cada evento novo

### Liskov

- contratos de `DeliveryTransport`, `EventMapper` e `SubscriptionMatcher` devem ser substituiveis sem mudar consumidores

### Interface Segregation

- separar interfaces pequenas:
  - `DomainEventPublisher`
  - `WebhookSubscriptionRepository`
  - `WebhookDeliveryRepository`
  - `WebhookSigner`
  - `WebhookHttpClient`

### Dependency Inversion

- services de dominio dependem de um publisher abstrato
- dispatcher depende de abstrações de persistencia e transporte

## Desacoplamento recomendado no codigo

Estrutura provavel no backend:

- `apps/backend/src/modules/webhooks/`
  - `webhook.service.ts`
  - `webhook.controller.ts`
  - `webhook.routes.ts`
  - `webhook.repository.ts`
  - `webhook-dispatcher.service.ts`
  - `webhook-signer.service.ts`
  - `webhook-event-mapper.ts`
  - `webhook.types.ts`

Integracao com dominios:

- cada dominio publica evento interno ou chama um publisher fino
- o dominio nao conhece URL de subscriber

Exemplos:

- `sessions` publica `session.started` e `session.ended`
- `ai-ssh-actions` publica eventos de `ActionRun`
- `mcp` publica eventos de token e sessao interativa

## UI administrativa recomendada

Area nova em `Administracao`:

- listar subscriptions
- criar subscription
- pausar/reativar
- testar entrega
- ver ultimos eventos e falhas
- reenfileirar entrega morta quando fizer sentido

Campos iniciais:

- nome
- URL
- eventos assinados
- timeout
- segredo
- status

Ergonomia recomendada:

- opcao `Payload automatico`
- opcao `Payload customizado`
- preview do payload final por evento
- teste de envio
- exemplos rapidos para `n8n` e `Zapier` usando endpoint HTTPS generico

Estados obrigatorios:

- loading
- vazio
- erro de conexao
- sucesso
- subscription pausada
- entrega falha com ultimo erro visivel

## Auditoria e observabilidade

Minimo necessario:

- log administrativo ao criar, editar, pausar, reativar e remover subscription
- log de entrega falha critica
- metricas:
  - entregas pendentes
  - entregas por status
  - latencia de entrega
  - taxa de falha
  - retries
  - idade da fila

Tambem faz sentido:

- endpoint admin para listar entregas por subscription
- filtro por `eventType`, status e periodo

## Rollout recomendado

### Fase 1

Infra minima:

- subscriptions por tenant
- deliveries persistidas
- worker simples
- assinatura HMAC
- retries com backoff
- UI admin minima

Eventos:

- `action_run.*`
- `mcp_token.revoked`
- `mcp_interactive_ssh_session.closed`

Compatibilidade desejada:

- envio simples para endpoints genericos de `n8n`, `Zapier`, `Make` ou endpoint proprietario;
- sem necessidade de adaptador dedicado no NodeAccess.

### Fase 2

Expandir eventos:

- `session.started`
- `session.ended`
- `host.*`
- `user.deactivated`

Melhorias:

- teste de webhook pela UI
- replay controlado
- filtros operacionais melhores
- payload customizado validado por schema
- presets de UX para integradores populares, se isso reduzir erro operacional

### Fase 3

Endurecimento e escala:

- rate limiting por subscription
- secrets rotacionaveis com janela de transicao
- processo worker dedicado
- DLQ explicita
- politicas por ambiente

## Decisoes importantes

### Payload enxuto

Webhook deve avisar o fato, nao substituir a API inteira.

Padrao recomendado:

- enviar dados minimos para automacao reagir
- se precisar de detalhe extra, o sistema externo consulta a API do NodeAccess com credencial propria

Isso encaixa melhor com `n8n` e `Zapier`:

- o webhook dispara a automacao;
- o fluxo externo decide se enriquece os dados depois;
- o NodeAccess permanece simples e desacoplado.

### Idempotencia

Entrega pode repetir.

O consumidor deve poder deduplicar por:

- `eventId`
- `deliveryId`
- `type`
- `resource.id`

### Automatico vs customizado

Os dois fazem sentido.

Mas eu colocaria como regra:

- default sempre `automatic`
- `custom` apenas como mapeamento estruturado e validado
- sem logica executavel por usuario

Isso preserva flexibilidade sem quebrar manutencao, seguranca e performance.

### Ordem

Nao prometer ordem global.

No maximo:

- ordem aproximada por subscription e recurso
- ainda assim com tolerancia a retry e reenvio

## Riscos e trade-offs

- webhook demais vira ruido operacional se o catalogo nascer grande demais
- entrega sincrona degrada UX e estabilidade
- payload excessivo aumenta custo, risco de dados sensiveis e acoplamento
- retries sem DLQ clara escondem problema operacional
- event naming ruim envelhece mal e quebra integracoes

## Recomendacao objetiva

Vale abrir a frente de webhooks.

Mas eu subiria assim:

1. modulo proprio de `webhooks`
2. outbox persistente
3. worker assíncrono
4. poucos eventos de alto valor
5. assinatura HMAC e auditoria desde o primeiro corte
6. payload enxuto e versionado
7. modo `automatic` no MVP e `custom` validado na fase seguinte

Esse caminho respeita nao acoplamento, SOLID, performance e flexibilidade sem forcar uma infraestrutura maior do que o NodeAccess precisa no primeiro momento.

Para o objetivo de integrar com `n8n`, `Zapier` e similares, essa abordagem e a correta:

- NodeAccess fica como emissor confiavel de eventos;
- o integrador externo cuida de orquestracao, enriquecimento, branching e conectores;
- se no futuro fizer sentido, presets de UX podem ser adicionados sem mudar o nucleo arquitetural.
