import { createHash, randomUUID } from 'node:crypto'
import type { Redis } from 'ioredis'
import type {
  GuacamoleAclMapping,
  GuacamoleImportCommitResponse,
  GuacamoleImportPreviewRequest,
  GuacamoleImportPreviewResponse,
  InventoryAclEntryPublic,
  InventoryNodePublic,
} from '@nodeaccess/shared'
import { NotFoundError, ValidationError } from '../../shared/errors.js'
import { decrypt, encrypt } from '../../shared/crypto.js'
import type { HostService } from '../hosts/host.service.js'
import type { InventoryAclService } from '../inventory/inventory-acl.service.js'
import type { InventoryService } from '../inventory/inventory.service.js'
import type { SecretService } from '../secrets/secret.service.js'

const PREVIEW_TTL_SECONDS = 15 * 60
const key = (tenantId: number, actorId: number, id: string) => `host-import:guacamole:${tenantId}:${actorId}:${id}`
const normalize = (value: string) => value.trim().toLowerCase()
const pathKey = (path: string[]) => path.map(normalize).join('/')

interface StoredPreview extends Omit<GuacamoleImportPreviewRequest, 'hosts'> {
  tenantId: number
  actorId: number
  role: 'ADMIN' | 'USER'
  readySourceIds: string[]
  hosts: Array<Omit<GuacamoleImportPreviewRequest['hosts'][number], 'password'> & { passwordEncrypted?: string }>
}

interface AppliedAcl {
  nodeId: number
  mapping: GuacamoleAclMapping
  before: InventoryAclEntryPublic | null
}

export class HostImportService {
  constructor(
    private readonly redis: Redis,
    private readonly hostService: HostService,
    private readonly inventoryService: InventoryService,
    private readonly inventoryAclService: InventoryAclService,
    private readonly secretService: SecretService,
  ) {}

  async preview(
    request: GuacamoleImportPreviewRequest,
    tenantId: number,
    actorId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<GuacamoleImportPreviewResponse> {
    if (request.importCredentials && role !== 'ADMIN') {
      throw new ValidationError('Apenas administradores podem importar credenciais')
    }
    if (request.importCredentials) await this.secretService.list(actorId, tenantId, 'admin')
    const tree = await this.inventoryService.list(tenantId, actorId, role)
    const destination = tree.find(node => node.id === request.destinationId && (node.type === 'ROOT' || node.type === 'FOLDER'))
    if (!destination) throw new NotFoundError('Pasta de destino do inventário')

    const endpoints = new Set<string>()
    const sourceIds = new Set<string>()
    const readySourceIds: string[] = []
    const report = request.hosts.map(host => {
      const warnings = [...host.warnings]
      const endpoint = `${host.accessProtocol}|${normalize(host.ip)}|${host.port}|${normalize(host.sshUser)}`
      const duplicate = endpoints.has(endpoint) || sourceIds.has(host.sourceId)
      endpoints.add(endpoint)
      sourceIds.add(host.sourceId)
      if (duplicate) warnings.push('duplicate-in-preview')
      else readySourceIds.push(host.sourceId)
      return {
        sourceId: host.sourceId,
        name: host.name,
        status: duplicate ? 'blocked' as const : 'ready' as const,
        destinationPath: [destination.name, ...(request.preserveHierarchy ? host.folderPath : [])].join(' / '),
        warnings,
      }
    })

    const foldersToCreate = this.countMissingFolders(tree, request.destinationId, request.preserveHierarchy
      ? request.hosts.filter(host => readySourceIds.includes(host.sourceId)).map(host => host.folderPath)
      : [])
    const previewId = randomUUID()
    const expiresAt = new Date(Date.now() + PREVIEW_TTL_SECONDS * 1000).toISOString()
    const stored: StoredPreview = {
      ...request,
      hosts: request.hosts.map(({ password, ...host }) => ({
        ...host,
        ...(password ? { passwordEncrypted: JSON.stringify(encrypt(password)) } : {}),
      })),
      tenantId, actorId, role, readySourceIds,
    }
    await this.redis.set(key(tenantId, actorId, previewId), JSON.stringify(stored), 'EX', PREVIEW_TTL_SECONDS)

    return {
      previewId,
      expiresAt,
      summary: {
        detected: request.hosts.length,
        ready: readySourceIds.length,
        blocked: request.hosts.length - readySourceIds.length,
        foldersToCreate,
        aclMappings: request.aclMappings.length,
        warnings: report.filter(row => row.warnings.length).length,
        credentialsDetected: request.hosts.filter(host => host.password).length,
        credentialsToImport: request.importCredentials
          ? request.hosts.filter(host => host.password && readySourceIds.includes(host.sourceId)).length
          : 0,
      },
      report,
    }
  }

  async commit(
    previewId: string,
    tenantId: number,
    actorId: number,
    currentRole: 'ADMIN' | 'USER' = 'USER',
  ): Promise<GuacamoleImportCommitResponse> {
    const raw = await this.redis.call('GETDEL', key(tenantId, actorId, previewId)) as string | null
    if (!raw) throw new NotFoundError('Preview expirado ou já utilizado')
    const preview = JSON.parse(raw) as StoredPreview
    if (preview.tenantId !== tenantId || preview.actorId !== actorId) throw new ValidationError('Preview pertence a outro contexto')
    if (preview.importCredentials && currentRole !== 'ADMIN') {
      throw new ValidationError('Apenas administradores podem importar credenciais')
    }

    const tree = await this.inventoryService.list(tenantId, actorId, preview.role)
    const createdFolders: InventoryNodePublic[] = []
    const createdHostIds: number[] = []
    const createdSecretIds: number[] = []
    const appliedAcl: AppliedAcl[] = []
    const rows: GuacamoleImportCommitResponse['rows'] = []

    try {
      const destinationByPath = await this.ensureFolders(preview, tree, createdFolders)
      for (const host of preview.hosts.filter(item => preview.readySourceIds.includes(item.sourceId))) {
        const inventoryParentId = preview.preserveHierarchy && host.folderPath.length
          ? destinationByPath.get(pathKey(host.folderPath)) ?? preview.destinationId
          : preview.destinationId
        const password = preview.importCredentials && host.passwordEncrypted
          ? decrypt(JSON.parse(host.passwordEncrypted))
          : undefined
        const alias = password ? this.secretAlias(host.name, host.sourceId) : undefined
        if (password && alias) {
          const secret = await this.secretService.create(actorId, tenantId, 'admin', {
            alias,
            value: password,
            description: `Credencial importada do Guacamole para ${host.name}`,
            scope: 'TENANT',
            source: 'HOST_CONNECTION',
          })
          createdSecretIds.push(secret.id)
        }
        const created = await this.hostService.create({
          name: host.name,
          ip: host.ip,
          port: host.port,
          accessProtocol: host.accessProtocol,
          operatingSystem: 'unknown',
          sshUser: host.sshUser,
          authType: 'password',
          connectionMode: 'direct',
          scope: 'global',
          inventoryParentId,
          ...(password ? { password } : {}),
          ...(password && alias && host.accessProtocol === 'ssh' ? { onePasswordRef: `secret://${alias}` } : {}),
        }, tenantId, actorId, preview.role)
        createdHostIds.push(created.id)
        rows.push({ sourceId: host.sourceId, name: host.name, status: 'created', message: 'Importado' })
      }

      for (const mapping of preview.aclMappings) {
        const nodeId = mapping.folderPath.length
          ? destinationByPath.get(pathKey(mapping.folderPath))
          : preview.destinationId
        if (!nodeId) throw new ValidationError(`Pasta da ACL não encontrada: ${mapping.folderPath.join(' / ')}`)
        const entries = await this.inventoryAclService.listEntries(nodeId, tenantId, actorId, preview.role)
        const before = entries.find(entry => entry.local && entry.principalType === mapping.principalType && entry.principalId === mapping.principalId) ?? null
        await this.inventoryAclService.upsertEntry(nodeId, {
          principalType: mapping.principalType,
          principalId: mapping.principalId,
          permissions: mapping.permissions,
        }, tenantId, actorId, preview.role)
        appliedAcl.push({ nodeId, mapping, before })
      }

      return {
        status: 'committed',
        createdHosts: createdHostIds.length,
        createdFolders: createdFolders.length,
        createdSecrets: createdSecretIds.length,
        appliedAclMappings: appliedAcl.length,
        rolledBackHosts: 0,
        rolledBackFolders: 0,
        rolledBackSecrets: 0,
        rows,
      }
    } catch (error) {
      for (const acl of [...appliedAcl].reverse()) {
        try {
          if (acl.before) {
            await this.inventoryAclService.upsertEntry(acl.nodeId, {
              principalType: acl.before.principalType,
              principalId: acl.before.principalId,
              permissions: acl.before.permissions,
            }, tenantId, actorId, preview.role)
          } else {
            await this.inventoryAclService.deleteEntry(acl.nodeId, acl.mapping.principalType, acl.mapping.principalId, tenantId, actorId, preview.role)
          }
        } catch { /* best-effort rollback continues */ }
      }
      let rolledBackHosts = 0
      for (const id of [...createdHostIds].reverse()) {
        try { await this.hostService.delete(id, tenantId, actorId, preview.role); rolledBackHosts++ } catch { /* continue */ }
      }
      let rolledBackSecrets = 0
      for (const id of [...createdSecretIds].reverse()) {
        try { await this.secretService.delete(id, actorId, tenantId, 'admin'); rolledBackSecrets++ } catch { /* continue */ }
      }
      let rolledBackFolders = 0
      for (const folder of [...createdFolders].reverse()) {
        try { await this.inventoryService.deleteFolder(folder.id, tenantId, actorId); rolledBackFolders++ } catch { /* continue */ }
      }
      const message = error instanceof Error ? error.message : 'Falha desconhecida'
      return {
        status: 'rolled_back',
        createdHosts: 0,
        createdFolders: 0,
        createdSecrets: 0,
        appliedAclMappings: 0,
        rolledBackHosts,
        rolledBackFolders,
        rolledBackSecrets,
        rows: [
          ...rows.map(row => ({ ...row, status: 'rolled_back' as const, message })),
          { sourceId: 'commit', name: 'Importação', status: 'failed' as const, message },
        ],
      }
    }
  }

  private secretAlias(name: string, sourceId: string): string {
    const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72) || 'host'
    const suffix = createHash('sha256').update(sourceId).digest('hex').slice(0, 12)
    return `guacamole.${slug}.${suffix}`
  }

  private countMissingFolders(tree: InventoryNodePublic[], baseId: number, paths: string[][]): number {
    const virtual = tree.map(node => ({ ...node }))
    let nextId = -1
    let missing = 0
    for (const path of paths) {
      let parentId = baseId
      for (const name of path) {
        let child = virtual.find(node => node.type === 'FOLDER' && node.parentId === parentId && normalize(node.name) === normalize(name))
        if (!child) {
          child = { id: nextId--, parentId, type: 'FOLDER', hostId: null, name, path: '', depth: 0, createdAt: new Date(), updatedAt: new Date() }
          virtual.push(child)
          missing++
        }
        parentId = child.id
      }
    }
    return missing
  }

  private async ensureFolders(preview: StoredPreview, tree: InventoryNodePublic[], created: InventoryNodePublic[]): Promise<Map<string, number>> {
    const result = new Map<string, number>()
    if (!preview.preserveHierarchy) return result
    for (const path of preview.hosts.filter(host => preview.readySourceIds.includes(host.sourceId)).map(host => host.folderPath)) {
      let parentId = preview.destinationId
      const traversed: string[] = []
      for (const name of path) {
        traversed.push(name)
        const existing = tree.find(node => node.type === 'FOLDER' && node.parentId === parentId && normalize(node.name) === normalize(name))
        const folder = existing ?? await this.inventoryService.createFolder({ parentId, name }, preview.tenantId, preview.actorId)
        if (!existing) { tree.push(folder); created.push(folder) }
        parentId = folder.id
        result.set(pathKey(traversed), parentId)
      }
    }
    return result
  }
}
