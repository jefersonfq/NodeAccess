import type { VaultAdministrationService } from './vault-administration.service.js'
import { z } from 'zod'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { requireAuth } from '../../shared/guards.js'
import { AppError } from '../../shared/errors.js'
import { VaultError, type VaultIdentity } from './vault-domain.js'
import type { VaultService } from './vault.service.js'

const opaque = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const empty = z.object({}).strict()
const session = z.object({ sessionId: opaque }).strict()
const recipient = z.object({ kty: z.literal('RSA'), n: z.string().min(342).max(683), e: z.literal('AQAB') }).strict()
function identity(req: FastifyRequest): VaultIdentity {
  const u = req.jwtUser
  if (!u || u.actingTenantId !== undefined || u.platformTenantId !== undefined || u.impersonatedByUserId !== undefined || u.forcePasswordChange) throw new VaultError('VAULT_FORBIDDEN', 403)
  const userId = Number(u.sub)
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new VaultError('VAULT_FORBIDDEN', 403)
  return { userId, tenantId: u.tenantId, sessionVersion: u.sessionVersion ?? 0 }
}
export function vaultRoutes(app: FastifyInstance, service: VaultService, administration?: VaultAdministrationService): Promise<void> {
  function post<T extends z.ZodTypeAny>(path: string, schema: T, run: (i: VaultIdentity, client: string, origin: string, body: z.infer<T>) => Promise<unknown>, needsClient = true): void {
    app.post(path, { preHandler: [requireAuth], bodyLimit: 16 * 1024 }, async (req, reply) => {
      reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache').header('Referrer-Policy', 'no-referrer')
      try {
        if (req.protocol !== 'https') throw new VaultError('VAULT_HTTPS_REQUIRED', 403)
        const origin = req.headers.origin
        if (typeof origin !== 'string') throw new VaultError('VAULT_ORIGIN_REQUIRED', 403)
        const client = needsClient ? opaque.parse(req.headers['x-vault-client']) : ''
        const body = schema.parse(req.body ?? {})
        return await service.admitted(() => run(identity(req), client, origin, body))
      } catch (error) {
        if (error instanceof z.ZodError) throw new AppError('Requisição inválida', 400, 'VAULT_INPUT_INVALID')
        if (error instanceof VaultError) {
          if (path.startsWith('/operations')) {
            // Denials stay denied if diagnostic audit/quota is unavailable. Release audit is mandatory in its transaction.
            try { await service.admitted(() => service.recordDenial(identity(req), error.code)) } catch { /* No release or retry on a denial. */ }
          }
          if (error.status === 429) reply.header('Retry-After', '60')
          throw new AppError('Operação do cofre indisponível', error.status, error.code)
        }
        // Never surface ORM, crypto or upstream details containing request material.
        throw new AppError('Serviço do cofre indisponível', 503, 'VAULT_DEPENDENCY_UNAVAILABLE')
      }
    })
  }
  post('/clients', z.object({ refreshToken: z.string().min(32).max(4096) }).strict(), (i, _c, o, b) => service.register(i, b.refreshToken, o), false)
  post('/sessions/challenges', empty, (i,c,o) => service.challenge(i,c,o))
  post('/sessions/unlock', z.object({ challengeId: opaque, password: z.string().min(1).max(1024), token: z.string().regex(/^\d{6}$/) }).strict(),
    (i,c,o,b) => service.unlock(i,c,o,b.challengeId,b.password,b.token))
  // NA-0184: OIDC/Google sessions confirm identity at the provider, bound to one challenge.
  post('/sessions/provider/begin', z.object({ challengeId: opaque }).strict(), (i,c,o,b) => service.providerBegin(i,c,o,b.challengeId))
  post('/sessions/provider/complete', z.object({ challengeId: opaque, state: z.string().regex(/^vsu\.[A-Za-z0-9_-]{16,512}$/).optional(),
    code: z.string().min(1).max(4096).optional(), idToken: z.string().min(32).max(8192).optional() }).strict(),
    (i,c,o,b) => service.providerComplete(i,c,o,b.challengeId,{ state: b.state, code: b.code, idToken: b.idToken }))
  post('/sessions/unlock-provider', z.object({ challengeId: opaque, token: z.string().regex(/^\d{6}$/).optional() }).strict(),
    (i,c,o,b) => service.unlockProvider(i,c,o,b.challengeId,b.token))
  post('/sessions/lock', empty, (i,c,o) => service.lock(i,c,o).then(() => ({ state: 'LOCKED' })))
  post('/sessions/current', empty, (i,c,o) => service.current(i,c,o))
  post('/operations', session.extend({ action: z.enum(['reveal','copy']), secretId: z.number().int().positive(), recipient }).strict(),
    (i,c,o,b) => service.request(i,c,o,b.sessionId,b.action,b.secretId,b.recipient))
  post('/operations/consume', session.extend({ operationId: opaque }).strict(), (i,c,o,b) => service.consume(i,c,o,b.sessionId,b.operationId))
  post('/operations/status', z.object({ operationId: opaque }).strict(), (i,c,o,b) => service.operation(i,c,o,b.operationId))
  post('/operations/cancel', z.object({ operationId: opaque }).strict(), (i,c,o,b) => service.operation(i,c,o,b.operationId,true))
  if (administration) {
    const change = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('grant'), userId: z.number().int().positive(), action: z.enum(['reveal','copy']), enabled: z.boolean() }).strict(),
      z.object({ kind: z.literal('item'), secretId: z.number().int().positive(), enabled: z.boolean() }).strict(),
      z.object({ kind: z.literal('policy'), reveal: z.boolean(), copy: z.boolean(), tenantQuota: z.number().int().min(1).max(300) }).strict(),
    ])
    post('/administration/proposals', session.extend({ change }).strict(), (i,c,o,b) => administration.propose(i,c,o,b.sessionId,b.change))
    post('/administration/approve', session.extend({ proposalId: opaque }).strict(), (i,c,o,b) => administration.approve(i,c,o,b.sessionId,b.proposalId))
  }
  return Promise.resolve()
}
