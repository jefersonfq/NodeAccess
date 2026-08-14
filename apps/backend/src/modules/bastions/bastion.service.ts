import type { BastionPublic, CreateBastionDto, UpdateBastionDto } from '@nodeaccess/shared'
import { NotFoundError, ConflictError, ValidationError } from '../../shared/errors.js'
import { encrypt } from '../../shared/crypto.js'
import type { BastionHostRow, BastionRepository } from './bastion.repository.js'
import type { BastionUsageSummary } from './bastion.repository.js'
import type { LogRepository } from '../logs/log.repository.js'

type PrismaAuthType = 'PEM' | 'PASSWORD' | 'PEM_PASSWORD'

function mapAuthType(authType: string): PrismaAuthType {
  return authType.toUpperCase() as PrismaAuthType
}

function normalizeBastionAuthType(authType: BastionHostRow['authType']): PrismaAuthType {
  if (authType === 'PASSWORD' || authType === 'PEM_PASSWORD') return authType
  return 'PEM'
}

function emptyUsage(): BastionUsageSummary {
  return {
    directHostCount:    0,
    inheritedHostCount: 0,
    groupCount:         0,
    directHostNames:    [],
    inheritedHostNames: [],
    groupNames:         [],
  }
}

function toPublic(bastion: BastionHostRow, usage?: BastionUsageSummary): BastionPublic {
  return {
    id:        bastion.id,
    sourceHostId: bastion.sourceHostId,
    sourceType: bastion.sourceHostId ? 'host' : 'legacy',
    sourceHost: bastion.sourceHost ? {
      id: bastion.sourceHost.id,
      name: bastion.sourceHost.name,
      ip: bastion.sourceHost.ip,
      port: bastion.sourceHost.port,
      connectionMode: bastion.sourceHost.connectionMode.toLowerCase(),
    } : null,
    name:      bastion.name,
    ip:        bastion.ip,
    port:      bastion.port,
    sshUser:   bastion.sshUser,
    authType:  bastion.authType.toLowerCase() as 'pem' | 'password' | 'pem_password',
    pemKeyId:  bastion.pemKeyId,
    systemPemKeyId: bastion.systemPemKeyId,
    pemKeySource: bastion.systemPemKeyId ? 'registered' : bastion.pemKeyId ? 'legacy' : 'none',
    usage:     usage ?? emptyUsage(),
    createdAt: bastion.createdAt,
  }
}

function formatUsageConflict(usage: BastionUsageSummary): string {
  const parts = [
    usage.directHostCount > 0 ? `${usage.directHostCount} host(s) ativo(s) direto(s)` : '',
    usage.groupCount > 0 ? `${usage.groupCount} grupo(s)` : '',
    usage.inheritedHostCount > 0 ? `${usage.inheritedHostCount} host(s) ativo(s) herdado(s)` : '',
  ].filter(Boolean)

  return parts.length
    ? `Não é possível excluir este bastion porque ele ainda é usado por ${parts.join(', ')}. Remova os vínculos antes de excluir.`
    : 'Não é possível excluir um bastion vinculado a grupos ou hosts'
}

export class BastionService {
  constructor(
    private readonly bastionRepo: BastionRepository,
    private readonly logRepo:     LogRepository,
  ) {}

  async list(tenantId: number): Promise<BastionPublic[]> {
    const bastions = await this.bastionRepo.findAll(tenantId)
    const usageById = await this.bastionRepo.findUsageSummaries(bastions.map((bastion) => bastion.id), tenantId)
    return bastions.map((bastion) => toPublic(bastion, usageById.get(bastion.id)))
  }

  async getById(id: number, tenantId: number): Promise<BastionPublic> {
    const bastion = await this.bastionRepo.findById(id, tenantId)
    if (!bastion) throw new NotFoundError('Bastion')
    const usageById = await this.bastionRepo.findUsageSummaries([id], tenantId)
    return toPublic(bastion, usageById.get(id))
  }

  async create(dto: CreateBastionDto, tenantId: number, adminId: number): Promise<BastionPublic> {
    if (dto.sourceHostId !== undefined) {
      return this.createFromHost(dto.sourceHostId, tenantId, adminId)
    }
    if (!dto.name || !dto.ip || !dto.sshUser || !dto.authType) {
      throw new ValidationError('Informe o host de origem ou todos os campos do bastion legado')
    }
    const authType = mapAuthType(dto.authType)
    let pemKeyId: number | undefined
    let systemPemKeyId: number | undefined
    let passwordEncrypted: string | undefined

    if (authType === 'PEM') {
      if (dto.systemPemKeyId !== undefined) {
        if (!await this.bastionRepo.systemPemKeyExists(dto.systemPemKeyId, tenantId)) {
          throw new ValidationError('Chave PEM cadastrada não encontrada')
        }
        systemPemKeyId = dto.systemPemKeyId
      } else {
        if (!dto.pemKey) throw new ValidationError('Selecione uma PEM cadastrada ou informe uma chave PEM para authType=pem')
        const { encrypted, iv } = encrypt(dto.pemKey)
        pemKeyId = await this.bastionRepo.createPemKey({
          name:         dto.pemKeyName ?? dto.name,
          encryptedKey: encrypted,
          iv,
        })
      }
    } else {
      if (!dto.password) throw new ValidationError('Senha obrigatória para authType=password')
      const payload = encrypt(dto.password)
      passwordEncrypted = JSON.stringify(payload)
    }

    const bastion = await this.bastionRepo.create({
      name:    dto.name,
      ip:      dto.ip,
      port:    dto.port ?? 22,
      sshUser: dto.sshUser,
      authType,
      tenantId,
      ...(pemKeyId !== undefined && { pemKeyId }),
      ...(systemPemKeyId !== undefined && { systemPemKeyId }),
      ...(passwordEncrypted !== undefined && { passwordEncrypted }),
    })

    await this.logRepo.logAdminEvent({ adminId, action: 'CREATE_BASTION', targetType: 'Bastion', targetId: bastion.id }).catch(() => { /* best-effort */ })
    return toPublic(bastion)
  }

  async update(id: number, dto: UpdateBastionDto, tenantId: number, adminId: number): Promise<BastionPublic> {
    const bastion = await this.bastionRepo.findById(id, tenantId)
    if (!bastion) throw new NotFoundError('Bastion')
    if (bastion.sourceHostId) {
      throw new ValidationError('Edite endereço e credenciais diretamente no Host de origem')
    }

    const newAuthType = dto.authType ? mapAuthType(dto.authType) : normalizeBastionAuthType(bastion.authType)
    let pemKeyId: number | null | undefined
    let systemPemKeyId: number | null | undefined
    let passwordEncrypted: string | null | undefined

    if (newAuthType === 'PEM') {
      if (dto.systemPemKeyId !== undefined) {
        if (!await this.bastionRepo.systemPemKeyExists(dto.systemPemKeyId, tenantId)) {
          throw new ValidationError('Chave PEM cadastrada não encontrada')
        }
        systemPemKeyId = dto.systemPemKeyId
        if (bastion.pemKeyId) await this.bastionRepo.deletePemKey(bastion.pemKeyId)
        pemKeyId = null
        passwordEncrypted = null
      } else if (dto.pemKey) {
        if (bastion.pemKeyId) await this.bastionRepo.deletePemKey(bastion.pemKeyId)
        const { encrypted, iv } = encrypt(dto.pemKey)
        pemKeyId = await this.bastionRepo.createPemKey({
          name:         dto.pemKeyName ?? bastion.name,
          encryptedKey: encrypted,
          iv,
        })
        systemPemKeyId = null
        passwordEncrypted = null
      } else if (bastion.authType === 'PASSWORD' && !bastion.systemPemKeyId && !bastion.pemKeyId) {
        throw new ValidationError('Selecione uma PEM cadastrada ou informe uma chave PEM para trocar o bastion para authType=pem')
      }
    } else if (newAuthType === 'PASSWORD' && dto.password) {
      const payload = encrypt(dto.password)
      passwordEncrypted = JSON.stringify(payload)
      systemPemKeyId = null
      if (bastion.pemKeyId) {
        await this.bastionRepo.deletePemKey(bastion.pemKeyId)
        pemKeyId = null
      }
    }

    const updated = await this.bastionRepo.update(id, {
      ...(dto.name     !== undefined && { name:     dto.name }),
      ...(dto.ip       !== undefined && { ip:       dto.ip }),
      ...(dto.port     !== undefined && { port:     dto.port }),
      ...(dto.sshUser  !== undefined && { sshUser:  dto.sshUser }),
      ...(dto.authType !== undefined && { authType: newAuthType }),
      ...(pemKeyId     !== undefined && { pemKeyId }),
      ...(systemPemKeyId !== undefined && { systemPemKeyId }),
      ...(passwordEncrypted !== undefined && { passwordEncrypted }),
    })

    await this.logRepo.logAdminEvent({ adminId, action: 'UPDATE_BASTION', targetType: 'Bastion', targetId: id }).catch(() => { /* best-effort */ })
    return toPublic(updated)
  }

  private async createFromHost(sourceHostId: number, tenantId: number, adminId: number): Promise<BastionPublic> {
    const host = await this.bastionRepo.findSourceHost(sourceHostId, tenantId)
    if (!host) throw new NotFoundError('Host de origem')
    if (host.accessProtocol !== 'SSH') throw new ValidationError('Somente hosts SSH podem atuar como bastion')
    if (host.connectionMode !== 'DIRECT') throw new ValidationError('O host bastion deve usar conexão direta')
    if (host.onePasswordRef) throw new ValidationError('Host com credencial 1Password ainda não pode atuar como bastion')
    if (host.bastionId || host.groupBastionId) throw new ValidationError('Um host que depende de outro bastion não pode atuar como bastion')
    if (await this.bastionRepo.findBySourceHostId(sourceHostId, tenantId)) {
      throw new ConflictError('Este host já está habilitado como bastion')
    }
    if ((host.authType === 'PEM' || host.authType === 'PEM_PASSWORD') && !host.pemKeyId) {
      throw new ValidationError('O host precisa de uma chave PEM cadastrada para atuar como bastion')
    }
    if ((host.authType === 'PASSWORD' || host.authType === 'PEM_PASSWORD') && !host.passwordEncrypted) {
      throw new ValidationError('O host precisa de uma senha cadastrada para atuar como bastion')
    }

    const bastion = await this.bastionRepo.create({
      name: host.name,
      ip: host.ip,
      port: host.port,
      sshUser: host.sshUser,
      authType: host.authType,
      tenantId,
      sourceHostId,
    })
    await this.logRepo.logAdminEvent({
      adminId,
      action: 'ENABLE_HOST_AS_BASTION',
      targetType: 'Host',
      targetId: sourceHostId,
      details: JSON.stringify({ bastionId: bastion.id }),
    }).catch(() => { /* best-effort */ })
    return toPublic(bastion)
  }

  async delete(id: number, tenantId: number, adminId: number): Promise<void> {
    const bastion = await this.bastionRepo.findById(id, tenantId)
    if (!bastion) throw new NotFoundError('Bastion')

    if (await this.bastionRepo.isUsedByGroupOrHost(id, tenantId)) {
      const usageById = await this.bastionRepo.findUsageSummaries([id], tenantId)
      throw new ConflictError(formatUsageConflict(usageById.get(id) ?? emptyUsage()))
    }

    const pemKeyId = bastion.pemKeyId

    await this.bastionRepo.delete(id)

    if (pemKeyId) {
      await this.bastionRepo.deletePemKey(pemKeyId).catch(() => { /* orphaned key, ignore */ })
    }

    await this.logRepo.logAdminEvent({ adminId, action: 'DELETE_BASTION', targetType: 'Bastion', targetId: id }).catch(() => { /* best-effort */ })
  }
}
