import { describe, expect, it } from 'vitest'
import { CompactEncrypt, importJWK } from 'jose'
import { assertContext, createRecipient, openEnvelope, thumbprintOf, type DeliveryContext } from './envelope'

const context = (thumbprint: string): DeliveryContext => ({ version: 1, operationId: 'o'.repeat(43), tenantId: 3, userId: 7, clientId: 'c'.repeat(64), action: 'reveal',
  itemRef: 'secret:1', recipientThumbprint: thumbprint, policyVersion: 2, secretVersion: 'f'.repeat(64), expiresAt: Date.now() + 30_000, origin: 'https://portal.test' })
async function seal(jwk: object, value: string, header: object): Promise<string> {
  return new CompactEncrypt(new TextEncoder().encode(value)).setProtectedHeader(header as never).encrypt(await importJWK(jwk as never, 'RSA-OAEP-256'))
}
describe('NA-0195 extension envelope', () => {
  it('opens a release sealed by the server format, bound to its context', async () => {
    const r = await createRecipient(), ctx = context(r.thumbprint)
    expect(r.privateKey.extractable).toBe(false); expect(r.thumbprint).toBe(await thumbprintOf(r.publicJwk))
    const jwe = await seal(r.publicJwk, 'Senha-ç-🔑', { alg: 'RSA-OAEP-256', enc: 'A256GCM', typ: 'vaultnaccess+jwe', vault: ctx })
    assertContext(ctx, { itemRef: 'secret:1', action: 'reveal', thumbprint: r.thumbprint })
    expect(await openEnvelope(jwe, r, ctx)).toBe('Senha-ç-🔑')
  })
  it('refuses another context, header, key, tampering or garbage', async () => {
    const r = await createRecipient(), other = await createRecipient(), ctx = context(r.thumbprint)
    const header = { alg: 'RSA-OAEP-256', enc: 'A256GCM', typ: 'vaultnaccess+jwe', vault: ctx }
    const jwe = await seal(r.publicJwk, 'x', header)
    await expect(openEnvelope(jwe, r, { ...ctx, itemRef: 'secret:2' })).rejects.toThrow('envelope')
    await expect(openEnvelope(jwe, other, ctx)).rejects.toThrow('envelope')
    await expect(openEnvelope(await seal(r.publicJwk, 'x', { ...header, typ: 'JWE' }), r, ctx)).rejects.toThrow('envelope')
    await expect(openEnvelope(await seal(r.publicJwk, 'x', { ...header, extra: 1 }), r, ctx)).rejects.toThrow('envelope')
    const parts = jwe.split('.'); parts[3] = parts[3]!.slice(0, -2) + (parts[3]!.endsWith('A') ? 'BB' : 'AA')
    await expect(openEnvelope(parts.join('.'), r, ctx)).rejects.toThrow('envelope')
    for (const bad of [42, 'a.b.c', 'x'.repeat(30_000), '!.!.!.!.!']) await expect(openEnvelope(bad, r, ctx)).rejects.toThrow('envelope')
  })
  it('NA-0195: refuses a context already expired by the server clock or from another portal', () => {
    const ctx = context('t'.repeat(43)), expected = { itemRef: 'secret:1', action: 'reveal' as const, thumbprint: 't'.repeat(43) }
    expect(() => assertContext(ctx, { ...expected, origin: 'https://portal.test', serverNow: ctx.expiresAt - 1 })).not.toThrow()
    expect(() => assertContext(ctx, { ...expected, serverNow: ctx.expiresAt })).toThrow('envelope')
    expect(() => assertContext(ctx, { ...expected, origin: 'https://other.test' })).toThrow('envelope')
  })
  it('checks that the server context answers this item, action and key', () => {
    const ctx = context('t'.repeat(43)), expected = { itemRef: 'secret:1', action: 'reveal' as const, thumbprint: 't'.repeat(43) }
    expect(() => assertContext(ctx, expected)).not.toThrow()
    for (const bad of [null, { ...ctx, action: 'copy' }, { ...ctx, itemRef: 'secret:9' }, { ...ctx, recipientThumbprint: 'x' }, { ...ctx, extra: 1 }, { ...ctx, version: 2 }])
      expect(() => assertContext(bad, expected)).toThrow('envelope')
  })
})
