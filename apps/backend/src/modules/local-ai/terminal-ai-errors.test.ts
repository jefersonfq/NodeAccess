import { describe, expect, it } from 'vitest'
import { terminalAiError } from './terminal-ai-errors.js'
import { ForbiddenError } from '../../shared/errors.js'
describe('terminal AI failure boundary', () => {
  it.each([
    [new SyntaxError('secret answer'),'AI_RESPONSE_INVALID'],
    [new Error('HTTP 429: secret token'),'AI_RATE_LIMIT'],
    [new Error('HTTP 401: secret key'),'AI_PROVIDER_CONFIGURATION'],
    [new Error('TimeoutError'),'AI_TIMEOUT'],
    [new Error('fetch failed secret'),'AI_UNAVAILABLE'],
    [new ForbiddenError('IA não licenciada'),'AI_LICENSE'],
    [new ForbiddenError('Host inacessível'),'FORBIDDEN'],
  ])('returns actionable sanitized errors: %s', (error, code) => {
    const failure=terminalAiError(error)
    expect(failure.code).toBe(code)
    expect(failure.message).not.toContain('secret')
  })
  it('distinguishes cancellation from deadline', () => {
    const user=new AbortController();user.abort()
    const timeout=new AbortController();timeout.abort(new DOMException('deadline','TimeoutError'))
    expect(terminalAiError(new Error('secret'),user.signal).code).toBe('AI_CANCELED')
    expect(terminalAiError(new Error('secret'),timeout.signal).code).toBe('AI_TIMEOUT')
  })
})
