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
import type { UserRepository } from '../users/user.repository.js'
import type { LogRepository } from '../logs/log.repository.js'
import type { HostBulkActionRepository, HostBulkRow } from './host-bulk-action.repository.js'

const MAX_SYNC_HOSTS = 500
const PREVIEW_SAMPLE_SIZE = 20

export class HostBulkActionService {
  constructor(
    private readonly bulkRepo: HostBulkActionRepository,
    private readonly userRepo: UserRepository,
    private readonly logRepo: LogRepository,
  ) {}

  async preview(
    dto: HostBulkPreviewDto,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<HostBulkPreviewResponse> {
    this.assertCanBulkUpdate(role)
    await this.assertActionTarget(dto.action, tenantId)

    const userGroupIds = role === 'USER'
      ? await this.userRepo.findGroupIdsByUser(userId)
      : []

    const [hosts, total] = await Promise.all([
      this.bulkRepo.resolveSelection(tenantId, userId, role, userGroupIds, dto.selection),
      this.bulkRepo.countSelection(tenantId, userId, role, userGroupIds, dto.selection),
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

    const userGroupIds = role === 'USER'
      ? await this.userRepo.findGroupIdsByUser(userId)
      : []

    const total = await this.bulkRepo.countSelection(tenantId, userId, role, userGroupIds, dto.selection)
    if (total > MAX_SYNC_HOSTS) {
      throw new ValidationError(`A edição em massa síncrona suporta até ${MAX_SYNC_HOSTS} hosts por operação`)
    }
    const hosts = await this.bulkRepo.resolveSelection(tenantId, userId, role, userGroupIds, dto.selection)
    const actionLabel = await this.actionLabel(dto.action, tenantId)

    const previewRows = hosts.map((host) => this.buildPreviewRow(host, dto.action))
    const blocked = previewRows.filter((row) => row.errors.length > 0)
    const actionableHosts = hosts.filter((host) => !blocked.some((row) => row.hostId === host.id))

    if (actionableHosts.length > 0) {
      await this.bulkRepo.applyAction(actionableHosts.map((host) => host.id), tenantId, dto.action)
    }

    const rows: HostBulkApplyRow[] = [
      ...actionableHosts.map((host) => this.buildApplyRow(host, dto.action)),
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
      skipped: blocked.length,
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
        skipped: blocked.length,
        hostIds: actionableHosts.slice(0, 200).map((host) => host.id),
        hostIdsTruncated: actionableHosts.length > 200,
      }),
    }).catch(() => { /* best-effort */ })

    return {
      updated: actionableHosts.length,
      skipped: blocked.length,
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
    }))

    const activeIds = await this.bulkRepo.restoreSnapshots(tenantId, restoreRows, fields)
    const rows: HostBulkApplyRow[] = reversibleRows.map((row) => {
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

    return {
      hostId: host.id,
      name: host.name,
      ip: host.ip,
      port: host.port,
      currentBastionId: host.bastionId,
      currentBastionName: host.bastion?.name ?? null,
      currentPemKeyId: host.pemKeyId,
      currentPemKeyName: host.pemKey?.name ?? null,
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
    const names = await this.bulkRepo.tagNames(action.tagIds, tenantId)
    const label = action.tagIds.map((id) => names.get(id) ?? String(id)).join(', ')
    return action.type === 'add_tags' ? `Adicionar tags: ${label}` : `Remover tags: ${label}`
  }
}

function snapshotForHost(host: HostBulkRow): Record<string, unknown> {
  return {
    bastionId: host.bastionId,
    pemKeyId: host.pemKeyId,
    tagIds: host.tags.map((item) => item.tagId).sort((a, b) => a - b),
  }
}

function snapshotAfterAction(before: Record<string, unknown>, action: HostBulkAction): Record<string, unknown> {
  if (action.type === 'set_bastion') return { ...before, bastionId: action.bastionId }
  if (action.type === 'set_pem_key') return { ...before, pemKeyId: action.pemKeyId }

  const currentTagIds = readNumberArray(before, 'tagIds')
  if (action.type === 'add_tags') {
    return { ...before, tagIds: [...new Set([...currentTagIds, ...action.tagIds])].sort((a, b) => a - b) }
  }
  return { ...before, tagIds: currentTagIds.filter((id) => !action.tagIds.includes(id)) }
}

function rollbackFieldsForAction(actionType: HostBulkAction['type']): Array<'bastionId' | 'pemKeyId' | 'tagIds'> {
  if (actionType === 'set_bastion') return ['bastionId']
  if (actionType === 'set_pem_key') return ['pemKeyId']
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
