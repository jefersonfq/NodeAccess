import { afterEach, describe, expect, it, vi } from 'vitest'
import { SecretRedactor } from './secret-redactor.js'

describe('SecretRedactor', () => {
  afterEach(() => vi.useRealTimers())

  it('redacts every occurrence and reports each alias once', () => {
    const redactor = new SecretRedactor()
    redactor.addMany([{ alias: 'db', value: 'CANARY-123' }])
    const result = redactor.redactBuffer(Buffer.from('CANARY-123 x CANARY-123'))
    expect(result.data.toString()).toBe('{{secret:db:***}} x {{secret:db:***}}')
    expect(result.redactedAliases).toEqual(['db'])
  })

  it('does not retain short values that would over-redact normal output', () => {
    const redactor = new SecretRedactor()
    redactor.addMany([{ alias: 'short', value: 'ab' }])
    expect(redactor.redactBuffer(Buffer.from('ab')).data.toString()).toBe('ab')
  })

  it('expires redactions and clears them explicitly', () => {
    vi.useFakeTimers()
    const redactor = new SecretRedactor()
    redactor.addMany([{ alias: 'token', value: 'CANARY-456' }], 100)
    vi.advanceTimersByTime(101)
    expect(redactor.redactBuffer(Buffer.from('CANARY-456')).redactedAliases).toEqual([])
    redactor.addMany([{ alias: 'token', value: 'CANARY-456' }])
    redactor.clear()
    expect(redactor.redactBuffer(Buffer.from('CANARY-456')).redactedAliases).toEqual([])
  })

  it('preserves the original Buffer instance when there is nothing to redact', () => {
    const redactor = new SecretRedactor()
    const input = Buffer.from('ordinary output')
    expect(redactor.redactBuffer(input).data).toBe(input)
  })
})
