import type {
  HostBulkAction,
  HostBulkActionHistoryResponse,
  HostBulkApplyDto,
  HostBulkApplyResponse,
  HostBulkApplyRow,
  HostBulkPreviewDto,
  HostBulkPreviewResponse,
  HostBulkPreviewRow,
} from '@nodeaccess/shared'
import { ForbiddenError, ValidationError } from '../../shared/errors.js'
import type { LogRepository } from '../logs/log.repository.js'
import type { AppEventBus } from '../app-events/app-event.bus.js'
import type { HostBulkActionRepository, HostBulkRow } from './host-bulk-action.repository.js'

const MAX_SYNC_HOSTS = 500
const PREVIEW_SAMPLE_SIZE = 20

export class HostBulkActionService {
  constructor(
    private readonly bulkRepo: HostBulkActionRepository,
    private readonly logRepo: LogRepository,
    private readonly appEventBus?: AppEventBus,
  ) {}

  async preview(
    dto: HostBulkPreviewDto,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<HostBulkPreviewResponse> {
    this.assertCanBulkUpdate(role)
    await this.assertActionTarget(dto.action, tenantId)

    const [hosts, total] = await Promise.all([
      this.bulkRepo.resolveSelection(tenantId, userId, role, dto.selection),
      this.bulkRepo.countSelection(tenantId, userId, role, dto.selection),
    ])
    if (total > MAX_SYNC_HOSTS) {
      throw new ValidationError(`A edição em massa síncrona suporta até ${MAX_SYNC_HOSTS} hosts por operação. Refine os filtros para continuar.`)
    }

    const rows = hosts.map((host) => this.buildPreviewRow(host, dto.action))
    return {
      total,
      sample: rows.slice(0, PREVIEW_SAMPLE_SIZE),
      blocked: rows.filter((row) => row.errors.length > 0).length,
      warnings: rows.filter((row) => row.warnings.length > 0).length,
      actionLabel: await this.actionLabel(dto.action, tenantId),
    }
  }

  async apply(
    dto: HostBulkApplyDto,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<HostBulkApplyResponse> {
    this.assertCanBulkUpdate(role)
    await this.assertActionTarget(dto.action, tenantId)

    const total = await this.bulkRepo.countSelection(tenantId, userId, role, dto.selection)
    if (total > MAX_SYNC_HOSTS) {
      throw new ValidationError(`A edição em massa síncrona suporta até ${MAX_SYNC_HOSTS} hosts por operação`)
    }
    const hosts = await this.bulkRepo.resolveSelection(tenantId, userId, role, dto.selection)
    const actionLabel = await this.actionLabel(dto.action, tenantId)

    const previewRows = hosts.map((host) => this.buildPreviewRow(host, dto.action))
    const blocked = previewRows.filter((row) => row.errors.length > 0)
    const blockedHostIds = new Set(blocked.map((row) => row.hostId))
    const noOpHosts = hosts.filter((host) => !blockedHostIds.has(host.id) && isNoopAction(host, dto.action))
    const noOpHostIds = new Set(noOpHosts.map((host) => host.id))
    const actionableHosts = hosts.filter((host) => !blockedHostIds.has(host.id) && !noOpHostIds.has(host.id))

    if (actionableHosts.length > 0) {
      await this.bulkRepo.applyAction(actionableHosts.map((host) => host.id), tenantId, dto.action, userId)
      await this.publishMoveAclChanged(dto.action, tenantId, userId)
    }

    const rows: HostBulkApplyRow[] = [
      ...actionableHosts.map((host) => this.buildApplyRow(host, dto.action)),
      ...noOpHosts.map((host) => ({
        hostId: host.id,
        name: host.name,
        status: 'skipped' as const,
        message: noopMessage(dto.action),
      })),
      ...blocked.map((row) => ({
        hostId: row.hostId,
        name: row.name,
        status: 'skipped' as const,
        message: row.errors.join(' • '),
      })),
    ]

    await this.bulkRepo.createHistory({
      tenantId,
      actorUserId: userId,
      action: dto.action,
      actionLabel,
      selection: dto.selection,
      requested: hosts.length,
      updated: actionableHosts.length,
      skipped: blocked.length + noOpHosts.length,
      failed: 0,
      rows,
    }).catch(() => { /* best-effort: admin log still records the action */ })

    await this.logRepo.logAdminEvent({
      adminId: userId,
      action: 'HOST_BULK_ACTION',
      targetType: 'HostBulkAction',
      targetId: 0,
      details: JSON.stringify({
        action: dto.action,
        selection: dto.selection,
        requested: hosts.length,
        updated: actionableHosts.length,
        skipped: blocked.length + noOpHosts.length,
        hostIds: actionableHosts.slice(0, 200).map((host) => host.id),
        hostIdsTruncated: actionableHosts.length > 200,
      }),
    }).catch(() => { /* best-effort */ })
    await this.auditInventoryMove(dto.action, userId, dto.selection, hosts.length, actionableHosts, blocked.length + noOpHosts.length)

    return {
      updated: actionableHosts.length,
      skipped: blocked.length + noOpHosts.length,
      failed: 0,
      rows,
    }
  }

  async rollback(
    historyId: number,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<HostBulkApplyResponse> {
    this.assertCanBulkUpdate(role)

    const history = await this.bulkRepo.getHistoryById(tenantId, historyId)
    if (!history) throw new ValidationError('Histórico de ação em massa não encontrado')
    if (history.action.type === 'rollback') throw new ValidationError('Rollback de rollback não é suportado')

    const updatedRows = history.rows.filter((row) => row.status === 'updated')
    const reversibleRows = updatedRows.filter((row) => !!row.before)
    if (reversibleRows.length === 0) {
      throw new ValidationError('Este histórico não possui snapshot para rollback')
    }

    const fields = rollbackFieldsForAction(history.action.type)
    const restoreRows = reversibleRows.map((row) => ({
      hostId: row.hostId,
      bastionId: readNullableNumber(row.before, 'bastionId'),
      pemKeyId: readNullableNumber(row.before, 'pemKeyId'),
      tagIds: readNumberArray(row.before, 'tagIds'),
      inventoryParentId: readNullableNumber(row.before, 'inventoryParentId'),
    }))

    const rollbackBlocks = fields.includes('inventoryParentId')
      ? await this.resolveInventoryRollbackBlocks(restoreRows, tenantId)
      : new Map<number, string>()
    const restorableRows = restoreRows.filter((row) => !rollbackBlocks.has(row.hostId))

    const activeIds = await this.bulkRepo.restoreSnapshots(tenantId, restorableRows, fields, userId)
    const rows: HostBulkApplyRow[] = reversibleRows.map((row) => {
      const rollbackBlock = rollbackBlocks.get(row.hostId)
      if (rollbackBlock) {
        return {
          hostId: row.hostId,
          name: row.name,
          status: 'skipped' as const,
          message: rollbackBlock,
        }
      }
      if (!activeIds.has(row.hostId)) {
        return {
          hostId: row.hostId,
          name: row.name,
          status: 'skipped' as const,
          message: 'Host removido ou indisponível para rollback',
        }
      }
      return {
        hostId: row.hostId,
        name: row.name,
        status: 'updated' as const,
        message: 'Rollback aplicado',
        before: row.after,
        after: row.before,
      }
    })

    const updated = rows.filter((row) => row.status === 'updated').length
    const skipped = rows.filter((row) => row.status === 'skipped').length

    await this.bulkRepo.createHistory({
      tenantId,
      actorUserId: userId,
      action: { type: 'rollback', historyId },
      actionLabel: `Rollback de ação em massa #${historyId}`,
      selection: { mode: 'ids', hostIds: reversibleRows.map((row) => row.hostId) },
      requested: reversibleRows.length,
      updated,
      skipped,
      failed: 0,
      rows,
    }).catch(() => { /* best-effort: admin log still records the rollback */ })

    await this.logRepo.logAdminEvent({
      adminId: userId,
      action: 'HOST_BULK_ACTION_ROLLBACK',
      targetType: 'HostBulkActionHistory',
      targetId: historyId,
      details: JSON.stringify({
        requested: reversibleRows.length,
        updated,
        skipped,
      }),
    }).catch(() => { /* best-effort */ })

    return { updated, skipped, failed: 0, rows }
  }

  async listHistory(role: 'ADMIN' | 'USER', tenantId: number): Promise<HostBulkActionHistoryResponse> {
    this.assertCanBulkUpdate(role)
    return { data: await this.bulkRepo.listHistory(tenantId) }
  }

  private async resolveInventoryRollbackBlocks(
    rows: Array<{ hostId: number; inventoryParentId?: number | null }>,
    tenantId: number,
  ): Promise<Map<number, string>> {
    const blocks = new Map<number, string>()
    const folderCache = new Map<number, Awaited<ReturnType<HostBulkActionRepository['inventoryFolder']>>>()

    for (const row of rows) {
      if (!row.inventoryParentId) {
        blocks.set(row.hostId, 'Pasta anterior do inventário ausente no snapshot de rollback')
        continue
      }

      let folder = folderCache.get(row.inventoryParentId)
      if (folder === undefined) {
        folder = await this.bulkRepo.inventoryFolder(row.inventoryParentId, tenantId)
        folderCache.set(row.inventoryParentId, folder)
      }
      if (!folder) {
        blocks.set(row.hostId, 'Pasta anterior do inventário não encontrada neste tenant')
        continue
      }
      if (folder.aclEntries === 0) {
        blocks.set(row.hostId, 'Pasta anterior do inventário não possui ACL aplicável')
      }
    }

    return blocks
  }

  private assertCanBulkUpdate(role: 'ADMIN' | 'USER'): void {
    if (role === 'ADMIN') return
    throw new ForbiddenError('Ações em massa de hosts exigem administrador')
  }

  private async assertActionTarget(action: HostBulkAction, tenantId: number): Promise<void> {
    if (action.type === 'set_bastion' && action.bastionId !== null) {
      const name = await this.bulkRepo.bastionName(action.bastionId, tenantId)
      if (!name) throw new ValidationError('Bastion não encontrado neste tenant')
    }
    if (action.type === 'set_pem_key' && action.pemKeyId !== null) {
      const name = await this.bulkRepo.pemKeyName(action.pemKeyId, tenantId)
      if (!name) throw new ValidationError('Chave PEM não encontrada neste tenant')
    }
    if (action.type === 'add_tags' || action.type === 'remove_tags') {
      const names = await this.bulkRepo.tagNames(action.tagIds, tenantId)
      if (names.size !== new Set(action.tagIds).size) throw new ValidationError('Uma ou mais tags não existem neste tenant')
    }
    if (action.type === 'move_inventory') {
      const folder = await this.bulkRepo.inventoryFolder(action.inventoryParentId, tenantId)
      if (!folder) throw new ValidationError('Pasta do inventário não encontrada neste tenant')
      if (folder.aclEntries === 0) {
        throw new ValidationError('A pasta de destino não possui ACL aplicável')
      }
    }
  }

  private buildPreviewRow(host: HostBulkRow, action: HostBulkAction): HostBulkPreviewRow {
    const errors: string[] = []
    const warnings: string[] = []

    if (action.type === 'set_pem_key' && host.authType === 'PASSWORD') {
      warnings.push('O host continuará com autenticação por senha até o tipo de autenticação ser alterado')
    }
    if (action.type === 'set_bastion' && host.group?.bastionId && host.bastionId === null) {
      warnings.push('Este host herda bastion do grupo; definir bastion direto sobrescreve a herança')
    }
    if (action.type === 'move_inventory' && host.inventoryNode?.parentId === action.inventoryParentId) {
      warnings.push('Host já está na pasta de destino')
    }
    if (action.type === 'move_inventory' && !host.inventoryNode?.parentId) {
      errors.push('Host sem pasta corporativa/ACL vinculada')
    }

    return {
      hostId: host.id,
      name: host.name,
      ip: host.ip,
      port: host.port,
      currentBastionId: host.bastionId,
      currentBastionName: host.bastion?.name ?? null,
      currentPemKeyId: host.pemKeyId,
      currentPemKeyName: host.pemKey?.name ?? null,
      currentInventoryParentId: host.inventoryNode?.parentId ?? null,
      currentInventoryParentName: host.inventoryNode?.parent?.name ?? null,
      warnings,
      errors,
    }
  }

  private buildApplyRow(host: HostBulkRow, action: HostBulkAction): HostBulkApplyRow {
    const before = snapshotForHost(host)
    return {
      hostId: host.id,
      name: host.name,
      status: 'updated',
      message: 'Atualizado',
      before,
      after: snapshotAfterAction(before, action),
    }
  }

  private async actionLabel(action: HostBulkAction, tenantId: number): Promise<string> {
    if (action.type === 'set_bastion') {
      if (action.bastionId === null) return 'Remover bastion direto dos hosts'
      const name = await this.bulkRepo.bastionName(action.bastionId, tenantId)
      return `Alterar bastion para ${name ?? action.bastionId}`
    }
    if (action.type === 'set_pem_key') {
      if (action.pemKeyId === null) return 'Remover chave PEM dos hosts'
      const name = await this.bulkRepo.pemKeyName(action.pemKeyId, tenantId)
      return `Alterar chave PEM para ${name ?? action.pemKeyId}`
    }
    if (action.type === 'move_inventory') {
      const folder = await this.bulkRepo.inventoryFolder(action.inventoryParentId, tenantId)
      return `Mover para pasta do inventário: ${folder?.name ?? action.inventoryParentId}`
    }
    const names = await this.bulkRepo.tagNames(action.tagIds, tenantId)
    const label = action.tagIds.map((id) => names.get(id) ?? String(id)).join(', ')
    return action.type === 'add_tags' ? `Adicionar tags: ${label}` : `Remover tags: ${label}`
  }

  private async publishMoveAclChanged(
    action: HostBulkAction,
    tenantId: number,
    actorId: number,
  ): Promise<void> {
    if (action.type !== 'move_inventory') return
    await this.appEventBus?.publish({
      type: 'inventory_acl_changed',
      tenantId,
      inventoryNodeId: action.inventoryParentId,
      hostId: null,
      actorId,
      principalType: 'ROLE',
      principalId: 1,
      action: 'move',
      changedAt: new Date().toISOString(),
    }).catch(() => { /* best-effort realtime/revocation */ })
  }

  private async auditInventoryMove(
    action: HostBulkAction,
    userId: number,
    selection: HostBulkApplyDto['selection'],
    requested: number,
    actionableHosts: HostBulkRow[],
    skipped: number,
  ): Promise<void> {
    if (action.type !== 'move_inventory' || actionableHosts.length === 0) return
    await this.logRepo.logAdminEvent({
      adminId: userId,
      action: 'INVENTORY_ACL_HOSTS_MOVED',
      targetType: 'InventoryNode',
      targetId: action.inventoryParentId,
      details: JSON.stringify({
        selection,
        requested,
        updated: actionableHosts.length,
        skipped,
        hostIds: actionableHosts.slice(0, 200).map((host) => host.id),
        hostIdsTruncated: actionableHosts.length > 200,
      }),
    }).catch(() => { /* best-effort */ })
  }
}

function snapshotForHost(host: HostBulkRow): Record<string, unknown> {
  return {
    bastionId: host.bastionId,
    pemKeyId: host.pemKeyId,
    tagIds: host.tags.map((item) => item.tagId).sort((a, b) => a - b),
    inventoryParentId: host.inventoryNode?.parentId ?? null,
  }
}

function snapshotAfterAction(before: Record<string, unknown>, action: HostBulkAction): Record<string, unknown> {
  if (action.type === 'set_bastion') return { ...before, bastionId: action.bastionId }
  if (action.type === 'set_pem_key') return { ...before, pemKeyId: action.pemKeyId }
  if (action.type === 'move_inventory') return { ...before, inventoryParentId: action.inventoryParentId }

  const currentTagIds = readNumberArray(before, 'tagIds')
  if (action.type === 'add_tags') {
    return { ...before, tagIds: [...new Set([...currentTagIds, ...action.tagIds])].sort((a, b) => a - b) }
  }
  return { ...before, tagIds: currentTagIds.filter((id) => !action.tagIds.includes(id)) }
}

function isNoopAction(host: HostBulkRow, action: HostBulkAction): boolean {
  return action.type === 'move_inventory' && host.inventoryNode?.parentId === action.inventoryParentId
}

function noopMessage(action: HostBulkAction): string {
  if (action.type === 'move_inventory') return 'Host já está na pasta de destino'
  return 'Sem alteração necessária'
}

function rollbackFieldsForAction(
  actionType: HostBulkAction['type'],
): Array<'bastionId' | 'pemKeyId' | 'tagIds' | 'inventoryParentId'> {
  if (actionType === 'set_bastion') return ['bastionId']
  if (actionType === 'set_pem_key') return ['pemKeyId']
  if (actionType === 'move_inventory') return ['inventoryParentId']
  return ['tagIds']
}

function readNullableNumber(source: Record<string, unknown> | undefined, key: string): number | null {
  const value = source?.[key]
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

function readNumberArray(source: Record<string, unknown> | undefined, key: string): number[] {
  const value = source?.[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is number => Number.isInteger(item) && item > 0)
}
