import { createClient } from '@1password/sdk'
import { encrypt, decrypt } from '../../shared/crypto.js'
import type { IntegrationRepository } from './integration.repository.js'
import type { SecretRepository } from '../secrets/secret.repository.js'

const PROVIDER = 'onepassword'

export class OnePasswordService {
  constructor(
    private readonly integrationRepo: IntegrationRepository,
    private readonly secretRepo?: SecretRepository,
  ) {}

  // ── Resolve uma referência op:// usando o token do tenant ──────────────────

  async resolve(tenantId: number, ref: string): Promise<string> {
    if (ref.startsWith('secret://')) {
      const alias = ref.slice('secret://'.length)
      const secret = await this.secretRepo?.findByAlias(tenantId, alias)
      if (!secret || secret.revokedAt) throw new Error('Secret não encontrado ou revogado')
      return decrypt({ encrypted: secret.encryptedValue, iv: secret.iv })
    }
    const integration = await this.integrationRepo.findByProvider(tenantId, PROVIDER)
    if (!integration || !integration.enabled) {
      throw new Error('Integração com 1Password não está ativa para este tenant')
    }

    const token = this.decryptToken(integration.config)
    const client = await createClient({
      auth:               token,
      integrationName:    'NodeAccess',
      integrationVersion: '1.0.0',
    })

    return client.secrets.resolve(ref)
  }

  // ── Valida um token tentando listar os vaults ─────────────────────────────

  async validateToken(token: string): Promise<void> {
    const client = await createClient({
      auth:               token,
      integrationName:    'NodeAccess',
      integrationVersion: '1.0.0',
    })
    // resolve um ref intencionalmente inválido — se o token for inválido,
    // o cliente já lança antes de chegar no resolve
    try { await client.secrets.resolve('op://test/test/test') } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      // erros de "item not found" são OK — significa que o token é válido
      if (msg.toLowerCase().includes('unauthorized') || msg.toLowerCase().includes('invalid token')) {
        throw new Error('Token de serviço inválido ou sem permissão')
      }
    }
  }

  // ── Helpers de criptografia do token ──────────────────────────────────────

  encryptToken(token: string): string {
    return JSON.stringify(encrypt(token))
  }

  decryptToken(config: string): string {
    const payload = JSON.parse(config)
    return decrypt(payload)
  }
}
