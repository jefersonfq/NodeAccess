import type { CreateHostDto, HostPublic } from '@nodeaccess/shared'

/** Copy editable configuration only; never copy identity, trust, grants or secrets. */
export function duplicateHostDraft(host: HostPublic, name: string): Omit<CreateHostDto, 'inventoryParentId'> & { inventoryParentId?: number } {
  return {
    name: name.slice(0, 100), ip: '', port: host.port,
    description: host.description ?? '',
    accessProtocol: host.accessProtocol, operatingSystem: host.operatingSystem,
    deviceProfile: host.deviceProfile, sshUser: host.sshUser,
    authType: host.authType, connectionMode: host.connectionMode,
    privateAccessConnectorId: host.privateAccessConnectorId ?? null,
    scope: host.scope, groupId: host.groupId ?? undefined,
    folderId: host.folderId ?? undefined,
    inventoryParentId: host.inventoryParentId ?? undefined,
    bastionId: host.bastionId ?? undefined,
    pemKeyId: host.pemKeyId ?? undefined,
    onePasswordRef: host.onePasswordRef ?? undefined,
    password: '', passwordSecretId: host.passwordSecretId ?? null,
    startupSnippetId: host.startupSnippetId ?? null,
    startupSnippetMode: host.startupSnippetMode ?? 'disabled',
    tagNames: host.tags.map(tag => tag.name),
    associatedLinks: (host.associatedLinks ?? []).map((link, position) => ({
      label: link.label, urlTemplate: link.urlTemplate, position,
      enabled: link.enabled, openMode: link.openMode,
      sourceType: 'manual', sourceStatus: 'manual',
    })),
  }
}
