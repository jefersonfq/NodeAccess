import type { Prisma } from '@prisma/client'
import { InventoryAclRepository } from '../inventory/inventory-acl.repository.js'
import type { VaultIdentity } from './vault-domain.js'
import { resolveAssociatedLinkTemplate } from '../hosts/host.service.js'
import { VaultSiteOriginSchema } from '@nodeaccess/shared'

/** Reuses the portal inventory ACL on the caller's transaction. No SSH addresses or secrets. */
export function siteHostAccess(role: 'ADMIN' | 'USER') {
  return async (db: Prisma.TransactionClient, identity: VaultIdentity, id: number): Promise<{ id: number; name: string } | null> => {
    const host = await db.host.findFirst({ where: { id, tenantId: identity.tenantId, deletedAt: null }, select: { id: true, name: true } })
    if (!host) return null
    if (role === 'ADMIN') return host
    const permissions = await new InventoryAclRepository(db).findEffectiveHostPermissions([id], identity.tenantId, identity.userId)
    return permissions.some(p => Number(p.hostId) === id && Boolean(p.canView)) ? host : null
  }
}

/** Filter permissions before limiting the visible choices; no hidden total/cursor. */
export async function siteHostChoices(db: Prisma.TransactionClient, identity: VaultIdentity, role: 'ADMIN' | 'USER', q: string): Promise<Array<{ id: number; name: string }>> {
  const hosts = await db.host.findMany({ where: { tenantId: identity.tenantId, deletedAt: null, ...(q ? { name: { contains: q } } : {}) },
    select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] })
  if (role === 'ADMIN') return hosts.slice(0, 50)
  const permissions = await new InventoryAclRepository(db).findEffectiveHostPermissions(hosts.map(h => h.id), identity.tenantId, identity.userId)
  const visible = new Set(permissions.filter(p => Boolean(p.canView)).map(p => Number(p.hostId)))
  return hosts.filter(h => visible.has(h.id)).slice(0, 50)
}

/** Reuse already registered website links: the user need not recreate a mapping in each login. */
export async function siteCurrentHosts(db: Prisma.TransactionClient, identity: VaultIdentity, role: 'ADMIN' | 'USER', rawOrigin: string): Promise<Array<{ id: number; name: string }>> {
  const origin = VaultSiteOriginSchema.parse(rawOrigin)
  const links = await db.hostAssociatedLink.findMany({ where: { tenantId: identity.tenantId, enabled: true,
    sourceStatus: { in: ['MANUAL', 'SYNCED'] }, host: { tenantId: identity.tenantId, deletedAt: null } },
    select: { urlTemplate: true, host: { select: { id: true, name: true, ip: true, port: true, sshUser: true } } } })
  const permissions = role === 'ADMIN' ? null : await new InventoryAclRepository(db).findEffectiveHostPermissions(links.map(l => l.host.id), identity.tenantId, identity.userId)
  const visible = new Set(permissions?.filter(p => Boolean(p.canView)).map(p => Number(p.hostId)))
  const matched = new Map<number, { id: number; name: string }>()
  for (const link of links) {
    if (permissions && !visible.has(link.host.id)) continue
    try {
      const url = new URL(resolveAssociatedLinkTemplate(link.urlTemplate, link.host))
      if (url.protocol === 'https:' && !url.username && !url.password && url.origin === origin) matched.set(link.host.id, { id: link.host.id, name: link.host.name })
    } catch { /* Invalid legacy links do not suggest a connection. */ }
  }
  return [...matched.values()].sort((a,b) => a.name.localeCompare(b.name) || a.id - b.id).slice(0,50)
}
