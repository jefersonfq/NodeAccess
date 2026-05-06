import { NotFoundError } from '../../shared/errors.js'
import type { EmailConfigRepository } from './email-config.repository.js'
import type { EmailService } from './email.service.js'

export interface EmailConfigInput {
  provider: 'gmail' | 'outlook' | 'smtp'
  host?:    string | null
  port?:    number | null
  secure:   boolean
  user:     string
  password: string
  fromName: string
}

export interface EmailConfigPublic {
  id:       number
  provider: string
  host:     string | null
  port:     number | null
  secure:   boolean
  user:     string
  fromName: string
}

function toPublic(row: Omit<EmailConfigPublic, never> & { id: number; tenantId: number; password: string }): EmailConfigPublic {
  return { id: row.id, provider: row.provider, host: row.host, port: row.port, secure: row.secure, user: row.user, fromName: row.fromName }
}

export class EmailConfigService {
  constructor(
    private readonly repo:         EmailConfigRepository,
    private readonly emailService: EmailService,
  ) {}

  async get(tenantId: number): Promise<EmailConfigPublic | null> {
    const row = await this.repo.findByTenant(tenantId)
    return row ? toPublic(row) : null
  }

  async upsert(tenantId: number, input: EmailConfigInput): Promise<EmailConfigPublic> {
    const row = await this.repo.upsert(tenantId, input)
    return toPublic(row)
  }

  async test(tenantId: number, toEmail: string): Promise<void> {
    const row = await this.repo.findByTenant(tenantId)
    if (!row) throw new NotFoundError('Configuração de email')

    const { host, port } = resolveSmtpCoords(row.provider, row.host, row.port)

    await this.emailService.testConnection({ host, port, secure: row.secure, user: row.user, password: row.password, fromName: row.fromName })
    await this.emailService.send(
      { host, port, secure: row.secure, user: row.user, password: row.password, fromName: row.fromName },
      { to: toEmail, subject: 'NodeAccess — Teste de email', text: 'Configuração de email funcionando corretamente.' },
    )
  }

  async testCredentials(input: EmailConfigInput, toEmail: string): Promise<void> {
    const { host, port } = resolveSmtpCoords(input.provider, input.host ?? null, input.port ?? null)
    const transport = { host, port, secure: input.secure, user: input.user, password: input.password, fromName: input.fromName }
    await this.emailService.testConnection(transport)
    await this.emailService.send(transport, {
      to: toEmail, subject: 'NodeAccess — Teste de email', text: 'Configuração de email funcionando corretamente.',
    })
  }

  async delete(tenantId: number): Promise<void> {
    await this.repo.delete(tenantId)
  }

  async getTransportConfig(tenantId: number) {
    const row = await this.repo.findByTenant(tenantId)
    if (!row) return null
    const { host, port } = resolveSmtpCoords(row.provider, row.host, row.port)
    return { host, port, secure: row.secure, user: row.user, password: row.password, fromName: row.fromName }
  }
}

function resolveSmtpCoords(provider: string, host: string | null, port: number | null): { host: string; port: number } {
  if (provider === 'gmail')   return { host: 'smtp.gmail.com',     port: 587 }
  if (provider === 'outlook') return { host: 'smtp.office365.com', port: 587 }
  return { host: host ?? '', port: port ?? 587 }
}
