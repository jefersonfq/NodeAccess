import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { requireAuth, requirePlatformAdmin } from '../../shared/guards.js'
import { AppError, UnauthorizedError, ValidationError } from '../../shared/errors.js'
import { opaqueTokenSchema } from './trial-contract.js'
import type { TrialWriteLimiter } from './trial-write-limiter.js'
import type { TrialService } from './trial.service.js'
import type { AuthRateLimitService } from '../auth/auth-rate-limit.service.js'

function token(request: FastifyRequest): string {
  const value = request.headers.authorization?.replace(/^Bearer /, '')
  const result = opaqueTokenSchema.safeParse(value)
  if (!result.success) throw new UnauthorizedError('Link de acesso inválido')
  return result.data
}
function bodyToken(body: unknown): string {
  const parsed = z.object({ token: opaqueTokenSchema }).strict().safeParse(body)
  if (!parsed.success) throw new ValidationError('Link inválido ou incompleto')
  return parsed.data.token
}
function safeErrors(scope: FastifyInstance): void {
  scope.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.status(422).send({ code: 'VALIDATION_ERROR', message: 'Confira os campos obrigatórios e os limites informados.' })
    if (error instanceof AppError) return reply.status(error.statusCode).send({ code: error.code, message: error.message })
    return reply.status(503).send({ code: 'TRIAL_UNAVAILABLE', message: 'Não foi possível concluir agora. Tente novamente mais tarde.' })
  })
}
export async function trialRoutes(app: FastifyInstance, service: TrialService, limiter: AuthRateLimitService, writeLimiter?: TrialWriteLimiter): Promise<void> {
  // Public routes are same-origin, bounded, and never trust JWTs or tenant IDs from the caller.
  app.get('/trials/public/config', () => service.publicConfig())
  await app.register((publicApi, _options, done) => {
    safeErrors(publicApi)
    publicApi.addHook('onRequest', async request => {
      await limiter.check({ action: 'lookup', ip: request.ip, tenant: 'trial-public' })
    })
    publicApi.post('/register', { bodyLimit: 4096 }, async request => {
      const email = (request.body as { email?: unknown } | undefined)?.email
      if (typeof email === 'string') await limiter.check({ action: 'email_otp', ip: request.ip, tenant: 'trial-public', identity: email })
      return service.register(request.body)
    })
    publicApi.post('/verify', { bodyLimit: 1024 }, request => service.verify(bodyToken(request.body)))
    publicApi.get('/status', request => service.status(token(request)))
    publicApi.post('/activate', { bodyLimit: 1024 }, async request => {
      const managementToken = token(request)
      await limiter.check({ action: 'mfa', ip: request.ip, tenant: 'trial-activation', identity: managementToken })
      return service.activate(managementToken, request.body)
    })
    publicApi.post('/preferences', { bodyLimit: 1024 }, request => service.preferences(token(request), request.body))
    publicApi.post('/invite', { bodyLimit: 2048 }, async request => {
      const email = (request.body as { email?: unknown } | undefined)?.email
      if (typeof email === 'string') await limiter.check({ action: 'email_otp', ip: request.ip, tenant: 'trial-invitation', identity: email })
      return service.invite(token(request), request.body)
    })
    publicApi.post('/cancel', request => service.cancel(token(request)))
    done()
  }, { prefix: '/trials/public' })
  await app.register((mine, _options, done) => {
    safeErrors(mine)
    mine.addHook('preHandler', requireAuth)
    mine.addHook('preHandler', async request => {
      if (writeLimiter && !['GET', 'HEAD'].includes(request.method)) await writeLimiter.check({ tenantId: request.jwtUser!.tenantId, userId: Number(request.jwtUser!.sub), ip: request.ip })
    })
    mine.get('/resources', request => service.machines.resources(request.jwtUser!.tenantId, Number(request.jwtUser!.sub)))
    mine.post('/machines', { bodyLimit: 1024 }, async (request, reply) => {
      const result = await service.machines.request(request.jwtUser!.tenantId, request.body)
      return reply.status(202).send(result)
    })
    mine.post('/hosts', { bodyLimit: 73728 }, async (request, reply) => {
      const result = await service.customHosts.create(request.jwtUser!.tenantId, Number(request.jwtUser!.sub), request.body)
      return reply.status(201).send(result)
    })
    mine.put<{ Params: { id: string } }>('/hosts/:id', { bodyLimit: 73728 }, request => service.customHosts.update(
      request.jwtUser!.tenantId, Number(request.jwtUser!.sub), z.coerce.number().int().positive().parse(request.params.id), request.body))
    mine.delete<{ Params: { id: string } }>('/hosts/:id', async (request, reply) => {
      await service.customHosts.remove(request.jwtUser!.tenantId, Number(request.jwtUser!.sub), z.coerce.number().int().positive().parse(request.params.id))
      return reply.status(204).send()
    })
    done()
  }, { prefix: '/trials/me' })
  await app.register((admin, _options, done) => {
    safeErrors(admin)
    admin.addHook('preHandler', requirePlatformAdmin)
    admin.get('/', () => service.list())
    admin.put('/profile', { bodyLimit: 8192 }, request => service.updateProfile(request.body, Number(request.jwtUser!.sub)))
    admin.post<{ Params: { id: string } }>('/:id/cancel', request => {
      const id = z.string().uuid().parse(request.params.id)
      return service.cancelById(id)
    })
    done()
  }, { prefix: '/platform/trials' })
}
