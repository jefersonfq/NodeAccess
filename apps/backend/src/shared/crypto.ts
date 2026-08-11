import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { env } from '../config/env.js'

const ALGORITHM = 'aes-256-gcm'
const AUTH_TAG_LENGTH = 16

export interface EncryptedPayload {
  encrypted: string // base64: ciphertext + authTag
  iv: string        // hex
}

export interface EncryptionPayloadInspection {
  keyOrigin: 'primary' | 'previous'
  previousKeyPosition: number | null
}

export interface EncryptionRewrapResult extends EncryptionPayloadInspection {
  payload: EncryptedPayload
  wouldChange: boolean
  changed: boolean
}

export class EncryptionKeyring {
  private readonly keys: Buffer[]

  constructor(primaryKey: string, previousKeys: string[] = []) {
    const unique = [...new Set([primaryKey, ...previousKeys].map((key) => key.trim().toLowerCase()))]
    if (unique.some((key) => !/^[0-9a-f]{64}$/.test(key))) {
      throw new Error('Chave de criptografia inválida')
    }
    this.keys = unique.map((key) => Buffer.from(key, 'hex'))
  }

  encrypt(plaintext: string): EncryptedPayload {
    const iv = randomBytes(16)
    const cipher = createCipheriv(ALGORITHM, this.keys[0]!, iv)
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const authTag = cipher.getAuthTag()

    return {
      encrypted: Buffer.concat([ciphertext, authTag]).toString('base64'),
      iv: iv.toString('hex'),
    }
  }

  decrypt({ encrypted, iv }: EncryptedPayload): string {
    return this.open({ encrypted, iv }).plaintext
  }

  inspect(payload: EncryptedPayload): EncryptionPayloadInspection {
    const opened = this.open(payload)
    return {
      keyOrigin: opened.keyIndex === 0 ? 'primary' : 'previous',
      previousKeyPosition: opened.keyIndex === 0 ? null : opened.keyIndex,
    }
  }

  rewrap(payload: EncryptedPayload, options: { dryRun: boolean }): EncryptionRewrapResult {
    const opened = this.open(payload)
    const inspection: EncryptionPayloadInspection = {
      keyOrigin: opened.keyIndex === 0 ? 'primary' : 'previous',
      previousKeyPosition: opened.keyIndex === 0 ? null : opened.keyIndex,
    }
    if (opened.keyIndex === 0 || options.dryRun) {
      return { ...inspection, payload, wouldChange: opened.keyIndex !== 0, changed: false }
    }
    return { ...inspection, payload: this.encrypt(opened.plaintext), wouldChange: true, changed: true }
  }

  private open({ encrypted, iv }: EncryptedPayload): { plaintext: string; keyIndex: number } {
    const data = Buffer.from(encrypted, 'base64')
    if (data.length <= AUTH_TAG_LENGTH || !/^[0-9a-f]{32}$/i.test(iv)) {
      throw new Error('Payload cifrado inválido')
    }
    const authTag = data.subarray(data.length - AUTH_TAG_LENGTH)
    const ciphertext = data.subarray(0, data.length - AUTH_TAG_LENGTH)

    for (const [keyIndex, key] of this.keys.entries()) {
      try {
        const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'))
        decipher.setAuthTag(authTag)
        return {
          plaintext: Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'),
          keyIndex,
        }
      } catch {
        // Tenta somente as chaves explicitamente configuradas no keyring.
      }
    }
    throw new Error('Não foi possível descriptografar o payload com as chaves configuradas')
  }
}

const keyring = new EncryptionKeyring(
  env.PEM_ENCRYPTION_KEY,
  env.PEM_ENCRYPTION_PREVIOUS_KEYS?.split(',').map((key) => key.trim()).filter(Boolean) ?? [],
)

export function encrypt(plaintext: string): EncryptedPayload {
  return keyring.encrypt(plaintext)
}

export function decrypt(payload: EncryptedPayload): string {
  return keyring.decrypt(payload)
}

export function inspectEncryption(payload: EncryptedPayload): EncryptionPayloadInspection {
  return keyring.inspect(payload)
}

export function rewrapEncryption(
  payload: EncryptedPayload,
  options: { dryRun: boolean },
): EncryptionRewrapResult {
  return keyring.rewrap(payload, options)
}
