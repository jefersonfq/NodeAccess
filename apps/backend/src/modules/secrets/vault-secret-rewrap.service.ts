import type { EncryptedPayload, EncryptionPayloadInspection, EncryptionRewrapResult } from '../../shared/crypto.js'

export interface VaultSecretCipherRow { id: number; payload: EncryptedPayload }
export interface VaultSecretCipherUpdate { id: number; expected: EncryptedPayload; replacement: EncryptedPayload }

export interface VaultSecretRewrapRepository {
  listAfter(cursor: number, limit: number): Promise<VaultSecretCipherRow[]>
  updateBatch(items: VaultSecretCipherUpdate[]): Promise<number>
}

export interface VaultSecretRewrapCrypto {
  inspect(payload: EncryptedPayload): EncryptionPayloadInspection
  rewrap(payload: EncryptedPayload, options: { dryRun: boolean }): EncryptionRewrapResult
}

export interface VaultSecretRewrapReport {
  mode: 'dry-run' | 'apply'
  total: number
  primary: number
  previous: number
  invalid: number
  changed: number
}

export class VaultSecretRewrapService {
  constructor(
    private readonly repository: VaultSecretRewrapRepository,
    private readonly crypto: VaultSecretRewrapCrypto,
    private readonly batchSize = 100,
  ) {}

  async dryRun(): Promise<VaultSecretRewrapReport> {
    return { mode: 'dry-run', ...(await this.scan()), changed: 0 }
  }

  async apply(expectedPrevious: number): Promise<VaultSecretRewrapReport> {
    const baseline = await this.scan()
    if (baseline.invalid > 0) throw new Error('Recifragem bloqueada: existem payloads inválidos')
    if (baseline.previous !== expectedPrevious) {
      throw new Error(`Recifragem bloqueada: esperado ${expectedPrevious}, encontrado ${baseline.previous}`)
    }

    let cursor = 0
    let changed = 0
    while (true) {
      const rows = await this.repository.listAfter(cursor, this.batchSize)
      if (rows.length === 0) break
      const updates: VaultSecretCipherUpdate[] = []
      for (const row of rows) {
        const result = this.crypto.rewrap(row.payload, { dryRun: false })
        if (result.changed) updates.push({ id: row.id, expected: row.payload, replacement: result.payload })
      }
      if (updates.length > 0) {
        const updated = await this.repository.updateBatch(updates)
        if (updated !== updates.length) {
          throw new Error('Recifragem interrompida: dados alterados concorrentemente; execute novo dry-run')
        }
        changed += updated
      }
      cursor = rows[rows.length - 1]!.id
    }
    return { mode: 'apply', ...baseline, changed }
  }

  private async scan(): Promise<Omit<VaultSecretRewrapReport, 'mode' | 'changed'>> {
    const report = { total: 0, primary: 0, previous: 0, invalid: 0 }
    let cursor = 0
    while (true) {
      const rows = await this.repository.listAfter(cursor, this.batchSize)
      if (rows.length === 0) break
      for (const row of rows) {
        report.total += 1
        try {
          report[this.crypto.inspect(row.payload).keyOrigin] += 1
        } catch {
          report.invalid += 1
        }
      }
      cursor = rows[rows.length - 1]!.id
    }
    return report
  }
}
