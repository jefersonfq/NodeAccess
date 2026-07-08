import type { FastifyReply, FastifyRequest } from 'fastify'
import { env } from '../../config/env.js'
import type { JwtPayload } from '../../shared/guards.js'
import type { WebAccessService } from './web-access.service.js'

type AuthReq = FastifyRequest & { user: JwtPayload }

export class WebAccessController {
  constructor(private readonly service: WebAccessService) {}

  async createLink(req: FastifyRequest, reply: FastifyReply) {
    const { tenantId, sub, role } = (req as AuthReq).user
    const { forwardingId } = req.params as { forwardingId: string }
    const data = await this.service.createLink(Number(forwardingId), tenantId, Number(sub), role, resolvePublicBaseUrl(req))
    return reply.send(data)
  }

  async proxy(req: FastifyRequest, reply: FastifyReply) {
    const { token } = req.query as { token?: string }
    const referer = typeof req.headers.referer === 'string' ? req.headers.referer : undefined
    await this.service.proxy(resolveProxyToken(token, referer), req, reply)
  }
}

function resolvePublicBaseUrl(req: FastifyRequest): string {
  const forwardedProto = firstHeader(req.headers['x-forwarded-proto'])?.split(',')[0]?.trim()
  const forwardedHost = firstHeader(req.headers['x-forwarded-host'])?.split(',')[0]?.trim()
  const host = forwardedHost || firstHeader(req.headers.host)
  const proto = forwardedProto || (req.protocol === 'https' ? 'https' : 'http')
  const base = host ? `${proto}://${host}` : env.APP_URL

  return normalizeLocalApiWebAccessBase(base)
}

function normalizeLocalApiWebAccessBase(base: string): string {
  try {
    const url = new URL(base)
    const isLocalHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
    if (isLocalHost && Number(url.port) === env.APP_PORT_API && env.APP_PORT_GATEWAY !== env.APP_PORT_API) {
      url.port = String(env.APP_PORT_GATEWAY)
      return url.toString().replace(/\/$/, '')
    }
  } catch {
    return base.replace(/\/$/, '')
  }

  return base.replace(/\/$/, '')
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
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
