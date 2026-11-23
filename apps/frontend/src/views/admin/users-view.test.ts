import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, createSSRApp, defineComponent, h, nextTick, reactive, ssrContextKey, type Component, type VNode } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { UserPublic } from '@nodeaccess/shared'
import UsersView from './UsersView.vue'

const mocks = vi.hoisted(() => ({
  users: { list: vi.fn(), get: vi.fn(), listInventoryAccess: vi.fn(), create: vi.fn(), update: vi.fn(), activate: vi.fn(), deactivate: vi.fn(),
    delete: vi.fn(), restore: vi.fn(), resetPassword: vi.fn(), resetMfa: vi.fn() },
  groups: { list: vi.fn() }, platform: { promoteUser: vi.fn() }, push: vi.fn(), vaultManager: vi.fn(), online: vi.fn(), handlers: [] as Array<Record<string, unknown>>,
  dialog: { warning: vi.fn(), info: vi.fn() }, message: { success: vi.fn(), error: vi.fn() },
}))
const auth = reactive({ isPlatformAdmin: true, user: { id: 1, tenantId: 7 } })
vi.mock('@/services/user.service', () => ({ userService: mocks.users }))
vi.mock('@/services/group.service', () => ({ groupService: mocks.groups }))
vi.mock('@/services/platform-admin.service', () => ({ platformAdminService: mocks.platform }))
vi.mock('@/services/vault-manager', () => ({ vaultAdministrationStatus: mocks.vaultManager }))
vi.mock('@/services/vault-http', () => ({ createVaultTransport: () => ({}) }))
vi.mock('@/services/login-sessions.service', () => ({ loginSessionsService: { online: mocks.online } }))
vi.mock('@/components/users/UserLoginSessions.vue', () => ({ default: defineComponent({ render: () => null }) }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => auth }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key) }) }))
vi.mock('@/components/vault/VaultAdministration.vue', () => ({ default: defineComponent({ render: () => null }) }))
vi.mock('@/components/SkeletonTable.vue', () => ({ default: defineComponent({ render: () => null }) }))
vi.mock('@/components/SessionSupervisionPermission.vue', () => ({ default: defineComponent({ render: () => null }) }))
vi.mock('@/components/UserAvatar.vue', () => ({ default: defineComponent({ render: () => null }) }))
vi.mock('naive-ui', () => ({ useMessage: () => mocks.message, useDialog: () => mocks.dialog,
  ...Object.fromEntries(['NDataTable', 'NButton', 'NSpace', 'NTag', 'NInput', 'NAlert', 'NSpin', 'NModal', 'NForm', 'NFormItem', 'NSelect', 'NSwitch',
    'NTransfer', 'NCheckbox', 'NDrawer', 'NDrawerContent', 'NEmpty', 'NTooltip', 'NDropdown'].map(name => [name,
    defineComponent({ name, inheritAttrs: false, setup: (_, { attrs, slots }) => { mocks.handlers.push(attrs); return () => h('div', Object.values(slots).map(slot => slot?.())) } })])) }))

interface HostNode { parent: HostNode | null; children: HostNode[] }
const node = (): HostNode => ({ parent: null, children: [] })
function mount<S>(component: Component) {
  const renderer = createRenderer<HostNode, HostNode>({ createElement: node, createText: node, createComment: node, setText: () => {}, setElementText: () => {}, patchProp: () => {},
    parentNode: n => n.parent, nextSibling: () => null, insert: (n, p) => { n.parent = p; p.children.push(n) }, remove: n => { if (n.parent) n.parent.children = n.parent.children.filter(c => c !== n) } })
  const app = renderer.createApp(component); app.provide(ssrContextKey, { modules: new Set() })
  app.config.globalProperties.$t = (key: string): string => key
  const vm = app.mount(node()), state = (vm.$ as unknown as { setupState: S }).setupState
  const html = (): Promise<string> => {
    const ssr = createSSRApp({ ...component, setup: () => state }); ssr.config.globalProperties.$t = (key: string): string => key
    return renderToString(ssr)
  }
  return { state, html, unmount: () => app.unmount() }
}
const flush = async (): Promise<void> => { for (let i = 0; i < 8; i++) { await Promise.resolve(); await nextTick() } }
const user = (patch: Partial<UserPublic> = {}): UserPublic => ({ id: 2, name: 'Bruno', email: 'bruno@example.test', role: 'admin', active: true, deletedAt: null,
  isPlatformAdmin: false, canManageHosts: true, canViewLiveSessions: false, groupIds: [3], ...patch } as unknown as UserPublic)
type Column = { key: string; render?: (row: UserPublic) => VNode }
type Option = { key: string; label?: unknown }
interface View {
  users: UserPublic[]; vaultManager: boolean; vaultUser: UserPublic | null; vaultReview: boolean; vaultPending: number; vaultManagers: number[]; closeVault(): void; sessionsUser: UserPublic | null; onlineUsers: Map<number, number>; loadOnline(): Promise<void>; error: string | null; tempPassword: string | null
  showCreateModal: boolean; showEditModal: boolean; editingId: number | null; accessDrawerUser: UserPublic | null; accessError: string
  createForm: { password?: string }; copyGroupsFromCreateUserId: number | null; copyGroupsFromEditUserId: number | null; editForm: { groupIds: number[] }
  columns: Column[]; userActionOptions(u: UserPublic): Option[]; handleUserAction(a: string, u: UserPublic): unknown
  openCreate(): void; createUser(): Promise<void>; openEdit(u: UserPublic): Promise<void>; saveEdit(): Promise<void>; copyGroups(t: 'create' | 'edit'): Promise<void>
  closeAccessDrawer(): void; load(): Promise<void>; restoreUser(u: UserPublic): Promise<void>; toggleActive(u: UserPublic, a: boolean): Promise<void>
}
const positive = async (): Promise<void> => { const o = mocks.dialog.warning.mock.calls.at(-1)![0] as { onPositiveClick(): Promise<void> }; await o.onPositiveClick() }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.users.list.mockResolvedValue({ data: { data: [user()], total: 1 } })
  mocks.groups.list.mockResolvedValue({ data: [{ id: 3, name: 'Ops' }] })
  mocks.users.get.mockResolvedValue({ data: user({ groupIds: [3, 4] }) })
  mocks.vaultManager.mockResolvedValue({ manager: true, pending: 0, managers: [1] })
  mocks.online.mockResolvedValue([{ userId: 2, sessions: 2, lastSeenAt: 1 }])
  for (const fn of ['create', 'update', 'activate', 'deactivate', 'delete', 'restore', 'resetMfa', 'listInventoryAccess'] as const) mocks.users[fn].mockResolvedValue({ data: [] })
  mocks.users.resetPassword.mockResolvedValue({ data: { temporaryPassword: 'temp-fixture' } })
  mocks.platform.promoteUser.mockResolvedValue({ data: { temporaryPassword: 'temp-fixture' } })
})

describe('Users view (NA-0186)', () => {
  it('loads users, groups and the vault manager status; offers "Vault permissions" only to managers', async () => {
    const f = mount<View>(UsersView); await flush()
    expect(f.state.users).toHaveLength(1); expect(mocks.vaultManager).toHaveBeenCalled()
    const keys = (u: UserPublic) => f.state.userActionOptions(u).map(o => o.key)
    expect(keys(user())).toContain('vault'); expect(keys(user())).toContain('promote-superadmin')
    expect(keys(user({ active: false }))).not.toContain('vault')
    expect(keys(user({ deletedAt: new Date() }))).toEqual(['restore'])
    f.state.handleUserAction('vault', user()); expect(f.state.vaultUser?.id).toBe(2)
    // NA-0188: an admin who is not a vault manager sees the action disabled, with the reason in its label.
    f.state.vaultManager = false; f.state.vaultUser = null
    const option = f.state.userActionOptions(user()).find(o => o.key === 'vault') as Option & { disabled?: boolean }
    expect(option.disabled).toBe(true); expect(option.label).toBe('admin.users.actions.vaultManagersOnly')
    f.state.handleUserAction('vault', user()); expect(f.state.vaultUser).toBeNull()
    const danger = f.state.userActionOptions(user()).find(o => o.key === 'delete')!.label as () => VNode
    expect(danger().props?.class).toBe('user-action-danger')
    f.unmount()
  })
  it('renders every column for active, inactive and deleted users', async () => {
    const f = mount<View>(UsersView); await flush()
    for (const row of [user(), user({ active: false, role: 'user', canViewLiveSessions: true, groupIds: [] }), user({ deletedAt: new Date() })]) {
      for (const column of f.state.columns) if (column.render) expect(column.render(row)).toBeTruthy()
    }
    const actions = f.state.columns.find(c => c.key === 'actions')!.render!(user())
    ;(actions.props as { onSelect(key: string): void }).onSelect('vault'); expect(f.state.vaultUser?.id).toBe(2)
    f.unmount()
  })
  it('routes each action to its handler', async () => {
    const f = mount<View>(UsersView); await flush()
    f.state.handleUserAction('dashboard', user()); expect(mocks.push).toHaveBeenCalledWith({ name: 'admin-dashboard-user', params: { userId: 2 } })
    await f.state.handleUserAction('access', user()); expect(f.state.accessDrawerUser?.id).toBe(2); f.state.closeAccessDrawer(); expect(f.state.accessDrawerUser).toBeNull()
    mocks.users.listInventoryAccess.mockRejectedValueOnce(new Error('x')); await f.state.handleUserAction('access', user()); expect(f.state.accessError).toBe('admin.users.access.loadError')
    await f.state.handleUserAction('edit', user()); expect(f.state.editForm.groupIds).toEqual([3, 4])
    await f.state.handleUserAction('activate', user()); expect(mocks.users.activate).toHaveBeenCalledWith(2)
    await f.state.handleUserAction('deactivate', user()); expect(mocks.users.deactivate).toHaveBeenCalledWith(2)
    mocks.users.activate.mockRejectedValueOnce(new Error('x')); await f.state.toggleActive(user(), true); expect(mocks.message.error).toHaveBeenCalled()
    f.state.handleUserAction('reset-password', user()); await positive(); expect(mocks.dialog.info).toHaveBeenCalled()
    mocks.users.resetPassword.mockRejectedValueOnce(new Error('x')); f.state.handleUserAction('reset-password', user()); await positive()
    f.state.handleUserAction('reset-mfa', user()); await positive(); expect(mocks.users.resetMfa).toHaveBeenCalledWith(2)
    mocks.users.resetMfa.mockRejectedValueOnce({ response: { data: { message: 'no' } } }); f.state.handleUserAction('reset-mfa', user()); await positive()
    f.state.handleUserAction('promote-superadmin', user()); await positive(); expect(mocks.platform.promoteUser).toHaveBeenCalledWith(2)
    mocks.platform.promoteUser.mockRejectedValueOnce(new Error('x')); f.state.handleUserAction('promote-superadmin', user()); await positive()
    f.state.handleUserAction('delete', user()); await positive(); expect(mocks.users.delete).toHaveBeenCalledWith(2)
    mocks.users.delete.mockRejectedValueOnce(new Error('x')); f.state.handleUserAction('delete', user()); await positive()
    await f.state.handleUserAction('restore', user()); expect(mocks.users.restore).toHaveBeenCalledWith(2)
    mocks.users.restore.mockRejectedValueOnce(new Error('x')); await f.state.restoreUser(user())
    f.unmount()
  })
  it('creates, edits and copies groups, with error paths', async () => {
    const f = mount<View>(UsersView); await flush()
    f.state.openCreate(); expect(f.state.showCreateModal).toBe(true)
    mocks.users.create.mockResolvedValueOnce({ data: { temporaryPassword: 'temp-fixture' } }); await f.state.createUser(); expect(f.state.tempPassword).toBe('temp-fixture')
    mocks.users.create.mockResolvedValueOnce({ data: {} }); await f.state.createUser(); expect(f.state.showCreateModal).toBe(false)
    mocks.users.create.mockRejectedValueOnce(new Error('x')); await f.state.createUser()
    await f.state.copyGroups('create'); expect(mocks.users.get).not.toHaveBeenCalled()
    f.state.copyGroupsFromCreateUserId = 2; await f.state.copyGroups('create')
    await f.state.openEdit(user()); f.state.copyGroupsFromEditUserId = 2; await f.state.copyGroups('edit'); expect(f.state.editForm.groupIds).toEqual([3, 4])
    mocks.users.get.mockRejectedValueOnce(new Error('x')); await f.state.copyGroups('edit')
    await f.state.saveEdit(); expect(mocks.users.update).toHaveBeenCalled()
    mocks.users.update.mockRejectedValueOnce(new Error('x')); await f.state.saveEdit()
    f.state.editingId = null; await f.state.saveEdit(); expect(mocks.users.update).toHaveBeenCalledTimes(2)
    mocks.users.list.mockRejectedValueOnce(new Error('x')); await f.state.load(); expect(f.state.error).toBe('admin.users.messages.loadError')
    f.unmount()
  })
  it('renders the modals and drawers with their content', async () => {
    mocks.users.listInventoryAccess.mockResolvedValue({ data: [{ aclEntryId: 1, inventoryNodeId: 1, inventoryNodeName: 'web', inventoryNodeType: 'HOST', principalType: 'USER',
      principalId: 2, principalName: 'Bruno', hostCount: 1, permissions: { view: true, connect: true, edit: false, admin: true } }] })
    const f = mount<View>(UsersView); await flush()
    f.state.openCreate(); f.state.tempPassword = 'temp-fixture'
    await f.state.openEdit(user())
    await f.state.handleUserAction('access', user())
    f.state.handleUserAction('vault', user())
    await flush()
    expect(f.state.showEditModal).toBe(true); expect(f.state.vaultUser?.id).toBe(2)
    expect(await f.html()).toContain('admin.users.vaultModal.hint')
    // Every template event handler (v-model updates, clicks) runs once without breaking the view.
    mocks.handlers.length = 0; await f.html()
    for (const attrs of [...mocks.handlers]) for (const [key, handler] of Object.entries(attrs)) {
      if (!/^on[A-Z]|^onUpdate:/.test(key) || typeof handler !== 'function') continue
      const value = key === 'onUpdate:show' ? false : key === 'onUpdate:checked' ? true : key === 'onUpdate:value' ? 'x' : undefined
      // A few handlers expect real component payloads (e.g. table events); those may throw on the synthetic value.
      try { (handler as (v: unknown) => unknown)(value) } catch { /* synthetic payload */ }
    }
    await flush()
    expect(f.state.showCreateModal).toBe(false); expect(f.state.vaultUser).toBeNull()
    f.state.users = []; f.state.tempPassword = null; f.state.accessDrawerUser = null; f.state.accessError = 'x'
    expect(await f.html()).toContain('admin.users.title')
    f.unmount()
  })
  it('keeps working when groups or the vault check fail', async () => {
    mocks.groups.list.mockRejectedValueOnce(new Error('x')); mocks.vaultManager.mockResolvedValueOnce({ manager: false, pending: 0, managers: [] })
    const f = mount<View>(UsersView); await flush()
    expect(f.state.vaultManager).toBe(false); expect(f.state.users).toHaveLength(1)
    f.unmount()
  })
  it('NA-0188: an unknown vault status (no vault, HTTP, error) shows no vault action; a failed poll keeps the last state', async () => {
    mocks.vaultManager.mockResolvedValueOnce(null)
    const f = mount<View>(UsersView); await flush()
    expect(f.state.userActionOptions(user()).map(o => o.key)).not.toContain('vault')
    mocks.vaultManager.mockResolvedValueOnce({ manager: true, pending: 1, managers: [1] }); f.state.closeVault(); await flush()
    expect(f.state.userActionOptions(user()).map(o => o.key)).toContain('vault')
    mocks.vaultManager.mockResolvedValueOnce(null); f.state.closeVault(); await flush()
    expect(f.state.vaultManager).toBe(true); expect(f.state.vaultPending).toBe(1)
    f.unmount()
  })
  it('NA-0187: marks online users and opens the login sessions of one user', async () => {
    const f = mount<View>(UsersView); await flush()
    expect(f.state.onlineUsers.get(2)).toBe(2)
    const name = f.state.columns.find(c => c.key === 'name')!.render!(user())
    expect(JSON.stringify(name.children)).toContain('user-online-2')
    expect(f.state.userActionOptions(user()).map(o => o.key)).toContain('login-sessions')
    f.state.handleUserAction('login-sessions', user()); expect(f.state.sessionsUser?.id).toBe(2)
    mocks.handlers.length = 0; await f.html()
    expect(mocks.handlers.some(a => String(a.title).startsWith('admin.users.loginSessions.title'))).toBe(true)
    mocks.online.mockRejectedValueOnce(new Error('x')); await f.state.loadOnline(); expect(f.state.onlineUsers.size).toBe(0)
    f.unmount()
  })
  it('NA-0188: tags vault managers, announces pending vault changes and refreshes the count every minute', async () => {
    vi.useFakeTimers()
    try {
      mocks.vaultManager.mockResolvedValue({ manager: true, pending: 2, managers: [1, 2] })
      const f = mount<View>(UsersView); await flush()
      expect(f.state.vaultPending).toBe(2); expect(f.state.vaultManagers).toEqual([1, 2])
      const name = f.state.columns.find(c => c.key === 'name')!.render!(user())
      expect(JSON.stringify(name.children)).toContain('user-vault-manager-2')
      const testIds = async (): Promise<unknown[]> => { mocks.handlers.length = 0; await f.html(); return mocks.handlers.map(a => a['data-testid']) }
      expect(await testIds()).toEqual(expect.arrayContaining(['users-vault-pending', 'users-vault-review']))
      const review = mocks.handlers.find(a => a['data-testid'] === 'users-vault-review') as { onClick(): void }
      review.onClick(); expect(f.state.vaultReview).toBe(true)
      mocks.handlers.length = 0; await f.html()
      expect(mocks.handlers.some(a => a.title === 'admin.users.vaultModal.reviewTitle')).toBe(true)
      // No refresh while the vault window is open; closing it re-reads the status.
      const calls = mocks.vaultManager.mock.calls.length
      await vi.advanceTimersByTimeAsync(60_000); expect(mocks.vaultManager.mock.calls.length).toBe(calls)
      mocks.vaultManager.mockResolvedValue({ manager: true, pending: 0, managers: [1, 2] })
      f.state.closeVault(); await flush()
      expect(f.state.vaultReview).toBe(false); expect(f.state.vaultPending).toBe(0)
      await vi.advanceTimersByTimeAsync(60_000); expect(mocks.vaultManager.mock.calls.length).toBe(calls + 2)
      expect(await testIds()).not.toContain('users-vault-pending')
      f.unmount()
      await vi.advanceTimersByTimeAsync(120_000); expect(mocks.vaultManager.mock.calls.length).toBe(calls + 2)
    } finally { vi.useRealTimers() }
  })
})
