import { describe, expect, it, vi } from 'vitest'
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.js'
import type { LogRepository } from '../logs/log.repository.js'
import type { InventoryNodeRow, InventoryRepository } from './inventory.repository.js'
import { InventoryService } from './inventory.service.js'

const root: InventoryNodeRow = {
  id: 1,
  tenantId: 10,
  parentId: null,
  type: 'ROOT',
  hostId: null,
  name: '__root__',
  path: '/',
  depth: 0,
  createdAt: new Date('2026-07-08T00:00:00Z'),
  updatedAt: new Date('2026-07-08T00:00:00Z'),
}

const folder: InventoryNodeRow = {
  ...root,
  id: 2,
  parentId: 1,
  type: 'FOLDER',
  name: 'Produção',
  path: '/2/',
  depth: 1,
}

function setup() {
  const repo = {
    findTree: vi.fn(),
    findVisibleTree: vi.fn(),
    findById: vi.fn(),
    findByHostId: vi.fn(),
    findRoot: vi.fn(),
    findHostsWithoutInventoryNode: vi.fn(),
    createMissingHostNodesUnderRoot: vi.fn(),
    existsActiveSibling: vi.fn(),
    createFolder: vi.fn(),
    renameFolder: vi.fn(),
    hasActiveChildren: vi.fn(),
    deleteFolder: vi.fn(),
    moveFolder: vi.fn(),
    moveHost: vi.fn(),
  }
  const logRepo = { logAdminEvent: vi.fn().mockResolvedValue(undefined) }
  const appEventBus = { publish: vi.fn().mockResolvedValue(undefined) }
  return {
    repo,
    logRepo,
    appEventBus,
    service: new InventoryService(
      repo as unknown as InventoryRepository,
      logRepo as unknown as LogRepository,
      appEventBus as never,
    ),
  }
}

describe('InventoryService', () => {
  it('cria pasta abaixo da raiz do mesmo tenant e audita a alteração', async () => {
    const { service, repo, logRepo, appEventBus } = setup()
    repo.findById.mockResolvedValue(root)
    repo.existsActiveSibling.mockResolvedValue(false)
    repo.createFolder.mockResolvedValue(folder)

    await expect(service.createFolder({ parentId: 1, name: ' Produção ' }, 10, 7))
      .resolves.toMatchObject({ id: 2, name: 'Produção', parentId: 1 })
    expect(repo.createFolder).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 10,
      actorId: 7,
      name: 'Produção',
    }))
    expect(logRepo.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CREATE_INVENTORY_FOLDER',
      targetId: 2,
    }))
  })

  it('retorna relatório de hosts ativos sem nó de inventário corporativo', async () => {
    const { service, repo } = setup()
    repo.findHostsWithoutInventoryNode.mockResolvedValue({
      total: 2,
      sample: [
        { id: 10, name: 'legado-01', ip: '10.0.0.10' },
        { id: 11, name: 'legado-02', ip: '10.0.0.11' },
      ],
    })

    await expect(service.getIntegrityReport(10)).resolves.toEqual({
      hostsWithoutInventoryNode: {
        total: 2,
        sampleLimit: 20,
        sample: [
          { id: 10, name: 'legado-01', ip: '10.0.0.10' },
          { id: 11, name: 'legado-02', ip: '10.0.0.11' },
        ],
      },
    })
    expect(repo.findHostsWithoutInventoryNode).toHaveBeenCalledWith(10, 20)
  })

  it('repara hosts ativos sem nó corporativo abaixo da raiz e audita', async () => {
    const { service, repo, logRepo, appEventBus } = setup()
    repo.findRoot.mockResolvedValue(root)
    repo.createMissingHostNodesUnderRoot.mockResolvedValue(2)
    repo.findHostsWithoutInventoryNode.mockResolvedValue({
      total: 0,
      sample: [],
    })

    await expect(service.repairIntegrity(10, 7)).resolves.toEqual({
      repairedHosts: 2,
      report: {
        hostsWithoutInventoryNode: {
          total: 0,
          sampleLimit: 20,
          sample: [],
        },
      },
    })
    expect(repo.createMissingHostNodesUnderRoot).toHaveBeenCalledWith(10, 7)
    expect(logRepo.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'REPAIR_INVENTORY_HOST_NODES',
      targetType: 'InventoryNode',
      targetId: 1,
      details: JSON.stringify({ repairedHosts: 2 }),
    }))
    expect(appEventBus.publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'inventory_acl_changed',
      tenantId: 10,
      inventoryNodeId: 1,
      hostId: null,
      actorId: 7,
      principalType: 'ROLE',
      principalId: 1,
      action: 'repair',
    }))
  })

  it('mantém reparo de integridade idempotente quando não há hosts pendentes', async () => {
    const { service, repo, logRepo, appEventBus } = setup()
    repo.findRoot.mockResolvedValue(root)
    repo.createMissingHostNodesUnderRoot.mockResolvedValue(0)
    repo.findHostsWithoutInventoryNode.mockResolvedValue({
      total: 0,
      sample: [],
    })

    await expect(service.repairIntegrity(10, 7)).resolves.toMatchObject({
      repairedHosts: 0,
      report: { hostsWithoutInventoryNode: { total: 0 } },
    })
    expect(logRepo.logAdminEvent).not.toHaveBeenCalled()
    expect(appEventBus.publish).not.toHaveBeenCalled()
  })

  it('rejeita reparo de integridade sem raiz corporativa', async () => {
    const { service, repo } = setup()
    repo.findRoot.mockResolvedValue(null)

    await expect(service.repairIntegrity(10, 7)).rejects.toBeInstanceOf(NotFoundError)
    expect(repo.createMissingHostNodesUnderRoot).not.toHaveBeenCalled()
  })

  it('rejeita pai inexistente no tenant informado', async () => {
    const { service, repo } = setup()
    repo.findById.mockResolvedValue(null)

    await expect(service.createFolder({ parentId: 99, name: 'Produção' }, 10, 7))
      .rejects.toBeInstanceOf(NotFoundError)
  })

  it('rejeita host como pai de pasta', async () => {
    const { service, repo } = setup()
    repo.findById.mockResolvedValue({ ...folder, type: 'HOST', hostId: 42 })

    await expect(service.createFolder({ parentId: 2, name: 'Filha' }, 10, 7))
      .rejects.toBeInstanceOf(ValidationError)
  })

  it('rejeita nome duplicado no mesmo nível', async () => {
    const { service, repo } = setup()
    repo.findById.mockResolvedValue(root)
    repo.existsActiveSibling.mockResolvedValue(true)

    await expect(service.createFolder({ parentId: 1, name: 'Produção' }, 10, 7))
      .rejects.toBeInstanceOf(ConflictError)
  })

  it('não permite tratar a raiz como pasta editável', async () => {
    const { service, repo } = setup()
    repo.findById.mockResolvedValue(root)

    await expect(service.updateFolder(1, { name: 'Outra raiz' }, 10, 7))
      .rejects.toBeInstanceOf(NotFoundError)
  })

  it('bloqueia exclusão de pasta com filhos ativos', async () => {
    const { service, repo } = setup()
    repo.findById.mockResolvedValue(folder)
    repo.hasActiveChildren.mockResolvedValue(true)

    await expect(service.deleteFolder(2, 10, 7)).rejects.toBeInstanceOf(ConflictError)
    expect(repo.deleteFolder).not.toHaveBeenCalled()
  })

  it('move host para uma pasta do mesmo tenant e registra a origem', async () => {
    const { service, repo, logRepo } = setup()
    const hostNode: InventoryNodeRow = {
      ...folder,
      id: 3,
      parentId: 1,
      type: 'HOST',
      hostId: 42,
      name: 'mysql-01',
      path: '/3/',
    }
    const moved = { ...hostNode, parentId: 2, path: '/2/3/', depth: 2 }
    repo.findByHostId.mockResolvedValue(hostNode)
    repo.findById.mockResolvedValue(folder)
    repo.moveHost.mockResolvedValue(moved)

    await expect(service.moveHost(42, { parentId: 2 }, 10, 7))
      .resolves.toMatchObject({ hostId: 42, parentId: 2, path: '/2/3/' })
    expect(logRepo.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'MOVE_INVENTORY_HOST',
      details: JSON.stringify({ hostId: 42, previousParentId: 1, parentId: 2 }),
    }))
  })

  it('move pasta para outro destino e registra a origem', async () => {
    const { service, repo, logRepo, appEventBus } = setup()
    const destination: InventoryNodeRow = {
      ...folder,
      id: 4,
      parentId: 1,
      name: 'Destino',
      path: '/4/',
    }
    const moved = { ...folder, parentId: 4, path: '/4/2/', depth: 2 }
    repo.findById
      .mockResolvedValueOnce(folder)
      .mockResolvedValueOnce(destination)
    repo.existsActiveSibling.mockResolvedValue(false)
    repo.moveFolder.mockResolvedValue(moved)

    await expect(service.moveFolder(2, { parentId: 4 }, 10, 7))
      .resolves.toMatchObject({ id: 2, parentId: 4, path: '/4/2/' })
    expect(repo.moveFolder).toHaveBeenCalledWith(folder, 10, destination, 7)
    expect(logRepo.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'MOVE_INVENTORY_FOLDER',
      targetId: 2,
      details: JSON.stringify({ previousParentId: 1, parentId: 4 }),
    }))
    expect(appEventBus.publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'inventory_acl_changed',
      inventoryNodeId: 1,
      action: 'move',
    }))
    expect(appEventBus.publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'inventory_acl_changed',
      inventoryNodeId: 4,
      action: 'move',
    }))
  })

  it('não move pasta para dentro dela mesma ou descendente', async () => {
    const { service, repo } = setup()
    const child: InventoryNodeRow = {
      ...folder,
      id: 5,
      parentId: 2,
      name: 'Filha',
      path: '/2/5/',
      depth: 2,
    }
    repo.findById
      .mockResolvedValueOnce(folder)
      .mockResolvedValueOnce(child)

    await expect(service.moveFolder(2, { parentId: 5 }, 10, 7))
      .rejects.toBeInstanceOf(ValidationError)
    expect(repo.moveFolder).not.toHaveBeenCalled()
  })

  it('não move pasta quando já existe pasta com mesmo nome no destino', async () => {
    const { service, repo } = setup()
    const destination: InventoryNodeRow = {
      ...folder,
      id: 4,
      parentId: 1,
      name: 'Destino',
      path: '/4/',
    }
    repo.findById
      .mockResolvedValueOnce(folder)
      .mockResolvedValueOnce(destination)
    repo.existsActiveSibling.mockResolvedValue(true)

    await expect(service.moveFolder(2, { parentId: 4 }, 10, 7))
      .rejects.toBeInstanceOf(ConflictError)
    expect(repo.moveFolder).not.toHaveBeenCalled()
  })

  it('não move host para outro host', async () => {
    const { service, repo } = setup()
    repo.findByHostId.mockResolvedValue({ ...folder, type: 'HOST', hostId: 42 })
    repo.findById.mockResolvedValue({ ...folder, id: 3, type: 'HOST', hostId: 43 })

    await expect(service.moveHost(42, { parentId: 3 }, 10, 7))
      .rejects.toBeInstanceOf(ValidationError)
    expect(repo.moveHost).not.toHaveBeenCalled()
  })
})
