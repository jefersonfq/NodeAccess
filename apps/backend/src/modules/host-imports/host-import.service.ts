import { createHash, randomUUID } from 'node:crypto'
import type { Redis } from 'ioredis'
import type {
  GuacamoleAclMapping,
  HostImportCommitResponse,
  HostImportHistoryResponse,
  HostImportPreviewRequest,
  HostImportPreviewResponse,
  HostImportRevertResponse,
  InventoryAclEntryPublic,
  InventoryNodePublic,
} from '@nodeaccess/shared'
import { NotFoundError, ValidationError } from '../../shared/errors.js'
import { decrypt, encrypt, type EncryptedPayload } from '../../shared/crypto.js'
import type { HostService } from '../hosts/host.service.js'
import type { InventoryAclService } from '../inventory/inventory-acl.service.js'
import type { InventoryService } from '../inventory/inventory.service.js'
import type { SecretService } from '../secrets/secret.service.js'
import type { LogRepository } from '../logs/log.repository.js'
import type { HostImportRepository } from './host-import.repository.js'

const PREVIEW_TTL_SECONDS = 15 * 60
const key = (tenantId: number, actorId: number, id: string) => `host-import:${tenantId}:${actorId}:${id}`
const normalize = (value: string) => value.trim().toLowerCase()
const pathKey = (path: string[]) => path.map(normalize).join('/')

interface StoredPreview extends Omit<HostImportPreviewRequest, 'hosts'> {
  tenantId: number
  actorId: number
  role: 'ADMIN' | 'USER'
  readySourceIds: string[]
  hosts: Array<Omit<HostImportPreviewRequest['hosts'][number], 'password'> & {
    passwordEncrypted?: string
    existingHostId?: number
    existingHostBefore?: { name: string; ip: string; port: number; sshUser: string; inventoryParentId?: number; connectionMode?: 'direct' | 'agent' | 'agent_user' | 'agent_tenant_fallback' | 'private_access_connector' | 'auto' }
  }>
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
    private readonly logRepository?: LogRepository,
    private readonly importRepository?: HostImportRepository,
  ) {}

  async preview(
    request: HostImportPreviewRequest,
    tenantId: number,
    actorId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<HostImportPreviewResponse> {
    if (request.source === 'mobaxterm') {
      if (request.importCredentials || request.hosts.some(host => host.password || host.onePasswordRef)) {
        throw new ValidationError('Credenciais do MobaXterm não podem ser importadas')
      }
      if (request.hosts.some(host => host.accessProtocol !== 'ssh')) {
        throw new ValidationError('Apenas sessões SSH do MobaXterm podem ser importadas')
      }
    }
    if (request.importCredentials && role !== 'ADMIN') {
      throw new ValidationError('Apenas administradores podem importar credenciais')
    }
    if (request.importCredentials) await this.secretService.list(actorId, tenantId, 'admin')
    const tree = await this.inventoryService.list(tenantId, actorId, role)
    const destination = tree.find(node => node.id === request.destinationId && (node.type === 'ROOT' || node.type === 'FOLDER'))
    if (!destination) throw new NotFoundError('Pasta de destino do inventário')

    const duplicateStrategy = request.duplicateStrategy ?? 'skip'
    if (duplicateStrategy === 'update' && role !== 'ADMIN') {
      throw new ValidationError('Apenas administradores podem atualizar hosts duplicados')
    }
    const existingHosts = typeof this.hostService.findImportDuplicates === 'function'
      ? await this.hostService.findImportDuplicates(tenantId, request.hosts.map(host => ({
          ip: host.ip,
          port: host.port,
          sshUser: host.sshUser,
          accessProtocol: host.accessProtocol,
        })))
      : []
    const existingByEndpoint = new Map(existingHosts.map(host => [
      `${host.accessProtocol.toLowerCase()}|${normalize(host.ip)}|${host.port}|${normalize(host.sshUser ?? '')}`,
      host,
    ]))
    const endpoints = new Set<string>()
    const sourceIds = new Set<string>()
    const readySourceIds: string[] = []
    const report = request.hosts.map(host => {
      const warnings = [...host.warnings]
      const endpoint = `${host.accessProtocol}|${normalize(host.ip)}|${host.port}|${normalize(host.sshUser)}`
      const duplicate = endpoints.has(endpoint) || sourceIds.has(host.sourceId)
      const existing = existingByEndpoint.get(endpoint)
      const missingSshUser = host.accessProtocol === 'ssh' && !normalize(host.sshUser)
      const unresolvedBastion = host.requiresBastion === true && !host.bastionId
      endpoints.add(endpoint)
      sourceIds.add(host.sourceId)
      if (duplicate) warnings.push('duplicate-in-preview')
      if (existing) warnings.push('duplicate-existing-host')
      if (missingSshUser) warnings.push('missing-ssh-user')
      if (unresolvedBastion) warnings.push('unresolved-bastion')
      const blocked = duplicate || missingSshUser || (unresolvedBastion && (request.unresolvedBastionPolicy ?? 'block') === 'block')
      const skippedDuplicate = Boolean(existing) && duplicateStrategy === 'skip'
      if (!blocked && !skippedDuplicate) readySourceIds.push(host.sourceId)
      return {
        sourceId: host.sourceId,
        name: host.name,
        status: blocked ? 'blocked' as const : skippedDuplicate ? 'duplicate' as const : 'ready' as const,
        destinationPath: [destination.name, ...(request.preserveHierarchy ? host.folderPath : [])].join(' / '),
        warnings,
        ...(existing ? { existingHostId: existing.id } : {}),
        ...(existing ? { existingHost: { id: existing.id, name: existing.name, ip: existing.ip, port: existing.port, sshUser: existing.sshUser ?? '' } } : {}),
      }
    })

    const foldersToCreate = this.countMissingFolders(tree, request.destinationId, request.preserveHierarchy
      ? request.hosts.filter(host => readySourceIds.includes(host.sourceId)).map(host => host.folderPath)
      : [])
    const previewId = randomUUID()
    const expiresAt = new Date(Date.now() + PREVIEW_TTL_SECONDS * 1000).toISOString()
    const stored: StoredPreview = {
      ...request,
      duplicateStrategy,
      hosts: request.hosts.map(({ password, ...host }) => ({
        ...host,
        ...(existingByEndpoint.get(`${host.accessProtocol}|${normalize(host.ip)}|${host.port}|${normalize(host.sshUser)}`)
          ? (() => {
              const existing = existingByEndpoint.get(`${host.accessProtocol}|${normalize(host.ip)}|${host.port}|${normalize(host.sshUser)}`)!
              return {
                existingHostId: existing.id,
                existingHostBefore: {
                  name: existing.name, ip: existing.ip, port: existing.port,
                  sshUser: existing.sshUser ?? '', ...(existing.inventoryParentId ? { inventoryParentId: existing.inventoryParentId } : {}),
                  ...(existing.connectionMode ? { connectionMode: existing.connectionMode } : {}),
                },
              }
            })()
          : {}),
        ...(password ? { passwordEncrypted: JSON.stringify(encrypt(password)) } : {}),
      })),
      tenantId, actorId, role, readySourceIds,
    }
    await this.redis.set(key(tenantId, actorId, previewId), JSON.stringify(stored), 'EX', PREVIEW_TTL_SECONDS)

    const hostsToUpdate = report.filter(row => row.status === 'ready' && row.existingHostId !== undefined && duplicateStrategy === 'update').length
    const hostsToCreate = report.filter(row => row.status === 'ready' && !(row.existingHostId !== undefined && duplicateStrategy === 'update')).length
    const hostsToSkip = report.filter(row => row.status !== 'ready').length

    const summary = {
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
        duplicates: report.filter(row => row.existingHostId !== undefined).length,
        hostsToCreate,
        hostsToUpdate,
        hostsToSkip,
        privateHostsViaAgent: request.hosts.filter(host => ['agent', 'agent_tenant_fallback', 'agent_user'].includes(host.connectionMode ?? '')).length,
        unresolvedBastions: request.hosts.filter(host => host.requiresBastion && !host.bastionId).length,
        reversible: true,
    }
    const jobId = await this.importRepository?.createPreview({
      tenantId, actorId, previewId, source: request.source,
      detectedHosts: summary.detected, readyHosts: summary.ready, blockedHosts: summary.blocked,
      impact: { summary, report },
    })

    return {
      previewId,
      ...(jobId ? { jobId } : {}),
      expiresAt,
      summary,
      report,
    }
  }

  async commit(
    previewId: string,
    tenantId: number,
    actorId: number,
    currentRole: 'ADMIN' | 'USER' = 'USER',
  ): Promise<HostImportCommitResponse> {
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
    const updatedHostIds: number[] = []
    const appliedAcl: AppliedAcl[] = []
    const rows: HostImportCommitResponse['rows'] = []

    try {
      const destinationByPath = await this.ensureFolders(preview, tree, createdFolders)
      for (const host of preview.hosts.filter(item => preview.readySourceIds.includes(item.sourceId))) {
        const inventoryParentId = preview.preserveHierarchy && host.folderPath.length
          ? destinationByPath.get(pathKey(host.folderPath)) ?? preview.destinationId
          : preview.destinationId
        const password = preview.importCredentials && host.passwordEncrypted
          ? decrypt(JSON.parse(host.passwordEncrypted) as EncryptedPayload)
          : undefined
        const alias = password ? this.secretAlias(preview.source, host.name, host.sourceId) : undefined
        if (password && alias) {
          const secret = await this.secretService.create(actorId, tenantId, 'admin', {
            alias,
            value: password,
            description: `Credencial importada de ${preview.source} para ${host.name}`,
            scope: 'TENANT',
            source: 'HOST_CONNECTION',
          })
          createdSecretIds.push(secret.id)
        }
        if (host.existingHostId && preview.duplicateStrategy === 'update') {
          await this.hostService.update(host.existingHostId, {
            name: host.name,
            ip: host.ip,
            port: host.port,
            sshUser: host.sshUser,
            connectionMode: host.connectionMode ?? 'direct',
            inventoryParentId,
          }, tenantId, actorId, currentRole)
          updatedHostIds.push(host.existingHostId)
          rows.push({ sourceId: host.sourceId, name: host.name, status: 'updated', message: 'Host existente atualizado', hostId: host.existingHostId })
          continue
        }
        const created = await this.hostService.create({
          name: host.name,
          ip: host.ip,
          port: host.port,
          accessProtocol: host.accessProtocol,
          operatingSystem: 'unknown',
          sshUser: host.sshUser,
          authType: host.authType ?? 'password',
          connectionMode: host.connectionMode ?? 'direct',
          scope: 'global',
          inventoryParentId,
          ...(host.bastionId ? { bastionId: host.bastionId } : {}),
          ...(host.pemKeyId ? { pemKeyId: host.pemKeyId } : {}),
          ...(password ? { password } : {}),
          ...(password && alias && host.accessProtocol === 'ssh' ? { onePasswordRef: `secret://${alias}` } : {}),
          ...(!password && host.onePasswordRef && host.accessProtocol === 'ssh' ? { onePasswordRef: host.onePasswordRef } : {}),
        }, tenantId, actorId, preview.role)
        createdHostIds.push(created.id)
        rows.push({ sourceId: host.sourceId, name: host.name, status: 'created', message: 'Importado', hostId: created.id })
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

      for (const host of preview.hosts.filter(item => item.existingHostId && !preview.readySourceIds.includes(item.sourceId))) {
        rows.push({ sourceId: host.sourceId, name: host.name, status: 'skipped', message: 'Duplicado ignorado', hostId: host.existingHostId })
      }
      const snapshot = {
        createdHostIds,
        updatedHostIds,
        updatedHostSnapshots: preview.hosts
          .filter(host => host.existingHostId && updatedHostIds.includes(host.existingHostId) && host.existingHostBefore)
          .map(host => ({ id: host.existingHostId!, before: host.existingHostBefore! })),
        createdFolderIds: createdFolders.map(folder => folder.id),
        createdSecretIds,
      }
      if (this.logRepository) await this.logRepository.logAdminEvent({
        adminId: actorId,
        action: 'HOST_IMPORT_COMMITTED',
        targetType: 'HostImport',
        targetId: actorId,
        details: JSON.stringify({
          source: preview.source,
          ...snapshot,
          createdHosts: createdHostIds.length,
          updatedHosts: updatedHostIds.length,
          createdFolders: createdFolders.length,
          status: 'committed',
        }),
      })
      const persistedImportId = await this.importRepository?.markCommitted(previewId, {
        createdHosts: createdHostIds.length,
        updatedHosts: updatedHostIds.length,
        createdFolders: createdFolders.length,
        snapshot,
      })
      const legacyImportLog = !persistedImportId && this.logRepository
        ? await this.logRepository.findAdminLogs(tenantId, { action: 'HOST_IMPORT_COMMITTED', targetType: 'HostImport', targetId: actorId, limit: 1 })
        : null
      const importId = persistedImportId ?? legacyImportLog?.logs[0]?.id
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
        ...(importId ? { importId } : {}),
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
      for (const host of [...preview.hosts].reverse()) {
        if (!updatedHostIds.includes(host.existingHostId ?? -1) || !host.existingHostId || !host.existingHostBefore) continue
        try {
          await this.hostService.update(host.existingHostId, host.existingHostBefore, tenantId, actorId, currentRole)
          rolledBackHosts++
        } catch { /* continue */ }
      }
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

  async history(tenantId: number): Promise<HostImportHistoryResponse> {
    if (this.importRepository) {
      const jobs = await this.importRepository.list(tenantId)
      return {
        total: jobs.length,
        items: jobs.map(job => ({
          id: job.id,
          source: job.source as HostImportPreviewRequest['source'],
          actorName: job.actorName,
          timestamp: (job.completedAt ?? job.createdAt).toISOString(),
          status: job.status === 'COMMITTED' ? 'committed' as const : 'reverted' as const,
          createdHosts: job.createdHosts,
          updatedHosts: job.updatedHosts,
          createdFolders: job.createdFolders,
          canRevert: job.status === 'COMMITTED' && Boolean(job.snapshotJson),
        })),
      }
    }
    if (!this.logRepository) return { items: [], total: 0 }
    const [commits, reversals] = await Promise.all([
      this.logRepository.findAdminLogs(tenantId, { action: 'HOST_IMPORT_COMMITTED', targetType: 'HostImport', limit: 100 }),
      this.logRepository.findAdminLogs(tenantId, { action: 'HOST_IMPORT_REVERTED', targetType: 'HostImport', limit: 100 }),
    ])
    const revertedIds = new Set(reversals.logs.flatMap(log => {
      try { return [Number((JSON.parse(log.details ?? '{}') as { importId?: number }).importId)] } catch { return [] }
    }))
    const items = commits.logs.map(log => {
      let details: { source?: HostImportPreviewRequest['source']; createdHosts?: number; updatedHosts?: number; createdFolders?: number } = {}
      try { details = JSON.parse(log.details ?? '{}') as typeof details } catch { /* malformed legacy entry */ }
      const reverted = revertedIds.has(log.id)
      return {
        id: log.id,
        source: details.source ?? 'mobaxterm',
        actorName: log.admin.name,
        timestamp: log.timestamp.toISOString(),
        status: reverted ? 'reverted' as const : 'committed' as const,
        createdHosts: details.createdHosts ?? 0,
        updatedHosts: details.updatedHosts ?? 0,
        createdFolders: details.createdFolders ?? 0,
        canRevert: !reverted && ((details.createdHosts ?? 0) > 0 || (details.updatedHosts ?? 0) > 0 || (details.createdFolders ?? 0) > 0),
      }
    })
    return { items, total: commits.total }
  }

  async revert(importId: number, tenantId: number, actorId: number, role: 'ADMIN' | 'USER'): Promise<HostImportRevertResponse> {
    if (role !== 'ADMIN') throw new ValidationError('Apenas administradores podem reverter importações')
    const persistedJob = await this.importRepository?.findById(tenantId, importId)
    if (persistedJob && persistedJob.status !== 'COMMITTED') throw new ValidationError('Importação já revertida')
    let rawSnapshot = persistedJob?.snapshotJson ?? null
    if (!rawSnapshot) {
      if (!this.logRepository) throw new NotFoundError('Histórico de importação')
      const history = await this.logRepository.findAdminLogs(tenantId, { action: 'HOST_IMPORT_COMMITTED', targetType: 'HostImport', limit: 100 })
      const log = history.logs.find(item => item.id === importId)
      if (!log) throw new NotFoundError('Importação')
      const existingReversal = await this.logRepository.findAdminLogs(tenantId, {
        action: 'HOST_IMPORT_REVERTED', targetType: 'HostImport', detailsContains: [`"importId":${importId}`], limit: 1,
      })
      if (existingReversal.total) throw new ValidationError('Importação já revertida')
      rawSnapshot = log.details ?? '{}'
    }
    const details = JSON.parse(rawSnapshot) as {
      createdHostIds?: number[]
      updatedHostIds?: number[]
      updatedHostSnapshots?: Array<{ id: number; before: { name: string; ip: string; port: number; sshUser: string; inventoryParentId?: number; connectionMode?: 'direct' | 'agent' | 'agent_user' | 'agent_tenant_fallback' | 'private_access_connector' | 'auto' } }>
      createdFolderIds?: number[]
      createdSecretIds?: number[]
    }
    const failures: string[] = []
    let revertedHosts = 0
    for (const id of [...(details.createdHostIds ?? [])].reverse()) {
      try { await this.hostService.delete(id, tenantId, actorId, role); revertedHosts++ } catch (error) {
        failures.push(`Host ${id}: ${error instanceof Error ? error.message : 'falha desconhecida'}`)
      }
    }
    const snapshots = new Map((details.updatedHostSnapshots ?? []).map(snapshot => [snapshot.id, snapshot.before]))
    for (const id of [...(details.updatedHostIds ?? [])].reverse()) {
      const before = snapshots.get(id)
      if (!before) {
        failures.push(`Host ${id}: snapshot anterior indisponível; atualização preservada`)
        continue
      }
      try {
        await this.hostService.update(id, before, tenantId, actorId, role)
        revertedHosts++
      } catch (error) {
        failures.push(`Host ${id}: ${error instanceof Error ? error.message : 'falha desconhecida'}`)
      }
    }
    for (const id of [...(details.createdSecretIds ?? [])].reverse()) {
      try {
        await this.secretService.delete(id, actorId, tenantId, 'admin')
      } catch (error) {
        failures.push(`Secret ${id}: ${error instanceof Error ? error.message : 'falha desconhecida'}`)
      }
    }
    let revertedFolders = 0
    for (const id of [...(details.createdFolderIds ?? [])].reverse()) {
      try { await this.inventoryService.deleteFolder(id, tenantId, actorId); revertedFolders++ } catch (error) {
        failures.push(`Pasta ${id}: ${error instanceof Error ? error.message : 'falha desconhecida'}`)
      }
    }
    if (persistedJob) await this.importRepository!.markReverted(importId, failures.length > 0)
    if (this.logRepository) await this.logRepository.logAdminEvent({
      adminId: actorId,
      action: 'HOST_IMPORT_REVERTED',
      targetType: 'HostImport',
      targetId: actorId,
      details: JSON.stringify({ importId, revertedHosts, revertedFolders, failures }),
    })
    return {
      status: failures.length ? 'partially_reverted' : 'reverted',
      revertedHosts,
      revertedFolders,
      failures,
    }
  }

  private secretAlias(source: string, name: string, sourceId: string): string {
    const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72) || 'host'
    const suffix = createHash('sha256').update(sourceId).digest('hex').slice(0, 12)
    return `${source}.${slug}.${suffix}`
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
