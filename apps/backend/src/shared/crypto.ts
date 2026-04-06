import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { env } from '../config/env.js'

const ALGORITHM = 'aes-256-gcm'
const AUTH_TAG_LENGTH = 16

// Chave derivada da variável de ambiente (64 chars hex = 32 bytes)
const KEY = Buffer.from(env.PEM_ENCRYPTION_KEY, 'hex')

export interface EncryptedPayload {
  encrypted: string // base64: ciphertext + authTag
  iv: string        // hex
}

export function encrypt(plaintext: string): EncryptedPayload {
  const iv = randomBytes(16)
  const cipher = createCipheriv(ALGORITHM, KEY, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return {
    encrypted: Buffer.concat([ciphertext, authTag]).toString('base64'),
    iv: iv.toString('hex'),
  }
}

export function decrypt({ encrypted, iv }: EncryptedPayload): string {
  const data = Buffer.from(encrypted, 'base64')
  const authTag = data.subarray(data.length - AUTH_TAG_LENGTH)
  const ciphertext = data.subarray(0, data.length - AUTH_TAG_LENGTH)

  const decipher = createDecipheriv(ALGORITHM, KEY, Buffer.from(iv, 'hex'))
  decipher.setAuthTag(authTag)

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
