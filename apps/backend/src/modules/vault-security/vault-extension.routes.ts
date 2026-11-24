import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { VaultExtensionAuthorizeSchema, VaultExtensionItemsQuerySchema, VaultExtensionDeliverRequestSchema, VaultExtensionForgetRequestSchema, VaultExtensionRenewRequestSchema, VaultExtensionUnlockRequestSchema, VaultExtensionThumbprintSchema, VaultExtensionTokenRequestSchema } from '@nodeaccess/shared'
import { requireAuth } from '../../shared/guards.js'
import { AppError } from '../../shared/errors.js'
import { VaultError, type VaultIdentity } from './vault-domain.js'
import type { VaultService } from './vault.service.js'
import type { ExtensionRequest, VaultExtensionService } from './vault-extension.service.js'
import { updateManifestFor, type ExtensionPackage } from './vault-extension-package.js'

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
export function vaultExtensionRoutes(app: FastifyInstance, vault: VaultService, service: VaultExtensionService, releases?: ExtensionPackage): Promise<void> {
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
  // NA-0193: trusted-device renewal (automatic while the consenting portal login lives, else the authenticator code).
  extension('POST', '/extension/renew', req => service.renew(extensionRequest(req), VaultExtensionRenewRequestSchema.parse(req.body ?? {})))
  extension('POST', '/extension/forget', req => service.forget(extensionRequest(req), VaultExtensionForgetRequestSchema.parse(req.body ?? {})))
  // NA-0195 (E2): authenticator-code proof and reveal/copy release (DPoP + authorization).
  extension('POST', '/extension/unlock', req => service.unlock(extensionRequest(req), header(req, 'authorization'), VaultExtensionUnlockRequestSchema.parse(req.body ?? {})))
  // NA-0200 (E5b): proof from an identity confirmation in the portal (Windows Hello or password + code).
  extension('POST', '/extension/proof-request', req => service.proofRequest(extensionRequest(req), header(req, 'authorization')))
  extension('POST', '/extension/proof-claim', req => service.proofClaim(extensionRequest(req), header(req, 'authorization'), z.object({ request: opaque }).strict().parse(req.body ?? {})))
  extension('POST', '/extension/deliver', req => service.deliver(extensionRequest(req), header(req, 'authorization'), VaultExtensionDeliverRequestSchema.parse(req.body ?? {})))
  extension('GET', '/extension/capabilities', req => service.capabilities(extensionRequest(req), header(req, 'authorization')))
  extension('GET', '/extension/items', req => service.items(extensionRequest(req), header(req, 'authorization'), VaultExtensionItemsQuerySchema.parse(req.query ?? {})))

  // NA-0194: release published by the operator. Files are public (the browser and the install policy fetch them
  // without a session; they hold no secret) and only exist when the release matches this deployment.
  const BASE = '/api/v1/vault-security/extension'
  const https = (req: FastifyRequest, reply: FastifyReply): void => {
    reply.header('Cache-Control', 'no-cache').header('X-Content-Type-Options', 'nosniff')
    if (req.protocol !== 'https') throw new AppError('Extensão do cofre indisponível', 403, 'VAULT_HTTPS_REQUIRED')
  }
  const unavailable = (): never => { throw new AppError('Pacote da extensão indisponível', 404, 'EXTENSION_PACKAGE_UNAVAILABLE') }
  for (const [path, kind] of [['/extension/package.zip', 'zip'], ['/extension/package.crx', 'crx']] as const) {
    app.get(path, async (req, reply) => {
      https(req, reply)
      const file = await releases?.file(kind)
      if (!file) return unavailable()
      const sha = kind === 'zip' ? file.release.zip.sha256 : file.release.crx.sha256
      reply.header('ETag', `"${sha}"`).header('Content-Disposition', `attachment; filename="vaultnaccess-${file.release.version}.${kind}"`)
      if (req.headers['if-none-match'] === `"${sha}"`) return reply.code(304).send()
      return reply.type(file.contentType).send(file.body)
    })
  }
  app.get('/extension/update.xml', async (req, reply) => {
    https(req, reply)
    const release = await releases?.verified()
    if (!release) return unavailable()
    return reply.type('application/xml; charset=utf-8').send(updateManifestFor(release, `https://${req.host}${BASE}/package.crx`))
  })
  app.get('/extension/package', { preHandler: [requireAuth] }, async (_req, reply) => {
    reply.header('Cache-Control', 'no-store')
    const release = await releases?.verified()
    if (!release) return { available: false }
    return { available: true, version: release.version, extensionId: release.extensionId, zip: { sha256: release.zip.sha256, size: release.zip.size },
      zipUrl: `${BASE}/package.zip`, crxUrl: `${BASE}/package.crx`, updateUrl: `${BASE}/update.xml` }
  })

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
  portal('/extension/proof-info', z.object({ request: opaque }).strict(), (i, _c, o, b) => service.proofInfo(i, o, b.request), false)
  portal('/extension/proof-approve', z.object({ sessionId: opaque, request: opaque }).strict(), (i, c, o, b) => service.proofApprove(i, c, o, b.sessionId, b.request), true)
  portal('/extension/devices/revoke', z.object({ jkt: VaultExtensionThumbprintSchema }).strict(), (i, _c, o, b) => service.revokeDevice(i, o, b.jkt), false)
  return Promise.resolve()
}
