import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { VaultExtensionAuthorizeSchema, VaultExtensionItemsQuerySchema, VaultExtensionThumbprintSchema, VaultExtensionTokenRequestSchema } from '@nodeaccess/shared'
import { requireAuth } from '../../shared/guards.js'
import { AppError } from '../../shared/errors.js'
import { VaultError, type VaultIdentity } from './vault-domain.js'
import type { VaultService } from './vault.service.js'
import type { ExtensionRequest, VaultExtensionService } from './vault-extension.service.js'

const opaque = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
function identity(req: FastifyRequest): VaultIdentity {
  const u = req.jwtUser
  if (!u || u.actingTenantId !== undefined || u.platformTenantId !== undefined || u.impersonatedByUserId !== undefined || u.forcePasswordChange) throw new VaultError('VAULT_FORBIDDEN', 403)
  const userId = Number(u.sub)
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new VaultError('VAULT_FORBIDDEN', 403)
  return { userId, tenantId: u.tenantId, sessionVersion: u.sessionVersion ?? 0 }
}
function header(req: FastifyRequest, name: string): unknown {
  const value = req.headers[name]
  return Array.isArray(value) ? undefined : value
}
/** The URL as the client addressed it (proxy-aware via trustProxy); DPoP `htu` must equal it. */
function extensionRequest(req: FastifyRequest): ExtensionRequest {
  return { requestOrigin: header(req, 'origin'), version: header(req, 'x-extension-version'), proof: header(req, 'dpop'),
    url: `${req.protocol}://${req.host}${req.url.split('?')[0] ?? ''}` }
}

/** NA-0183: extension endpoints under /vault-security/extension; nothing here ever returns a secret value. */
export function vaultExtensionRoutes(app: FastifyInstance, vault: VaultService, service: VaultExtensionService): Promise<void> {
  function fail(error: unknown, reply: FastifyReply): never {
    if (error instanceof z.ZodError) throw new AppError('Requisição inválida', 400, 'VAULT_INPUT_INVALID')
    if (error instanceof VaultError) {
      if (error.code === 'EXTENSION_DPOP_NONCE') reply.header('WWW-Authenticate', 'DPoP error="use_dpop_nonce"')
      else if (error.status === 401) reply.header('WWW-Authenticate', 'DPoP error="invalid_token"')
      if (error.status === 429) reply.header('Retry-After', '60')
      throw new AppError('Extensão do cofre indisponível', error.status, error.code)
    }
    throw new AppError('Serviço do cofre indisponível', 503, 'VAULT_DEPENDENCY_UNAVAILABLE')
  }
  function secure(req: FastifyRequest, reply: FastifyReply): void {
    reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache').header('Referrer-Policy', 'no-referrer')
    if (req.protocol !== 'https') throw new VaultError('VAULT_HTTPS_REQUIRED', 403)
  }
  /** Public extension endpoints: a fresh nonce on every answer, including errors. */
  function extension(method: 'GET' | 'POST', path: string, run: (req: FastifyRequest) => Promise<unknown>): void {
    app.route({ method, url: path, bodyLimit: 4096, handler: async (req, reply) => {
      reply.header('DPoP-Nonce', service.nonces.issue())
      try { secure(req, reply); return await vault.admitted(() => run(req)) } catch (error) { return fail(error, reply) }
    } })
  }
  extension('POST', '/extension/token', req => service.token(extensionRequest(req), VaultExtensionTokenRequestSchema.parse(req.body ?? {})))
  extension('GET', '/extension/capabilities', req => service.capabilities(extensionRequest(req), header(req, 'authorization')))
  extension('GET', '/extension/items', req => service.items(extensionRequest(req), header(req, 'authorization'), VaultExtensionItemsQuerySchema.parse(req.query ?? {})))

  /** Portal endpoints (central JWT, same-origin). */
  function portal<T extends z.ZodTypeAny>(path: string, schema: T, run: (i: VaultIdentity, client: string, origin: string, body: z.infer<T>) => Promise<unknown>, needsClient: boolean): void {
    app.post(path, { preHandler: [requireAuth], bodyLimit: 4096 }, async (req, reply) => {
      try {
        secure(req, reply)
        const origin = header(req, 'origin')
        if (typeof origin !== 'string') throw new VaultError('VAULT_ORIGIN_REQUIRED', 403)
        const client = needsClient ? opaque.parse(req.headers['x-vault-client']) : ''
        const body = schema.parse(req.body ?? {})
        return await vault.admitted(() => run(identity(req), client, origin, body))
      } catch (error) { return fail(error, reply) }
    })
  }
  portal('/extension/authorize', VaultExtensionAuthorizeSchema, (i, c, o, b) => service.authorize(i, c, o, b), true)
  portal('/extension/devices', z.object({}).strict(), (i, _c, o) => service.devices(i, o), false)
  portal('/extension/devices/revoke', z.object({ jkt: VaultExtensionThumbprintSchema }).strict(), (i, _c, o, b) => service.revokeDevice(i, o, b.jkt), false)
  return Promise.resolve()
}
