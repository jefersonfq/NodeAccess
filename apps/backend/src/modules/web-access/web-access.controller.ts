import type { FastifyReply, FastifyRequest } from 'fastify'
import type { JwtPayload } from '../../shared/guards.js'
import type { WebAccessService } from './web-access.service.js'

type AuthReq = FastifyRequest & { user: JwtPayload }

export class WebAccessController {
  constructor(private readonly service: WebAccessService) {}

  async createLink(req: FastifyRequest, reply: FastifyReply) {
    const { tenantId, sub, role } = (req as AuthReq).user
    const { forwardingId } = req.params as { forwardingId: string }
    const data = await this.service.createLink(Number(forwardingId), tenantId, Number(sub), role)
    return reply.send(data)
  }

  async proxy(req: FastifyRequest, reply: FastifyReply) {
    const { token } = req.query as { token?: string }
    const referer = typeof req.headers.referer === 'string' ? req.headers.referer : undefined
    await this.service.proxy(resolveProxyToken(token, referer), req, reply)
  }
}

function resolveProxyToken(token?: string, referer?: string): string {
  if (token) return token
  if (!referer) return ''

  try {
    const url = new URL(referer)
    return url.searchParams.get('token') ?? ''
  } catch {
    return ''
  }
}
