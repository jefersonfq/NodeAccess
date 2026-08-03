import { Client } from 'ldapts'
import type { Entry } from 'ldapts'
import { env } from '../../config/env.js'
import type { IntegrationRepository } from '../integrations/integration.repository.js'
import type { LdapIntegrationService, StoredLdapConfig } from '../integrations/ldap.service.js'
import type { UserRepository } from '../users/user.repository.js'
import type {
  IdentityProvider,
  IdentityProviderAuthenticateInput,
  IdentityProviderAuthenticateResult,
} from './identity-provider.js'

const LDAP_TIMEOUT_MS = 10_000
const LDAP_USER_ATTRIBUTES = ['dn', 'mail', 'userPrincipalName', 'displayName', 'cn', 'sAMAccountName']

export class LdapIdentityProvider implements IdentityProvider {
  readonly type = 'ldap'
  readonly providerKey = 'ldap'

  constructor(
    private readonly integrationRepo: IntegrationRepository,
    private readonly ldapService: LdapIntegrationService,
    private readonly userRepo: UserRepository,
  ) {}

  async authenticate(input: IdentityProviderAuthenticateInput): Promise<IdentityProviderAuthenticateResult> {
    const integration = await this.integrationRepo.findByProvider(input.tenantId, 'ldap')
    if (!integration?.enabled) return { user: null, passwordValid: false }

    const config = parseConfig(integration.config)
    if (!config.url || !config.baseDn || !config.userSearchFilter) {
      return { user: null, passwordValid: false }
    }

    if (env.NODE_ENV === 'production' && config.url.startsWith('ldap://') && !config.startTls) {
      throw new Error('LDAP sem TLS não é permitido em produção')
    }

    const client = new Client({
      url: config.url,
      timeout: LDAP_TIMEOUT_MS,
      connectTimeout: LDAP_TIMEOUT_MS,
      ...(config.url.startsWith('ldaps://')
        ? { tlsOptions: { rejectUnauthorized: config.tlsRejectUnauthorized ?? true } }
        : {}),
    })

    try {
      if (config.startTls) {
        await client.startTLS({ rejectUnauthorized: config.tlsRejectUnauthorized ?? true })
      }

      if (config.bindDn) {
        const bindPassword = this.ldapService.decryptBindPassword(config)
        await client.bind(config.bindDn, bindPassword)
      }

      const userEntry = await this.findUserEntry(client, config, input.email)
      if (!userEntry) return { user: await this.userRepo.findByEmail(input.email, input.tenantId), passwordValid: false }

      await client.bind(userEntry.dn, input.password)

      let localUser = await this.userRepo.findByEmail(input.email, input.tenantId)
      if (!localUser && config.autoProvision) {
        localUser = await this.userRepo.createLdapUser({
          name: resolveLdapDisplayName(userEntry, input.email),
          email: input.email,
          tenantId: input.tenantId,
        })
      }

      if (!localUser) return { user: null, passwordValid: false }
      return { user: localUser, passwordValid: true }
    } catch {
      const localUser = await this.userRepo.findByEmail(input.email, input.tenantId)
      return { user: localUser, passwordValid: false }
    } finally {
      await client.unbind().catch(() => {})
    }
  }

  private async findUserEntry(client: Client, config: StoredLdapConfig, email: string): Promise<Entry | null> {
    const filter = buildUserSearchFilter(config.userSearchFilter!, email)
    const result = await client.search(config.baseDn!, {
      scope: 'sub',
      filter,
      attributes: LDAP_USER_ATTRIBUTES,
      sizeLimit: 2,
      timeLimit: 10,
    })

    if (result.searchEntries.length !== 1) return null

    const entry = result.searchEntries[0]
    return entry?.dn?.trim() ? entry : null
  }
}

function parseConfig(value: string): StoredLdapConfig {
  try {
    return JSON.parse(value) as StoredLdapConfig
  } catch {
    return {}
  }
}

function buildUserSearchFilter(template: string, email: string): string {
  const username = email.split('@')[0] ?? email
  return template
    .replaceAll('{{email}}', escapeLdapFilterValue(email))
    .replaceAll('{{username}}', escapeLdapFilterValue(username))
}

function resolveLdapDisplayName(entry: Entry, fallbackEmail: string): string {
  return getLdapString(entry.displayName)
    ?? getLdapString(entry.cn)
    ?? getLdapString(entry.sAMAccountName)
    ?? fallbackEmail
}

function getLdapString(value: Entry[string] | undefined): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === 'string' && item.trim())
    return typeof first === 'string' ? first.trim() : null
  }
  return null
}

function escapeLdapFilterValue(value: string): string {
  return value.replace(/[\u0000()*\\]/g, (char) => {
    switch (char) {
      case '\u0000': return '\\00'
      case '(': return '\\28'
      case ')': return '\\29'
      case '*': return '\\2a'
      case '\\': return '\\5c'
      default: return char
    }
  })
}
