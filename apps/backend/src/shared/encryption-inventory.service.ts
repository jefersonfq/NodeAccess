import type { EncryptedPayload, EncryptionPayloadInspection } from './crypto.js'

export interface EncryptionInventorySource {
  domain: string
  load(): Promise<Array<EncryptedPayload | null>>
}

export interface EncryptionInventoryRow {
  domain: string
  total: number
  primary: number
  previous: number
  invalid: number
}

export interface EncryptionInventoryInspector {
  inspect(payload: EncryptedPayload): EncryptionPayloadInspection
}

export class EncryptionInventoryService {
  constructor(
    private readonly sources: EncryptionInventorySource[],
    private readonly inspector: EncryptionInventoryInspector,
  ) {}

  async inspect(): Promise<{ totals: EncryptionInventoryRow; domains: EncryptionInventoryRow[] }> {
    const domains: EncryptionInventoryRow[] = []
    for (const source of this.sources) {
      const row: EncryptionInventoryRow = { domain: source.domain, total: 0, primary: 0, previous: 0, invalid: 0 }
      for (const payload of await source.load()) {
        if (!payload) continue
        row.total += 1
        try {
          const result = this.inspector.inspect(payload)
          row[result.keyOrigin] += 1
        } catch {
          row.invalid += 1
        }
      }
      domains.push(row)
    }
    const totals = domains.reduce<EncryptionInventoryRow>((sum, row) => ({
      domain: 'total',
      total: sum.total + row.total,
      primary: sum.primary + row.primary,
      previous: sum.previous + row.previous,
      invalid: sum.invalid + row.invalid,
    }), { domain: 'total', total: 0, primary: 0, previous: 0, invalid: 0 })
    return { totals, domains }
  }
}

export function parseEncryptedJson(value: string | null): EncryptedPayload | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    return payload(parsed.encrypted, parsed.iv)
  } catch {
    return { encrypted: '', iv: '' }
  }
}

export function payload(encrypted: unknown, iv: unknown): EncryptedPayload | null {
  return typeof encrypted === 'string' && typeof iv === 'string' ? { encrypted, iv } : null
}
