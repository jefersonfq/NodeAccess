import { describe, expect, it } from 'vitest'
import { CreateSecretSchema, RotateSecretSchema, SecretPublicSchema, UpdateSecretSchema } from './secret.schema.js'

describe('secret schemas', () => {
  it('rejects invalid aliases, empty values and oversized values', () => {
    expect(CreateSecretSchema.safeParse({ alias: 'a', value: 'x' }).success).toBe(false)
    expect(CreateSecretSchema.safeParse({ alias: 'has spaces', value: 'x' }).success).toBe(false)
    expect(CreateSecretSchema.safeParse({ alias: 'valid', value: '' }).success).toBe(false)
    expect(RotateSecretSchema.safeParse({ value: 'x'.repeat(65536) }).success).toBe(false)
  })

  it('does not accept sensitive properties in the public contract output', () => {
    const parsed = SecretPublicSchema.parse({
      id: 1, tenantId: 1, alias: 'ssh-prod', description: null, scope: 'PERSONAL',
      ownerUserId: 2, groupId: null, createdByUserId: 2, createdByUsername: 'user',
      source: 'MANUAL', createdAt: new Date(), updatedAt: new Date(), rotatedAt: null, revokedAt: null,
      encryptedValue: 'must-be-stripped', iv: 'must-be-stripped', value: 'must-be-stripped',
    })
    expect(parsed).not.toHaveProperty('value')
    expect(parsed).not.toHaveProperty('encryptedValue')
    expect(parsed).not.toHaveProperty('iv')
  })

  it('keeps value out of metadata updates', () => {
    expect(UpdateSecretSchema.parse({ alias: 'renamed', value: 'ignored' })).toEqual({ alias: 'renamed' })
  })
})
