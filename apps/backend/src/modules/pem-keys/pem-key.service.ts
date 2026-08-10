import type { PemKey } from '@prisma/client'
import type { PemKeyPublic, CreatePemKeyDto, UpdatePemKeyPassphraseDto } from '@nodeaccess/shared'
import { NotFoundError, ForbiddenError, ConflictError, BadRequestError } from '../../shared/errors.js'  // BadRequestError added for .ppk validation
import { decrypt, encrypt } from '../../shared/crypto.js'
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
    hasPassphrase: Boolean(key.encryptedPassphrase && key.passphraseIv),
  }
}

export class PemKeyService {
  constructor(
    private readonly pemKeyRepo: PemKeyRepository,
    private readonly logRepo:    LogRepository,
  ) {}

  async list(userId: number, tenantId: number, isAdmin: boolean): Promise<PemKeyPublic[]> {
    const keys = isAdmin
      ? await this.pemKeyRepo.findAll(tenantId)
      : await this.pemKeyRepo.findByUser(userId)
    return keys.map(toPublic)
  }

  /**
   * Converts a PuTTY .ppk key to OpenSSH PEM format.
   * Returns the original string unchanged if it is not a .ppk file.
   */
  private normalizePemKey(raw: string, passphrase?: string): string {
    const parsed = sshUtils.parseKey(Buffer.from(raw), passphrase)
    const key    = Array.isArray(parsed) ? parsed[0] : parsed
    if (!key || key instanceof Error) {
      const encrypted = /encrypted|passphrase|decrypt/i.test(key instanceof Error ? key.message : '')
      throw new BadRequestError(encrypted
        ? 'A chave privada é criptografada. Informe a senha da chave e tente novamente.'
        : 'Chave privada inválida ou senha da chave incorreta.')
    }
    if (!raw.includes('PuTTY-User-Key-File')) return raw
    // Convert to OpenSSH private key format (-----BEGIN OPENSSH PRIVATE KEY-----)
    const converted = key.toString('openssh' as Parameters<typeof key.toString>[0])
    if (!converted) throw new BadRequestError('Não foi possível converter a chave .ppk para o formato OpenSSH.')
    return converted
  }

  async create(dto: CreatePemKeyDto, userId: number): Promise<PemKeyPublic> {
    const passphrase = dto.passphrase || undefined
    const keyContent      = this.normalizePemKey(dto.key, passphrase)
    const { encrypted, iv } = encrypt(keyContent as string)
    const encryptedPassphrase = passphrase ? encrypt(passphrase) : null
    const key = await this.pemKeyRepo.create({
      name:         dto.name,
      encryptedKey: encrypted,
      iv,
      encryptedPassphrase: encryptedPassphrase?.encrypted ?? null,
      passphraseIv: encryptedPassphrase?.iv ?? null,
      createdById:  userId,
    })
    await this.logRepo.logAdminEvent({ adminId: userId, action: 'CREATE_PEM_KEY', targetType: 'PemKey', targetId: key.id }).catch(() => { /* best-effort */ })
    return toPublic(key)
  }

  async updatePassphrase(id: number, dto: UpdatePemKeyPassphraseDto, userId: number, tenantId: number, isAdmin: boolean): Promise<PemKeyPublic> {
    const key = await this.pemKeyRepo.findById(id, tenantId)
    if (!key) throw new NotFoundError('Chave PEM')
    if (!isAdmin && key.createdById !== userId) throw new ForbiddenError('Você não tem permissão para alterar esta chave')

    const passphrase = dto.passphrase || null
    const keyContent = decrypt({ encrypted: key.encryptedKey, iv: key.iv })
    this.normalizePemKey(keyContent, passphrase ?? undefined)
    const encryptedPassphrase = passphrase ? encrypt(passphrase) : null
    const updated = await this.pemKeyRepo.updatePassphrase(id, {
      encryptedPassphrase: encryptedPassphrase?.encrypted ?? null,
      passphraseIv: encryptedPassphrase?.iv ?? null,
    })
    await this.logRepo.logAdminEvent({ adminId: userId, action: 'UPDATE_PEM_KEY_PASSPHRASE', targetType: 'PemKey', targetId: id }).catch(() => {})
    return toPublic(updated)
  }

  async delete(id: number, userId: number, tenantId: number, isAdmin: boolean): Promise<void> {
    const key = await this.pemKeyRepo.findById(id, tenantId)
    if (!key) throw new NotFoundError('Chave PEM')

    if (!isAdmin && key.createdById !== userId) {
      throw new ForbiddenError('Você não tem permissão para excluir esta chave')
    }

    if (await this.pemKeyRepo.isUsedByHost(id, tenantId)) {
      throw new ConflictError('Não é possível excluir uma chave em uso por um host ou bastion')
    }

    await this.pemKeyRepo.delete(id)
    await this.logRepo.logAdminEvent({ adminId: userId, action: 'DELETE_PEM_KEY', targetType: 'PemKey', targetId: id }).catch(() => { /* best-effort */ })
  }
}
