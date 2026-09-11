import type {
  EffectiveInventoryPermissions,
  EffectiveHostInventoryPermissions,
  InventoryAclImpactPreviewDto,
  InventoryAclImpactPreviewResult,
  InventoryAclEntryPublic,
  InventoryNodePublic,
  InventoryPermissions,
  UpsertInventoryAclEntryDto,
} from '@nodeaccess/shared'
import { ForbiddenError, NotFoundError, ValidationError } from '../../shared/errors.js'
import type { AppEventBus } from '../app-events/app-event.bus.js'
import type { LogRepository } from '../logs/log.repository.js'
import type { EffectiveAclSourceRow, InventoryAclEntryRow, InventoryAclRepository } from './inventory-acl.repository.js'
import type { InventoryNodeRow, InventoryRepository } from './inventory.repository.js'

const DENIED: InventoryPermissions = {
  view: false,
  connect: false,
  edit: false,
  admin: false,
}

const ACL_PERMISSION_KEYS = ['view', 'connect', 'edit', 'admin'] as const
type InventoryAclPermissionKey = typeof ACL_PERMISSION_KEYS[number]

export function normalizeInventoryPermissions(permissions: InventoryPermissions): InventoryPermissions {
  if (permissions.admin) {
    return { view: true, connect: true, edit: true, admin: true }
  }
  return {
    view: permissions.view || permissions.connect || permissions.edit,
    connect: permissions.connect,
    edit: permissions.edit,
    admin: false,
  }
}

function permissionsFromRow(row: EffectiveAclSourceRow): InventoryPermissions {
  return normalizeInventoryPermissions({
    view: Boolean(row.canView),
    connect: Boolean(row.canConnect),
    edit: Boolean(row.canEdit),
    admin: Boolean(row.canAdmin),
  })
}

function permissionChanges(before: InventoryPermissions | null, after: InventoryPermissions | null) {
  return ACL_PERMISSION_KEYS
    .map((permission) => ({
      permission,
      before: Boolean(before?.[permission]),
      after: Boolean(after?.[permission]),
    }))
    .filter((change) => change.before !== change.after)
}

export class InventoryAclService {
  constructor(
    private readonly repo: InventoryAclRepository,
    private readonly logRepo?: LogRepository,
    private readonly appEventBus?: AppEventBus,
    private readonly inventoryRepo?: InventoryRepository,
  ) {}

  async listEntries(
    inventoryNodeId: number,
    tenantId: number,
    actorId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<InventoryAclEntryPublic[]> {
    if (!await this.repo.nodeExists(inventoryNodeId, tenantId)) {
      throw new NotFoundError('Nó do inventário')
    }
    await this.assertCanAdmin(inventoryNodeId, tenantId, actorId, role)
    const rows = await this.repo.findApplicableEntries(inventoryNodeId, tenantId)
    const origins = new Map<number, boolean>()
    for (const id of new Set(rows.map(row => row.inventoryNodeId))) {
      origins.set(id, role === 'ADMIN' || (await this.resolveEffectivePermissions(id, tenantId, actorId)).admin)
    }
    return rows.map(row => ({ ...toPublicEntry(row), canAdminOrigin: origins.get(row.inventoryNodeId) === true }))
  }

  async searchUsers(inventoryNodeId: number, tenantId: number, actorId: number, role: 'ADMIN' | 'USER', search: string, page: number) {
    if (!await this.repo.nodeExists(inventoryNodeId, tenantId)) throw new NotFoundError('Nó do inventário')
    await this.assertCanAdmin(inventoryNodeId, tenantId, actorId, role)
    return this.repo.searchUsers(tenantId, search, page)
  }

  async ownHostAccess(hostId: number, tenantId: number, userId: number, role: 'ADMIN' | 'USER', canManageHosts = false) {
    const node = await this.inventoryRepo?.findByHostId(hostId, tenantId)
    if (!node) throw new NotFoundError('Host')
    const effective = await this.resolveEffectivePermissions(node.id, tenantId, userId)
    if (role === 'ADMIN') return { ...effective, view: true, connect: true, edit: true, admin: true,
      explanation: { ...effective.explanation, access: 'admin' as const } }
    if (!effective.view) throw new NotFoundError('Host')
    // Match the route-level host-management prerequisite without exposing other users.
    const permissions = { view: effective.view, connect: effective.connect, edit: effective.edit, admin: effective.admin && canManageHosts }
    return { ...effective, ...permissions, explanation: { ...effective.explanation, access: effectiveAccessLevel(permissions) } }
  }

  async upsertEntry(
    inventoryNodeId: number,
    dto: UpsertInventoryAclEntryDto,
    tenantId: number,
    actorId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<InventoryAclEntryPublic[]> {
    if (!await this.repo.nodeExists(inventoryNodeId, tenantId)) {
      throw new NotFoundError('Nó do inventário')
    }
    const principalName = await this.repo.findPrincipalName(dto.principalType, dto.principalId, tenantId)
    if (!principalName) {
      throw new NotFoundError(dto.principalType === 'USER' ? 'Usuário' : dto.principalType === 'GROUP' ? 'Grupo' : 'Role')
    }
    await this.assertCanAdmin(inventoryNodeId, tenantId, actorId, role)
    const permissions = normalizeInventoryPermissions(dto.permissions)
    if (!Object.values(permissions).some(Boolean)) {
      throw new ValidationError('Ao menos uma permissão deve ser concedida')
    }
    const current = await this.repo.findLocalEntry(inventoryNodeId, tenantId, dto.principalType, dto.principalId)
    const before = current ? permissionsFromRow(current) : null
    await this.repo.upsert({
      tenantId,
      inventoryNodeId,
      principalType: dto.principalType,
      principalId: dto.principalId,
      canView: permissions.view,
      canConnect: permissions.connect,
      canEdit: permissions.edit,
      canAdmin: permissions.admin,
      inheritToChildren: true,
      actorId,
    })
    const nodeAuditDetails = await this.nodeAuditDetails(inventoryNodeId, tenantId)
    await this.audit(actorId, 'UPSERT_INVENTORY_ACL', inventoryNodeId, {
      principalType: dto.principalType,
      principalId: dto.principalId,
      principalName,
      ...nodeAuditDetails,
      permissions,
      before,
      after: permissions,
      changes: permissionChanges(before, permissions),
      inheritToChildren: true,
    })
    await this.publishChanged('upsert', inventoryNodeId, tenantId, actorId, dto.principalType, dto.principalId)
    // A successful self-demotion must not look like a failed write, or leak the ACL afterward.
    if (role !== 'ADMIN' && !(await this.resolveEffectivePermissions(inventoryNodeId, tenantId, actorId)).admin) return []
    return this.listEntries(inventoryNodeId, tenantId, actorId, role)
  }

  async previewImpact(
    inventoryNodeId: number,
    dto: InventoryAclImpactPreviewDto,
    tenantId: number,
    actorId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<InventoryAclImpactPreviewResult> {
    if (!await this.repo.nodeExists(inventoryNodeId, tenantId)) {
      throw new NotFoundError('Nó do inventário')
    }
    if (!await this.repo.principalExists(dto.principalType, dto.principalId, tenantId)) {
      throw new NotFoundError(dto.principalType === 'USER' ? 'Usuário' : dto.principalType === 'GROUP' ? 'Grupo' : 'Role')
    }
    await this.assertCanAdmin(inventoryNodeId, tenantId, actorId, role)

    const [current, affectedHostCount, activeSessionCount] = await Promise.all([
      this.repo.findLocalEntry(inventoryNodeId, tenantId, dto.principalType, dto.principalId),
      this.repo.countHostsInSubtree(inventoryNodeId, tenantId),
      this.repo.countActiveAuthenticatedSessionsInSubtreeForPrincipal(inventoryNodeId, tenantId, dto.principalType, dto.principalId),
    ])
    const before = current ? permissionsFromRow(current) : null
    const after = dto.action === 'delete'
      ? null
      : normalizeInventoryPermissions(dto.permissions ?? DENIED)
    const mayRevokeConnect = Boolean(before?.connect) && !Boolean(after?.connect)
    const [users, applicable] = await Promise.all([
      this.repo.findPrincipalUsers(tenantId, dto.principalType, dto.principalId),
      this.repo.findApplicableEntries(inventoryNodeId, tenantId),
    ])
    const fold = (rows: EffectiveAclSourceRow[]): InventoryPermissions => rows.reduce((permissions, row) => {
      const grant = permissionsFromRow(row)
      return { view: permissions.view || grant.view, connect: permissions.connect || grant.connect,
        edit: permissions.edit || grant.edit, admin: permissions.admin || grant.admin }
    }, { ...DENIED })
    const evaluated = users.map(user => {
      const sources = applicable.filter(row => row.principalType === 'USER' ? row.principalId === user.id
        : row.principalType === 'GROUP' ? user.groups.some(group => group.groupId === row.principalId)
          : row.principalId === 1 || (row.principalId === 2 && user.role === 'ADMIN'))
      const remaining = sources.filter(row => row.aclEntryId !== current?.aclEntryId)
      const oldPermissions = fold(sources)
      const newPermissions = fold(remaining)
      if (after) for (const key of ACL_PERMISSION_KEYS) newPermissions[key] ||= after[key]
      if (user.role === 'ADMIN') for (const key of ACL_PERMISSION_KEYS) { oldPermissions[key] = true; newPermissions[key] = true }
      return { userId: user.id, name: user.name, before: oldPermissions, after: newPermissions,
        remainingSources: [...new Set(remaining.map(row => `${row.principalName} · ${row.inventoryNodeName}`))],
      }
    })

    return {
      inventoryNodeId,
      action: dto.action,
      principalType: dto.principalType,
      principalId: dto.principalId,
      affectedHostCount,
      activeSessionCount,
      mayRevokeConnect,
      remainingAccess: { scope: 'item', usersEvaluated: evaluated.length,
        retainConnect: evaluated.filter(user => user.before.connect && user.after.connect).length,
        gainConnect: evaluated.filter(user => !user.before.connect && user.after.connect).length,
        loseConnect: evaluated.filter(user => user.before.connect && !user.after.connect).length,
        examples: evaluated.slice(0, 10) },
      before,
      after,
    }
  }

  async deleteEntry(
    inventoryNodeId: number,
    principalType: 'USER' | 'GROUP' | 'ROLE',
    principalId: number,
    tenantId: number,
    actorId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<void> {
    await this.assertCanAdmin(inventoryNodeId, tenantId, actorId, role)
    const current = await this.repo.findLocalEntry(inventoryNodeId, tenantId, principalType, principalId)
    const before = current ? permissionsFromRow(current) : null
    if (!await this.repo.delete(inventoryNodeId, tenantId, principalType, principalId)) {
      throw new NotFoundError('Entrada de ACL')
    }
    const nodeAuditDetails = await this.nodeAuditDetails(inventoryNodeId, tenantId)
    await this.audit(actorId, 'DELETE_INVENTORY_ACL', inventoryNodeId, {
      principalType,
      principalId,
      ...(current?.principalName ? { principalName: current.principalName } : {}),
      ...nodeAuditDetails,
      before,
      after: null,
      changes: permissionChanges(before, null),
    })
    await this.publishChanged('delete', inventoryNodeId, tenantId, actorId, principalType, principalId)
  }

  async resolveEffectivePermissions(
    inventoryNodeId: number,
    tenantId: number,
    userId: number,
  ): Promise<EffectiveInventoryPermissions> {
    const rows = await this.repo.findEffectiveSources(inventoryNodeId, tenantId, userId)
    const permissions = rows.reduce<InventoryPermissions>((effective, row) => {
      const entry = permissionsFromRow(row)
      return {
        view: effective.view || entry.view,
        connect: effective.connect || entry.connect,
        edit: effective.edit || entry.edit,
        admin: effective.admin || entry.admin,
      }
    }, { ...DENIED })

    return {
      ...permissions,
      explanation: {
        access: effectiveAccessLevel(permissions),
        sourceCount: rows.length,
        localSourceCount: rows.filter((row) => Boolean(row.local)).length,
        inheritedSourceCount: rows.filter((row) => !Boolean(row.local)).length,
        principalTypes: [...new Set(rows.map((row) => row.principalType))],
      },
      sources: rows.map((row) => ({
        aclEntryId: row.aclEntryId,
        inventoryNodeId: row.inventoryNodeId,
        inventoryNodeName: row.inventoryNodeName,
        principalType: row.principalType,
        principalId: row.principalId,
        principalName: row.principalName,
        permissions: permissionsFromRow(row),
        local: Boolean(row.local),
        inheritToChildren: Boolean(row.inheritToChildren),
      })),
    }
  }

  async resolveEffectiveHostPermissions(
    hostId: number,
    tenantId: number,
    userId: number,
  ): Promise<EffectiveHostInventoryPermissions> {
    const node = await this.inventoryRepo?.findByHostId(hostId, tenantId)
    if (!node) throw new NotFoundError('Host do inventário')
    return {
      inventoryNode: toPublicNode(node),
      ...await this.resolveEffectivePermissions(node.id, tenantId, userId),
    }
  }

  private async audit(actorId: number, action: string, targetId: number, details: object): Promise<void> {
    await this.logRepo?.logAdminEvent({
      adminId: actorId,
      action,
      targetType: 'InventoryNode',
      targetId,
      details: JSON.stringify(details),
    }).catch(() => { /* best-effort */ })
  }

  private async nodeAuditDetails(inventoryNodeId: number, tenantId: number): Promise<Record<string, string>> {
    const context = await this.repo.findNodeContext(inventoryNodeId, tenantId).catch(() => null)
    return {
      ...(context?.name ? { inventoryNodeName: context.name } : {}),
      ...(context?.type ? { inventoryNodeType: context.type } : {}),
    }
  }

  private async assertCanAdmin(
    inventoryNodeId: number,
    tenantId: number,
    actorId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<void> {
    if (role === 'ADMIN') return
    const permissions = await this.resolveEffectivePermissions(inventoryNodeId, tenantId, actorId)
    if (!permissions.admin) {
      throw new ForbiddenError('Sem permissão para administrar a ACL deste item')
    }
  }

  private async publishChanged(
    action: 'upsert' | 'delete',
    inventoryNodeId: number,
    tenantId: number,
    actorId: number,
    principalType: 'USER' | 'GROUP' | 'ROLE',
    principalId: number,
  ): Promise<void> {
    const context = await this.repo.findNodeContext(inventoryNodeId, tenantId).catch(() => null)
    await this.appEventBus?.publish({
      type: 'inventory_acl_changed',
      tenantId,
      inventoryNodeId,
      hostId: context?.hostId ?? null,
      actorId,
      principalType,
      principalId,
      action,
      changedAt: new Date().toISOString(),
    }).catch(() => { /* best-effort */ })
  }
}

function effectiveAccessLevel(permissions: InventoryPermissions): EffectiveInventoryPermissions['explanation']['access'] {
  if (permissions.admin) return 'admin'
  if (permissions.edit) return 'edit'
  if (permissions.connect) return 'connect'
  if (permissions.view) return 'view'
  return 'none'
}

function toPublicNode(node: InventoryNodeRow): InventoryNodePublic {
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

function toPublicEntry(row: InventoryAclEntryRow): InventoryAclEntryPublic {
  return {
    id: row.aclEntryId,
    inventoryNodeId: row.inventoryNodeId,
    inventoryNodeName: row.inventoryNodeName,
    principalType: row.principalType,
    principalId: row.principalId,
    principalName: row.principalName,
    permissions: permissionsFromRow(row),
    inheritToChildren: Boolean(row.inheritToChildren),
    local: Boolean(row.local),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
