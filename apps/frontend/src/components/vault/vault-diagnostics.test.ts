import { describe, expect, it, vi } from 'vitest'
import { createRenderer, createSSRApp, defineComponent, h, nextTick, ssrContextKey, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import VaultDiagnostics from './VaultDiagnostics.vue'
import { VaultClientError } from '../../services/vault-http'
const renderedControls = new Map<string, Record<string, unknown>>()
vi.mock('naive-ui', () => Object.fromEntries(['NAlert', 'NButton', 'NFormItem', 'NInputNumber', 'NSelect', 'NSpace'].map(name => [name,
  defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => { renderedControls.set(name, { ...attrs }); return h(name, attrs, slots.default?.()) } })])))
interface Node { parent: Node | null; children: Node[] }
const node = (): Node => ({ parent: null, children: [] })
const reply = { kind: 'configuration', userId: 2, secretId: 10, user: { exists: true, active: true, deleted: false },
  policy: { reveal: true, copy: false }, grants: { reveal: true, copy: false }, item: { released: true, revoked: false }, acl: true, runtime: 'not-evaluated' }
function mount(post = vi.fn().mockResolvedValue(reply), language = 'pt') {
  const props = { transport: { post }, identity: { userId: 1, tenantId: 7, accessToken: 'a', refreshToken: 'r', origin: 'https://example.test' },
    clientId: 'c', sessionId: 's', users: [{ id: 2, name: 'Target' }], secretId: 10, language, onExpired: vi.fn() }
  const renderer = createRenderer<Node, Node>({ createElement: node, createText: node, createComment: node, setText: () => {}, setElementText: () => {}, patchProp: () => {},
    parentNode: n => n.parent, nextSibling: () => null, insert: (n, p) => { n.parent = p; p.children.push(n) }, remove: () => {} })
  const app = renderer.createApp({ ...(VaultDiagnostics as Component), render: () => null }, props)
  app.provide(ssrContextKey, { modules: new Set() })
  const vm = app.mount(node())
  const state = (vm.$ as unknown as { setupState: { userId: number | null; itemId: number | null; result: unknown; busy: boolean; failure: string | null; run(): Promise<void> } }).setupState
  function control(tag: string): { props: Record<string, unknown> } {
    const props = renderedControls.get(tag); if (!props) throw new Error(`Missing control ${tag}`); return { props }
  }
  return { props, state, control, setProps: (values: Partial<typeof props>) => { Object.assign(props, values); Object.assign(vm.$.props, values) }, unmount: () => app.unmount(), html: () => renderToString(createSSRApp({ ...(VaultDiagnostics as Component), setup: () => state }, props)) }
}
describe('diagnostics component', () => {
  it.each(['pt', 'en'])('shows configuration disclaimer and explicit result in %s', async language => {
    const f = mount(undefined, language)
    expect(f.props.transport.post).not.toHaveBeenCalled()
    f.state.userId = 2; await f.state.run()
    const html = await f.html()
    expect(html).toContain(language === 'pt' ? 'Somente configuração' : 'Configuration only')
    expect(html).toContain(language === 'pt' ? 'Concessão de revelar' : 'Reveal grant')
    expect(html).not.toContain('type="password"'); f.unmount()
  })
  it('rejects selections outside overview and clears previous results on changed target', async () => {
    const f = mount(); f.state.userId = 99; await f.state.run(); expect(f.props.transport.post).not.toHaveBeenCalled()
    f.state.userId = 2; await f.state.run(); expect(f.state.result).not.toBeNull()
    f.state.itemId = 11; expect(f.state.result).toBeNull(); f.unmount()
  })
  it('ignores late success after selection changes and aborts the old request', async () => {
    let resolve!: (value: unknown) => void
    const post = vi.fn(() => new Promise(r => { resolve = r })), f = mount(post)
    f.state.userId = 2; const pending = f.state.run(); await nextTick()
    f.state.itemId = 11
    expect((post.mock.calls[0] as unknown as unknown[])[4]).toMatchObject({ aborted: true })
    resolve(reply); await pending; expect(f.state.result).toBeNull(); f.unmount()
  })
  it('emits expiry for the parent unlock controls without asking for credentials', async () => {
    const f = mount(vi.fn().mockRejectedValue(new VaultClientError('expired')))
    f.state.userId = 2; await f.state.run()
    expect(f.state.failure).toBe('expired'); expect(f.props.onExpired).toHaveBeenCalledOnce(); f.unmount()
  })
  it('shows generic denial without server detail and ignores a failure after unmount', async () => {
    const f = mount(vi.fn().mockRejectedValue(new VaultClientError('denied')))
    f.state.userId = 2; await f.state.run(); expect(f.state.failure).toBe('error'); f.unmount()
    let reject!: (reason: Error) => void
    const late = mount(vi.fn(() => new Promise((_, r) => { reject = r })))
    late.state.userId = 2; const pending = late.state.run(); late.unmount(); reject(new Error('late'))
    await pending; expect(late.state.failure).toBeNull()
  })
})


describe('diagnostics rendered actions and revoked context', () => {
  it('uses selected fields, blocks duplicate checks and restores the button after a sanitized failure', async () => {
    let reject!: (reason: Error) => void
    const post = vi.fn(() => new Promise((_, no) => { reject = no }))
    const f = mount(post, 'en')
    await f.html()
    expect(f.control('NButton').props.disabled).toBe(true)
    ;(f.control('NSelect').props['onUpdate:value'] as (v: number) => void)(2)
    ;(f.control('NInputNumber').props['onUpdate:value'] as (v: number) => void)(10)
    await nextTick(); await f.html()
    expect(f.control('NButton').props.disabled).toBe(false)
    const click = f.control('NButton').props.onClick as () => Promise<void>
    const pending = click(); await nextTick(); await click(); await f.html()
    expect(post).toHaveBeenCalledOnce()
    expect(f.control('NButton').props.disabled).toBe(true)
    expect(await f.html()).toContain('aria-busy="true"')
    reject(new Error('internal private backend detail')); await pending; await nextTick()
    const html = await f.html()
    expect(html).toContain('Diagnosis unavailable for this user and item.')
    expect(html).toContain('role="alert"')
    expect(html).not.toContain('internal private backend detail')
    expect(f.control('NButton').props.disabled).toBe(false)
    expect(f.props.onExpired).not.toHaveBeenCalled(); f.unmount()
  })
  it.each(['pt', 'en'])('removes results and blocks requests when authorized users disappear (%s)', async language => {
    const f = mount(undefined, language)
    f.state.userId = 2; await f.state.run()
    expect(await f.html()).toContain('aria-live="polite"')
    f.setProps({ users: [] }); await nextTick()
    expect(f.state.result).toBeNull()
    await f.state.run(); expect(f.props.transport.post).toHaveBeenCalledOnce()
    const html = await f.html()
    expect(f.control('NButton').props.disabled).toBe(true)
    expect(html).toContain(language === 'en' ? 'No authorized users available.' : 'Nenhum usuário autorizado disponível.')
    expect(html).not.toContain('aria-live="polite"'); f.unmount()
  })
  it.each(['locked', 'login'] as const)('renders expired guidance for %s without a new password prompt', async reason => {
    const f = mount(vi.fn().mockRejectedValue(new VaultClientError(reason)), 'en')
    f.state.userId = 2; await f.state.run()
    expect(await f.html()).toContain('Confirmation expired. Use the existing unlock controls.')
    expect(await f.html()).not.toContain('type="password"')
    expect(f.props.onExpired).toHaveBeenCalledOnce(); f.unmount()
  })
})
