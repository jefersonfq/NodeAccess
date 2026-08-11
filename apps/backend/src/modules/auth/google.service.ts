import jwt from 'jsonwebtoken'
import { encrypt, decrypt } from '../../shared/crypto.js'
import { logger, opaqueLogId } from '../../config/logger.js'
import type { IntegrationRepository } from '../integrations/integration.repository.js'
import type { UserRepository } from '../users/user.repository.js'

interface GoogleTokenInfo {
  sub:             string
  email:           string
  name?:           string
  hd?:             string   // hosted domain (Google Workspace)
  aud:             string
  email_verified?: string
}

interface ServiceAccountKey {
  client_email: string
  private_key:  string
  token_uri:    string
}

interface WorkspaceUser {
  id:           string
  primaryEmail: string
  suspended:    boolean
}

export interface StoredGoogleConfig {
  clientId:                 string
  adminEmail?:              string
  domain?:                  string
  syncIntervalMinutes:      number
  autoProvision:            boolean
  serviceAccountEncrypted?: string   // AES-256-GCM ciphertext (base64)
  serviceAccountIv?:        string   // hex IV
}

export class GoogleService {
  constructor(
    private readonly integrationRepo: IntegrationRepository,
    private readonly userRepo:        UserRepository,
  ) {}

  // ── Public config — used by login page (no auth required) ──────────────────

  async getPublicConfig(tenantId: number): Promise<{ enabled: boolean; clientId: string | null }> {
    const row = await this.integrationRepo.findByProvider(tenantId, 'google')
    if (!row || !row.config) return { enabled: false, clientId: null }
    const config = JSON.parse(row.config) as StoredGoogleConfig
    return { enabled: row.enabled, clientId: config.clientId || null }
  }

  // ── Full config — for internal service use ──────────────────────────────────

  async getConfig(tenantId: number): Promise<StoredGoogleConfig | null> {
    const row = await this.integrationRepo.findByProvider(tenantId, 'google')
    if (!row || !row.config) return null
    return JSON.parse(row.config) as StoredGoogleConfig
  }

  // ── Verify Google ID token via tokeninfo endpoint ───────────────────────────

  async verifyIdToken(idToken: string, clientId: string): Promise<GoogleTokenInfo> {
    const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
    const res  = await fetch(url)
    const info = await res.json() as GoogleTokenInfo & { error_description?: string }

    if (!res.ok || info.error_description) {
      throw new Error('ID token inválido ou expirado')
    }
    if (info.aud !== clientId) {
      throw new Error('Client ID não corresponde')
    }

    return info
  }

  // ── Save / update Google integration config ─────────────────────────────────

  async upsertConfig(
    tenantId: number,
    dto: {
      enabled:              boolean
      clientId:             string
      adminEmail?:          string
      domain?:              string
      syncIntervalMinutes?: number
      autoProvision?:       boolean
      serviceAccountJson?:  string   // raw content from file upload
    },
  ): Promise<StoredGoogleConfig> {
    const existing = await this.getConfig(tenantId)

    let serviceAccountEncrypted = existing?.serviceAccountEncrypted
    let serviceAccountIv        = existing?.serviceAccountIv

    if (dto.serviceAccountJson) {
      const sa = JSON.parse(dto.serviceAccountJson) as Partial<ServiceAccountKey>
      if (!sa.client_email || !sa.private_key) {
        throw new Error('JSON de service account inválido — verifique os campos client_email e private_key')
      }
      const enc           = encrypt(dto.serviceAccountJson)
      serviceAccountEncrypted = enc.encrypted
      serviceAccountIv        = enc.iv
    }

    const adminEmail = dto.adminEmail ?? existing?.adminEmail
    const domain = dto.domain ?? existing?.domain

    const config = {
      clientId:                dto.clientId,
      syncIntervalMinutes:     dto.syncIntervalMinutes   ?? existing?.syncIntervalMinutes ?? 60,
      autoProvision:           dto.autoProvision         ?? existing?.autoProvision       ?? false,
      ...(adminEmail ? { adminEmail } : {}),
      ...(domain ? { domain } : {}),
      ...(serviceAccountEncrypted ? { serviceAccountEncrypted } : {}),
      ...(serviceAccountIv ? { serviceAccountIv } : {}),
    } satisfies StoredGoogleConfig

    await this.integrationRepo.upsert(tenantId, 'google', dto.enabled, JSON.stringify(config))
    return config
  }

  // ── Directory Sync — deactivate users removed/suspended in Workspace ────────

  async syncDirectory(tenantId: number): Promise<{ synced: number; deactivated: number }> {
    const config = await this.getConfig(tenantId)

    if (!config?.serviceAccountEncrypted || !config.serviceAccountIv || !config.adminEmail || !config.domain) {
      return { synced: 0, deactivated: 0 }
    }

    const saJson  = decrypt({ encrypted: config.serviceAccountEncrypted, iv: config.serviceAccountIv })
    const sa      = JSON.parse(saJson) as ServiceAccountKey
    const token   = await this.getServiceAccountToken(sa, config.adminEmail)
    const wsUsers = await this.listDomainUsers(token, config.domain)

    const activeIds = new Set(wsUsers.filter((u) => !u.suspended).map((u) => u.id))

    const linked = await this.userRepo.findGoogleLinkedUsers(tenantId)
    let deactivated = 0

    for (const user of linked) {
      if (user.active && !activeIds.has(user.googleId!)) {
        await this.userRepo.setActive(user.id, false)
        deactivated++
        logger.info(
          { userId: user.id, externalIdentityRef: opaqueLogId(user.googleId!) },
          'Usuário desativado via Google Workspace sync',
        )
      }
    }

    return { synced: linked.length, deactivated }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async getServiceAccountToken(sa: ServiceAccountKey, impersonateEmail: string): Promise<string> {
    const now   = Math.floor(Date.now() / 1000)
    const claim = {
      iss:   sa.client_email,
      scope: 'https://www.googleapis.com/auth/admin.directory.user.readonly',
      aud:   sa.token_uri || 'https://oauth2.googleapis.com/token',
      sub:   impersonateEmail,
      iat:   now,
      exp:   now + 3600,
    }

    const assertion = jwt.sign(claim, sa.private_key, { algorithm: 'RS256' })

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Falha ao autenticar service account: ${err}`)
    }

    const data = await res.json() as { access_token: string }
    return data.access_token
  }

  private async listDomainUsers(accessToken: string, domain: string): Promise<WorkspaceUser[]> {
    const users: WorkspaceUser[] = []
    let pageToken: string | undefined

    do {
      const params = new URLSearchParams({ domain, maxResults: '500', projection: 'basic' })
      if (pageToken) params.set('pageToken', pageToken)

      const res = await fetch(
        `https://admin.googleapis.com/admin/directory/v1/users?${params}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      )

      if (!res.ok) {
        const err = await res.text()
        throw new Error(`Erro ao listar usuários do Workspace: ${err}`)
      }

      const data = await res.json() as { users?: WorkspaceUser[]; nextPageToken?: string }
      users.push(...(data.users ?? []))
      pageToken = data.nextPageToken
    } while (pageToken)

    return users
  }
}
