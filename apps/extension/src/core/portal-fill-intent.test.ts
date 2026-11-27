import { describe, expect, it } from 'vitest'
import { readPendingFill } from './portal-fill-intent'
const now = 1_800_000_000_000
const pending = { reference: 'a'.repeat(24), siteId: 7, version: 2, origin: 'https://site.example', expiresAt: now + 120_000, action: 'fill' }
describe('pending fill public metadata', () => {
  it('projects references only and never secret or authorization fields', () => {
    expect(readPendingFill({ ...pending, password: 'private', token: 'auth', binding: 'internal', documentId: 'internal' }, now)).toEqual(pending)
  })
  it.each([{ expiresAt: now }, { expiresAt: now - 1 }, { expiresAt: now + 120_001 }, { expiresAt: Infinity }, { origin: 'http://site.example' }, { origin: 'https://site.example/path' }, { origin: 'https://name:password@site.example' }, { reference: '../secret' }, { siteId: 0 }, { version: 1.2 }, { action: 'reveal' }])('rejects expired, foreign action or malformed metadata %j', change => {
    expect(readPendingFill({ ...pending, ...change }, now)).toBeNull()
  })
})
