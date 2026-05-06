import type { PrismaClient } from '@prisma/client'
import { encrypt, decrypt } from '../../shared/crypto.js'

export interface EmailConfigRow {
  id:       number
  tenantId: number
  provider: string
  host:     string | null
  port:     number | null
  secure:   boolean
  user:     string
  fromName: string
  password: string // decrypted at read time
}

export class EmailConfigRepository {
  constructor(private readonly db: PrismaClient) {}

  async findByTenant(tenantId: number): Promise<EmailConfigRow | null> {
    const row = await this.db.emailConfig.findUnique({ where: { tenantId } })
    if (!row) return null
    return {
      id:       row.id,
      tenantId: row.tenantId,
      provider: row.provider,
      host:     row.host,
      port:     row.port,
      secure:   row.secure,
      user:     row.user,
      fromName: row.fromName,
      password: decrypt({ encrypted: row.passwordEnc, iv: row.passwordIv }),
    }
  }

  async upsert(tenantId: number, data: {
    provider: string
    host?:    string | null
    port?:    number | null
    secure:   boolean
    user:     string
    password: string
    fromName: string
  }): Promise<EmailConfigRow> {
    const { encrypted, iv } = encrypt(data.password)
    const row = await this.db.emailConfig.upsert({
      where:  { tenantId },
      create: {
        tenantId,
        provider:    data.provider,
        host:        data.host ?? null,
        port:        data.port ?? null,
        secure:      data.secure,
        user:        data.user,
        passwordEnc: encrypted,
        passwordIv:  iv,
        fromName:    data.fromName,
      },
      update: {
        provider:    data.provider,
        host:        data.host ?? null,
        port:        data.port ?? null,
        secure:      data.secure,
        user:        data.user,
        passwordEnc: encrypted,
        passwordIv:  iv,
        fromName:    data.fromName,
      },
    })
    return { ...row, password: data.password }
  }

  async delete(tenantId: number): Promise<void> {
    await this.db.emailConfig.delete({ where: { tenantId } }).catch(() => {})
  }
}
