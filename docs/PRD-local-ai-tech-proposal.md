# PRD Local AI Tech Proposal

## Objetivo

Traduzir o [PRD-local-ai-lite.md](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/docs/PRD-local-ai-lite.md) em um plano tecnico inicial, incremental e de baixo acoplamento para introduzir IA local no NodeAccess.

O foco deste documento e:

- desacoplamento
- ativacao controlada por modulo
- aderencia ao padrao atual da ferramenta
- baixo risco sobre terminal, auth e fluxos criticos

## Principios tecnicos

- IA local deve ser modulo proprio
- nenhuma tela existente deve depender da IA para carregar
- o terminal nao deve ser ponto de acoplamento inicial
- o backend deve expor capacidades de IA por ferramentas internas controladas
- `provider`, `orquestracao`, `knowledge` e `policy` devem nascer separados
- o desenho deve permitir provider local, provider de rede ou ambos, com politica explicita de coexistencia
- execucao remota em host nao entra no primeiro corte
- tudo deve respeitar:
  - tenant
  - RBAC atual
  - licensing
  - auditoria

## Meta do primeiro corte

Entregar um `Assistente local` de leitura, capaz de:

- responder perguntas sobre a plataforma
- consultar contexto do tenant
- localizar hosts, sessoes e auditorias
- usar base de conhecimento local do tenant
- citar fontes quando usar documentos indexados

Sem:

- abrir SSH automaticamente
- executar comandos no host
- escrever em arquivos
- depender do terminal

## Arquitetura recomendada

### Backend

Criar modulo dedicado:

- `apps/backend/src/modules/local-ai/*`

Estrutura sugerida:

- `local-ai.routes.ts`
- `local-ai.controller.ts`
- `local-ai.service.ts`
- `local-ai.repository.ts`
- `local-ai-provider.ts`
- `providers/ollama.provider.ts`
- `local-ai-policy.service.ts`
- `local-ai-tools.service.ts`
- `local-ai-knowledge.service.ts`
- `local-ai-ingestion.service.ts`
- `local-ai-audit.service.ts`

### Responsabilidades

#### `local-ai.service.ts`

Orquestra a pergunta:

- valida tenant/licenca/configuracao
- resolve contexto do usuario
- monta toolset permitido
- chama provider
- persiste auditoria minima

#### `local-ai-provider.ts`

Interface unica para modelos locais.

Exemplo:

```ts
export interface LocalAiProvider {
  healthcheck(): Promise<{ ok: boolean; model?: string; details?: string }>
  chat(input: LocalAiChatInput): Promise<LocalAiChatOutput>
  embed?(input: LocalAiEmbedInput): Promise<LocalAiEmbedOutput>
}
```

#### `providers/ollama.provider.ts`

Primeira implementacao concreta.

Responsavel por:

- chamar Ollama
- mapear erros
- padronizar resposta

#### `local-ai-tools.service.ts`

Expõe apenas ferramentas internas seguras de leitura.

Exemplos do MVP:

- `searchHosts`
- `getHostById`
- `listRecentSessions`
- `getSessionAuditSummary`
- `getTenantFeatures`
- `searchKnowledgeBase`

Importante:

- a IA nao acessa banco livremente
- o provider nao chama repositorios direto
- todas as consultas passam por tools internas

#### `local-ai-policy.service.ts`

Decide o que pode ou nao pode ser usado.

No MVP:

- modo `read_only`
- tools apenas de leitura
- sem remote execution

No futuro:

- `low_impact`
- `full_control`

#### `local-ai-knowledge.service.ts`

Busca semantica e citacoes.

Separado da conversa para evitar acoplamento com provider ou com tools operacionais.

#### `local-ai-ingestion.service.ts`

Cuida de:

- upload
- parsing
- chunking
- indexacao

Nao deve estar dentro do fluxo de resposta do chat.

#### `local-ai-audit.service.ts`

Registra:

- pergunta
- usuario
- tenant
- provider/modelo
- tools usadas
- artefatos consultados
- status

## Frontend recomendado

### Entry point

Criar uma rota ou drawer proprio:

- `Assistente local`

Arquivos sugeridos:

- `apps/frontend/src/views/LocalAiView.vue`
- `apps/frontend/src/services/local-ai.service.ts`
- `apps/frontend/src/services/local-ai-knowledge.service.ts`

### Regras

- UI nao deve ser carregada em bootstrap global obrigatorio
- o menu so aparece quando:
  - feature tecnica habilitada
  - licenca permitir
  - tenant tiver provider configurado

### UX do MVP

- campo de pergunta
- resposta textual
- lista de fontes/citacoes
- indicador das tools usadas
- aviso claro de que o assistente esta em modo leitura

## Gate de ativacao

O modulo deve obedecer tres camadas:

### 1. Feature tecnica

Exemplo:

- `FEATURE_LOCAL_AI=true`

Serve como kill switch da instalacao.

### 2. Entitlement da licenca

Sugestao:

- `localAi`

No futuro, pode existir complemento para:

- `localAiKnowledge`
- `localAiActions`

### 3. Configuracao do tenant

O tenant deve poder configurar:

- provider
- URL/base do provider local
- modelo padrao
- timeout
- modo permitido

Se qualquer camada falhar:

- o menu nao aparece
- a API retorna indisponibilidade controlada

## Modelo de dados sugerido

### Configuracao da integracao

Opcao mais simples:

- reaproveitar tabela/fluxo de `integrations`

Provider sugerido:

- `LOCAL_AI`

Campos esperados:

- `provider = LOCAL_AI`
- `enabled`
- `configJson`

Exemplo de `configJson`:

```json
{
  "baseUrl": "http://ollama:11434",
  "model": "qwen2.5-coder",
  "mode": "read_only",
  "routingPolicy": "prefer_local",
  "timeoutMs": 30000
}
```

Se o tenant quiser usar IA em rede tambem, o `configJson` deve suportar:

```json
{
  "mode": "read_only",
  "routingPolicy": "prefer_local",
  "local": {
    "provider": "ollama",
    "baseUrl": "http://ollama:11434",
    "model": "qwen2.5-coder"
  },
  "network": {
    "provider": "openai_compatible",
    "baseUrl": "https://proxy-ia.interno/v1",
    "model": "gpt-5-mini"
  }
}
```

### Auditoria de uso

Tabela sugerida:

- `local_ai_interactions`

Campos:

- `id`
- `tenantId`
- `userId`
- `provider`
- `model`
- `mode`
- `question`
- `responseSummary`
- `toolsUsedJson`
- `sourcesJson`
- `status`
- `createdAt`

### Knowledge base

Tabelas sugeridas:

- `local_ai_documents`
- `local_ai_document_chunks`

Campos minimos de documento:

- `id`
- `tenantId`
- `scope`
- `title`
- `sourceType`
- `sourceRef`
- `mimeType`
- `status`
- `createdByUserId`
- `createdAt`

Campos minimos de chunk:

- `id`
- `documentId`
- `chunkIndex`
- `contentText`
- `embeddingRef` ou `embeddingJson`

Observacao:

- se embeddings ficarem fora do MySQL, manter `embeddingRef`
- se o primeiro corte for keyword/basic semantic search, pode nascer sem embedding persistido

## Contratos compartilhados

Sugestao de novo schema compartilhado:

- `packages/shared/src/schemas/local-ai.schema.ts`

Tipos iniciais:

- `LocalAiModeSchema`
- `LocalAiProviderSchema`
- `LocalAiAvailabilitySchema`
- `LocalAiChatRequestSchema`
- `LocalAiChatResponseSchema`
- `LocalAiCitationSchema`
- `LocalAiToolCallSchema`

Exemplo conceitual:

```ts
export const LocalAiModeSchema = z.enum([
  'read_only',
  'low_impact',
  'full_control',
])

export const LocalAiChatRequestSchema = z.object({
  message: z.string().min(3).max(4000),
  context: z.object({
    route: z.string().optional(),
    hostId: z.number().optional(),
    sessionAuditId: z.number().optional(),
  }).optional(),
})

export const LocalAiCitationSchema = z.object({
  kind: z.enum(['document', 'audit', 'host', 'session', 'settings']),
  label: z.string(),
  referenceId: z.string().optional(),
  excerpt: z.string().optional(),
})
```

## Rotas sugeridas

### Admin

- `GET /api/v1/local-ai/admin/status`
- `POST /api/v1/local-ai/admin/test`
- `POST /api/v1/local-ai/admin/documents`
- `GET /api/v1/local-ai/admin/documents`

### Usuario

- `GET /api/v1/local-ai/status`
- `POST /api/v1/local-ai/chat`

## Ferramentas internas recomendadas

No MVP, expor apenas tools de leitura de alto valor:

### Hosts

- `searchHosts(query, scope?)`
- `getHost(hostId)`

### Sessoes

- `listRecentSessions(limit?)`
- `getSessionSummary(sessionId)`

### Auditoria

- `getSessionAuditSummary(sessionAuditId)`
- `searchSessionAudits(query, limit?)`

### Tenant e features

- `getTenantFeatures()`
- `getTenantSettingsSummary()`

### Knowledge base

- `searchKnowledgeBase(query, limit?)`

## Guardrails do MVP

- modo unico: `read_only`
- tools apenas de leitura
- sem terminal
- sem SSH
- sem escrita em banco por acao da IA
- sem leitura de secrets em claro
- sem bypass de ACL de tenant/grupo/usuario

## Fluxo recomendado do request

1. usuario envia pergunta
2. backend valida:
   - JWT
   - tenant
   - licenca
   - configuracao `LOCAL_AI`
3. `local-ai-policy.service` resolve tools permitidas
4. `local-ai.service` monta contexto minimo
5. provider recebe:
   - system prompt
   - contexto resumido
   - tool definitions
6. provider responde com:
   - resposta direta
   - ou pedido de tool call
7. tools internas executam leitura controlada
8. resposta final e devolvida com citacoes
9. `local-ai-audit.service` registra a interacao

## Plano tecnico inicial

### Fase 1

- entitlement `localAi`
- provider `LOCAL_AI` em integracoes
- `LocalAiProvider` + `OllamaProvider`
- rotas de status/test
- rota `chat`
- tools internas de leitura:
  - hosts
  - sessoes
  - auditoria resumida
  - features do tenant
- UI dedicada simples

Resultado:

- assistente global da plataforma
- sem knowledge base ainda
- sem execucao remota

### Fase 2

- `local_ai_documents`
- upload/admin de documentos
- ingestao e chunking
- busca semantica ou keyword-first
- citacoes no frontend

Resultado:

- admin alimenta conhecimento local
- assistente responde com base em arquivos, links e referencias do tenant

### Fase 3

- `low_impact`
- sessao tecnica isolada para IA
- allowlist de comandos
- auditoria por comando

Resultado:

- diagnostico tecnico controlado

### Fase 4

- governanca de aprovacoes
- acoes mais sensiveis
- politicas por tenant

Resultado:

- maturidade operacional sem comprometer o MVP inicial

## Riscos e mitigacoes

### Risco: acoplamento no terminal

Mitigacao:

- manter entrypoint proprio
- nenhuma dependencia do xterm no MVP

### Risco: provider vazar para o resto do backend

Mitigacao:

- interface `LocalAiProvider`
- resto do sistema depende da interface, nao do Ollama

### Risco: acesso amplo demais a dados internos

Mitigacao:

- tools internas estritas
- policy service
- sem query livre

### Risco: latencia alta ou indisponibilidade do provider

Mitigacao:

- healthcheck admin
- timeout configuravel
- resposta clara de indisponibilidade

### Risco: virar dependencia obrigatoria da UX

Mitigacao:

- menu e rotas opcionais
- nenhum carregamento global obrigatorio

## Recomendacao de implementacao

Comecar pelo menor corte util:

1. `LOCAL_AI` como integracao opcional
2. entitlement `localAi`
3. provider interface + `OllamaProvider`
4. chat read-only
5. tools internas de leitura
6. UI dedicada

Nao começar por:

- agente autônomo
- execucao remota
- knowledge base complexa
- embeddings distribuidos

## Arquivos provaveis no primeiro corte

### Backend

- `apps/backend/src/modules/local-ai/local-ai.routes.ts`
- `apps/backend/src/modules/local-ai/local-ai.controller.ts`
- `apps/backend/src/modules/local-ai/local-ai.service.ts`
- `apps/backend/src/modules/local-ai/local-ai-policy.service.ts`
- `apps/backend/src/modules/local-ai/local-ai-tools.service.ts`
- `apps/backend/src/modules/local-ai/local-ai-audit.service.ts`
- `apps/backend/src/modules/local-ai/providers/ollama.provider.ts`

### Frontend

- `apps/frontend/src/views/LocalAiView.vue`
- `apps/frontend/src/services/local-ai.service.ts`
- menu opcional no layout

### Shared

- `packages/shared/src/schemas/local-ai.schema.ts`
