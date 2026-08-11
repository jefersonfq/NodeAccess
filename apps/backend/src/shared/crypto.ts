import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { env } from '../config/env.js'

const ALGORITHM = 'aes-256-gcm'
const AUTH_TAG_LENGTH = 16

export interface EncryptedPayload {
  encrypted: string // base64: ciphertext + authTag
  iv: string        // hex
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
    const data = Buffer.from(encrypted, 'base64')
    if (data.length <= AUTH_TAG_LENGTH || !/^[0-9a-f]{32}$/i.test(iv)) {
      throw new Error('Payload cifrado inválido')
    }
    const authTag = data.subarray(data.length - AUTH_TAG_LENGTH)
    const ciphertext = data.subarray(0, data.length - AUTH_TAG_LENGTH)

    for (const key of this.keys) {
      try {
        const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'))
        decipher.setAuthTag(authTag)
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
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
