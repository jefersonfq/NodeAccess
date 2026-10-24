import { MacroOutcomeSchema } from '@nodeaccess/shared'
import { AppError } from '../../shared/errors.js'
import { assertTrialAccess } from '../trials/trial-policy.js'
import type { FastifyRequest, FastifyReply } from 'fastify'
import type { SnippetService } from './snippet.service.js'
import type { JwtPayload } from '../../shared/guards.js'

type AuthReq = Omit<FastifyRequest, 'user'> & { user: JwtPayload }

export class SnippetController {
  constructor(private readonly service: SnippetService) {}

  async list(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const { sub, tenantId } = (req as AuthReq).user
    const snippets = await this.service.list(Number(sub), tenantId)
    // Older clients interpret unknown command prefixes as shell text.
    // Hide versioned macros unless the client explicitly understands them.
    return reply.send(req.headers['x-nodeaccess-snippet-format'] === 'macro-v1'
      ? snippets
      : snippets.filter(item => !item.command.startsWith('#!nodeaccess:macro-v1')))
  }

  async create(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const { sub, tenantId } = (req as AuthReq).user
    const body = req.body as { name: string; command: string; description?: string; scope: 'PERSONAL' | 'TEAM' }
    const snippet = await this.service.create(Number(sub), tenantId, body)
    return reply.status(201).send(snippet)
  }

  async update(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const { sub, tenantId } = (req as AuthReq).user
    const { id } = req.params as { id: string }
    const body = req.body as { name?: string; command?: string; description?: string; scope?: 'PERSONAL' | 'TEAM' }
    const snippet = await this.service.update(Number(id), Number(sub), tenantId, body)
    return reply.send(snippet)
  }

  async recordOutcome(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const { sub, tenantId } = (req as AuthReq).user
    if (await assertTrialAccess(tenantId)) return reply.status(204).send()
    const result = MacroOutcomeSchema.safeParse(req.body)
    if (!result.success) throw new AppError('Resumo de macro inválido', 400, 'MACRO_OUTCOME_INVALID')
    const recorded = await this.service.recordOutcome(Number(sub), tenantId, Number((req.params as {id:string}).id), result.data)
    return reply.status(recorded ? 204 : 202).send()
  }

  async remove(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const { sub, tenantId } = (req as AuthReq).user
    const { id } = req.params as { id: string }
    await this.service.remove(Number(id), Number(sub), tenantId)
    return reply.status(204).send()
  }
}
