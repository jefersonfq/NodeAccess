import { describe, expect, it, vi } from 'vitest'
import type { EffectiveAclSourceRow, InventoryAclEntryRow, InventoryAclRepository } from './inventory-acl.repository.js'
import { InventoryAclService, normalizeInventoryPermissions } from './inventory-acl.service.js'

type PrincipalType = 'USER' | 'GROUP' | 'ROLE'

interface AclScenarioEntry {
  aclEntryId: number
  inventoryNodeId: number
  principalType: PrincipalType
  principalId: number
  canView: boolean
  canConnect: boolean
  canEdit: boolean
  canAdmin: boolean
  inheritToChildren: boolean
  createdAt: Date
  updatedAt: Date
}

class InventoryAclScenarioRepository {
  private nextAclEntryId = 1
  readonly entries: AclScenarioEntry[] = []
  readonly users = new Map<number, { name: string; role: 'ADMIN' | 'USER'; groupIds: number[] }>()
  readonly groups = new Map<number, { name: string }>()
  readonly nodes = new Map<number, { id: number; parentId: number | null; name: string; type: 'ROOT' | 'FOLDER' | 'HOST'; hostId: number | null }>()
  readonly activeSessions = new Map<string, number>()

  constructor() {
    this.users.set(10, { name: 'Admin', role: 'ADMIN', groupIds: [] })
    this.users.set(20, { name: 'Usuario', role: 'USER', groupIds: [30] })
    this.groups.set(30, { name: 'Operadores' })
    this.nodes.set(1, { id: 1, parentId: null, name: 'Raiz', type: 'ROOT', hostId: null })
    this.nodes.set(2, { id: 2, parentId: 1, name: 'PROXY', type: 'FOLDER', hostId: null })
    this.nodes.set(3, { id: 3, parentId: 2, name: 'FLUX', type: 'FOLDER', hostId: null })
    this.nodes.set(4, { id: 4, parentId: 3, name: 'proxy-01', type: 'HOST', hostId: 100 })
  }

  async nodeExists(inventoryNodeId: number): Promise<boolean> {
    return this.nodes.has(inventoryNodeId)
  }

  async principalExists(type: PrincipalType, principalId: number): Promise<boolean> {
    if (type === 'USER') return this.users.has(principalId)
    if (type === 'GROUP') return this.groups.has(principalId)
    return principalId === 1 || principalId === 2
  }

  async findPrincipalName(type: PrincipalType, principalId: number): Promise<string | null> {
    if (type === 'USER') return this.users.get(principalId)?.name ?? null
    if (type === 'GROUP') return this.groups.get(principalId)?.name ?? null
    if (principalId === 1) return 'All users'
    if (principalId === 2) return 'Tenant admins'
    return null
  }

  async findLocalEntry(inventoryNodeId: number, _tenantId: number, principalType: PrincipalType, principalId: number): Promise<InventoryAclEntryRow | null> {
    const entry = this.entries.find((item) =>
      item.inventoryNodeId === inventoryNodeId
      && item.principalType === principalType
      && item.principalId === principalId,
    )
    return entry ? this.toRow(entry, true) : null
  }

  async upsert(data: {
    inventoryNodeId: number
    principalType: PrincipalType
    principalId: number
    canView: boolean
    canConnect: boolean
    canEdit: boolean
    canAdmin: boolean
    inheritToChildren: boolean
  }): Promise<void> {
    const current = this.entries.find((item) =>
      item.inventoryNodeId === data.inventoryNodeId
      && item.principalType === data.principalType
      && item.principalId === data.principalId,
    )
    if (current) {
      Object.assign(current, {
        canView: data.canView,
        canConnect: data.canConnect,
        canEdit: data.canEdit,
        canAdmin: data.canAdmin,
        inheritToChildren: data.inheritToChildren,
        updatedAt: new Date(),
      })
      return
    }
    const now = new Date()
    this.entries.push({
      aclEntryId: this.nextAclEntryId++,
      inventoryNodeId: data.inventoryNodeId,
      principalType: data.principalType,
      principalId: data.principalId,
      canView: data.canView,
      canConnect: data.canConnect,
      canEdit: data.canEdit,
      canAdmin: data.canAdmin,
      inheritToChildren: data.inheritToChildren,
      createdAt: now,
      updatedAt: now,
    })
  }

  async delete(inventoryNodeId: number, _tenantId: number, principalType: PrincipalType, principalId: number): Promise<boolean> {
    const index = this.entries.findIndex((item) =>
      item.inventoryNodeId === inventoryNodeId
      && item.principalType === principalType
      && item.principalId === principalId,
    )
    if (index === -1) return false
    this.entries.splice(index, 1)
    return true
  }

  async findApplicableEntries(inventoryNodeId: number): Promise<InventoryAclEntryRow[]> {
    return this.entries
      .filter((entry) => this.appliesToNode(entry, inventoryNodeId))
      .map((entry) => this.toRow(entry, entry.inventoryNodeId === inventoryNodeId))
  }

  async findEffectiveSources(inventoryNodeId: number, _tenantId: number, userId: number): Promise<EffectiveAclSourceRow[]> {
    return this.entries
      .filter((entry) => this.appliesToNode(entry, inventoryNodeId) && this.appliesToUser(entry, userId))
      .map((entry) => this.toRow(entry, entry.inventoryNodeId === inventoryNodeId))
  }

  async countHostsInSubtree(inventoryNodeId: number): Promise<number> {
    return [...this.nodes.values()].filter((node) => node.type === 'HOST' && this.isAncestorOrSelf(inventoryNodeId, node.id)).length
  }

  async countActiveAuthenticatedSessionsInSubtreeForPrincipal(inventoryNodeId: number, _tenantId: number, principalType: PrincipalType, principalId: number): Promise<number> {
    return this.activeSessions.get(`${inventoryNodeId}:${principalType}:${principalId}`) ?? 0
  }

  async findNodeContext(inventoryNodeId: number): Promise<{ hostId: number | null; name: string; type: 'ROOT' | 'FOLDER' | 'HOST' } | null> {
    const node = this.nodes.get(inventoryNodeId)
    return node ? { hostId: node.hostId, name: node.name, type: node.type } : null
  }

  private toRow(entry: AclScenarioEntry, local: boolean): InventoryAclEntryRow {
    const node = this.nodes.get(entry.inventoryNodeId)
    return {
      aclEntryId: entry.aclEntryId,
      inventoryNodeId: entry.inventoryNodeId,
      inventoryNodeName: node?.name ?? `Node #${entry.inventoryNodeId}`,
      principalType: entry.principalType,
      principalId: entry.principalId,
      principalName: this.principalName(entry.principalType, entry.principalId),
      canView: entry.canView,
      canConnect: entry.canConnect,
      canEdit: entry.canEdit,
      canAdmin: entry.canAdmin,
      local,
      inheritToChildren: entry.inheritToChildren,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }
  }

  private principalName(type: PrincipalType, principalId: number): string {
    if (type === 'USER') return this.users.get(principalId)?.name ?? `Usuario #${principalId}`
    if (type === 'GROUP') return this.groups.get(principalId)?.name ?? `Grupo #${principalId}`
    return principalId === 2 ? 'Tenant admins' : 'All users'
  }

  private appliesToUser(entry: AclScenarioEntry, userId: number): boolean {
    const user = this.users.get(userId)
    if (!user) return false
    if (entry.principalType === 'USER') return entry.principalId === userId
    if (entry.principalType === 'GROUP') return user.groupIds.includes(entry.principalId)
    if (entry.principalType === 'ROLE') return entry.principalId === 1 || (entry.principalId === 2 && user.role === 'ADMIN')
    return false
  }

  private appliesToNode(entry: AclScenarioEntry, inventoryNodeId: number): boolean {
    if (entry.inventoryNodeId === inventoryNodeId) return true
    return entry.inheritToChildren && this.isAncestorOrSelf(entry.inventoryNodeId, inventoryNodeId)
  }

  private isAncestorOrSelf(ancestorId: number, nodeId: number): boolean {
    let current = this.nodes.get(nodeId)
    while (current) {
      if (current.id === ancestorId) return true
      current = current.parentId === null ? undefined : this.nodes.get(current.parentId)
    }
    return false
  }
}

function scenarioService(repo = new InventoryAclScenarioRepository()) {
  const logRepo = { logAdminEvent: vi.fn().mockResolvedValue(undefined) }
  const appEventBus = { publish: vi.fn().mockResolvedValue(undefined) }
  return {
    repo,
    logRepo,
    appEventBus,
    service: new InventoryAclService(
      repo as unknown as InventoryAclRepository,
      logRepo as never,
      appEventBus as never,
    ),
  }
}

describe('normalizeInventoryPermissions', () => {
  it('faz connect e edit implicarem view', () => {
    expect(normalizeInventoryPermissions({
      view: false,
      connect: true,
      edit: false,
      admin: false,
    })).toEqual({ view: true, connect: true, edit: false, admin: false })
  })

  it('faz admin implicar todas as permissões', () => {
    expect(normalizeInventoryPermissions({
      view: false,
      connect: false,
      edit: false,
      admin: true,
    })).toEqual({ view: true, connect: true, edit: true, admin: true })
  })
})

describe('InventoryAclService', () => {
  it('sempre propaga a ACL para os itens abaixo', async () => {
    const repo = {
      nodeExists: vi.fn().mockResolvedValue(true),
      principalExists: vi.fn().mockResolvedValue(true),
      findPrincipalName: vi.fn().mockResolvedValue('DEVOPS'),
      findLocalEntry: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
      findApplicableEntries: vi.fn().mockResolvedValue([]),
      findNodeContext: vi.fn().mockResolvedValue({ hostId: 42 }),
    }
    const service = new InventoryAclService(repo as unknown as InventoryAclRepository)

    await service.upsertEntry(5, {
      principalType: 'GROUP',
      principalId: 8,
      permissions: { view: true, connect: true, edit: false, admin: false },
    }, 10, 20, 'ADMIN')

    expect(repo.upsert).toHaveBeenCalledWith(expect.objectContaining({
      inventoryNodeId: 5,
      inheritToChildren: true,
    }))
  })

  it('audita antes, depois e permissões alteradas ao salvar ACL', async () => {
    const repo = {
      nodeExists: vi.fn().mockResolvedValue(true),
      principalExists: vi.fn().mockResolvedValue(true),
      findPrincipalName: vi.fn().mockResolvedValue('DEVOPS'),
      findLocalEntry: vi.fn().mockResolvedValue({
        aclEntryId: 1,
        inventoryNodeId: 5,
        inventoryNodeName: 'Produção',
        principalType: 'GROUP',
        principalId: 8,
        principalName: 'DEVOPS',
        canView: 1,
        canConnect: 1,
        canEdit: 0,
        canAdmin: 0,
        local: 1,
        inheritToChildren: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      upsert: vi.fn().mockResolvedValue(undefined),
      findApplicableEntries: vi.fn().mockResolvedValue([]),
      findNodeContext: vi.fn().mockResolvedValue({ hostId: 42 }),
    }
    const logRepo = { logAdminEvent: vi.fn().mockResolvedValue(undefined) }
    const service = new InventoryAclService(repo as unknown as InventoryAclRepository, logRepo as never)

    await service.upsertEntry(5, {
      principalType: 'GROUP',
      principalId: 8,
      permissions: { view: true, connect: true, edit: true, admin: false },
    }, 10, 20, 'ADMIN')

    const details = JSON.parse(logRepo.logAdminEvent.mock.calls[0][0].details)
    expect(details).toMatchObject({
      principalName: 'DEVOPS',
      before: { view: true, connect: true, edit: false, admin: false },
      after: { view: true, connect: true, edit: true, admin: false },
      changes: [{ permission: 'edit', before: false, after: true }],
    })
  })

  it('audita antes, depois e permissões alteradas ao remover ACL', async () => {
    const repo = {
      findEffectiveSources: vi.fn(),
      findLocalEntry: vi.fn().mockResolvedValue({
        aclEntryId: 1,
        inventoryNodeId: 5,
        inventoryNodeName: 'Produção',
        principalType: 'GROUP',
        principalId: 8,
        principalName: 'DEVOPS',
        canView: 1,
        canConnect: 1,
        canEdit: 1,
        canAdmin: 0,
        local: 1,
        inheritToChildren: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      delete: vi.fn().mockResolvedValue(true),
      findNodeContext: vi.fn().mockResolvedValue({ hostId: 42 }),
    }
    const logRepo = { logAdminEvent: vi.fn().mockResolvedValue(undefined) }
    const service = new InventoryAclService(repo as unknown as InventoryAclRepository, logRepo as never)

    await service.deleteEntry(5, 'GROUP', 8, 10, 20, 'ADMIN')

    const details = JSON.parse(logRepo.logAdminEvent.mock.calls[0][0].details)
    expect(details.before).toEqual({ view: true, connect: true, edit: true, admin: false })
    expect(details.after).toBeNull()
    expect(details.changes).toEqual([
      { permission: 'view', before: true, after: false },
      { permission: 'connect', before: true, after: false },
      { permission: 'edit', before: true, after: false },
    ])
  })

  it('nega por padrão quando não há fonte aplicável', async () => {
    const repo = { findEffectiveSources: vi.fn().mockResolvedValue([]) }
    const service = new InventoryAclService(repo as unknown as InventoryAclRepository)

    await expect(service.resolveEffectivePermissions(5, 10, 20)).resolves.toEqual({
      view: false,
      connect: false,
      edit: false,
      admin: false,
      explanation: {
        access: 'none',
        sourceCount: 0,
        localSourceCount: 0,
        inheritedSourceCount: 0,
        principalTypes: [],
      },
      sources: [],
    })
  })

  it('combina concessões herdadas de usuário e grupo', async () => {
    const repo = {
      findEffectiveSources: vi.fn().mockResolvedValue([
        {
          aclEntryId: 1,
          inventoryNodeId: 2,
          inventoryNodeName: 'Produção',
          principalType: 'GROUP',
          principalId: 8,
          principalName: 'DBA',
          canView: 1,
          canConnect: 1,
          canEdit: 0,
          canAdmin: 0,
          local: 0,
          inheritToChildren: 1,
        },
        {
          aclEntryId: 2,
          inventoryNodeId: 5,
          inventoryNodeName: 'mysql-01',
          principalType: 'USER',
          principalId: 20,
          principalName: 'Jeferson',
          canView: 0,
          canConnect: 0,
          canEdit: 1,
          canAdmin: 0,
          local: 1,
          inheritToChildren: 0,
        },
      ]),
    }
    const service = new InventoryAclService(repo as unknown as InventoryAclRepository)

    await expect(service.resolveEffectivePermissions(5, 10, 20)).resolves.toEqual({
      view: true,
      connect: true,
      edit: true,
      admin: false,
      explanation: {
        access: 'edit',
        sourceCount: 2,
        localSourceCount: 1,
        inheritedSourceCount: 1,
        principalTypes: ['GROUP', 'USER'],
      },
      sources: [
        {
          aclEntryId: 1,
          inventoryNodeId: 2,
          inventoryNodeName: 'Produção',
          principalType: 'GROUP',
          principalId: 8,
          principalName: 'DBA',
          permissions: { view: true, connect: true, edit: false, admin: false },
          local: false,
          inheritToChildren: true,
        },
        {
          aclEntryId: 2,
          inventoryNodeId: 5,
          inventoryNodeName: 'mysql-01',
          principalType: 'USER',
          principalId: 20,
          principalName: 'Jeferson',
          permissions: { view: true, connect: false, edit: true, admin: false },
          local: true,
          inheritToChildren: false,
        },
      ],
    })
  })

  it('resolve permissões efetivas diretamente pelo host', async () => {
    const updatedAt = new Date('2026-07-10T12:00:00.000Z')
    const repo = {
      findEffectiveSources: vi.fn().mockResolvedValue([
        {
          aclEntryId: 1,
          inventoryNodeId: 2,
          inventoryNodeName: 'Produção',
          principalType: 'GROUP',
          principalId: 8,
          principalName: 'DBA',
          canView: 1,
          canConnect: 1,
          canEdit: 0,
          canAdmin: 0,
          local: 0,
          inheritToChildren: 1,
        },
      ]),
    }
    const inventoryRepo = {
      findByHostId: vi.fn().mockResolvedValue({
        id: 5,
        tenantId: 10,
        parentId: 2,
        type: 'HOST',
        hostId: 99,
        name: 'db-01',
        path: '/1/2/5/',
        depth: 3,
        createdAt: updatedAt,
        updatedAt,
      }),
    }
    const service = new InventoryAclService(
      repo as unknown as InventoryAclRepository,
      undefined,
      undefined,
      inventoryRepo as never,
    )

    await expect(service.resolveEffectiveHostPermissions(99, 10, 20)).resolves.toMatchObject({
      inventoryNode: {
        id: 5,
        hostId: 99,
        name: 'db-01',
      },
      view: true,
      connect: true,
      edit: false,
      admin: false,
      explanation: {
        access: 'connect',
        sourceCount: 1,
      },
    })
    expect(repo.findEffectiveSources).toHaveBeenCalledWith(5, 10, 20)
  })

  it('falha quando host não possui nó de inventário', async () => {
    const repo = { findEffectiveSources: vi.fn() }
    const inventoryRepo = { findByHostId: vi.fn().mockResolvedValue(null) }
    const service = new InventoryAclService(
      repo as unknown as InventoryAclRepository,
      undefined,
      undefined,
      inventoryRepo as never,
    )

    await expect(service.resolveEffectiveHostPermissions(99, 10, 20)).rejects.toThrow('Host do inventário')
    expect(repo.findEffectiveSources).not.toHaveBeenCalled()
  })
})

describe('InventoryAclService scenario harness', () => {
  it('admin concede e remove ACL direta do usuário uma permissão por vez e o efetivo reflete cada etapa', async () => {
    const { service, appEventBus, logRepo } = scenarioService()
    const tenantId = 10
    const adminId = 10
    const userId = 20
    const folderId = 2
    const hostNodeId = 4

    await expect(service.resolveEffectivePermissions(hostNodeId, tenantId, userId))
      .resolves.toMatchObject({ view: false, connect: false, edit: false, admin: false })

    await service.upsertEntry(folderId, {
      principalType: 'USER',
      principalId: userId,
      permissions: { view: true, connect: false, edit: false, admin: false },
    }, tenantId, adminId, 'ADMIN')
    await expect(service.resolveEffectivePermissions(hostNodeId, tenantId, userId))
      .resolves.toMatchObject({ view: true, connect: false, edit: false, admin: false, explanation: { access: 'view' } })

    await service.upsertEntry(folderId, {
      principalType: 'USER',
      principalId: userId,
      permissions: { view: false, connect: true, edit: false, admin: false },
    }, tenantId, adminId, 'ADMIN')
    await expect(service.resolveEffectivePermissions(hostNodeId, tenantId, userId))
      .resolves.toMatchObject({ view: true, connect: true, edit: false, admin: false, explanation: { access: 'connect' } })

    await service.upsertEntry(folderId, {
      principalType: 'USER',
      principalId: userId,
      permissions: { view: false, connect: false, edit: true, admin: false },
    }, tenantId, adminId, 'ADMIN')
    await expect(service.resolveEffectivePermissions(hostNodeId, tenantId, userId))
      .resolves.toMatchObject({ view: true, connect: false, edit: true, admin: false, explanation: { access: 'edit' } })

    await service.upsertEntry(folderId, {
      principalType: 'USER',
      principalId: userId,
      permissions: { view: false, connect: false, edit: false, admin: true },
    }, tenantId, adminId, 'ADMIN')
    await expect(service.resolveEffectivePermissions(hostNodeId, tenantId, userId))
      .resolves.toMatchObject({ view: true, connect: true, edit: true, admin: true, explanation: { access: 'admin' } })

    await service.deleteEntry(folderId, 'USER', userId, tenantId, adminId, 'ADMIN')
    await expect(service.resolveEffectivePermissions(hostNodeId, tenantId, userId))
      .resolves.toMatchObject({ view: false, connect: false, edit: false, admin: false, explanation: { access: 'none' } })

    expect(appEventBus.publish).toHaveBeenCalledTimes(5)
    expect(appEventBus.publish).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'inventory_acl_changed',
      inventoryNodeId: folderId,
      principalType: 'USER',
      principalId: userId,
      action: 'delete',
    }))
    expect(logRepo.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'DELETE_INVENTORY_ACL' }))
  })

  it('ACL de grupo passa a valer para usuário membro e some ao remover a ACL do grupo', async () => {
    const { service, appEventBus } = scenarioService()
    const tenantId = 10
    const adminId = 10
    const userId = 20
    const groupId = 30
    const folderId = 3
    const hostNodeId = 4

    await service.upsertEntry(folderId, {
      principalType: 'GROUP',
      principalId: groupId,
      permissions: { view: false, connect: true, edit: false, admin: false },
    }, tenantId, adminId, 'ADMIN')

    await expect(service.resolveEffectivePermissions(hostNodeId, tenantId, userId))
      .resolves.toMatchObject({
        view: true,
        connect: true,
        edit: false,
        admin: false,
        explanation: {
          access: 'connect',
          principalTypes: ['GROUP'],
          inheritedSourceCount: 1,
        },
      })

    await service.deleteEntry(folderId, 'GROUP', groupId, tenantId, adminId, 'ADMIN')

    await expect(service.resolveEffectivePermissions(hostNodeId, tenantId, userId))
      .resolves.toMatchObject({ view: false, connect: false, edit: false, admin: false })
    expect(appEventBus.publish).toHaveBeenCalledWith(expect.objectContaining({
      principalType: 'GROUP',
      principalId: groupId,
      action: 'delete',
    }))
  })

  it('combina ACL direta, grupo e role admin sem vazar permissão de admin para usuário comum', async () => {
    const { service } = scenarioService()
    const tenantId = 10
    const adminId = 10
    const userId = 20
    const groupId = 30
    const parentFolderId = 2
    const childFolderId = 3
    const hostNodeId = 4

    await service.upsertEntry(parentFolderId, {
      principalType: 'GROUP',
      principalId: groupId,
      permissions: { view: false, connect: true, edit: false, admin: false },
    }, tenantId, adminId, 'ADMIN')
    await service.upsertEntry(hostNodeId, {
      principalType: 'USER',
      principalId: userId,
      permissions: { view: false, connect: false, edit: true, admin: false },
    }, tenantId, adminId, 'ADMIN')
    await service.upsertEntry(childFolderId, {
      principalType: 'ROLE',
      principalId: 2,
      permissions: { view: false, connect: false, edit: false, admin: true },
    }, tenantId, adminId, 'ADMIN')

    await expect(service.resolveEffectivePermissions(hostNodeId, tenantId, userId))
      .resolves.toMatchObject({
        view: true,
        connect: true,
        edit: true,
        admin: false,
        explanation: {
          access: 'edit',
          sourceCount: 2,
          principalTypes: ['GROUP', 'USER'],
        },
      })
    await expect(service.resolveEffectivePermissions(hostNodeId, tenantId, adminId))
      .resolves.toMatchObject({
        view: true,
        connect: true,
        edit: true,
        admin: true,
        explanation: {
          access: 'admin',
          sourceCount: 1,
          principalTypes: ['ROLE'],
        },
      })
  })

  it('usuário com Administrar ACL consegue administrar e perde essa capacidade quando a ACL é removida', async () => {
    const { service } = scenarioService()
    const tenantId = 10
    const adminId = 10
    const userId = 20
    const groupId = 30
    const folderId = 2

    await service.upsertEntry(folderId, {
      principalType: 'USER',
      principalId: userId,
      permissions: { view: false, connect: false, edit: false, admin: true },
    }, tenantId, adminId, 'ADMIN')

    await expect(service.upsertEntry(folderId, {
      principalType: 'GROUP',
      principalId: groupId,
      permissions: { view: true, connect: false, edit: false, admin: false },
    }, tenantId, userId, 'USER')).resolves.toEqual(expect.any(Array))

    await service.deleteEntry(folderId, 'USER', userId, tenantId, adminId, 'ADMIN')

    await expect(service.upsertEntry(folderId, {
      principalType: 'GROUP',
      principalId: groupId,
      permissions: { view: true, connect: true, edit: false, admin: false },
    }, tenantId, userId, 'USER')).rejects.toThrow('Sem permissão')
  })

  it('preview de remoção sinaliza hosts afetados, sessões ativas e risco de revogar Conectar', async () => {
    const repo = new InventoryAclScenarioRepository()
    repo.activeSessions.set('2:USER:20', 2)
    const { service } = scenarioService(repo)
    const tenantId = 10
    const adminId = 10
    const userId = 20
    const folderId = 2

    await service.upsertEntry(folderId, {
      principalType: 'USER',
      principalId: userId,
      permissions: { view: false, connect: true, edit: false, admin: false },
    }, tenantId, adminId, 'ADMIN')

    await expect(service.previewImpact(folderId, {
      action: 'delete',
      principalType: 'USER',
      principalId: userId,
    }, tenantId, adminId, 'ADMIN')).resolves.toMatchObject({
      inventoryNodeId: folderId,
      action: 'delete',
      affectedHostCount: 1,
      activeSessionCount: 2,
      mayRevokeConnect: true,
      before: { view: true, connect: true, edit: false, admin: false },
      after: null,
    })
  })

  it('mantém custo de resolução proporcional ao número de fontes aplicáveis', async () => {
    const repo = new InventoryAclScenarioRepository()
    const { service } = scenarioService(repo)
    const tenantId = 10
    const adminId = 10
    const userId = 20
    const folderId = 2
    const hostNodeId = 4

    for (let index = 0; index < 30; index += 1) {
      const principalId = 1000 + index
      repo.groups.set(principalId, { name: `Grupo ${index}` })
      if (index % 3 === 0) repo.users.get(userId)!.groupIds.push(principalId)
      await service.upsertEntry(folderId, {
        principalType: 'GROUP',
        principalId,
        permissions: { view: true, connect: index % 2 === 0, edit: false, admin: false },
      }, tenantId, adminId, 'ADMIN')
    }

    const startedAt = performance.now()
    const result = await service.resolveEffectivePermissions(hostNodeId, tenantId, userId)
    const elapsedMs = performance.now() - startedAt

    expect(result.view).toBe(true)
    expect(result.explanation.sourceCount).toBe(10)
    expect(elapsedMs).toBeLessThan(25)
  })
})
