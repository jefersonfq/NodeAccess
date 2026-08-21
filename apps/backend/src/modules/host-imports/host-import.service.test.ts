import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.DATABASE_URL ||= 'mysql://user:pass@127.0.0.1:3306/nodeaccess_test'
  process.env.REDIS_URL ||= 'redis://127.0.0.1:6379'
  process.env.JWT_SECRET ||= 'test-jwt-secret-with-at-least-32-chars'
  process.env.PEM_ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  process.env.NODE_ENV ||= 'test'
})
import { HostImportService } from './host-import.service'

const root = {
  id: 1, parentId: null, type: 'ROOT' as const, hostId: null, name: 'Inventário', path: '/', depth: 0,
  createdAt: new Date(), updatedAt: new Date(),
}

const request = {
  source: 'guacamole' as const,
  destinationId: 1,
  preserveHierarchy: true,
  hosts: [
    { sourceId: '1', name: 'Linux', ip: '10.0.0.1', port: 22, accessProtocol: 'ssh' as const, sshUser: 'ubuntu', folderPath: ['Brasil', 'Produção'], warnings: [] },
    { sourceId: '2', name: 'Windows', ip: '10.0.0.2', port: 3389, accessProtocol: 'rdp' as const, sshUser: '', folderPath: ['Brasil'], warnings: [] },
  ],
  aclMappings: [],
  sourceStats: { invalidConnections: 0, unsupportedProtocols: [], unmappedPermissions: 0 },
}

describe('HostImportService', () => {
  let storage: Map<string, string>
  let redis: any
  let hosts: any
  let inventory: any
  let acl: any
  let secrets: any
  let logs: any
  let service: HostImportService

  beforeEach(() => {
    storage = new Map()
    redis = {
      set: vi.fn(async (key: string, value: string) => { storage.set(key, value); return 'OK' }),
      get: vi.fn(async (key: string) => storage.get(key) ?? null),
      del: vi.fn(async (key: string) => Number(storage.delete(key))),
      call: vi.fn(async (command: string, key: string) => {
        if (command !== 'GETDEL') throw new Error(`unexpected Redis command: ${command}`)
        const value = storage.get(key) ?? null
        storage.delete(key)
        return value
      }),
    }
    let folderId = 10
    inventory = {
      list: vi.fn(async () => [root]),
      createFolder: vi.fn(async ({ parentId, name }: { parentId: number; name: string }) => ({
        ...root, id: folderId++, parentId, type: 'FOLDER', name,
      })),
      deleteFolder: vi.fn(async () => undefined),
    }
    let hostId = 100
    hosts = {
      create: vi.fn(async (dto: any) => ({ ...dto, id: hostId++ })),
      update: vi.fn(async (id: number, dto: any) => ({ ...dto, id })),
      delete: vi.fn(async () => undefined),
    }
    acl = {
      listEntries: vi.fn(async () => []),
      upsertEntry: vi.fn(async () => []),
      deleteEntry: vi.fn(async () => undefined),
    }
    let secretId = 500
    secrets = {
      list: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: secretId++ })),
      delete: vi.fn(async () => undefined),
    }
    logs = {
      logAdminEvent: vi.fn(async () => undefined),
      findAdminLogs: vi.fn(async () => ({ logs: [], total: 0 })),
    }
    service = new HostImportService(redis, hosts, inventory, acl, secrets, logs)
  })

  it('imports connection passwords only with explicit admin consent and never exposes them in preview', async () => {
    const withCredential = {
      ...request,
      importCredentials: true,
      hosts: [{ ...request.hosts[0], password: 'remote-password' }],
    }
    await expect(service.preview(withCredential, 7, 9, 'USER')).rejects.toThrow('Apenas administradores')

    const preview = await service.preview(withCredential, 7, 9, 'ADMIN')
    expect(JSON.stringify(preview)).not.toContain('remote-password')
    expect(preview.summary.credentialsToImport).toBe(1)
    const stored = [...storage.values()][0]
    expect(stored).not.toContain('remote-password')

    const result = await service.commit(preview.previewId, 7, 9, 'ADMIN')
    expect(result.createdSecrets).toBe(1)
    expect(secrets.create).toHaveBeenCalledWith(9, 7, 'admin', expect.objectContaining({
      value: 'remote-password', scope: 'TENANT', source: 'HOST_CONNECTION',
    }))
    expect(hosts.create).toHaveBeenCalledWith(expect.objectContaining({
      password: 'remote-password', onePasswordRef: expect.stringMatching(/^secret:\/\/guacamole\./),
    }), 7, 9, 'ADMIN')
  })

  it('rolls imported secrets back together with hosts and folders', async () => {
    hosts.create.mockRejectedValueOnce(new Error('falha simulada'))
    const preview = await service.preview({
      ...request,
      importCredentials: true,
      hosts: [{ ...request.hosts[0], password: 'remote-password' }],
    }, 7, 9, 'ADMIN')
    const result = await service.commit(preview.previewId, 7, 9, 'ADMIN')

    expect(result.rolledBackSecrets).toBe(1)
    expect(secrets.delete).toHaveBeenCalledWith(500, 9, 7, 'admin')
  })

  it('creates a tenant-bound expiring preview with folder impact', async () => {
    const preview = await service.preview(request, 7, 9, 'ADMIN')

    expect(preview.summary).toEqual(expect.objectContaining({ detected: 2, ready: 2, foldersToCreate: 2 }))
    expect(preview.report[0].destinationPath).toBe('Inventário / Brasil / Produção')
    expect(redis.set).toHaveBeenCalledWith(expect.stringContaining(preview.previewId), expect.any(String), 'EX', 900)
  })

  it('persists the import lifecycle independently from audit logs', async () => {
    const jobs = {
      createPreview: vi.fn(async () => 71),
      markCommitted: vi.fn(async () => 71),
      list: vi.fn(async () => [{
        id: 71, tenantId: 7, actorId: 9, actorName: 'Admin', previewId: 'preview', source: 'csv', status: 'COMMITTED',
        detectedHosts: 1, readyHosts: 1, blockedHosts: 0, createdHosts: 1, updatedHosts: 0, createdFolders: 0,
        impactJson: '{}', snapshotJson: '{}', createdAt: new Date(), completedAt: new Date(), revertedAt: null,
      }]),
      findById: vi.fn(),
      markReverted: vi.fn(),
    }
    const persistedService = new HostImportService(redis, hosts, inventory, acl, secrets, logs, jobs as any)
    const preview = await persistedService.preview({ ...request, hosts: [request.hosts[0]] }, 7, 9, 'ADMIN')
    expect(preview.jobId).toBe(71)
    const result = await persistedService.commit(preview.previewId, 7, 9, 'ADMIN')
    expect(result.importId).toBe(71)
    expect(jobs.markCommitted).toHaveBeenCalledWith(preview.previewId, expect.objectContaining({ createdHosts: 1 }))
    await expect(persistedService.history(7)).resolves.toMatchObject({ total: 1, items: [{ id: 71, canRevert: true }] })
  })

  it('reports preview storage connection failures without creating import data', async () => {
    redis.set.mockRejectedValueOnce(new Error('Redis indisponível'))

    await expect(service.preview(request, 7, 9, 'ADMIN')).rejects.toThrow('Redis indisponível')
    expect(hosts.create).not.toHaveBeenCalled()
    expect(inventory.createFolder).not.toHaveBeenCalled()
  })

  it('previews and commits a normalized MobaXterm migration without importing credentials', async () => {
    const mobaRequest = {
      ...request,
      source: 'mobaxterm' as const,
      importCredentials: false,
      hosts: [{
        sourceId: 'mobaxterm:0:0:4',
        name: 'Servidor do usuário',
        ip: 'moba.example.test',
        port: 22,
        accessProtocol: 'ssh' as const,
        sshUser: 'deploy',
        folderPath: ['Pessoal', 'Produção'],
        warnings: ['private-key-reference-ignored'],
      }],
    }

    const preview = await service.preview(mobaRequest, 7, 9, 'USER')
    expect(preview.summary).toEqual(expect.objectContaining({ detected: 1, ready: 1, foldersToCreate: 2, credentialsDetected: 0 }))
    expect(preview.report[0]).toEqual(expect.objectContaining({ destinationPath: 'Inventário / Pessoal / Produção' }))

    const result = await service.commit(preview.previewId, 7, 9, 'USER')
    expect(result).toEqual(expect.objectContaining({ status: 'committed', createdHosts: 1, createdFolders: 2, createdSecrets: 0 }))
    expect(hosts.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Servidor do usuário',
      ip: 'moba.example.test',
      sshUser: 'deploy',
    }), 7, 9, 'USER')
    expect(secrets.create).not.toHaveBeenCalled()
  })

  it('uses the same secure transaction for CSV credentials and OpenSSH PEM/bastion metadata', async () => {
    const csvPreview = await service.preview({
      ...request,
      source: 'csv',
      importCredentials: true,
      hosts: [{ ...request.hosts[0], sourceId: 'csv:2', password: 'csv-secret' }],
    }, 7, 9, 'ADMIN')
    expect(JSON.stringify(csvPreview)).not.toContain('csv-secret')
    const csvResult = await service.commit(csvPreview.previewId, 7, 9, 'ADMIN')
    expect(csvResult).toEqual(expect.objectContaining({ status: 'committed', createdSecrets: 1 }))

    const sshPreview = await service.preview({
      ...request,
      source: 'openssh',
      hosts: [{ ...request.hosts[0], sourceId: 'ssh:prod', authType: 'pem', pemKeyId: 31, bastionId: 8, connectionMode: 'agent_tenant_fallback' as const }],
    }, 7, 9, 'ADMIN')
    await service.commit(sshPreview.previewId, 7, 9, 'ADMIN')
    expect(hosts.create).toHaveBeenLastCalledWith(expect.objectContaining({ authType: 'pem', pemKeyId: 31, bastionId: 8, connectionMode: 'agent_tenant_fallback' }), 7, 9, 'ADMIN')
  })

  it('rejects credentials and non-SSH protocols claimed as MobaXterm imports', async () => {
    await expect(service.preview({
      ...request,
      source: 'mobaxterm',
      importCredentials: true,
      hosts: [{ ...request.hosts[0], password: 'must-not-enter-the-import' }],
    }, 7, 9, 'ADMIN')).rejects.toThrow('Credenciais do MobaXterm')

    await expect(service.preview({
      ...request,
      source: 'mobaxterm',
      hosts: [{ ...request.hosts[1], sourceId: 'moba-rdp' }],
    }, 7, 9, 'ADMIN')).rejects.toThrow('Apenas sessões SSH')
  })

  it('blocks SSH sessions without a user during preview instead of failing during commit', async () => {
    const preview = await service.preview({
      ...request,
      source: 'mobaxterm',
      hosts: [{ ...request.hosts[0], sourceId: 'moba-no-user', sshUser: '' }],
    }, 7, 9, 'USER')

    expect(preview.summary).toEqual(expect.objectContaining({ ready: 0, blocked: 1 }))
    expect(preview.report[0]).toEqual(expect.objectContaining({
      status: 'blocked',
      warnings: expect.arrayContaining(['missing-ssh-user']),
    }))
  })

  it('blocks only unresolved jumpserver rows by default and allows an explicit override', async () => {
    const hostWithJump = { ...request.hosts[0], sourceId: 'jump-required', requiresBastion: true }
    const blocked = await service.preview({ ...request, hosts: [hostWithJump], unresolvedBastionPolicy: 'block' }, 7, 9, 'ADMIN')
    expect(blocked.summary).toMatchObject({ ready: 0, blocked: 1, unresolvedBastions: 1, hostsToSkip: 1 })
    expect(blocked.report[0]).toMatchObject({ status: 'blocked', warnings: expect.arrayContaining(['unresolved-bastion']) })

    const allowed = await service.preview({ ...request, hosts: [hostWithJump], unresolvedBastionPolicy: 'allow' }, 7, 9, 'ADMIN')
    expect(allowed.summary).toMatchObject({ ready: 1, blocked: 0, unresolvedBastions: 1 })
  })

  it('detects existing tenant hosts and applies skip, create, and admin-only update strategies', async () => {
    hosts.findImportDuplicates = vi.fn(async () => [{
      id: 55, name: 'Linux antigo', ip: '10.0.0.1', port: 22, sshUser: 'ubuntu', accessProtocol: 'SSH',
    }])
    const duplicateRequest = { ...request, hosts: [request.hosts[0]] }

    const skipped = await service.preview({ ...duplicateRequest, duplicateStrategy: 'skip' }, 7, 9, 'USER')
    expect(skipped.summary).toEqual(expect.objectContaining({ duplicates: 1, ready: 0 }))
    expect(skipped.report[0]).toEqual(expect.objectContaining({ status: 'duplicate', existingHostId: 55 }))

    const created = await service.preview({ ...duplicateRequest, duplicateStrategy: 'create' }, 7, 9, 'USER')
    await expect(service.commit(created.previewId, 7, 9, 'USER')).resolves.toMatchObject({ createdHosts: 1 })

    await expect(service.preview({ ...duplicateRequest, duplicateStrategy: 'update' }, 7, 9, 'USER')).rejects.toThrow('Apenas administradores')
    const updated = await service.preview({ ...duplicateRequest, duplicateStrategy: 'update' }, 7, 9, 'ADMIN')
    const updateResult = await service.commit(updated.previewId, 7, 9, 'ADMIN')
    expect(updateResult.rows[0]).toEqual(expect.objectContaining({ status: 'updated', hostId: 55 }))
    expect(hosts.update).toHaveBeenCalledWith(55, expect.objectContaining({ name: 'Linux' }), 7, 9, 'ADMIN')
  })

  it('lists audited imports and safely reverses only resources created by that import', async () => {
    logs.findAdminLogs.mockImplementation(async (_tenantId: number, filter: { action: string }) => filter.action === 'HOST_IMPORT_COMMITTED'
      ? { logs: [{
          id: 44, admin: { name: 'Admin' }, timestamp: new Date('2026-08-20T12:00:00Z'),
          details: JSON.stringify({ source: 'mobaxterm', createdHostIds: [100, 101], updatedHostIds: [], createdFolderIds: [10], createdSecretIds: [500], createdHosts: 2, updatedHosts: 0, createdFolders: 1 }),
        }], total: 1 }
      : { logs: [], total: 0 })

    await expect(service.history(7)).resolves.toEqual({
      total: 1,
      items: [expect.objectContaining({ id: 44, status: 'committed', canRevert: true, createdHosts: 2 })],
    })
    const result = await service.revert(44, 7, 9, 'ADMIN')
    expect(result).toEqual(expect.objectContaining({ status: 'reverted', revertedHosts: 2, revertedFolders: 1 }))
    expect(hosts.delete.mock.calls.map((call: any[]) => call[0])).toEqual([101, 100])
    expect(inventory.deleteFolder).toHaveBeenCalledWith(10, 7, 9)
    expect(secrets.delete).toHaveBeenCalledWith(500, 9, 7, 'admin')
    expect(logs.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'HOST_IMPORT_REVERTED' }))
  })

  it('restores updated duplicate snapshots and reports missing legacy snapshots without deleting the host', async () => {
    logs.findAdminLogs.mockImplementation(async (_tenantId: number, filter: { action: string }) => filter.action === 'HOST_IMPORT_COMMITTED'
      ? { logs: [{
          id: 45, admin: { name: 'Admin' }, timestamp: new Date('2026-08-20T12:00:00Z'),
          details: JSON.stringify({
            source: 'csv', createdHostIds: [], updatedHostIds: [55, 56], createdFolderIds: [],
            updatedHostSnapshots: [{ id: 55, before: { name: 'Original', ip: '10.0.0.1', port: 22, sshUser: 'ops', inventoryParentId: 1 } }],
            createdHosts: 0, updatedHosts: 2, createdFolders: 0,
          }),
        }], total: 1 }
      : { logs: [], total: 0 })

    const history = await service.history(7)
    expect(history.items[0]).toMatchObject({ canRevert: true, updatedHosts: 2 })
    const result = await service.revert(45, 7, 9, 'ADMIN')

    expect(result).toMatchObject({ status: 'partially_reverted', revertedHosts: 1 })
    expect(result.failures).toContain('Host 56: snapshot anterior indisponível; atualização preservada')
    expect(hosts.update).toHaveBeenCalledWith(55, expect.objectContaining({ name: 'Original', inventoryParentId: 1 }), 7, 9, 'ADMIN')
    expect(hosts.delete).not.toHaveBeenCalledWith(55, expect.anything(), expect.anything(), expect.anything())
  })

  it('restores updated duplicate fields if a later commit step fails', async () => {
    hosts.findImportDuplicates = vi.fn(async () => [{
      id: 55, name: 'Nome anterior', ip: '10.0.0.1', port: 22, sshUser: 'ubuntu', accessProtocol: 'SSH', inventoryParentId: 1,
    }])
    acl.upsertEntry.mockRejectedValueOnce(new Error('ACL indisponível'))
    const preview = await service.preview({
      ...request,
      duplicateStrategy: 'update',
      hosts: [{ ...request.hosts[0], name: 'Nome novo' }],
      aclMappings: [{
        sourcePrincipal: 'ops', principalType: 'GROUP' as const, principalId: 77, folderPath: [],
        permissions: { view: true, connect: true, edit: false, admin: false },
      }],
    }, 7, 9, 'ADMIN')
    const result = await service.commit(preview.previewId, 7, 9, 'ADMIN')

    expect(result).toEqual(expect.objectContaining({ status: 'rolled_back', rolledBackHosts: 1 }))
    expect(hosts.update).toHaveBeenLastCalledWith(55, expect.objectContaining({ name: 'Nome anterior', inventoryParentId: 1 }), 7, 9, 'ADMIN')
  })

  it('commits folders and hosts once and consumes the preview', async () => {
    const preview = await service.preview(request, 7, 9, 'ADMIN')
    const result = await service.commit(preview.previewId, 7, 9)

    expect(result).toEqual(expect.objectContaining({ status: 'committed', createdHosts: 2, createdFolders: 2 }))
    expect(inventory.createFolder).toHaveBeenCalledTimes(2)
    expect(hosts.create).toHaveBeenCalledTimes(2)
    await expect(service.commit(preview.previewId, 7, 9)).rejects.toThrow('Preview expirado')
  })

  it('isolates previews by tenant/actor and consumes the valid context atomically', async () => {
    const preview = await service.preview(request, 7, 9, 'ADMIN')
    await expect(service.commit(preview.previewId, 8, 9)).rejects.toThrow('Preview expirado')
    await expect(service.commit(preview.previewId, 7, 9)).resolves.toMatchObject({ status: 'committed' })
    await expect(service.commit(preview.previewId, 7, 9)).rejects.toThrow('Preview expirado')
    expect(redis.call).toHaveBeenCalledWith('GETDEL', expect.stringContaining(preview.previewId))
  })

  it('does not mutate inventory when consuming the preview fails', async () => {
    const preview = await service.preview(request, 7, 9, 'ADMIN')
    redis.call.mockRejectedValueOnce(new Error('Conexão Redis interrompida'))

    await expect(service.commit(preview.previewId, 7, 9)).rejects.toThrow('Conexão Redis interrompida')
    expect(hosts.create).not.toHaveBeenCalled()
    expect(inventory.createFolder).not.toHaveBeenCalled()
  })

  it('rolls a partially created hierarchy back when folder creation fails', async () => {
    inventory.createFolder
      .mockResolvedValueOnce({ ...root, id: 10, parentId: 1, type: 'FOLDER', name: 'Brasil' })
      .mockRejectedValueOnce(new Error('Falha ao criar subpasta'))
    const preview = await service.preview(request, 7, 9, 'ADMIN')
    const result = await service.commit(preview.previewId, 7, 9)

    expect(result).toEqual(expect.objectContaining({ status: 'rolled_back', rolledBackFolders: 1, createdHosts: 0 }))
    expect(inventory.deleteFolder).toHaveBeenCalledWith(10, 7, 9)
    expect(hosts.create).not.toHaveBeenCalled()
  })

  it('rolls hosts and folders back in reverse order when a host fails', async () => {
    hosts.create
      .mockResolvedValueOnce({ id: 100 })
      .mockRejectedValueOnce(new Error('falha simulada'))
    const preview = await service.preview(request, 7, 9, 'ADMIN')
    const result = await service.commit(preview.previewId, 7, 9)

    expect(result).toEqual(expect.objectContaining({
      status: 'rolled_back',
      rolledBackHosts: 1,
      rolledBackFolders: 2,
    }))
    expect(hosts.delete).toHaveBeenCalledWith(100, 7, 9, 'ADMIN')
    expect(inventory.deleteFolder.mock.calls.map((call: any[]) => call[0])).toEqual([11, 10])
  })

  it('applies optional ACL mappings after hosts are created', async () => {
    const withAcl = {
      ...request,
      aclMappings: [{
        sourcePrincipal: 'guacamole-operators',
        principalType: 'GROUP' as const,
        principalId: 77,
        folderPath: [],
        permissions: { view: true, connect: true, edit: false, admin: false },
      }],
    }
    const preview = await service.preview(withAcl, 7, 9, 'ADMIN')
    const result = await service.commit(preview.previewId, 7, 9)

    expect(result.appliedAclMappings).toBe(1)
    expect(acl.upsertEntry).toHaveBeenCalledWith(1, expect.objectContaining({ principalId: 77 }), 7, 9, 'ADMIN')
  })

  it('removes a newly applied ACL and rolls imported data back if a later ACL fails', async () => {
    acl.upsertEntry.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('ACL inválida'))
    const withAcl = {
      ...request,
      aclMappings: [77, 88].map(principalId => ({
        sourcePrincipal: `source-${principalId}`,
        principalType: 'GROUP' as const,
        principalId,
        folderPath: [],
        permissions: { view: true, connect: true, edit: false, admin: false },
      })),
    }
    const preview = await service.preview(withAcl, 7, 9, 'ADMIN')
    const result = await service.commit(preview.previewId, 7, 9)

    expect(result.status).toBe('rolled_back')
    expect(acl.deleteEntry).toHaveBeenCalledWith(1, 'GROUP', 77, 7, 9, 'ADMIN')
    expect(hosts.delete).toHaveBeenCalledTimes(2)
    expect(inventory.deleteFolder).toHaveBeenCalledTimes(2)
  })
})
