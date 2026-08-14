import { describe, expect, it, vi } from 'vitest'
import type { CreateHostDto } from '@nodeaccess/shared'
import { HostService } from './host.service.js'
import type { HostRepository, HostRow } from './host.repository.js'

vi.mock('../../shared/crypto.js', () => ({
  encrypt: vi.fn(() => ({ encrypted: 'encrypted', iv: 'iv' })),
}))

type HostCreateInput = Parameters<HostRepository['create']>[0]
type HostUpdateInput = Parameters<HostRepository['update']>[2]

function makeHostRow(overrides: Partial<HostRow> = {}): HostRow {
  return {
    id: 10,
    tenantId: 1,
    name: 'host',
    ip: '10.0.0.10',
    port: 22,
    accessProtocol: 'SSH',
    sshUser: 'root',
    authType: 'PASSWORD',
    connectionMode: 'DIRECT',
    scope: 'GLOBAL',
    ownerId: null,
    groupId: null,
    folderId: null,
    bastionId: null,
    pemKeyId: null,
    passwordEncrypted: null,
    onePasswordRef: null,
    trustedHostKeyFingerprint: null,
    trustedHostKeyVerifiedAt: null,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    tags: [],
    bastion: null,
    group: null,
    ...overrides,
  } as HostRow
}

function makeService() {
  const createdInputs: HostCreateInput[] = []
  const updatedInputs: HostUpdateInput[] = []
  let existingHost = makeHostRow()
  const sshRepo = {
    getEffectiveHostPermissionSets: vi.fn().mockResolvedValue(new Map()),
  }

  const hostRepo = {
    findHostLicenseLimit: vi.fn().mockResolvedValue(null),
    countByTenant: vi.fn().mockResolvedValue(0),
    findVisible: vi.fn().mockResolvedValue({ hosts: [existingHost], total: 1 }),
    create: vi.fn(async (input: HostCreateInput) => {
      createdInputs.push(input)
      existingHost = makeHostRow({
        ...input,
        id: 11,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        tags: [],
        bastion: null,
        group: null,
      } as Partial<HostRow>)
      return existingHost
    }),
    findById: vi.fn().mockImplementation(async () => existingHost),
    findByIdForUser: vi.fn().mockImplementation(async () => existingHost),
    update: vi.fn(async (_id: number, _tenantId: number, input: HostUpdateInput) => {
      updatedInputs.push(input)
      existingHost = makeHostRow({ ...existingHost, ...input })
      return existingHost
    }),
    setPersonalFolder: vi.fn(async (_hostId: number, folderId: number | null) => {
      existingHost = makeHostRow({ ...existingHost, folderId })
    }),
    listAssociatedLinksByHostIds: vi.fn().mockResolvedValue(new Map()),
    bastionExists: vi.fn().mockResolvedValue(true),
    findBastionProfileIdBySourceHost: vi.fn().mockResolvedValue(null),
    findBastionSourceHostId: vi.fn().mockResolvedValue(null),
    findGroupBastionId: vi.fn().mockResolvedValue(null),
    pemKeyExists: vi.fn().mockResolvedValue(true),
    inventoryFolderAclSummary: vi.fn().mockResolvedValue({ name: 'Produção', aclEntries: 1 }),
    inventoryFolderEffectivePermissions: vi.fn().mockResolvedValue({ view: true, connect: true, edit: true, admin: false }),
    personalFolderExists: vi.fn().mockResolvedValue(true),
  }
  const appEventBus = {
    publish: vi.fn().mockResolvedValue(undefined),
  }
  const logRepo = {
    logAdminEvent: vi.fn().mockResolvedValue(undefined),
  }

  const service = new HostService(
    hostRepo as unknown as HostRepository,
    sshRepo as never,
    logRepo as never,
    {} as never,
    { publishEvent: vi.fn().mockResolvedValue(undefined) } as never,
    { del: vi.fn().mockResolvedValue(1) } as never,
    appEventBus as never,
  )

  return {
    service,
    hostRepo,
    sshRepo,
    logRepo,
    appEventBus,
    createdInputs,
    updatedInputs,
    setExistingHost(host: HostRow) {
      existingHost = host
      hostRepo.findVisible.mockResolvedValue({ hosts: [existingHost], total: 1 })
    },
  }
}

const baseDto: Omit<CreateHostDto, 'inventoryParentId'> = {
  name: 'srv-rdp',
  ip: '10.0.0.20',
  port: 3389,
  accessProtocol: 'rdp',
  sshUser: 'admin',
  authType: 'pem_password',
  connectionMode: 'direct',
  scope: 'global',
  password: 'secret',
  pemKeyId: 5,
  bastionId: 7,
  onePasswordRef: 'op://vault/item/password',
}

describe('HostService protocol-specific credential handling', () => {
  it('persists password but not SSH-only fields when creating a graphical host', async () => {
    const { service, createdInputs, appEventBus } = makeService()

    await service.create({ ...baseDto, inventoryParentId: 44 }, 1, 2)

    expect(createdInputs).toHaveLength(1)
    expect(createdInputs[0]).toMatchObject({
      accessProtocol: 'RDP',
      sshUser: '',
      authType: 'PASSWORD',
      inventoryParentId: 44,
    })
    expect(createdInputs[0]).toHaveProperty('passwordEncrypted')
    expect(createdInputs[0]).not.toHaveProperty('pemKeyId')
    expect(createdInputs[0]).not.toHaveProperty('bastionId')
    expect(createdInputs[0]).not.toHaveProperty('onePasswordRef')
    expect(appEventBus.publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'inventory_acl_changed',
      tenantId: 1,
      inventoryNodeId: 44,
      hostId: 11,
      actorId: 2,
      action: 'move',
    }))
  })

  it('clears SSH-only fields but preserves password unless replaced when updating to a graphical protocol', async () => {
    const { service, updatedInputs, setExistingHost } = makeService()
    setExistingHost(makeHostRow({
      accessProtocol: 'SSH',
      sshUser: 'root',
      authType: 'PEM_PASSWORD',
      pemKeyId: 5,
      bastionId: 7,
      passwordEncrypted: '{"encrypted":"x","iv":"y"}',
      onePasswordRef: 'op://vault/item/password',
    }))

    await service.update(10, { accessProtocol: 'rdp', port: 3389 }, 1, 2, 'ADMIN')

    expect(updatedInputs).toHaveLength(1)
    expect(updatedInputs[0]).toMatchObject({
      accessProtocol: 'RDP',
      sshUser: '',
      authType: 'PASSWORD',
      pemKeyId: null,
      bastionId: null,
      onePasswordRef: null,
    })
    expect(updatedInputs[0]).not.toHaveProperty('passwordEncrypted')
  })

  it('stores a replacement VNC password when updating a graphical host', async () => {
    const { service, updatedInputs, setExistingHost } = makeService()
    setExistingHost(makeHostRow({
      accessProtocol: 'VNC',
      sshUser: '',
      authType: 'PASSWORD',
      passwordEncrypted: null,
    }))

    await service.update(10, { accessProtocol: 'vnc', port: 5901, password: 'vnc-secret' }, 1, 2, 'ADMIN')

    expect(updatedInputs).toHaveLength(1)
    expect(updatedInputs[0]).toMatchObject({
      accessProtocol: 'VNC',
      sshUser: '',
      authType: 'PASSWORD',
      pemKeyId: null,
      bastionId: null,
      onePasswordRef: null,
    })
    expect(updatedInputs[0]).toHaveProperty('passwordEncrypted')
  })

  it('rejects clearing SSH user while updating an SSH host', async () => {
    const { service, updatedInputs, setExistingHost } = makeService()
    setExistingHost(makeHostRow({
      accessProtocol: 'SSH',
      sshUser: 'suporte',
      folderId: null,
    }))

    await expect(service.update(10, { sshUser: '', folderId: 2 }, 1, 2, 'ADMIN'))
      .rejects.toThrow('Usuário SSH é obrigatório para hosts SSH')

    expect(updatedInputs).toHaveLength(0)
  })

  it('rejects creating an SSH host without SSH user', async () => {
    const { service, createdInputs } = makeService()

    await expect(service.create({
      ...baseDto,
      accessProtocol: 'ssh',
      port: 22,
      sshUser: '   ',
      authType: 'password',
      inventoryParentId: 44,
    }, 1, 2, 'ADMIN')).rejects.toThrow('Usuário SSH é obrigatório para hosts SSH')

    expect(createdInputs).toHaveLength(0)
  })

  it('persiste macro de inicialização ao criar host', async () => {
    const { service, createdInputs } = makeService()

    const result = await service.create({
      ...baseDto,
      accessProtocol: 'ssh',
      port: 22,
      sshUser: 'root',
      inventoryParentId: 44,
      startupSnippetId: 42,
      startupSnippetMode: 'suggest',
    }, 1, 2, 'ADMIN')

    expect(createdInputs).toHaveLength(1)
    expect(createdInputs[0]).toMatchObject({
      startupSnippetId: 42,
      startupSnippetMode: 'SUGGEST',
    })
    expect(result).toMatchObject({
      startupSnippetId: 42,
      startupSnippetMode: 'suggest',
    })
  })

  it('ignora macro de inicialização ao criar host gráfico', async () => {
    const { service, createdInputs } = makeService()

    const result = await service.create({
      ...baseDto,
      accessProtocol: 'rdp',
      inventoryParentId: 44,
      startupSnippetId: 42,
      startupSnippetMode: 'auto',
    }, 1, 2, 'ADMIN')

    expect(createdInputs).toHaveLength(1)
    expect(createdInputs[0]).toMatchObject({
      accessProtocol: 'RDP',
      startupSnippetId: null,
      startupSnippetMode: 'DISABLED',
    })
    expect(result).toMatchObject({
      startupSnippetId: null,
      startupSnippetMode: 'disabled',
    })
  })

  it('preserva modo atual ao atualizar somente o snippet de inicialização', async () => {
    const { service, updatedInputs, setExistingHost } = makeService()
    setExistingHost(makeHostRow({
      startupSnippetId: 10,
      startupSnippetMode: 'SUGGEST',
    } as Partial<HostRow>))

    const result = await service.update(10, { startupSnippetId: 42 }, 1, 2, 'ADMIN')

    expect(updatedInputs).toHaveLength(1)
    expect(updatedInputs[0]).toMatchObject({
      startupSnippetId: 42,
      startupSnippetMode: 'SUGGEST',
    })
    expect(result).toMatchObject({
      startupSnippetId: 42,
      startupSnippetMode: 'suggest',
    })
  })

  it('limpa snippet ao desativar macro de inicialização', async () => {
    const { service, updatedInputs, setExistingHost } = makeService()
    setExistingHost(makeHostRow({
      startupSnippetId: 42,
      startupSnippetMode: 'AUTO',
    } as Partial<HostRow>))

    const result = await service.update(10, { startupSnippetMode: 'disabled' }, 1, 2, 'ADMIN')

    expect(updatedInputs).toHaveLength(1)
    expect(updatedInputs[0]).toMatchObject({
      startupSnippetId: null,
      startupSnippetMode: 'DISABLED',
    })
    expect(result).toMatchObject({
      startupSnippetId: null,
      startupSnippetMode: 'disabled',
    })
  })

  it('limpa macro de inicialização ao converter host para protocolo gráfico', async () => {
    const { service, updatedInputs, setExistingHost } = makeService()
    setExistingHost(makeHostRow({
      accessProtocol: 'SSH',
      startupSnippetId: 42,
      startupSnippetMode: 'SUGGEST',
    } as Partial<HostRow>))

    const result = await service.update(10, { accessProtocol: 'rdp', port: 3389 }, 1, 2, 'ADMIN')

    expect(updatedInputs).toHaveLength(1)
    expect(updatedInputs[0]).toMatchObject({
      accessProtocol: 'RDP',
      startupSnippetId: null,
      startupSnippetMode: 'DISABLED',
    })
    expect(result).toMatchObject({
      startupSnippetId: null,
      startupSnippetMode: 'disabled',
    })
  })

  it('rejects assigning a host to another user personal folder', async () => {
    const { service, hostRepo, updatedInputs } = makeService()
    hostRepo.personalFolderExists.mockResolvedValue(false)

    await expect(service.update(10, { folderId: 99 }, 1, 2, 'ADMIN'))
      .rejects.toThrow('Pasta pessoal não encontrada para o usuário atual')

    expect(hostRepo.personalFolderExists).toHaveBeenCalledWith(99, 2, 1)
    expect(updatedInputs).toHaveLength(0)
  })

  it('stores personal folder assignment outside the host record', async () => {
    const { service, hostRepo, updatedInputs } = makeService()

    const host = await service.update(10, { folderId: 2 }, 1, 2, 'ADMIN')

    expect(hostRepo.setPersonalFolder).toHaveBeenCalledWith(10, 2, 2, 1)
    expect(updatedInputs).toHaveLength(1)
    expect(updatedInputs[0]).not.toHaveProperty('folderId')
    expect(host.folderId).toBe(2)
  })

  it('requires ACL view permission when reading a host', async () => {
    const { service, sshRepo } = makeService()
    sshRepo.getEffectiveHostPermissionSets.mockResolvedValue(new Map([
      [10, { view: false, connect: false, edit: false, admin: false }],
    ]))

    await expect(service.getById(10, 1, 2, 'USER')).rejects.toThrow('Sem acesso a este host')
  })

  it('lists a host with view permission but exposes connect as disabled', async () => {
    const { service, sshRepo } = makeService()
    sshRepo.getEffectiveHostPermissionSets.mockResolvedValue(new Map([
      [10, { view: true, connect: false, edit: false, admin: false }],
    ]))

    const result = await service.list(1, 2, 'USER', { page: 1, limit: 20 })

    expect(result.total).toBe(1)
    expect(result.data[0]).toMatchObject({
      id: 10,
      accessPermissions: {
        view: true,
        connect: false,
        edit: false,
        admin: false,
      },
    })
  })

  it('requires ACL edit permission when updating a host', async () => {
    const { service, sshRepo } = makeService()
    sshRepo.getEffectiveHostPermissionSets.mockResolvedValue(new Map([
      [10, { view: true, connect: true, edit: false, admin: false }],
    ]))

    await expect(service.update(10, { name: 'novo nome' }, 1, 2, 'USER')).rejects.toThrow('Sem permissão para editar este host')
  })

  it('bloqueia criação em pasta corporativa inexistente', async () => {
    const { service, hostRepo } = makeService()
    hostRepo.inventoryFolderAclSummary.mockResolvedValue(null)

    await expect(service.create({ ...baseDto, inventoryParentId: 44 }, 1, 2, 'ADMIN')).rejects.toThrow('Pasta do inventário não encontrada')
    expect(hostRepo.create).not.toHaveBeenCalled()
  })

  it('bloqueia criação sem pasta corporativa para evitar ACL legado implícita', async () => {
    const { service, hostRepo } = makeService()

    await expect(service.create(baseDto as CreateHostDto, 1, 2, 'ADMIN')).rejects.toThrow('pasta do inventário corporativo')
    expect(hostRepo.inventoryFolderAclSummary).not.toHaveBeenCalled()
    expect(hostRepo.create).not.toHaveBeenCalled()
  })

  it('bloqueia criação em pasta corporativa sem ACL aplicável', async () => {
    const { service, hostRepo } = makeService()
    hostRepo.inventoryFolderAclSummary.mockResolvedValue({ name: 'Sem ACL', aclEntries: 0 })

    await expect(service.create({ ...baseDto, inventoryParentId: 44 }, 1, 2, 'ADMIN')).rejects.toThrow('não possui ACL aplicável')
    expect(hostRepo.create).not.toHaveBeenCalled()
  })

  it('bloqueia usuário comum criando host em pasta sem Edit/Admin efetivo', async () => {
    const { service, hostRepo } = makeService()
    hostRepo.inventoryFolderEffectivePermissions.mockResolvedValue({ view: true, connect: true, edit: false, admin: false })

    await expect(service.create({ ...baseDto, inventoryParentId: 44 }, 1, 2, 'USER'))
      .rejects.toThrow('exige permissão Editar ou Administrar ACL')

    expect(hostRepo.inventoryFolderEffectivePermissions).toHaveBeenCalledWith(44, 1, 2)
    expect(hostRepo.create).not.toHaveBeenCalled()
  })

  it('valida ACL e envia apenas pasta corporativa ao atualizar host', async () => {
    const { service, hostRepo, updatedInputs, appEventBus, logRepo } = makeService()

    await service.update(10, { inventoryParentId: 55 }, 1, 2, 'ADMIN')

    expect(hostRepo.inventoryFolderAclSummary).toHaveBeenCalledWith(55, 1)
    expect(updatedInputs).toHaveLength(1)
    expect(updatedInputs[0]).toMatchObject({
      inventoryParentId: 55,
    })
    expect(updatedInputs[0]).not.toHaveProperty('aclActorId')
    expect(appEventBus.publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'inventory_acl_changed',
      tenantId: 1,
      inventoryNodeId: 55,
      hostId: 10,
      actorId: 2,
      action: 'move',
    }))
    expect(logRepo.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({
      adminId: 2,
      action: 'INVENTORY_ACL_HOSTS_MOVED',
      targetType: 'InventoryNode',
      targetId: 55,
    }))
  })

  it('não exige usuário SSH ao mover ACL sem alterar configuração técnica do host', async () => {
    const { service, updatedInputs, setExistingHost } = makeService()
    setExistingHost(makeHostRow({
      accessProtocol: 'SSH',
      sshUser: '',
    }))

    await service.update(10, { inventoryParentId: 55 }, 1, 2, 'ADMIN')

    expect(updatedInputs).toHaveLength(1)
    expect(updatedInputs[0]).toMatchObject({
      inventoryParentId: 55,
    })
    expect(updatedInputs[0]).not.toHaveProperty('sshUser')
  })

  it('não emite evento ACL ao atualizar host sem mudar pasta corporativa', async () => {
    const { service, appEventBus, setExistingHost } = makeService()
    setExistingHost(makeHostRow({
      inventoryNode: {
        id: 100,
        parentId: 55,
        parent: { id: 55, name: 'Produção', type: 'FOLDER' },
      },
    } as Partial<HostRow>))

    await service.update(10, { inventoryParentId: 55 }, 1, 2, 'ADMIN')

    expect(appEventBus.publish).not.toHaveBeenCalled()
  })

  it('permite remover vínculo ACL corporativo do host', async () => {
    const { service, hostRepo, updatedInputs, appEventBus, logRepo, setExistingHost } = makeService()
    setExistingHost(makeHostRow({
      inventoryNode: {
        id: 100,
        parentId: 55,
        parent: { id: 55, name: 'Produção', type: 'FOLDER' },
      },
    } as Partial<HostRow>))

    await service.update(10, { inventoryParentId: null }, 1, 2, 'ADMIN')

    expect(hostRepo.inventoryFolderAclSummary).not.toHaveBeenCalled()
    expect(updatedInputs).toHaveLength(1)
    expect(updatedInputs[0]).toMatchObject({
      inventoryParentId: null,
    })
    expect(appEventBus.publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'inventory_acl_changed',
      tenantId: 1,
      inventoryNodeId: 55,
      hostId: 10,
      actorId: 2,
      action: 'move',
    }))
    expect(logRepo.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({
      adminId: 2,
      action: 'INVENTORY_ACL_HOST_UNLINKED',
      targetType: 'Host',
      targetId: 10,
    }))
  })

  it('bloqueia movimentação para pasta corporativa inexistente ao atualizar host', async () => {
    const { service, hostRepo } = makeService()
    hostRepo.inventoryFolderAclSummary.mockResolvedValue(null)

    await expect(service.update(10, { inventoryParentId: 55 }, 1, 2, 'ADMIN')).rejects.toThrow('Pasta do inventário não encontrada')
    expect(hostRepo.update).not.toHaveBeenCalled()
  })

  it('bloqueia movimentação para pasta corporativa sem ACL aplicável ao atualizar host', async () => {
    const { service, hostRepo } = makeService()
    hostRepo.inventoryFolderAclSummary.mockResolvedValue({ name: 'Sem ACL', aclEntries: 0 })

    await expect(service.update(10, { inventoryParentId: 55 }, 1, 2, 'ADMIN')).rejects.toThrow('não possui ACL aplicável')
    expect(hostRepo.update).not.toHaveBeenCalled()
  })

  it('bloqueia usuário comum movendo host para pasta sem Edit/Admin efetivo', async () => {
    const { service, hostRepo, sshRepo } = makeService()
    sshRepo.getEffectiveHostPermissionSets.mockResolvedValue(new Map([
      [10, { view: true, connect: true, edit: true, admin: false }],
    ]))
    hostRepo.inventoryFolderEffectivePermissions.mockResolvedValue({ view: true, connect: true, edit: false, admin: false })

    await expect(service.update(10, { inventoryParentId: 55 }, 1, 2, 'USER'))
      .rejects.toThrow('exige permissão Editar ou Administrar ACL')

    expect(hostRepo.inventoryFolderEffectivePermissions).toHaveBeenCalledWith(55, 1, 2)
    expect(hostRepo.update).not.toHaveBeenCalled()
  })
})
