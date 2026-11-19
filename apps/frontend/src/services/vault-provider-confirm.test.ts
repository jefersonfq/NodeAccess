import { afterEach, describe, expect, it, vi } from 'vitest'
import { forwardVaultStepUpReturn, isVaultStepUpState, openVaultProviderWindow, requestGoogleIdToken, routeVaultStepUpReturn, type ProviderWindowDependencies } from './vault-provider-confirm'

const state = 'vsu.abcdefghijklmnop'
function deps() {
  const channel = { postMessage: vi.fn(), close: vi.fn(), onmessage: null as ((event: MessageEvent) => void) | null }
  const popup = { close: vi.fn() }
  let timeout: (() => void) | null = null
  const d: ProviderWindowDependencies = { open: vi.fn(() => popup), channel: () => channel, setTimeout: fn => { timeout = fn; return 1 }, clearTimeout: vi.fn() }
  return { d, channel, popup, fireTimeout: () => timeout?.() }
}
const message = (data: unknown) => ({ data }) as MessageEvent

describe('vault provider window (NA-0184)', () => {
  it('recognizes only step-up states', () => {
    expect(isVaultStepUpState(state)).toBe(true)
    expect(isVaultStepUpState('abcdefghijklmnopqrstuvwxyz')).toBe(false)
    expect(isVaultStepUpState('vsu.short')).toBe(false)
  })
  it('resolves with the code of its own state only and closes the window', async () => {
    const f = deps()
    const pending = openVaultProviderWindow(`https://idp.example/authorize?state=${state}`, new AbortController().signal, f.d)
    f.channel.onmessage?.(message({ type: 'vault-step-up-return', state: 'vsu.otherotherotherother', code: 'x' }))
    f.channel.onmessage?.(message({ type: 'other', state, code: 'x' }))
    f.channel.onmessage?.(message({ type: 'vault-step-up-return', state, code: 'provider-code' }))
    await expect(pending).resolves.toEqual({ state, code: 'provider-code' })
    expect(f.popup.close).toHaveBeenCalled(); expect(f.channel.close).toHaveBeenCalled()
  })
  it('rejects non-HTTPS, non step-up URLs, blocked popups, abort and timeout', async () => {
    const f = deps()
    await expect(openVaultProviderWindow(`http://idp.example/a?state=${state}`, new AbortController().signal, f.d)).rejects.toMatchObject({ reason: 'unavailable' })
    await expect(openVaultProviderWindow('https://idp.example/a?state=plainloginstate123456', new AbortController().signal, f.d)).rejects.toMatchObject({ reason: 'unavailable' })
    const blocked = deps(); blocked.d.open = vi.fn(() => null)
    await expect(openVaultProviderWindow(`https://idp.example/a?state=${state}`, new AbortController().signal, blocked.d)).rejects.toMatchObject({ reason: 'unsupported' })
    const a = deps(), controller = new AbortController()
    const aborted = openVaultProviderWindow(`https://idp.example/a?state=${state}`, controller.signal, a.d); controller.abort()
    await expect(aborted).rejects.toMatchObject({ reason: 'locked' })
    const t = deps(); const timed = openVaultProviderWindow(`https://idp.example/a?state=${state}`, new AbortController().signal, t.d); t.fireTimeout()
    await expect(timed).rejects.toMatchObject({ reason: 'expired' })
  })
  it('forwards only step-up returns from the callback page', () => {
    const channel = { postMessage: vi.fn(), close: vi.fn(), onmessage: null }
    expect(forwardVaultStepUpReturn('plainloginstate123456', 'code', () => channel)).toBe(false)
    expect(forwardVaultStepUpReturn(state, '', () => channel)).toBe(false)
    expect(channel.postMessage).not.toHaveBeenCalled()
    expect(forwardVaultStepUpReturn(state, 'code', () => channel)).toBe(true)
    expect(channel.postMessage).toHaveBeenCalledWith({ type: 'vault-step-up-return', state, code: 'code' }); expect(channel.close).toHaveBeenCalled()
  })
})

describe('vault step-up callback routing and browser defaults (NA-0184)', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  it('routes only step-up states and never treats them as a login', () => {
    const forward = vi.fn(() => true)
    expect(routeVaultStepUpReturn({ state: 'plainloginstate123456', code: 'c' }, forward)).toBe('not-step-up')
    expect(routeVaultStepUpReturn({ state, error: 'access_denied' }, forward)).toBe('failed')
    expect(routeVaultStepUpReturn({ state }, forward)).toBe('failed')
    expect(routeVaultStepUpReturn({ state, code: 'c' }, forward)).toBe('forwarded')
    expect(routeVaultStepUpReturn({ state, code: 'c' }, () => false)).toBe('failed')
    expect(forward).toHaveBeenCalledTimes(1)
  })
  it('uses a named popup and the same-origin channel by default', async () => {
    const channels: Array<{ postMessage: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; onmessage: ((e: MessageEvent) => void) | null }> = []
    vi.stubGlobal('BroadcastChannel', vi.fn(function channel() { const c = { postMessage: vi.fn(), close: vi.fn(), onmessage: null }; channels.push(c); return c }))
    const open = vi.fn(() => ({ close: vi.fn() }))
    vi.stubGlobal('window', { open })
    const pending = openVaultProviderWindow(`https://idp.example/a?state=${state}`, new AbortController().signal)
    expect(open).toHaveBeenCalledWith(`https://idp.example/a?state=${state}`, 'nodeaccess-vault-step-up', 'popup,width=520,height=720')
    expect(BroadcastChannel).toHaveBeenCalledWith('nodeaccess-vault-step-up')
    channels[0].onmessage?.(message({ type: 'vault-step-up-return', state, code: 'code' }))
    await expect(pending).resolves.toEqual({ state, code: 'code' })
    expect(forwardVaultStepUpReturn(state, 'code')).toBe(true)
    expect(channels[1].postMessage).toHaveBeenCalled()
  })
})

describe('vault Google step-up button (NA-0184)', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  function google() {
    let callback: ((response: { credential?: string }) => void) | null = null
    const id = { initialize: vi.fn((o: { callback: (r: { credential?: string }) => void }) => { callback = o.callback }), renderButton: vi.fn(), cancel: vi.fn() }
    vi.stubGlobal('window', { google: { accounts: { id } } })
    return { id, respond: (r: { credential?: string }) => callback?.(r) }
  }
  const element = { replaceChildren: vi.fn() } as unknown as HTMLElement
  it('binds the challenge nonce and resolves with the fresh credential', async () => {
    const g = google()
    const pending = requestGoogleIdToken(element, 'google-client', 'nonce-value', new AbortController().signal)
    await vi.waitFor(() => expect(g.id.renderButton).toHaveBeenCalled())
    expect(g.id.initialize).toHaveBeenCalledWith(expect.objectContaining({ client_id: 'google-client', nonce: 'nonce-value', auto_select: false }))
    g.respond({ credential: 'g'.repeat(64) })
    await expect(pending).resolves.toBe('g'.repeat(64))
  })
  it('rejects an empty credential and cancels on abort', async () => {
    const g = google()
    const bad = requestGoogleIdToken(element, 'google-client', 'nonce-value', new AbortController().signal)
    await vi.waitFor(() => expect(g.id.renderButton).toHaveBeenCalled())
    g.respond({}); await expect(bad).rejects.toMatchObject({ reason: 'denied' })
    const controller = new AbortController()
    const aborted = requestGoogleIdToken(element, 'google-client', 'nonce-value', controller.signal)
    await vi.waitFor(() => expect(g.id.renderButton).toHaveBeenCalledTimes(2))
    controller.abort(); await expect(aborted).rejects.toMatchObject({ reason: 'locked' }); expect(g.id.cancel).toHaveBeenCalled()
    const already = new AbortController(); already.abort()
    await expect(requestGoogleIdToken(element, 'google-client', 'nonce-value', already.signal)).rejects.toMatchObject({ reason: 'locked' })
  })
  it('loads the Google script once and fails closed when it cannot load', async () => {
    const scripts: Array<{ src?: string; onload?: () => void; onerror?: () => void }> = []
    const w: { google?: unknown } = {}
    vi.stubGlobal('window', w)
    vi.stubGlobal('document', { createElement: vi.fn(() => { const s = {}; scripts.push(s); return s }), head: { appendChild: vi.fn() } })
    const failing = requestGoogleIdToken(element, 'c', 'n', new AbortController().signal)
    scripts[0].onerror?.(); await expect(failing).rejects.toMatchObject({ reason: 'unavailable' })
    const loading = requestGoogleIdToken(element, 'c', 'n', new AbortController().signal)
    expect(scripts[1].src).toBe('https://accounts.google.com/gsi/client')
    scripts[1].onload?.(); await expect(loading).rejects.toMatchObject({ reason: 'unavailable' })
  })
})

