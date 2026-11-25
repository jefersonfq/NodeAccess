import type { VaultSiteCreate, VaultSiteUpdate, VaultSiteList, VaultSiteMetadata } from '../../../../packages/shared/src/schemas/vault-sites.schema'
export type { VaultSiteMetadata } from '../../../../packages/shared/src/schemas/vault-sites.schema'

/** Transport injected by the extension or portal; it owns authentication and authorization. */
export interface SitesClient {
  list(query: VaultSiteList): Promise<{ items: VaultSiteMetadata[]; next: number | null }>
  create(input: VaultSiteCreate): Promise<unknown>
  update(input: VaultSiteUpdate): Promise<unknown>
}
export interface SiteWriteAccess { groups: { id: number; name: string }[]; tenant: boolean }
export interface SiteHostOption { id: number; name: string }
