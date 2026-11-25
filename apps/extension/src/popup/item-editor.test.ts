import { describe, expect, it, vi } from 'vitest'
import { createRenderer, createSSRApp, ssrContextKey, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import ItemEditor from './ItemEditor.vue'
import { ExtensionError } from '../core/client'
import { generatePassword } from '../core/password'

interface Host { parent: Host | null; children: Host[] }
const node = (): Host => ({ parent: null, children: [] })
interface State {
  form: { reportValidity(): boolean; querySelector(selector: string): { focus(): void } | null } | null
  scope: 'PERSONAL' | 'GROUP' | 'TENANT'; groupId: number | undefined; name: string; description: string; value: string; key: string; passphrase: string; busy: boolean; reading: boolean; error: string
  save(): Promise<void>; close(): void; generate(): void; fileChanged(event: Event): Promise<void>
}
function mount(mode = 'create-secret', language = 'pt-BR', options: Record<string, unknown> = {}) {
  const renderer = createRenderer<Host, Host>({ createElement: node, createText: node, createComment: node, setText: () => {}, setElementText: () => {}, patchProp: () => {},
    parentNode: n => n.parent, nextSibling: () => null, insert: (n, p) => { n.parent = p; p.children.push(n) }, remove: () => {} })
  const write = vi.fn().mockResolvedValue({ id: 8 }), saved = vi.fn(), close = vi.fn(), expired = vi.fn()
  const props = { client: { write }, language, mode,
    item: { kind: 'secret', sourceId: 8, label: 'mine', description: 'desc', scope: 'personal', portalPath: '/vault' }, ...options, onSaved: saved, onClose: close, onExpired: expired }
  const app = renderer.createApp({ ...(ItemEditor as Component), render: () => null }, props)
  app.provide(ssrContextKey, { modules: new Set() })
  const vm = app.mount(node()), state = (vm.$ as unknown as { setupState: State }).setupState
  return { state, write, saved, close, expired, html: () => renderToString(createSSRApp({ ...(ItemEditor as Component), setup: () => state }, props)), unmount: () => app.unmount() }
}
describe('E3 item editor', () => {
  it('requires an explicit group and sends shared scope without sharing PEM', async () => {
    const h = mount(); h.state.value = 'new'; h.state.scope = 'GROUP'
    await h.state.save(); expect(h.write).not.toHaveBeenCalled()
    h.state.groupId = 12; h.state.value = 'new'; await h.state.save()
    expect(h.write).toHaveBeenCalledWith({ operation: 'create-secret', scope: 'GROUP', groupId: 12, alias: 'mine', description: 'desc', value: 'new' })
    h.unmount()
    const pem = mount('import-pem'); pem.state.scope = 'GROUP'; pem.state.key = 'pem'; await pem.state.save()
    expect(pem.write).toHaveBeenCalledWith({ operation: 'import-pem', name: 'mine', key: 'pem' }); pem.unmount()
  })
  it('creates, clears values, blocks duplicate submits and discards on unmount', async () => {
    const h = mount(); h.state.value = 'new'
    let resolve!: () => void
    h.write.mockImplementationOnce(() => new Promise<void>(r => { resolve = r }))
    const pending = h.state.save(); await h.state.save(); h.state.close()
    expect(h.write).toHaveBeenCalledTimes(1); expect(h.close).not.toHaveBeenCalled()
    resolve(); await pending
    expect(h.write).toHaveBeenCalledWith({ operation: 'create-secret', scope: 'PERSONAL', alias: 'mine', description: 'desc', value: 'new' })
    expect(h.state.value).toBe(''); expect(h.saved).toHaveBeenCalledOnce()
    h.state.key = 'material'; h.unmount(); expect(h.state.key).toBe('')
  })
  it('sends metadata without a value, and replacement only as a separate explicit operation', async () => {
    const h = mount('update-secret'); h.state.description = ''; await h.state.save()
    expect(h.write).toHaveBeenCalledWith({ operation: 'update-secret', scope: 'PERSONAL', id: 8, alias: 'mine', description: null }); h.unmount()
    const r = mount('rotate-secret'); r.state.generate(); expect(r.state.value).toHaveLength(24)
    const generated = r.state.value
    await r.state.save(); expect(r.write).toHaveBeenCalledWith({ operation: 'rotate-secret', scope: 'PERSONAL', id: 8, value: generated }); r.unmount()
  })
  it('imports with and without passphrase and clears sensitive fields on cancellation', async () => {
    const h = mount('import-pem')
    h.state.key = 'pem'; h.state.passphrase = 'pass'; await h.state.save()
    expect(h.write).toHaveBeenLastCalledWith({ operation: 'import-pem', name: 'mine', key: 'pem', passphrase: 'pass' })
    h.state.key = 'pem'; await h.state.save()
    expect(h.write).toHaveBeenLastCalledWith({ operation: 'import-pem', name: 'mine', key: 'pem' })
    h.state.key = 'pending'; h.state.close(); expect(h.state.key).toBe(''); expect(h.close).toHaveBeenCalledOnce(); h.unmount()
  })
  it('clears material on errors, signals expired sessions and ignores late responses after close', async () => {
    for (const failure of [new ExtensionError('expired'), new ExtensionError('writeConflict'), new Error('sensitive-marker')]) {
      const h = mount('create-secret', 'en'); h.state.value = 'new'; h.write.mockRejectedValueOnce(failure)
      await h.state.save(); expect(h.state.value).toBe(''); expect(h.state.error).not.toContain('sensitive-marker')
      expect(h.expired).toHaveBeenCalledTimes(failure instanceof ExtensionError && failure.reason === 'expired' ? 1 : 0); h.unmount()
    }
    const h = mount(); h.state.value = 'new'; let resolve!: () => void
    h.write.mockImplementationOnce(() => new Promise<void>(r => { resolve = r }))
    const pending = h.state.save(); h.unmount(); resolve(); await pending; expect(h.saved).not.toHaveBeenCalled()
  })
  it('does not save the previous PEM while reading another file or accept a stale read', async () => {
    const h = mount('import-pem'); h.state.key = 'previous'
    let first!: (text: string) => void, second!: (text: string) => void
    const event = (text: () => Promise<string>, size = 10) => ({ target: { files: [{ size, text }], value: 'file' } }) as unknown as Event
    const a = h.state.fileChanged(event(() => new Promise(r => { first = r })))
    expect(h.state.key).toBe(''); await h.state.save(); expect(h.write).not.toHaveBeenCalled()
    const b = h.state.fileChanged(event(() => new Promise(r => { second = r })))
    second('latest'); await b; first('stale'); await a; expect(h.state.key).toBe('latest')
    await h.state.fileChanged(event(() => Promise.resolve('too-large'), 65536)); expect(h.state.key).toBe(''); expect(h.state.error).toBeTruthy()
    await h.state.fileChanged(event(() => Promise.reject(new Error('failed')))); expect(h.state.reading).toBe(false)
    h.unmount()
  })
  it('uses Web Crypto with all 64 unbiased symbols', () => {
    const random = vi.spyOn(crypto, 'getRandomValues').mockImplementationOnce(array => { (array as Uint8Array).fill(255); return array })
    expect(generatePassword()).toBe('_'.repeat(24)); expect(random).toHaveBeenCalledOnce(); random.mockRestore()
  })
  it('keeps locally entered material when metadata is invalid, then saves after correction', async () => {
    const h = mount(); h.state.name = 'invalid alias'; h.state.value = 'new'
    await h.state.save()
    expect(h.write).not.toHaveBeenCalled(); expect(h.state.value).toBe('new')
    expect(h.state.error).toBeTruthy(); expect(h.state.busy).toBe(false)
    h.state.name = 'valid-alias'; await h.state.save()
    expect(h.write).toHaveBeenCalledOnce(); expect(h.state.value).toBe(''); h.unmount()
    const p = mount('import-pem'); p.state.name = ''; p.state.key = 'pem'; p.state.passphrase = 'pass'
    await p.state.save(); expect(p.write).not.toHaveBeenCalled()
    expect(p.state.key).toBe('pem'); expect(p.state.passphrase).toBe('pass')
    p.unmount(); expect(p.state.key).toBe(''); expect(p.state.passphrase).toBe('')
  })
})

describe('editor permissions and recovery visible to the user', () => {
  it.each(['pt-BR', 'en'])('shows personal create fields, only granted scopes and no current value (%s)', async language => {
    const h = mount('create-secret', language, { item: undefined })
    const html = await h.html()
    expect(html).toContain('id="item-name"'); expect(html).toContain('id="item-description"'); expect(html).toContain('type="password"')
    expect(html).toContain('value="PERSONAL"'); expect(html).not.toContain('value="GROUP"'); expect(html).not.toContain('value="TENANT"')
    expect(html).not.toContain('id="item-key"'); expect(h.state.name).toBe(''); expect(h.state.value).toBe('')
    h.unmount()
  })
  it('offers only the authorized groups and preserves the existing group reference on rotation', async () => {
    const h = mount('create-secret', 'en', { writeAccess: { groups: [{ id: 12, name: 'Allowed team' }], tenant: true } })
    h.state.scope = 'GROUP'; let html = await h.html()
    expect(html).toContain('Allowed team'); expect(html).toContain('value="TENANT"'); expect(html).not.toContain('Hidden team')
    h.state.groupId = 12; h.state.value = 'new-value'; await h.state.save()
    expect(h.write).toHaveBeenCalledWith(expect.objectContaining({ scope: 'GROUP', groupId: 12 })); h.unmount()
    const r = mount('rotate-secret', 'pt-BR', { item: { kind: 'secret', sourceId: 9, label: 'shared', scope: 'shared', writeScope: 'GROUP', groupId: 27, portalPath: '/vault' } })
    html = await r.html()
    expect(html).toContain('Grupo atual (#27)'); expect(html).toMatch(/id="item-scope"[^>]*disabled/); expect(html).toMatch(/id="item-group"[^>]*disabled/)
    expect(html).not.toContain('id="item-name"'); expect(html).not.toContain('id="item-description"')
    r.state.value = 'replacement'; await r.state.save(); expect(r.write).toHaveBeenCalledWith({ operation: 'rotate-secret', scope: 'GROUP', groupId: 27, id: 9, value: 'replacement' }); r.unmount()
  })
  it('keeps PEM personal even when tenant write access is available', async () => {
    const h = mount('import-pem', 'en', { writeAccess: { groups: [{ id: 12, name: 'Ops' }], tenant: true } })
    const html = await h.html()
    expect(html).toContain('Import personal PEM'); expect(html).toContain('id="item-file"'); expect(html).toContain('id="item-passphrase"')
    expect(html).not.toContain('id="item-scope"'); expect(html).not.toContain('id="item-description"'); expect(html).not.toContain('id="item-value"')
    h.state.key = 'private-material'; h.state.passphrase = 'pass'; h.state.close()
    expect(h.state.key).toBe(''); expect(h.state.passphrase).toBe(''); expect(h.write).not.toHaveBeenCalled(); h.unmount()
  })
  it('uses native validation without sending or erasing input, then focuses invalid schema metadata', async () => {
    const h = mount(); h.state.value = 'entered-secret'
    const focus = vi.fn(), querySelector = vi.fn().mockReturnValue({ focus })
    h.state.form = { reportValidity: () => false, querySelector }
    await h.state.save(); expect(h.write).not.toHaveBeenCalled(); expect(h.state.value).toBe('entered-secret'); expect(h.state.busy).toBe(false)
    h.state.form.reportValidity = () => true; h.state.description = 'x'.repeat(501)
    await h.state.save(); expect(querySelector).toHaveBeenCalledWith('#item-description'); expect(focus).toHaveBeenCalledOnce()
    expect(h.state.value).toBe('entered-secret'); expect(h.write).not.toHaveBeenCalled()
    h.state.description = 'corrected'; await h.state.save(); expect(h.saved).toHaveBeenCalledOnce(); h.unmount()
  })
  it('shows the pending save and generated value status, then clears material after success', async () => {
    const h = mount('create-secret', 'en'); h.state.generate()
    expect(await h.html()).toContain('Password generated. Save to apply.')
    let finish!: () => void; h.write.mockImplementationOnce(() => new Promise<void>(done => { finish = done }))
    const save = h.state.save(); const html = await h.html()
    expect(html).toContain('aria-busy="true"'); expect(html).toMatch(/<fieldset\s[^>]*disabled(?:\s|>)/); expect(html).toContain('Saving…')
    finish(); await save; expect(h.state.value).toBe(''); expect(await h.html()).not.toContain('Password generated. Save to apply.'); h.unmount()
  })
  it.each(['denied', 'expired', 'writeConflict', 'writeInvalid', 'unavailable'] as const)('reports %s without retaining material or raw server details', async reason => {
    const h = mount('import-pem', 'en'); h.state.key = 'private-material'; h.state.passphrase = 'private-pass'
    h.write.mockRejectedValueOnce(new ExtensionError(reason)); await h.state.save()
    const html = await h.html(); expect(html).toContain('role="alert"'); expect(html).not.toContain('private-material'); expect(html).not.toContain('private-pass')
    expect(h.saved).not.toHaveBeenCalled(); expect(h.expired).toHaveBeenCalledTimes(['denied', 'expired'].includes(reason) ? 1 : 0)
    expect(h.state.name).toBe('mine'); expect(h.state.busy).toBe(false); h.unmount()
  })
  it('cancelling the file picker invalidates an older read, and a closed editor ignores late errors', async () => {
    const h = mount('import-pem'); let finish!: (text: string) => void
    const event = { target: { files: [{ size: 10, text: () => new Promise<string>(done => { finish = done }) }], value: 'path' } } as unknown as Event
    const reading = h.state.fileChanged(event)
    await h.state.fileChanged({ target: { files: [], value: '' } } as unknown as Event)
    finish('old-key'); await reading; expect(h.state.key).toBe(''); expect(h.state.reading).toBe(false)
    h.state.key = 'new-key'; let reject!: (error: Error) => void
    h.write.mockImplementationOnce(() => new Promise((_, no) => { reject = no }))
    const saving = h.state.save(); h.unmount(); reject(new ExtensionError('expired')); await saving
    expect(h.expired).not.toHaveBeenCalled(); expect(h.saved).not.toHaveBeenCalled(); expect(h.state.key).toBe('')
  })
})
