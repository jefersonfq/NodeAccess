import { describe, expect, it, vi } from 'vitest'
import { fillSite, validFillBinding } from './site-fill'
const binding = { mode: 'both' as const, origin: 'https://login.example.test', tabId: 1, frameId: 0 as const, documentId: 'doc-1' }
function fixture() {
  const browser = { capture: vi.fn().mockResolvedValue({ ...binding }), preflight: vi.fn().mockResolvedValue('both'), fill: vi.fn().mockResolvedValue(undefined) }
  const authorize = vi.fn().mockResolvedValue({ operation: 'opaque', expiresAt: 100 })
  const deliver = vi.fn().mockResolvedValue({ mode: 'both', username: 'synthetic-user', password: 'synthetic-password' })
  return { browser, authorize, deliver, origin: binding.origin, enabled: () => true }
}
describe('single-use site fill', () => {
  it('binds authorize and delivery to an immutable exact document', async () => {
    const f = fixture(); await fillSite(f)
    expect(f.authorize).toHaveBeenCalledWith(binding)
    expect(Object.isFrozen(f.authorize.mock.calls[0]![0])).toBe(true)
    expect(f.deliver).toHaveBeenCalledWith({ operation: 'opaque', expiresAt: 100 }, binding)
    expect(f.browser.capture).toHaveBeenCalledTimes(3)
    expect(f.browser.fill).toHaveBeenCalledExactlyOnceWith(binding, { mode: 'both', username: 'synthetic-user', password: 'synthetic-password' })
  })
  it.each([undefined, () => false])('denies absent/disabled feature before capture', async enabled => {
    const f = fixture(); await expect(fillSite({ ...f, ...(enabled ? { enabled } : { enabled: undefined }) })).rejects.toThrow('disabled')
    expect(f.browser.capture).not.toHaveBeenCalled()
  })
  it.each(['http://login.example.test', 'https://login.example.test.evil.test', 'https://sub.login.example.test', 'https://login.example.test:8443'])('rejects different origin %s', async origin => {
    const f = fixture(); await expect(fillSite({ ...f, origin })).rejects.toThrow('target'); expect(f.authorize).not.toHaveBeenCalled()
  })
  it.each([{ documentId: 'doc-2' }, { tabId: 2 }, { frameId: 1 }, { origin: 'https://elsewhere.test' }, { documentId: '' }])('rejects changes before delivery %j', async change => {
    const f = fixture(); f.browser.capture.mockResolvedValueOnce(binding).mockResolvedValue({ ...binding, ...change })
    await expect(fillSite(f)).rejects.toThrow('changed'); expect(f.deliver).not.toHaveBeenCalled(); expect(f.browser.fill).not.toHaveBeenCalled()
  })
  it('rejects navigation after consuming the envelope without retry', async () => {
    const f = fixture(); f.browser.capture.mockResolvedValueOnce(binding).mockResolvedValueOnce(binding).mockResolvedValue({ ...binding, documentId: 'new' })
    await expect(fillSite(f)).rejects.toThrow('changed'); expect(f.deliver).toHaveBeenCalledTimes(1); expect(f.browser.fill).not.toHaveBeenCalled()
  })
  it('honors feature revocation while awaiting authorization', async () => {
    const f = fixture(); let active = true
    const enabled = () => active
    f.authorize.mockImplementation(() => { active = false; return Promise.resolve({ operation: 'opaque', expiresAt: 100 }) })
    await expect(fillSite({ ...f, enabled })).rejects.toThrow('disabled'); expect(f.deliver).not.toHaveBeenCalled()
  })
  it('honors feature revocation after delivery', async () => {
    const f = fixture(); let active = true
    const enabled = () => active
    f.deliver.mockImplementation(() => { active = false; return Promise.resolve({ mode: 'both', username: 'synthetic-user', password: 'synthetic-password' }) })
    await expect(fillSite({ ...f, enabled })).rejects.toThrow('disabled'); expect(f.browser.fill).not.toHaveBeenCalled()
  })
  it.each(['authorize', 'deliver'] as const)('does not retry %s errors', async key => {
    const f = fixture(); f[key].mockRejectedValue(new Error('denied'))
    await expect(fillSite(f)).rejects.toThrow('denied'); expect(f[key]).toHaveBeenCalledTimes(1); expect(f.browser.fill).not.toHaveBeenCalled()
  })
  it('does not retry injection failures', async () => {
    const f = fixture(); f.browser.fill.mockRejectedValue(new Error('fields'))
    await expect(fillSite(f)).rejects.toThrow('fields'); expect(f.deliver).toHaveBeenCalledTimes(1); expect(f.browser.fill).toHaveBeenCalledTimes(1)
  })
  it.each([{ username: null, password: 'x' }, { username: '', password: '' }])('rejects malformed credentials', async credentials => {
    const f = fixture(); f.deliver.mockResolvedValue(credentials); await expect(fillSite(f)).rejects.toThrow('fields'); expect(f.browser.fill).not.toHaveBeenCalled()
  })
  it.each(['https://a.test/path', 'https://u:p@a.test', 'https://a.test#x', 'broken'])('rejects non-origin %s', origin => {
    expect(validFillBinding({ ...binding, origin })).toBe(false)
  })
})


describe('structure-only preflight before credential release', () => {
  it('does not authorize or consume a ambiguous form', async () => {
    const f = fixture(); f.browser.preflight.mockRejectedValue(new Error('fields'))
    await expect(fillSite(f)).rejects.toThrow('fields')
    expect(f.authorize).not.toHaveBeenCalled(); expect(f.deliver).not.toHaveBeenCalled()
  })
  it('rechecks form after awaiting authorization without consuming when it disappears', async () => {
    const f = fixture(); f.browser.preflight.mockResolvedValueOnce('both').mockRejectedValue(new Error('fields'))
    await expect(fillSite(f)).rejects.toThrow('fields')
    expect(f.authorize).toHaveBeenCalledOnce(); expect(f.deliver).not.toHaveBeenCalled()
  })
})


describe('login-step mode binding', () => {
  it.each(['username', 'password'] as const)('authorizes only the inferred %s step', async mode => {
    const f = fixture(); f.browser.preflight.mockResolvedValue(mode)
    const credentials = mode === 'username' ? { mode, username: 'user' } : { mode, password: 'password' }
    f.deliver.mockResolvedValue(credentials)
    await fillSite(f)
    expect(f.authorize).toHaveBeenCalledExactlyOnceWith({ ...binding, mode })
    expect(f.browser.fill).toHaveBeenCalledExactlyOnceWith({ ...binding, mode }, credentials)
  })
  it('refuses a mode change while authorization is pending before consume', async () => {
    const f = fixture(); f.browser.preflight.mockResolvedValueOnce('username').mockResolvedValue('both')
    await expect(fillSite(f)).rejects.toThrow('changed')
    expect(f.deliver).not.toHaveBeenCalled()
  })
  it.each([{ mode: 'both', username: 'u', password: 'p' }, { mode: 'username', username: 'u', password: 'p' }])('never injects a password-bearing username-only reply %j', async reply => {
    const f = fixture(); f.browser.preflight.mockResolvedValue('username'); f.deliver.mockResolvedValue(reply)
    await expect(fillSite(f)).rejects.toThrow('fields'); expect(f.browser.fill).not.toHaveBeenCalled()
  })
})


describe('unsupported preflight contract', () => {
  it('does not authorize or request credentials when the browser port returns an unsupported mode', async () => {
    const f = fixture(); f.browser.preflight.mockResolvedValue('unsupported')
    await expect(fillSite(f)).rejects.toThrow('fields')
    expect(f.authorize).not.toHaveBeenCalled()
    expect(f.deliver).not.toHaveBeenCalled()
    expect(f.browser.fill).not.toHaveBeenCalled()
  })
})
