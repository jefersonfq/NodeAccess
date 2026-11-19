import { describe, expect, it, vi } from 'vitest'
import { forwardVaultStepUpReturn, isVaultStepUpState, openVaultProviderWindow, type ProviderWindowDependencies } from './vault-provider-confirm'

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
