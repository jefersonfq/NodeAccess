import type { FastifyReply, FastifyRequest } from 'fastify'
import type { LocalAiService } from './local-ai.service.js'
import type { LocalAiKnowledgeService } from './local-ai-knowledge.service.js'
import type { LocalAiProposedActionService } from './local-ai-proposed-action.service.js'
import type { LocalAiStreamChunk } from './local-ai.service.js'
import type { LocalAiTerminalAssistRequest } from '@nodeaccess/shared'
import { once } from 'node:events'
import type { AiScriptArtifactService } from '../ai-ssh-actions/ai-script-artifact.service.js'
import type { CreateAiScriptArtifactDto } from '@nodeaccess/shared'

type LocalAiChatBody = {
  message: string
  contextRoute?: string | null
  contextScreen?: string | null
  terminalContext?: {
    sessionId?: number | null
    hostId?: number | null
    hostName?: string | null
    hostIp?: string | null
    connectionStatus?: string | null
    selection?: string | null
    recentOutput?: string | null
    bufferTail?: string | null
  } | null
}

type LocalAiDiagnosticPlanBody = {
  hostId: number
  objective: string
}

type CreateTextDocumentBody = {
  title: string
  description?: string | null
  contentText: string
}

type CreateLinkDocumentBody = {
  title: string
  description?: string | null
  referenceUrl: string
  contentText?: string | null
}

type CreateProposedActionBody = {
  actionType: 'test_host_connection'
  targetType: 'host'
  targetId: number
  title: string
  reason: string
}

type ReviewProposedActionBody = {
  decision: 'approved' | 'rejected'
  reviewNote?: string | null
}

export class LocalAiController {
  constructor(
    private readonly localAiService: LocalAiService,
    private readonly localAiKnowledgeService: LocalAiKnowledgeService,
    private readonly localAiProposedActionService: LocalAiProposedActionService,
    private readonly scriptArtifactService: AiScriptArtifactService,
  ) {}

  async status(request: FastifyRequest, reply: FastifyReply) {
    const result = await this.localAiService.getStatus(request.jwtUser!)
    return reply.send(result)
  }

  async usageSummary(request: FastifyRequest<{ Querystring: { days?: string } }>, reply: FastifyReply) {
    const result = await this.localAiService.getUsageSummary(request.jwtUser!, Number(request.query.days ?? 30))
    return reply.send(result)
  }

  async interactions(request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) {
    const result = await this.localAiService.getInteractions(request.jwtUser!, Number(request.query.limit ?? 50))
    return reply.send(result)
  }

  async chat(request: FastifyRequest<{ Body: LocalAiChatBody }>, reply: FastifyReply) {
    const result = await this.localAiService.chat(request.jwtUser!, request.body)
    return reply.send(result)
  }

  async generateDiagnosticPlan(request: FastifyRequest<{ Body: LocalAiDiagnosticPlanBody }>, reply: FastifyReply) {
    const result = await this.localAiService.generateDiagnosticPlan(request.jwtUser!, request.body)
    return reply.send(result)
  }

  async terminalAssist(request: FastifyRequest<{ Body: LocalAiTerminalAssistRequest }>, reply: FastifyReply) {
    const result = await this.localAiService.terminalAssist(request.jwtUser!, request.body)
    return reply.send(result)
  }

  async createScriptArtifact(request: FastifyRequest<{ Body: CreateAiScriptArtifactDto }>, reply: FastifyReply) {
    return reply.status(201).send(await this.scriptArtifactService.create(request.jwtUser!, request.body))
  }

  async getScriptArtifact(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    return reply.send(await this.scriptArtifactService.get(request.jwtUser!, Number(request.params.id)))
  }

  async requestScriptExecution(request: FastifyRequest<{ Params: { id: string }; Body: { approvalReason?: string | null } }>, reply: FastifyReply) {
    return reply.status(201).send(await this.scriptArtifactService.requestExecution(request.jwtUser!, Number(request.params.id), request.body?.approvalReason))
  }

  async chatStream(request: FastifyRequest<{ Body: LocalAiChatBody }>, reply: FastifyReply) {
    reply.hijack()
    const res = reply.raw
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.writeHead(200)

    let closed = false
    const abortController = new AbortController()
    request.raw.on('close', () => {
      closed = true
      abortController.abort()
    })

    try {
      for await (const chunk of this.localAiService.chatStream(request.jwtUser!, request.body, abortController.signal)) {
        if (closed) break
        if (!res.write(`data: ${JSON.stringify(chunk as LocalAiStreamChunk)}\n\n`)) {
          await once(res, 'drain')
        }
      }
    } catch (err) {
      if (!closed) res.write(`data: ${JSON.stringify({ type: 'error', message: 'Não foi possível concluir a resposta da IA.' })}\n\n`)
    } finally {
      res.end()
    }
  }

  async listMineProposedActions(request: FastifyRequest, reply: FastifyReply) {
    const result = await this.localAiProposedActionService.listMine(request.jwtUser!)
    return reply.send(result)
  }

  async createProposedAction(request: FastifyRequest<{ Body: CreateProposedActionBody }>, reply: FastifyReply) {
    const result = await this.localAiProposedActionService.create(request.jwtUser!, request.body)
    return reply.status(201).send(result)
  }

  async listAdminProposedActions(request: FastifyRequest, reply: FastifyReply) {
    const result = await this.localAiProposedActionService.listForAdmin(request.jwtUser!)
    return reply.send(result)
  }

  async reviewProposedAction(
    request: FastifyRequest<{ Params: { id: string }; Body: ReviewProposedActionBody }>,
    reply: FastifyReply,
  ) {
    const result = await this.localAiProposedActionService.review(
      request.jwtUser!,
      Number(request.params.id),
      request.body,
    )
    return reply.send(result)
  }

  async listAdminDocuments(request: FastifyRequest, reply: FastifyReply) {
    const result = await this.localAiKnowledgeService.listAdminDocuments(request.jwtUser!)
    return reply.send(result)
  }

  async createTextDocument(request: FastifyRequest<{ Body: CreateTextDocumentBody }>, reply: FastifyReply) {
    const result = await this.localAiKnowledgeService.createTextDocument(request.jwtUser!, request.body)
    return reply.status(201).send(result)
  }

  async createLinkDocument(request: FastifyRequest<{ Body: CreateLinkDocumentBody }>, reply: FastifyReply) {
    const result = await this.localAiKnowledgeService.createLinkDocument(request.jwtUser!, request.body)
    return reply.status(201).send(result)
  }

  async uploadDocument(request: FastifyRequest, reply: FastifyReply) {
    const file = await (request as any).file() as {
      filename: string
      mimetype?: string
      file: NodeJS.ReadableStream
      toBuffer(): Promise<Buffer>
    } | undefined

    if (!file) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'Nenhum arquivo enviado' })
    }

    const buffer = await file.toBuffer()
    const result = await this.localAiKnowledgeService.createFileDocument(request.jwtUser!, {
      fileName: file.filename,
      mimeType: file.mimetype ?? null,
      byteSize: buffer.byteLength,
      contentText: buffer.toString('utf-8'),
    })
    return reply.status(201).send(result)
  }

  async deleteDocument(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    await this.localAiKnowledgeService.deleteDocument(request.jwtUser!, Number(request.params.id))
    return reply.status(204).send()
  }
}
