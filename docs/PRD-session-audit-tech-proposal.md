# Session Audit Tech Proposal

## Objetivo
Definir uma proposta técnica inicial para implementar auditoria de sessão SSH no NodeAccess com o menor risco de regressão no gateway e o menor custo operacional possível.

Base relacionada:
- [docs/PRD-session-audit-lite.md](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/docs/PRD-session-audit-lite.md)
- [docs/PRD-session-audit-architecture.md](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/docs/PRD-session-audit-architecture.md)

## Ponto de entrada atual
O melhor ponto de hook hoje é [ssh.gateway.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/backend/src/modules/ssh/ssh.gateway.ts), porque ali já existem:
- autenticação e autorização do usuário
- abertura da sessão via [ssh.repository.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/backend/src/modules/ssh/ssh.repository.ts)
- ciclo de vida de `sessionId`
- tráfego de `stdin` e `stdout`
- fechamento da sessão

## Recomendação de implementação
### Fase técnica 1
- adicionar um `SessionAuditPublisher` no backend
- publicar eventos do gateway para uma fila simples
- criar um `SessionAuditWorker`
- persistir metadados no MySQL
- persistir chunks em storage local

### Fase técnica 2
- adicionar consulta administrativa
- adicionar download da sessão bruta
- adicionar resumo pós-sessão

## Schema Prisma inicial
Sugestão para [schema.prisma](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/backend/prisma/schema.prisma):

```prisma
model SessionAudit {
  id              Int      @id @default(autoincrement())
  sessionId       Int      @unique @map("session_id")
  tenantId        Int      @map("tenant_id")
  userId          Int      @map("user_id")
  hostId          Int      @map("host_id")
  hostNameSnapshot String  @map("host_name_snapshot")
  hostIpSnapshot   String  @map("host_ip_snapshot")
  connectionMethod String  @map("connection_method")
  ticketProvider   String? @map("ticket_provider")
  ticketKey        String? @map("ticket_key")
  ticketUrl        String? @map("ticket_url") @db.Text
  startedAt        DateTime @map("started_at")
  endedAt          DateTime? @map("ended_at")
  status           SessionAuditStatus @default(RUNNING)
  auditEnabled     Boolean @default(true) @map("audit_enabled")
  storageDriver    String  @default("local") @map("storage_driver")
  chunkCount       Int     @default(0) @map("chunk_count")
  bytesIn          BigInt  @default(0) @map("bytes_in")
  bytesOut         BigInt  @default(0) @map("bytes_out")
  aiSummaryStatus  AiArtifactStatus @default(PENDING) @map("ai_summary_status")
  aiSummaryText    String? @map("ai_summary_text") @db.LongText
  aiRiskLevel      String? @map("ai_risk_level")
  createdAt        DateTime @default(now()) @map("created_at")
  updatedAt        DateTime @updatedAt @map("updated_at")

  session Session @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  user    User    @relation(fields: [userId], references: [id])
  host    Host    @relation(fields: [hostId], references: [id])
  chunks   SessionAuditChunk[]
  commands SessionAuditDerivedCommand[]
  guardrails SessionAuditGuardrailEvent[]
  aiArtifacts SessionAuditAiArtifact[]

  @@index([tenantId, startedAt])
  @@index([userId, startedAt])
  @@index([hostId, startedAt])
  @@index([ticketKey])
  @@map("session_audits")
}

model SessionAuditChunk {
  id              Int      @id @default(autoincrement())
  sessionAuditId  Int      @map("session_audit_id")
  seq             Int
  startedAt       DateTime @map("started_at")
  endedAt         DateTime @map("ended_at")
  eventCount      Int      @default(0) @map("event_count")
  storageKey      String   @map("storage_key") @db.Text
  compression     String   @default("gzip")
  compressedSize  BigInt   @default(0) @map("compressed_size")
  rawSize         BigInt   @default(0) @map("raw_size")
  createdAt       DateTime @default(now()) @map("created_at")

  sessionAudit SessionAudit @relation(fields: [sessionAuditId], references: [id], onDelete: Cascade)

  @@unique([sessionAuditId, seq])
  @@map("session_audit_chunks")
}

model SessionAuditDerivedCommand {
  id                Int      @id @default(autoincrement())
  sessionAuditId    Int      @map("session_audit_id")
  seq               Int
  timestamp         DateTime
  commandText       String   @map("command_text") @db.LongText
  normalizedCommand String?  @map("normalized_command") @db.Text
  confidence        Decimal? @db.Decimal(5, 4)
  source            String
  riskLevel         String?  @map("risk_level")
  createdAt         DateTime @default(now()) @map("created_at")

  sessionAudit SessionAudit @relation(fields: [sessionAuditId], references: [id], onDelete: Cascade)

  @@index([sessionAuditId, timestamp])
  @@map("session_audit_commands")
}

model SessionAuditGuardrailEvent {
  id              Int      @id @default(autoincrement())
  sessionAuditId  Int      @map("session_audit_id")
  timestamp       DateTime
  ruleId          String   @map("rule_id")
  decision        String
  rawInput        String   @map("raw_input") @db.LongText
  normalizedInput String?  @map("normalized_input") @db.Text
  confidence      Decimal? @db.Decimal(5, 4)
  reason          String?  @db.Text
  createdAt       DateTime @default(now()) @map("created_at")

  sessionAudit SessionAudit @relation(fields: [sessionAuditId], references: [id], onDelete: Cascade)

  @@index([sessionAuditId, timestamp])
  @@map("session_audit_guardrails")
}

model SessionAuditAiArtifact {
  id             Int      @id @default(autoincrement())
  sessionAuditId Int      @map("session_audit_id")
  kind           String
  model          String?
  status         AiArtifactStatus @default(PENDING)
  storageKey     String?  @map("storage_key") @db.Text
  metadataJson   String?  @map("metadata_json") @db.LongText
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  sessionAudit SessionAudit @relation(fields: [sessionAuditId], references: [id], onDelete: Cascade)

  @@index([sessionAuditId, kind])
  @@map("session_audit_ai_artifacts")
}

enum SessionAuditStatus {
  RUNNING
  COMPLETED
  FAILED
  PURGED
}

enum AiArtifactStatus {
  PENDING
  PROCESSING
  READY
  FAILED
}
```

## Ajustes de relação no schema atual
Sugestões adicionais:

```prisma
model Session {
  id        Int       @id @default(autoincrement())
  userId    Int       @map("user_id")
  hostId    Int       @map("host_id")
  startedAt DateTime  @default(now()) @map("started_at")
  endedAt   DateTime? @map("ended_at")
  active    Boolean   @default(true)

  user  User @relation(fields: [userId], references: [id])
  host  Host @relation(fields: [hostId], references: [id])
  audit SessionAudit?

  @@map("sessions")
}
```

```prisma
model User {
  // ...
  sessionAudits SessionAudit[]
}

model Host {
  // ...
  sessionAudits SessionAudit[]
}
```

## Contratos compartilhados
Sugestão de novo arquivo:
- [packages/shared/src/schemas/session-audit.schema.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/packages/shared/src/schemas/session-audit.schema.ts)

### Tipos mínimos
```ts
import { z } from 'zod'

export const SessionAuditStatusSchema = z.enum([
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'PURGED',
])

export const AiArtifactStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'READY',
  'FAILED',
])

export const SessionAuditPublicSchema = z.object({
  sessionId: z.number(),
  tenantId: z.number(),
  userId: z.number(),
  hostId: z.number(),
  hostNameSnapshot: z.string(),
  hostIpSnapshot: z.string(),
  connectionMethod: z.string(),
  ticketProvider: z.string().nullable(),
  ticketKey: z.string().nullable(),
  ticketUrl: z.string().nullable(),
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date().nullable(),
  status: SessionAuditStatusSchema,
  chunkCount: z.number(),
  bytesIn: z.coerce.bigint(),
  bytesOut: z.coerce.bigint(),
  aiSummaryStatus: AiArtifactStatusSchema,
  aiSummaryText: z.string().nullable(),
  aiRiskLevel: z.string().nullable(),
})

export type SessionAuditPublic = z.infer<typeof SessionAuditPublicSchema>
```

### Evento de fila
Sugestão de novo arquivo:
- [packages/shared/src/types/session-audit-event.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/packages/shared/src/types/session-audit-event.ts)

```ts
export type SessionAuditEventType =
  | 'session_started'
  | 'stdin'
  | 'stdout'
  | 'resize'
  | 'session_error'
  | 'session_ended'

export interface SessionAuditEvent {
  version: 1
  eventId: string
  sessionId: number
  tenantId: number
  userId: number
  hostId: number
  seq: number
  timestamp: string
  type: SessionAuditEventType
  source: 'gateway'
  payload: Record<string, unknown>
}
```

## Hooks no gateway SSH
Pontos exatos em [ssh.gateway.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/backend/src/modules/ssh/ssh.gateway.ts):

### 1. Após `startSession`
Logo após:
- [ssh.gateway.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/backend/src/modules/ssh/ssh.gateway.ts#L79)

Publicar `session_started` com:
- `sessionId`
- `tenantId`
- `userId`
- `hostId`
- `hostName`
- `hostIp`
- `connectionMethod`
- ticket opcional

### 2. Em `ws.on('message')` para binário
Hoje o input vai direto para:
- [ssh.gateway.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/backend/src/modules/ssh/ssh.gateway.ts#L179)

Adicionar:
- publicar `stdin`
- atualizar contador local de bytes de entrada

### 3. Em `resize`
Hoje o resize é tratado em:
- [ssh.gateway.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/backend/src/modules/ssh/ssh.gateway.ts#L187)

Adicionar:
- publicar `resize`

### 4. Saída do shell
O output hoje é emitido em [ssh.session.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/backend/src/modules/ssh/ssh.session.ts#L91).

Recomendação:
- não publicar auditoria direto do `ws.send`
- injetar callback opcional em `SshSession`:
  - `onStdout(data: Buffer): void`
  - `onShellClosed(): void`

Assim o gateway continua dono do fluxo de auditoria e do `sessionId`.

### 5. Falhas de conexão
Nos blocos de erro:
- [ssh.gateway.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/backend/src/modules/ssh/ssh.gateway.ts#L98)
- [ssh.gateway.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/backend/src/modules/ssh/ssh.gateway.ts#L167)

Adicionar evento:
- `session_error`

### 6. Cleanup
No `cleanup` atual:
- [ssh.gateway.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/backend/src/modules/ssh/ssh.gateway.ts#L201)

Adicionar:
- publicar `session_ended`
- razão de encerramento, quando disponível

## Novos módulos sugeridos no backend
### API
- `apps/backend/src/modules/session-audit/session-audit.repository.ts`
- `apps/backend/src/modules/session-audit/session-audit.service.ts`
- `apps/backend/src/modules/session-audit/session-audit.controller.ts`
- `apps/backend/src/modules/session-audit/session-audit.routes.ts`

### Worker / pipeline
- `apps/backend/src/modules/session-audit/session-audit.publisher.ts`
- `apps/backend/src/modules/session-audit/session-audit.consumer.ts`
- `apps/backend/src/modules/session-audit/session-audit.chunk-writer.ts`
- `apps/backend/src/modules/session-audit/session-audit.ai.service.ts`
- `apps/backend/src/modules/session-audit/session-audit.ticket.service.ts`

### Infra
- `apps/backend/src/modules/session-audit/storage/local-session-audit.storage.ts`
- `apps/backend/src/modules/session-audit/storage/s3-session-audit.storage.ts`
- `apps/backend/src/modules/session-audit/queue/redis-stream-session-audit.queue.ts`

## Backlog técnico por arquivo
### Passo 1
- atualizar [schema.prisma](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/backend/prisma/schema.prisma)
- criar migration
- adicionar schemas em `packages/shared`

### Passo 2
- criar `SessionAuditPublisher`
- registrar no container
- injetar no gateway SSH

### Passo 3
- ajustar [ssh.session.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/backend/src/modules/ssh/ssh.session.ts) para callback de stdout
- publicar `stdin/stdout/resize/start/end/error`

### Passo 4
- criar worker e gravação de chunks
- persistir `SessionAudit` e `SessionAuditChunk`

### Passo 5
- criar API admin de listagem, detalhe e download

### Passo 6
- adicionar resumo pós-sessão e status de IA

## Decisões pragmáticas recomendadas
- MVP com `Redis Streams`
- sem RabbitMQ no primeiro corte
- sem microserviço separado além de um worker
- sem guardrail bloqueante no MVP
- sem escrita automática no JIRA no MVP

## Critérios de aceite do primeiro corte
- abrir sessão SSH continua com impacto mínimo
- eventos de auditoria não bloqueiam terminal
- sessão auditada aparece listável por admin
- download bruto da sessão funciona
- encerramento da sessão fecha a trilha corretamente
