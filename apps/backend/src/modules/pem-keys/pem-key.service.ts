import type { PemKey } from '@prisma/client'
import type { PemKeyPublic, CreatePemKeyDto } from '@nodeaccess/shared'
import { NotFoundError, ForbiddenError, ConflictError, BadRequestError } from '../../shared/errors.js'  // BadRequestError added for .ppk validation
import { encrypt } from '../../shared/crypto.js'
import type { PemKeyRepository } from './pem-key.repository.js'
import type { LogRepository } from '../logs/log.repository.js'
import ssh2 from 'ssh2'
const sshUtils = ssh2.utils

function toPublic(key: PemKey): PemKeyPublic {
  return {
    id:          key.id,
    name:        key.name,
    createdById: key.createdById,
    createdAt:   key.createdAt,
  }
}

export class PemKeyService {
  constructor(
    private readonly pemKeyRepo: PemKeyRepository,
    private readonly logRepo:    LogRepository,
  ) {}

  async list(userId: number, isAdmin: boolean): Promise<PemKeyPublic[]> {
    const keys = isAdmin
      ? await this.pemKeyRepo.findAll()
      : await this.pemKeyRepo.findByUser(userId)
    return keys.map(toPublic)
  }

  /**
   * Converts a PuTTY .ppk key to OpenSSH PEM format.
   * Returns the original string unchanged if it is not a .ppk file.
   */
  private normalizePemKey(raw: string): string {
    if (!raw.includes('PuTTY-User-Key-File')) return raw

    const parsed = sshUtils.parseKey(Buffer.from(raw))
    const key    = Array.isArray(parsed) ? parsed[0] : parsed
    if (!key || key instanceof Error) {
      throw new BadRequestError('Chave .ppk inválida ou protegida por senha. Exporte a chave sem senha para importá-la.')
    }
    // Convert to OpenSSH private key format (-----BEGIN OPENSSH PRIVATE KEY-----)
    const converted = key.toString('openssh' as Parameters<typeof key.toString>[0])
    if (!converted) throw new BadRequestError('Não foi possível converter a chave .ppk para o formato OpenSSH.')
    return converted
  }

  async create(dto: CreatePemKeyDto, userId: number): Promise<PemKeyPublic> {
    const keyContent      = this.normalizePemKey(dto.key)
    const { encrypted, iv } = encrypt(keyContent as string)
    const key = await this.pemKeyRepo.create({
      name:         dto.name,
      encryptedKey: encrypted,
      iv,
      createdById:  userId,
    })
    await this.logRepo.logAdminEvent({ adminId: userId, action: 'CREATE_PEM_KEY', targetType: 'PemKey', targetId: key.id }).catch(() => { /* best-effort */ })
    return toPublic(key)
  }

  async delete(id: number, userId: number, isAdmin: boolean): Promise<void> {
    const key = await this.pemKeyRepo.findById(id)
    if (!key) throw new NotFoundError('Chave PEM')

    if (!isAdmin && key.createdById !== userId) {
      throw new ForbiddenError('Você não tem permissão para excluir esta chave')
    }

    if (await this.pemKeyRepo.isUsedByHost(id)) {
      throw new ConflictError('Não é possível excluir uma chave em uso por um host')
    }

    await this.pemKeyRepo.delete(id)
    await this.logRepo.logAdminEvent({ adminId: userId, action: 'DELETE_PEM_KEY', targetType: 'PemKey', targetId: id }).catch(() => { /* best-effort */ })
  }
}
