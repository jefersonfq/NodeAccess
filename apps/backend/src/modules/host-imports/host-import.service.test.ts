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
    service = new HostImportService(redis, hosts, inventory, acl, secrets)
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
