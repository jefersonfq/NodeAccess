import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, createSSRApp, defineComponent, h, nextTick, ssrContextKey, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import UserLoginSessions from './UserLoginSessions.vue'
import type { LoginSession } from '@/services/login-sessions.service'
import { describeUserAgent } from '@/utils/user-agent'

const service = vi.hoisted(() => ({ list: vi.fn(), revoke: vi.fn(), revokeAll: vi.fn(), online: vi.fn() }))
const dialog = vi.hoisted(() => ({ warning: vi.fn() }))
const message = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/services/login-sessions.service', () => ({ loginSessionsService: service }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key), d: () => 'date' }) }))
vi.mock('naive-ui', () => ({ useDialog: () => dialog, useMessage: () => message,
  ...Object.fromEntries(['NAlert', 'NButton', 'NEmpty', 'NSpin', 'NTag', 'NTooltip'].map(name => [name,
    defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => h(name, attrs, [slots.trigger?.(), slots.default?.()]) })])) }))
interface HostNode { parent: HostNode | null; children: HostNode[] }
const node = (): HostNode => ({ parent: null, children: [] })
function mount<S>(component: Component, props: Record<string, unknown>) {
  const renderer = createRenderer<HostNode, HostNode>({ createElement: node, createText: node, createComment: node, setText: () => {}, setElementText: () => {}, patchProp: () => {},
    parentNode: n => n.parent, nextSibling: () => null, insert: (n, p) => { n.parent = p; p.children.push(n) }, remove: n => { if (n.parent) n.parent.children = n.parent.children.filter(c => c !== n) } })
  const app = renderer.createApp({ ...component, render: () => null }, props); app.provide(ssrContextKey, { modules: new Set() })
  const vm = app.mount(node()), state = (vm.$ as unknown as { setupState: S }).setupState
  return { state, unmount: () => app.unmount(), html: () => renderToString(createSSRApp({ ...component, setup: () => state }, props)) }
}
const flush = async (): Promise<void> => { for (let i = 0; i < 6; i++) { await Promise.resolve(); await nextTick() } }
const a = 'a'.repeat(32), b = 'b'.repeat(32)
const sessions: LoginSession[] = [
  { ref: a, authMethod: 'local', ip: '203.0.113.10', lastIp: '198.51.100.7', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36', createdAt: 1, lastSeenAt: 2, current: false },
  { ref: b, authMethod: 'oidc', ip: '192.0.2.1', lastIp: '192.0.2.1', userAgent: null, createdAt: 1, lastSeenAt: 2, current: true },
]
interface View { sessions: LoginSession[]; failed: boolean; confirmRevoke(s: LoginSession): void; confirmRevokeAll(): void; revoke(s: LoginSession): Promise<void>; revokeAll(): Promise<void> }
beforeEach(() => { vi.clearAllMocks(); service.list.mockResolvedValue(sessions); service.revoke.mockResolvedValue({}); service.revokeAll.mockResolvedValue({}) })

describe('NA-0187 login sessions of a user', () => {
  it('lists the sessions with last IP, login IP when different, and no disconnect on the admin\'s own session', async () => {
    const f = mount<View>(UserLoginSessions, { userId: 20, userName: 'Bruno', self: false }); await flush()
    expect(service.list).toHaveBeenCalledWith(20)
    const html = await f.html()
    expect(html).toContain('198.51.100.7'); expect(html).toContain('admin.users.loginSessions.loginIp')
    expect(html).toContain(`user-login-session-revoke-${a}`); expect(html).not.toContain(`user-login-session-revoke-${b}`)
    expect(html).toContain('admin.users.loginSessions.current'); expect(html).toContain('user-login-sessions-revoke-all')
    f.unmount()
  })
  it('asks before disconnecting one session and reloads afterwards', async () => {
    const f = mount<View>(UserLoginSessions, { userId: 20, userName: 'Bruno', self: false }); await flush()
    f.state.confirmRevoke(sessions[0])
    expect(service.revoke).not.toHaveBeenCalled()
    const options = dialog.warning.mock.calls[0][0] as { content: string; onPositiveClick(): void }
    expect(options.content).toContain('198.51.100.7')
    options.onPositiveClick(); await flush()
    expect(service.revoke).toHaveBeenCalledWith(20, a); expect(message.success).toHaveBeenCalled(); expect(service.list).toHaveBeenCalledTimes(2)
    service.revoke.mockRejectedValueOnce(new Error('409')); await f.state.revoke(sessions[0]); expect(message.error).toHaveBeenCalled()
    f.unmount()
  })
  it('disconnects all only after confirmation and hides it for the admin\'s own account', async () => {
    const f = mount<View>(UserLoginSessions, { userId: 20, userName: 'Bruno', self: false }); await flush()
    f.state.confirmRevokeAll(); (dialog.warning.mock.calls[0][0] as { onPositiveClick(): void }).onPositiveClick(); await flush()
    expect(service.revokeAll).toHaveBeenCalledWith(20)
    service.revokeAll.mockRejectedValueOnce(new Error('409')); await f.state.revokeAll(); expect(message.error).toHaveBeenCalled()
    f.unmount()
    const g = mount<View>(UserLoginSessions, { userId: 11, userName: 'Ana', self: true }); await flush()
    expect(await g.html()).not.toContain('user-login-sessions-revoke-all'); g.unmount()
  })
  it('shows an error and an empty state', async () => {
    service.list.mockRejectedValueOnce(new Error('down'))
    const f = mount<View>(UserLoginSessions, { userId: 20, userName: 'Bruno', self: false }); await flush()
    expect(f.state.failed).toBe(true); expect(await f.html()).toContain('admin.users.loginSessions.loadError'); f.unmount()
    service.list.mockResolvedValueOnce([])
    const g = mount<View>(UserLoginSessions, { userId: 20, userName: 'Bruno', self: false }); await flush()
    expect(await g.html()).toContain('admin.users.loginSessions.empty'); g.unmount()
  })
  it('summarizes browsers', () => {
    expect(describeUserAgent(sessions[0].userAgent)).toBe('Chrome · Windows')
    expect(describeUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Version/17 Safari/605')).toBe('Safari · macOS')
    expect(describeUserAgent('Mozilla/5.0 (X11; Linux x86_64) Gecko Firefox/120.0')).toBe('Firefox · Linux')
    expect(describeUserAgent('Edg/120 Chrome/120 (Android 14)')).toBe('Edge · Android')
    expect(describeUserAgent('curl/8.0')).toBe('curl/8.0'); expect(describeUserAgent(null)).toBe('—')
  })
})
