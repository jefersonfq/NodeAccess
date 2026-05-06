const DEFAULT_TTL_MS = 30_000
const MIN_SECRET_LENGTH = 3

interface RedactionEntry {
  alias: string
  value: string
  expiresAt: number
}

export class SecretRedactor {
  private entries: RedactionEntry[] = []

  addMany(secrets: Array<{ alias: string; value: string }>, ttlMs = DEFAULT_TTL_MS): void {
    const expiresAt = Date.now() + ttlMs
    for (const secret of secrets) {
      if (secret.value.length < MIN_SECRET_LENGTH) continue
      this.entries.push({ alias: secret.alias, value: secret.value, expiresAt })
    }
    this.prune()
  }

  redactBuffer(data: Buffer): { data: Buffer; redactedAliases: string[] } {
    this.prune()
    if (this.entries.length === 0) return { data, redactedAliases: [] }

    const input = data.toString('utf8')
    let output = input
    const redactedAliases = new Set<string>()

    for (const entry of this.entries) {
      if (!output.includes(entry.value)) continue
      output = output.split(entry.value).join(`{{secret:${entry.alias}:***}}`)
      redactedAliases.add(entry.alias)
    }

    if (redactedAliases.size === 0) return { data, redactedAliases: [] }
    return { data: Buffer.from(output, 'utf8'), redactedAliases: [...redactedAliases] }
  }

  clear(): void {
    this.entries = []
  }

  private prune(): void {
    const now = Date.now()
    this.entries = this.entries.filter((entry) => entry.expiresAt > now)
  }
}
