import type { WebSocket } from 'ws'
import { randomUUID } from 'node:crypto'
import jwt from 'jsonwebtoken'
import type { FastifyInstance } from 'fastify'
import { requireAuth, requireAdmin, type JwtPayload } from '../../shared/guards.js'
import { env } from '../../config/env.js'
import type { SessionSupervisionService } from './session-supervision.service.js'

export async function sessionSupervisionRoutes(app: FastifyInstance, service: SessionSupervisionService) {
  app.get('/permission', { preHandler: [requireAuth] }, async request => ({ enabled: await service.permission(Number(request.jwtUser!.sub), request.jwtUser!.tenantId) }))
  app.get('/', { preHandler: [requireAuth] }, request => service.list(request.jwtUser!))
  app.get<{ Params: { userId: string } }>('/permissions/:userId', { preHandler: [requireAdmin] }, request => service.permission(Number(request.params.userId), request.jwtUser!.tenantId).then(enabled => ({ enabled })))
  app.put<{ Params: { userId: string }; Body: { enabled: boolean } }>('/permissions/:userId', { preHandler: [requireAdmin], schema: { params: { type: 'object', required: ['userId'], properties: { userId: { type: 'string', pattern: '^[1-9][0-9]*$' } } }, body: { type: 'object', required: ['enabled'], additionalProperties: false, properties: { enabled: { type: 'boolean' } } } } }, async (request, reply) => {
    await service.setPermission(request.jwtUser!, Number(request.params.userId), request.body.enabled)
    return reply.code(204).send()
  })
}

const observerSockets = new Set<WebSocket>()

export async function sessionSupervisionWsRoutes(app: FastifyInstance, service: SessionSupervisionService) {
  app.get<{ Params: { sessionId: string } }>('/session-supervision/:sessionId', { websocket: true }, (socket, request) => {
    const ws = socket as unknown as WebSocket & { bufferedAmount: number }
    if (observerSockets.size >= 64) { ws.close(1013); return }
    observerSockets.add(ws)
    const sessionId = Number(request.params.sessionId)
    let started = false
    let user: JwtPayload | undefined
    let reason = ''
    const observationId = randomUUID()
    let subscriber: ReturnType<typeof service.redis.duplicate> | undefined
    let timer: ReturnType<typeof setInterval> | undefined
    let expiry: ReturnType<typeof setTimeout> | undefined
    let audited = false
    let flushing = false
    let pending: string[] = []
    let bytes = 0
    const close = () => { if (ws.readyState === 1) ws.close(1008); cleanup() }
    const cleanup = () => {
      observerSockets.delete(ws)
      clearTimeout(authTimeout); clearTimeout(expiry); clearInterval(timer)
      subscriber?.disconnect(); subscriber = undefined; pending = []
      if (audited && user) { audited = false; void service.audit(user, sessionId, 'SESSION_SUPERVISION_ENDED', reason, observationId).catch(error => app.log.error(error, 'Supervision end audit failed')) }
    }
    const authTimeout = setTimeout(close, 5000)
    ws.once('close', cleanup)
    ws.on('error', cleanup)
    ws.on('message', async (raw, binary) => {
      // The only client message is the initial authentication. Any input closes this channel.
      if (started || binary || raw.toString().length > 12000) { close(); return }
      started = true
      try {
        const message = JSON.parse(raw.toString())
        user = jwt.verify(message.token, env.JWT_SECRET) as JwtPayload
        if (user.stage !== 'authenticated' || !Number.isSafeInteger(sessionId) || sessionId < 1 || typeof message.reason !== 'string' || message.reason.trim().length < 5 || message.reason.length > 500) throw new Error('Invalid request')
        reason = message.reason.trim()
        const expires = (user as JwtPayload & { exp: number }).exp * 1000 - Date.now()
        if (!Number.isFinite(expires) || expires <= 0) throw new Error('Expired')
        await service.authorize(user, sessionId)
        if (ws.readyState !== 1) return
        await service.audit(user, sessionId, 'SESSION_SUPERVISION_STARTED', reason, observationId)
        audited = true
        if (ws.readyState !== 1) { cleanup(); return }
        subscriber = service.redis.duplicate()
        subscriber.on('error', close)
        subscriber.on('message', (channel, value) => {
          if (channel.startsWith('supervision:user:')) { close(); return }
          try {
            const event = JSON.parse(value)
            if (event.ended) { close(); return }
            if (typeof event.data !== 'string' && !event.resize) return
            bytes += value.length
            if (bytes > 2 * 1024 * 1024) { close(); return }
            pending.push(value)
          } catch { close() }
        })
        await subscriber.connect()
        if (ws.readyState !== 1 || !subscriber) { cleanup(); return }
        await subscriber.subscribe(`supervision:session:${sessionId}`, `supervision:user:${user.tenantId}:${user.sub}`)
        if (ws.readyState !== 1) { cleanup(); return }
        clearTimeout(authTimeout)
        expiry = setTimeout(close, Math.min(expires, 2147483647))
        let lastCheck = 0
        timer = setInterval(() => {
          if (flushing || (!pending.length && Date.now() - lastCheck < 2000)) return
          flushing = true
          void service.authorize(user!, sessionId).then(() => {
            lastCheck = Date.now()
            if (ws.readyState !== 1 || ws.bufferedAmount > 2 * 1024 * 1024) { close(); return }
            const batch = pending; pending = []; bytes = 0
            for (const raw of batch) { const event = JSON.parse(raw); if (event.resize) ws.send(JSON.stringify({ type: 'resize', ...event.resize })); else ws.send(Buffer.from(event.data, 'base64')) }
          }).catch(close).finally(() => { flushing = false })
        }, 100)
        const dimensions = await service.redis.get(`supervision:dimensions:${sessionId}`)
        if (ws.readyState !== 1) return
        if (dimensions) ws.send(JSON.stringify({ type: 'resize', ...JSON.parse(dimensions) }))
        ws.send(JSON.stringify({ type: 'ready', observationId }))
      } catch { close() }
    })
  })
}
