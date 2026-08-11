import type { PrismaClient } from '@prisma/client'
import type { EncryptionInventorySource } from './encryption-inventory.service.js'
import { parseEncryptedJson, payload } from './encryption-inventory.service.js'

export function prismaEncryptionInventorySources(db: PrismaClient): EncryptionInventorySource[] {
  return [
    jsonSource('hosts.password', () => db.host.findMany({ where: { passwordEncrypted: { not: null } }, select: { passwordEncrypted: true } }), 'passwordEncrypted'),
    jsonSource('bastions.password', () => db.bastionHost.findMany({ where: { passwordEncrypted: { not: null } }, select: { passwordEncrypted: true } }), 'passwordEncrypted'),
    pairSource('host_links.token', () => db.hostLink.findMany({ where: { tokenEncrypted: { not: null }, tokenIv: { not: null } }, select: { tokenEncrypted: true, tokenIv: true } }), 'tokenEncrypted', 'tokenIv'),
    pairSource('host_links.pin', () => db.hostLink.findMany({ where: { pinEncrypted: { not: null }, pinIv: { not: null } }, select: { pinEncrypted: true, pinIv: true } }), 'pinEncrypted', 'pinIv'),
    pairSource('pem_keys.key', () => db.pemKey.findMany({ select: { encryptedKey: true, iv: true } }), 'encryptedKey', 'iv'),
    pairSource('pem_keys.passphrase', () => db.pemKey.findMany({ where: { encryptedPassphrase: { not: null }, passphraseIv: { not: null } }, select: { encryptedPassphrase: true, passphraseIv: true } }), 'encryptedPassphrase', 'passphraseIv'),
    pairSource('bastion_pem_keys.key', () => db.bastionPemKey.findMany({ select: { encryptedKey: true, iv: true } }), 'encryptedKey', 'iv'),
    pairSource('shared_sessions.token', () => db.sharedSession.findMany({ where: { tokenEncrypted: { not: null }, tokenIv: { not: null } }, select: { tokenEncrypted: true, tokenIv: true } }), 'tokenEncrypted', 'tokenIv'),
    pairSource('secrets.value', () => db.secret.findMany({ select: { encryptedValue: true, iv: true } }), 'encryptedValue', 'iv'),
    pairSource('webhooks.outbound', () => db.webhookSubscription.findMany({ where: { secretEncrypted: { not: null }, secretIv: { not: null } }, select: { secretEncrypted: true, secretIv: true } }), 'secretEncrypted', 'secretIv'),
    pairSource('webhooks.inbound', () => db.inboundWebhookEndpoint.findMany({ where: { secretEncrypted: { not: null }, secretIv: { not: null } }, select: { secretEncrypted: true, secretIv: true } }), 'secretEncrypted', 'secretIv'),
    pairSource('email.password', () => db.emailConfig.findMany({ select: { passwordEnc: true, passwordIv: true } }), 'passwordEnc', 'passwordIv'),
    integrationSource(db),
  ]
}

function pairSource(domain: string, loadRows: () => Promise<Record<string, unknown>[]>, encryptedKey: string, ivKey: string): EncryptionInventorySource {
  return { domain, load: async () => (await loadRows()).map((row) => payload(row[encryptedKey], row[ivKey])) }
}

function jsonSource(domain: string, loadRows: () => Promise<Record<string, unknown>[]>, key: string): EncryptionInventorySource {
  return {
    domain,
    load: async () => (await loadRows()).map((row) => {
      const value = row[key]
      return parseEncryptedJson(typeof value === 'string' ? value : null)
    }),
  }
}

function integrationSource(db: PrismaClient): EncryptionInventorySource {
  const pairs = [
    ['serviceAccountEncrypted', 'serviceAccountIv'], ['clientSecretEncrypted', 'clientSecretIv'],
    ['bindPasswordEncrypted', 'bindPasswordIv'], ['apiKeyEncrypted', 'apiKeyIv'],
    ['networkApiKeyEncrypted', 'networkApiKeyIv'], ['apiTokenEncrypted', 'apiTokenIv'],
  ] as const
  return {
    domain: 'integrations.config',
    load: async () => (await db.integration.findMany({ select: { config: true } })).flatMap(({ config }) => {
      try {
        const value = JSON.parse(config) as Record<string, unknown>
        return pairs.map(([encrypted, iv]) => payload(value[encrypted], value[iv])).filter((item) => item !== null)
      } catch {
        return [{ encrypted: '', iv: '' }]
      }
    }),
  }
}
