import type { Prisma } from '@prisma/client'
import { createHash } from 'node:crypto'
import type { VaultIdentity } from './vault-domain.js'
import type { WebauthnCredential, WebauthnRecords } from './vault-ports.js'

const hash = (s: string): string => createHash('sha256').update(s).digest('hex')
interface CredentialSql { id: string; publicKey: Uint8Array; counter: bigint | number; transports: string; name: string; createdAt: Date; lastUsedAt: Date | null }
const toCredential = (r: CredentialSql): WebauthnCredential => ({ id: r.id, publicKey: new Uint8Array(r.publicKey), counter: Number(r.counter),
  transports: r.transports ? r.transports.split(',') : [], name: r.name, createdAt: r.createdAt.getTime(), lastUsedAt: r.lastUsedAt?.getTime() ?? null })

/** NA-0198: WebAuthn credentials inside the vault transaction; every statement is scoped to the transaction identity.
 * Only credentials registered under the account's current credential version count: a password or MFA reset retires them. */
export class SqlVaultWebauthn implements WebauthnRecords {
  constructor(private readonly db: Prisma.TransactionClient, private readonly identity: VaultIdentity, private readonly now: () => number,
    private readonly credentialVersion: string) {}
  async list(): Promise<WebauthnCredential[]> {
    const rows = await this.db.$queryRaw<CredentialSql[]>`SELECT credential_id AS id,public_key AS publicKey,sign_count AS counter,transports,name,
      created_at AS createdAt,last_used_at AS lastUsedAt FROM vault_webauthn_credentials WHERE tenant_id=${this.identity.tenantId} AND user_id=${this.identity.userId}
      AND credential_version=${this.credentialVersion} ORDER BY created_at,credential_hash LIMIT 20`
    return rows.map(toCredential)
  }
  async find(id: string): Promise<WebauthnCredential | null> {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,1400}$/.test(id)) return null
    const rows = await this.db.$queryRaw<CredentialSql[]>`SELECT credential_id AS id,public_key AS publicKey,sign_count AS counter,transports,name,
      created_at AS createdAt,last_used_at AS lastUsedAt FROM vault_webauthn_credentials WHERE credential_hash=${hash(id)}
      AND tenant_id=${this.identity.tenantId} AND user_id=${this.identity.userId} AND credential_version=${this.credentialVersion} FOR UPDATE`
    return rows[0] ? toCredential(rows[0]) : null
  }
  async add(c: Omit<WebauthnCredential, 'createdAt' | 'lastUsedAt'>): Promise<boolean> {
    // A duplicate id (also a concurrent registration) inserts 0 rows instead of aborting the transaction. Inputs are already
    // bounded by the routes and the library (base64url id ≤ 1400, name ≤ 80, COSE key), so IGNORE hides no truncation.
    const inserted = await this.db.$executeRaw`INSERT IGNORE INTO vault_webauthn_credentials(credential_hash,tenant_id,user_id,credential_id,public_key,sign_count,transports,name,credential_version,created_at)
      VALUES(${hash(c.id)},${this.identity.tenantId},${this.identity.userId},${c.id},${Buffer.from(c.publicKey)},${c.counter},${c.transports.join(',')},${c.name},${this.credentialVersion},${new Date(this.now())})`
    return inserted === 1
  }
  async used(id: string, counter: number): Promise<void> {
    // Never moves the counter backwards (concurrent unlocks), so clone detection keeps its signal.
    await this.db.$executeRaw`UPDATE vault_webauthn_credentials SET sign_count=GREATEST(sign_count,${counter}),last_used_at=${new Date(this.now())}
      WHERE credential_hash=${hash(id)} AND tenant_id=${this.identity.tenantId} AND user_id=${this.identity.userId}`
  }
  async remove(id: string): Promise<boolean> {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,1400}$/.test(id)) return false
    const removed = await this.db.$executeRaw`DELETE FROM vault_webauthn_credentials WHERE credential_hash=${hash(id)}
      AND tenant_id=${this.identity.tenantId} AND user_id=${this.identity.userId}`
    return removed > 0
  }
}
