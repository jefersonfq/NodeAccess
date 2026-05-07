import type { FastifyReply, FastifyRequest } from 'fastify'
import type { LocalAiService } from './local-ai.service.js'
import type { LocalAiKnowledgeService } from './local-ai-knowledge.service.js'
import type { LocalAiProposedActionService } from './local-ai-proposed-action.service.js'
import type { LocalAiStreamChunk } from './local-ai.service.js'

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
  ) {}

  async status(request: FastifyRequest, reply: FastifyReply) {
    const result = await this.localAiService.getStatus(request.jwtUser!)
    return reply.send(result)
  }

  async chat(request: FastifyRequest<{ Body: LocalAiChatBody }>, reply: FastifyReply) {
    const result = await this.localAiService.chat(request.jwtUser!, request.body)
    return reply.send(result)
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
    request.raw.on('close', () => { closed = true })

    try {
      for await (const chunk of this.localAiService.chatStream(request.jwtUser!, request.body)) {
        if (closed) break
        res.write(`data: ${JSON.stringify(chunk as LocalAiStreamChunk)}\n\n`)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido'
      if (!closed) res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`)
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
