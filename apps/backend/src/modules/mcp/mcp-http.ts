import type { FastifyReply, FastifyRequest } from 'fastify'
import { env } from '../../config/env.js'

/** Validate before AJV coercion: JSON-RPC types and IDs must be preserved exactly. */
export async function requireMcpMessage(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> {
  const body = request.body as Record<string, unknown> | null
  if (!body || Array.isArray(body) || typeof body !== 'object' || body.jsonrpc !== '2.0'
    || typeof body.method !== 'string' || !body.method.trim()
    || (Object.hasOwn(body, 'id') && typeof body.id !== 'string' && !(typeof body.id === 'number' && Number.isFinite(body.id)))
    || (body.params != null && (typeof body.params !== 'object' || Array.isArray(body.params)))) {
    return reply.code(400).send({ error: 'MCP_INVALID_REQUEST' })
  }
}

/** Stateless JSON transport; origins come from configuration, never an untrusted Host header. */
export async function requireMcpHttp(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> {
  reply.header('Cache-Control', 'no-store')
  const origin = request.headers.origin
  if (origin !== undefined) {
    const allowed = [env.APP_URL, env.APP_FRONTEND_URL].filter(Boolean).map((value) => new URL(value!).origin)
    if (!allowed.includes(origin)) return reply.code(403).send({ error: 'MCP_ORIGIN_FORBIDDEN' })
  }
  const version = request.headers['mcp-protocol-version']
  if (version !== undefined && version !== '2025-06-18' && version !== '2025-03-26') {
    return reply.code(400).send({ error: 'MCP_PROTOCOL_VERSION_UNSUPPORTED' })
  }
  if (request.method === 'POST') {
    const accepted = (request.headers.accept ?? '').split(',').filter((part) => {
      const q = part.match(/;\s*q=([\d.]+)/i)
      return !q || Number(q[1]) > 0
    }).map((part) => part.split(';')[0]!.trim().toLowerCase())
    if (!accepted.includes('application/json') || !accepted.includes('text/event-stream')) {
      return reply.code(406).send({ error: 'MCP_ACCEPT_REQUIRED' })
    }
  }
}
