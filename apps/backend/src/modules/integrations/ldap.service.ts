import { Client } from 'ldapts'
import { decrypt, encrypt } from '../../shared/crypto.js'

const LDAP_TEST_TIMEOUT_MS = 10_000

export interface StoredLdapConfig {
  url?: string
  bindDn?: string
  bindPasswordEncrypted?: string
  bindPasswordIv?: string
  baseDn?: string
  userSearchFilter?: string
  startTls?: boolean
  tlsRejectUnauthorized?: boolean
  autoProvision?: boolean
  healthStatus?: 'unknown' | 'healthy' | 'unhealthy'
  healthMessage?: string | null
  lastCheckedAt?: string | null
}

export interface LdapConnectionTestInput {
  url: string
  bindDn?: string
  bindPassword?: string
  baseDn: string
  startTls?: boolean
  tlsRejectUnauthorized?: boolean
}

export class LdapIntegrationService {
  normalizeUrl(value: string): string {
    const url = new URL(value.trim())
    if (url.protocol !== 'ldap:' && url.protocol !== 'ldaps:') {
      throw new Error('URL LDAP deve usar ldap:// ou ldaps://')
    }
    return url.toString().replace(/\/$/, '')
  }

  encryptBindPassword(password: string): { encrypted: string; iv: string } {
    return encrypt(password)
  }

  decryptBindPassword(config: StoredLdapConfig): string {
    if (!config.bindPasswordEncrypted || !config.bindPasswordIv) {
      throw new Error('Senha de bind LDAP não configurada')
    }
    return decrypt({ encrypted: config.bindPasswordEncrypted, iv: config.bindPasswordIv })
  }

  validateSearchFilter(filter: string): string {
    const normalized = filter.trim()
    if (!normalized.includes('{{email}}') && !normalized.includes('{{username}}')) {
      throw new Error('Filtro LDAP deve conter {{email}} ou {{username}}')
    }
    if (!normalized.startsWith('(') || !normalized.endsWith(')')) {
      throw new Error('Filtro LDAP deve estar entre parênteses')
    }
    return normalized
  }

  async testConnection(input: LdapConnectionTestInput): Promise<{ ok: boolean; healthStatus: 'healthy' | 'unhealthy'; healthMessage: string | null }> {
    const url = this.normalizeUrl(input.url)
    const startTls = input.startTls === true
    const tlsRejectUnauthorized = input.tlsRejectUnauthorized ?? true

    if (url.startsWith('ldap://') && !startTls && process.env.NODE_ENV === 'production') {
      return {
        ok: false,
        healthStatus: 'unhealthy',
        healthMessage: 'LDAP sem TLS não é permitido em produção',
      }
    }

    if (input.bindDn?.trim() && !input.bindPassword?.trim()) {
      return {
        ok: false,
        healthStatus: 'unhealthy',
        healthMessage: 'Senha de bind LDAP obrigatória para testar com DN de bind',
      }
    }

    const client = new Client({
      url,
      timeout: LDAP_TEST_TIMEOUT_MS,
      connectTimeout: LDAP_TEST_TIMEOUT_MS,
      ...(url.startsWith('ldaps://') ? { tlsOptions: { rejectUnauthorized: tlsRejectUnauthorized } } : {}),
    })

    try {
      if (startTls) {
        await client.startTLS({ rejectUnauthorized: tlsRejectUnauthorized })
      }

      if (input.bindDn?.trim()) {
        await client.bind(input.bindDn.trim(), input.bindPassword!.trim())
      }

      await client.search(input.baseDn.trim(), {
        scope: 'base',
        filter: '(objectClass=*)',
        attributes: ['dn'],
        sizeLimit: 1,
        timeLimit: 10,
      })

      return {
        ok: true,
        healthStatus: 'healthy',
        healthMessage: 'Conexão LDAP validada com sucesso',
      }
    } catch (error) {
      return {
        ok: false,
        healthStatus: 'unhealthy',
        healthMessage: normalizeLdapTestError(error),
      }
    } finally {
      await client.unbind().catch(() => {})
    }
  }
}

function normalizeLdapTestError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (!message.trim()) return 'Falha ao testar conexão LDAP'
  return message.replace(/\s+/g, ' ').slice(0, 240)
}
