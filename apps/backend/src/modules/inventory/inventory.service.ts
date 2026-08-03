import type {
  CreateInventoryFolderDto,
  InventoryIntegrityRepairResult,
  InventoryIntegrityReport,
  InventoryNodePublic,
  MoveInventoryFolderDto,
  MoveInventoryHostDto,
  UpdateInventoryFolderDto,
} from '@nodeaccess/shared'
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.js'
import type { LogRepository } from '../logs/log.repository.js'
import type { AppEventBus } from '../app-events/app-event.bus.js'
import type { InventoryNodeRow, InventoryRepository } from './inventory.repository.js'

function toPublic(node: InventoryNodeRow): InventoryNodePublic {
  return {
    id: node.id,
    parentId: node.parentId,
    type: node.type,
    hostId: node.hostId,
    name: node.name,
    path: node.path,
    depth: node.depth,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  }
}

export class InventoryService {
  constructor(
    private readonly repo: InventoryRepository,
    private readonly logRepo: LogRepository,
    private readonly appEventBus?: AppEventBus,
  ) {}

  async list(tenantId: number, actorId: number, role: 'ADMIN' | 'USER'): Promise<InventoryNodePublic[]> {
    return (await this.repo.findVisibleTree(tenantId, actorId, role)).map(toPublic)
  }

  async getHostNode(hostId: number, tenantId: number): Promise<InventoryNodePublic> {
    const node = await this.repo.findByHostId(hostId, tenantId)
    if (!node) throw new NotFoundError('Host do inventário')
    return toPublic(node)
  }

  async getIntegrityReport(tenantId: number): Promise<InventoryIntegrityReport> {
    const sampleLimit = 20
    const hostsWithoutInventoryNode = await this.repo.findHostsWithoutInventoryNode(tenantId, sampleLimit)
    return {
      hostsWithoutInventoryNode: {
        total: hostsWithoutInventoryNode.total,
        sample: hostsWithoutInventoryNode.sample,
        sampleLimit,
      },
    }
  }

  async repairIntegrity(tenantId: number, actorId: number): Promise<InventoryIntegrityRepairResult> {
    const root = await this.repo.findRoot(tenantId)
    if (!root) throw new NotFoundError('Raiz do inventário')

    const repairedHosts = await this.repo.createMissingHostNodesUnderRoot(tenantId, actorId)
    if (repairedHosts > 0) {
      await this.audit(actorId, 'REPAIR_INVENTORY_HOST_NODES', root.id, { repairedHosts })
      await this.publishIntegrityRepaired(root.id, tenantId, actorId)
    }

    return {
      repairedHosts,
      report: await this.getIntegrityReport(tenantId),
    }
  }

  async createFolder(dto: CreateInventoryFolderDto, tenantId: number, actorId: number): Promise<InventoryNodePublic> {
    const name = dto.name.trim()
    const parent = await this.repo.findById(dto.parentId, tenantId)
    if (!parent) throw new NotFoundError('Pasta pai')
    if (parent.type !== 'ROOT' && parent.type !== 'FOLDER') {
      throw new ValidationError('A pasta pai deve ser a raiz ou outra pasta')
    }
    if (await this.repo.existsActiveSibling(tenantId, parent.id, name)) {
      throw new ConflictError('Já existe uma pasta com este nome neste nível')
    }

    const folder = await this.repo.createFolder({
      tenantId,
      parentId: parent.id,
      name,
      actorId,
      parentPath: parent.path,
      parentDepth: parent.depth,
    })
    await this.audit(actorId, 'CREATE_INVENTORY_FOLDER', folder.id, { parentId: parent.id })
    return toPublic(folder)
  }

  async updateFolder(
    id: number,
    dto: UpdateInventoryFolderDto,
    tenantId: number,
    actorId: number,
  ): Promise<InventoryNodePublic> {
    const folder = await this.requireFolder(id, tenantId)
    const name = dto.name.trim()
    if (name !== folder.name && await this.repo.existsActiveSibling(tenantId, folder.parentId!, name, id)) {
      throw new ConflictError('Já existe uma pasta com este nome neste nível')
    }
    const updated = await this.repo.renameFolder(id, tenantId, name, actorId)
    await this.audit(actorId, 'UPDATE_INVENTORY_FOLDER', id)
    return toPublic(updated)
  }

  async deleteFolder(id: number, tenantId: number, actorId: number): Promise<void> {
    await this.requireFolder(id, tenantId)
    if (await this.repo.hasActiveChildren(id, tenantId)) {
      throw new ConflictError('Não é possível excluir uma pasta que contém itens')
    }
    await this.repo.deleteFolder(id, tenantId, actorId)
    await this.audit(actorId, 'DELETE_INVENTORY_FOLDER', id)
  }

  async moveFolder(
    id: number,
    dto: MoveInventoryFolderDto,
    tenantId: number,
    actorId: number,
  ): Promise<InventoryNodePublic> {
    const [folder, parent] = await Promise.all([
      this.requireFolder(id, tenantId),
      this.repo.findById(dto.parentId, tenantId),
    ])
    if (!parent) throw new NotFoundError('Pasta de destino')
    if (parent.type !== 'ROOT' && parent.type !== 'FOLDER') {
      throw new ValidationError('O destino deve ser a raiz ou uma pasta')
    }
    if (folder.parentId === parent.id) return toPublic(folder)
    if (parent.path.startsWith(folder.path)) {
      throw new ValidationError('Não é possível mover uma pasta para dentro dela mesma')
    }
    if (await this.repo.existsActiveSibling(tenantId, parent.id, folder.name, folder.id)) {
      throw new ConflictError('Já existe uma pasta com este nome no destino')
    }

    const moved = await this.repo.moveFolder(folder, tenantId, parent, actorId)
    await this.audit(actorId, 'MOVE_INVENTORY_FOLDER', moved.id, {
      previousParentId: folder.parentId,
      parentId: parent.id,
    })
    if (folder.parentId !== null) {
      await this.publishInventoryMoved(folder.parentId, null, tenantId, actorId)
    }
    await this.publishInventoryMoved(parent.id, null, tenantId, actorId)
    return toPublic(moved)
  }

  async moveHost(
    hostId: number,
    dto: MoveInventoryHostDto,
    tenantId: number,
    actorId: number,
  ): Promise<InventoryNodePublic> {
    const [hostNode, parent] = await Promise.all([
      this.repo.findByHostId(hostId, tenantId),
      this.repo.findById(dto.parentId, tenantId),
    ])
    if (!hostNode) throw new NotFoundError('Host do inventário')
    if (!parent) throw new NotFoundError('Pasta de destino')
    if (parent.type !== 'ROOT' && parent.type !== 'FOLDER') {
      throw new ValidationError('O destino deve ser a raiz ou uma pasta')
    }
    if (hostNode.parentId === parent.id) return toPublic(hostNode)

    const moved = await this.repo.moveHost(hostNode.id, tenantId, parent, actorId)
    await this.audit(actorId, 'MOVE_INVENTORY_HOST', moved.id, {
      hostId,
      previousParentId: hostNode.parentId,
      parentId: parent.id,
    })
    if (hostNode.parentId !== null) {
      await this.publishInventoryMoved(hostNode.parentId, hostId, tenantId, actorId)
    }
    await this.publishInventoryMoved(parent.id, hostId, tenantId, actorId)
    return toPublic(moved)
  }

  private async requireFolder(id: number, tenantId: number): Promise<InventoryNodeRow> {
    const node = await this.repo.findById(id, tenantId)
    if (!node || node.type !== 'FOLDER') throw new NotFoundError('Pasta do inventário')
    return node
  }

  private async audit(actorId: number, action: string, targetId: number, details?: object): Promise<void> {
    await this.logRepo.logAdminEvent({
      adminId: actorId,
      action,
      targetType: 'InventoryNode',
      targetId,
      ...(details !== undefined && { details: JSON.stringify(details) }),
    }).catch(() => { /* best-effort */ })
  }

  private async publishIntegrityRepaired(inventoryNodeId: number, tenantId: number, actorId: number): Promise<void> {
    await this.appEventBus?.publish({
      type: 'inventory_acl_changed',
      tenantId,
      inventoryNodeId,
      hostId: null,
      actorId,
      principalType: 'ROLE',
      principalId: 1,
      action: 'repair',
      changedAt: new Date().toISOString(),
    }).catch(() => { /* best-effort realtime */ })
  }

  private async publishInventoryMoved(
    inventoryNodeId: number,
    hostId: number | null,
    tenantId: number,
    actorId: number,
  ): Promise<void> {
    await this.appEventBus?.publish({
      type: 'inventory_acl_changed',
      tenantId,
      inventoryNodeId,
      hostId,
      actorId,
      principalType: 'ROLE',
      principalId: 1,
      action: 'move',
      changedAt: new Date().toISOString(),
    }).catch(() => { /* best-effort realtime */ })
  }
}
