import { z } from 'zod'
import { VaultSiteListSchema, VaultSiteListReplySchema, VaultSiteCreateSchema, VaultSiteUpdateSchema, VaultSiteVersionSchema,
  VaultSiteFillAuthorizeSchema, VaultSiteFillConsumeSchema, VaultSiteFillBindingSchema, VaultSiteFillReleaseSchema, type VaultSiteFillBinding } from '@nodeaccess/shared'
import type { SiteFillBinding, SiteFillCredentials } from './site-fill'
import type { SitesClient } from './sites-port'
import { createRecipient, assertContext, openEnvelope, type Recipient } from './envelope'

export type SiteRequest = (path: string, body: object) => Promise<unknown>
export function createSitesClient(request: SiteRequest): SitesClient {
  return {
    list: async query => VaultSiteListReplySchema.parse(await request('/sites/list', VaultSiteListSchema.parse(query))),
    create: async input => VaultSiteVersionSchema.parse(await request('/sites/create', VaultSiteCreateSchema.parse(input))),
    update: async input => VaultSiteVersionSchema.parse(await request('/sites/update', VaultSiteUpdateSchema.parse(input))),
  }
}
const grantSchema = z.object({ operation: z.string().regex(/^[A-Za-z0-9_-]{43}$/), expiresAt: z.number().int(), serverNow: z.number().int() }).strict()
export interface SiteFillGrant { operation: string; recipient: Recipient; siteId: number; version: number; binding: VaultSiteFillBinding; deadline: number }
/** The worker owns this ephemeral key; the popup and the web page never receive it. */
export function createSiteFillClient(request: SiteRequest, now = Date.now): {
  authorize(siteId: number, version: number, binding: SiteFillBinding): Promise<SiteFillGrant>
  consume(grant: SiteFillGrant, binding: SiteFillBinding): Promise<SiteFillCredentials>
} {
  return {
    async authorize(siteId: number, version: number, binding: SiteFillBinding): Promise<SiteFillGrant> {
      const recipient = await createRecipient(), started = now()
      const input = VaultSiteFillAuthorizeSchema.parse({ siteId, siteVersion: version, binding, recipient: recipient.publicJwk })
      const grant = grantSchema.parse(await request('/sites/fill/authorize', input))
      if (grant.expiresAt <= grant.serverNow) throw new Error('Expired fill')
      return { operation: grant.operation, recipient, siteId, version, binding: input.binding, deadline: started + Math.min(30_000, grant.expiresAt - grant.serverNow) }
    },
    async consume(grant: SiteFillGrant, binding: SiteFillBinding): Promise<SiteFillCredentials> {
      if (now() >= grant.deadline || JSON.stringify(VaultSiteFillBindingSchema.parse(binding)) !== JSON.stringify(grant.binding)) throw new Error('Expired or changed fill')
      const reply = VaultSiteFillReleaseSchema.parse(await request('/sites/fill/consume', VaultSiteFillConsumeSchema.parse({ operation: grant.operation, binding })))
      if (reply.mode !== binding.mode) throw new Error('Changed fill mode')
      if (reply.mode === 'username') {
        if (reply.operation !== grant.operation || JSON.stringify(reply.binding) !== JSON.stringify(grant.binding) ||
          reply.expiresAt <= reply.serverNow || now() >= grant.deadline) throw new Error('Expired or changed fill')
        return { mode: 'username', username: reply.username }
      }
      assertContext(reply.context, { itemRef: `site:${grant.siteId}:${binding.mode}`, action: 'fill', thumbprint: grant.recipient.thumbprint, origin: binding.origin, serverNow: reply.serverNow })
      if (reply.context.operationId !== grant.operation || reply.context.secretVersion !== String(grant.version)) throw new Error('Wrong fill operation')
      const password = await openEnvelope(reply.envelope, grant.recipient, reply.context)
      if (now() >= grant.deadline) throw new Error('Expired fill')
      return reply.mode === 'password' ? { mode: 'password', password } : { mode: 'both', username: reply.username, password }
    },
  }
}
