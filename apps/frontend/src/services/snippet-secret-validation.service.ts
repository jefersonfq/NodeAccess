import type { SecretPublic } from '@nodeaccess/shared'

export interface SnippetSecretAliasStatus {
  alias: string
  state: 'available' | 'missing'
}

export function getSnippetSecretAliasStatuses(
  aliases: string[],
  secrets: SecretPublic[],
): SnippetSecretAliasStatus[] {
  const availableAliases = new Set(secrets.filter((secret) => !secret.revokedAt).map((secret) => secret.alias))
  return aliases.map((alias) => ({
    alias,
    state: availableAliases.has(alias) ? 'available' : 'missing',
  }))
}

export function hasMissingSecretAliases(statuses: SnippetSecretAliasStatus[]): boolean {
  return statuses.some((status) => status.state === 'missing')
}
