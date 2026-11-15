import { renderToString } from '@vue/server-renderer'
import { proxyRefs, createSSRApp, createRenderer, ssrContextKey, defineComponent, h, nextTick, type Component, type SetupContext } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PemActionHandle, SecretActionHandle } from './action-handles'
import PemKeyActions from './PemKeyActions.vue'
import SecretActions from './SecretActions.vue'
import { pemFixture, secretFixture } from '@/services/vault-catalog.fixtures'
import { pemEntries, secretEntries } from '@/services/vault-catalog'
const mocks = vi.hoisted(() => ({
  auth: { isAdmin: false, user: { id: 41 } },
  error: vi.fn(), warning: vi.fn(), success: vi.fn(), update: vi.fn(), rotate: vi.fn(), revoke: vi.fn(), passphrase: vi.fn(),
  createPem: vi.fn(), createSecret: vi.fn(), consumers: vi.fn(), groups: vi.fn(),
  removePem: vi.fn(), removeSecret: vi.fn(), confirmation: vi.fn(), destroy: vi.fn(),
}))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => mocks.auth }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/services/pem-key.service', () => ({ pemKeyService: { create: mocks.createPem, delete: mocks.removePem, updatePassphrase: mocks.passphrase } }))
vi.mock('@/services/secret.service', () => ({ secretService: { update: mocks.update, rotate: mocks.rotate, revoke: mocks.revoke, create: mocks.createSecret, consumers: mocks.consumers, remove: mocks.removeSecret } }))
vi.mock('@/services/group.service', () => ({ groupService: { list: mocks.groups } }))
vi.mock('naive-ui', () => {
  const names = ['NAlert', 'NButton', 'NEmpty', 'NForm', 'NFormItem', 'NInput', 'NModal', 'NSelect', 'NText']
  return { ...Object.fromEntries(names.map(name => [name, defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => h(name, attrs, slots.default?.()) })])),
    useMessage: () => ({ error: mocks.error, warning: mocks.warning, success: mocks.success }),
    useDialog: () => ({ warning: mocks.confirmation, error: mocks.confirmation }) }
})
interface Element { type: string; props: Record<string, unknown>; children: Element[]; parent: Element | null; text: string }
function element(type: string): Element { return { type, props: {}, children: [], parent: null, text: '' } }
function mount(component: Component, props: Record<string, unknown> = {}) {
  const root = element('root')
  const renderer = createRenderer<Element, Element>({
    createElement: element, createText: text => ({ ...element('text'), text }), createComment: element,
    setText: (node, text) => { node.text = text }, setElementText: (node, text) => { node.text = text },
    parentNode: node => node.parent, nextSibling: () => null,
    patchProp: (node, key, _, value: unknown) => { node.props[key] = value },
    insert: (node, parent) => { node.parent = parent; parent.children.push(node) },
    remove: node => { if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node) },
  })
  const app = renderer.createApp({ ...component, render: () => null }, props); app.config.globalProperties.$t = (key: string) => key
  app.provide(ssrContextKey, { modules: new Set() })
  const vm = app.mount(root)
  const all = (node: Element): Element[] => [node, ...node.children.flatMap(all)]
  return { app, vm, state: vm.$.setupState as unknown as EditorState, find: (type: string) => all(root).filter(node => node.type === type) }
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes }); return { promise, resolve } }
const flush = async () => { await Promise.resolve(); await nextTick(); await Promise.resolve(); await nextTick() }
describe('Vault editors isolation', () => {
  it('destroys confirmations and denies late positive callbacks after unmount', async () => {
    mocks.confirmation.mockReturnValue({ destroy: mocks.destroy })
    for (const kind of ['pem', 'secret']) {
      const fixture = mount(kind === 'pem' ? PemKeyActions : SecretActions, { licensed: true })
      if (kind === 'pem') (fixture.vm as unknown as PemActionHandle).remove(pemEntries([pemFixture])[0].record as Parameters<PemActionHandle['remove']>[0])
      else (fixture.vm as unknown as SecretActionHandle).remove(secretEntries([secretFixture])[0].record as Parameters<SecretActionHandle['remove']>[0])
      const confirmation = mocks.confirmation.mock.lastCall?.[0] as { onPositiveClick: () => Promise<void> }
      fixture.app.unmount(); await confirmation.onPositiveClick()
    }
    expect(mocks.destroy).toHaveBeenCalledTimes(2)
    expect(mocks.removePem).not.toHaveBeenCalled(); expect(mocks.removeSecret).not.toHaveBeenCalled()
  })
  it('does not publish a late consumer response after unmount', async () => {
    const pending = deferred<unknown>(); mocks.consumers.mockReturnValue(pending.promise)
    const fixture = mount(SecretActions, { licensed: true }), api = fixture.vm as unknown as SecretActionHandle
    const record = secretEntries([secretFixture])[0].record as Parameters<SecretActionHandle['openConsumers']>[0]
    const loading = api.openConsumers(record); fixture.app.unmount()
    pending.resolve({ data: { hostCount: 9, snippetCount: 3, hosts: [], snippets: [] } }); await loading; await flush()
    expect(record.usageCount).toBeUndefined()
  })
  it('does not open an unlicensed secret form or query its groups', async () => {
    mocks.groups.mockClear()
    const fixture = mount(SecretActions, { licensed: false }); (fixture.vm as unknown as SecretActionHandle).openCreate(); await nextTick()
    expect(mocks.groups).not.toHaveBeenCalled()
    fixture.app.unmount()
  })
})

interface EditorState {
 form: { alias: string; description: string; value: string; scope: string; groupId: number | null; name: string; key: string; passphrase: string }
 showFormModal: boolean; showModal: boolean; showConsumersModal: boolean; rotateValue: string; passphrase: string
 groupError: boolean; groups: unknown[]; passphraseKey: unknown; rotatingSecret: unknown
 save: () => Promise<void>; rotate: () => Promise<void>; savePassphrase: () => Promise<void>; loadGroups: () => Promise<void>
 readPemKeyFile: (file: File) => Promise<void>; onPemKeyFileSelected: (event: Event) => Promise<void>; onPemKeyFileDrop: (event: DragEvent) => Promise<void>
}
beforeEach(() => {
 vi.resetAllMocks(); mocks.auth.isAdmin = false; mocks.groups.mockResolvedValue({ data: [{ id: 8, name: 'Operations' }] }); mocks.confirmation.mockReturnValue({ destroy: mocks.destroy })
})
const ownedSecret = () => secretEntries([secretFixture])[0].record as Parameters<SecretActionHandle['openEdit']>[0]
const ownedPem = () => pemEntries([pemFixture])[0].record as Parameters<PemActionHandle['openPassphrase']>[0]
const file = (name: string, text: () => Promise<string>): File => ({ name, text }) as File
function secretEditor() { const f = mount(SecretActions, { licensed: true }); return { ...f, api: f.vm as unknown as SecretActionHandle } }
function pemEditor() { const f = mount(PemKeyActions); return { ...f, api: f.vm as unknown as PemActionHandle } }
describe('Secret payloads and lifecycle', () => {
 it('validates drafts and sends normalized group creation without retaining the value', async () => {
  const f = secretEditor(); f.api.openCreate(); await flush()
  await f.state.save(); expect(mocks.warning).toHaveBeenLastCalledWith('secrets.messages.aliasRequired')
  f.state.form.alias = 'bad/alias'; await f.state.save(); expect(mocks.warning).toHaveBeenLastCalledWith('secrets.messages.aliasInvalid')
  f.state.form.alias = ' database root '; await f.state.save(); expect(mocks.warning).toHaveBeenLastCalledWith('secrets.messages.valueRequired')
  f.state.form.value = 'synthetic'; f.state.form.scope = 'GROUP'; await f.state.save(); expect(mocks.warning).toHaveBeenLastCalledWith('secrets.messages.groupRequired'); expect(mocks.createSecret).not.toHaveBeenCalled()
  f.state.form.groupId = 8; f.state.form.description = ' notes '; await f.state.save()
  expect(mocks.createSecret).toHaveBeenCalledWith({ alias: 'database-root', description: 'notes', value: 'synthetic', scope: 'GROUP', groupId: 8, source: 'MANUAL' })
  expect(f.state.form.value).toBe(''); expect(f.state.showFormModal).toBe(false); f.app.unmount()
 })
 it('retains failed drafts, maps alias errors and prevents duplicate create or late publication', async () => {
  const f = secretEditor(); f.api.openCreate(); await flush(); f.state.form.alias = 'db'; f.state.form.value = 'synthetic'
  mocks.createSecret.mockRejectedValueOnce({ response: { data: { message: 'body/alias invalid' } } }); await f.state.save()
  expect(mocks.error).toHaveBeenLastCalledWith('secrets.messages.aliasInvalid'); expect(f.state.form.value).toBe('synthetic')
  mocks.createSecret.mockRejectedValueOnce(new Error('offline')); await f.state.save(); expect(mocks.error).toHaveBeenLastCalledWith('secrets.messages.saveError')
  const pending = deferred<void>(); mocks.createSecret.mockReturnValue(pending.promise); const saving = f.state.save(); await f.state.save(); expect(mocks.createSecret).toHaveBeenCalledTimes(3)
  f.app.unmount(); pending.resolve(); await saving; expect(mocks.success).not.toHaveBeenCalled()
 })
 it('edits only metadata and rejects foreign and revoked records', async () => {
  const f = secretEditor(), record = { ...ownedSecret(), value: 'synthetic-value' }
  f.api.openEdit({ ...record, ownerUserId: 99, createdByUserId: 99 }); expect(f.state.showFormModal).toBe(false)
  f.api.openEdit({ ...record, revokedAt: new Date().toISOString() }); expect(f.state.showFormModal).toBe(false)
  f.api.openEdit(record); await flush()
  expect(record.value).toBe('synthetic-value')
  expect(f.state.form).toEqual({ alias: record.alias, description: record.description ?? '', value: '', scope: record.scope, groupId: record.groupId })
  f.state.form.description = ''; f.state.form.value = 'must-not-send'; await f.state.save()
  expect(mocks.update).toHaveBeenCalledWith(record.id, { alias: record.alias, description: null, scope: record.scope }); expect(mocks.createSecret).not.toHaveBeenCalled(); f.app.unmount()
 })
 it('blocks group writes after lookup failure and supports retry', async () => {
  mocks.groups.mockRejectedValueOnce(new Error('offline')); const f = secretEditor(); f.api.openCreate(); await flush()
  Object.assign(f.state.form, { alias: 'group', value: 'synthetic', scope: 'GROUP', groupId: 8 }); await f.state.save(); expect(mocks.createSecret).not.toHaveBeenCalled(); expect(f.state.groupError).toBe(true)
  await f.state.loadGroups(); await f.state.save(); expect(mocks.createSecret).toHaveBeenCalledTimes(1); f.app.unmount()
 })
 it('validates rotation and handles failed and duplicate submissions', async () => {
  const f = secretEditor(), record = ownedSecret(); f.api.openRotate({ ...record, revokedAt: new Date().toISOString() }); expect(f.state.rotatingSecret).toBeNull()
  f.api.openRotate(record); await f.state.rotate(); expect(mocks.rotate).not.toHaveBeenCalled(); f.state.rotateValue = 'replacement'
  mocks.rotate.mockRejectedValueOnce(new Error('offline')); await f.state.rotate(); expect(f.state.rotateValue).toBe('replacement'); expect(mocks.error).toHaveBeenLastCalledWith('secrets.messages.rotateError')
  const pending = deferred<void>(); mocks.rotate.mockReturnValue(pending.promise); const saving = f.state.rotate(); await f.state.rotate(); expect(mocks.rotate).toHaveBeenCalledTimes(2)
  pending.resolve(); await saving; expect(mocks.rotate).toHaveBeenLastCalledWith(record.id, { value: 'replacement' }); expect(f.state.rotateValue).toBe(''); f.app.unmount()
 })
 it.each(['revoke', 'remove'] as const)('requires ownership and confirmation for %s and handles failure', async action => {
  const f = secretEditor(), record = ownedSecret(), operation = action === 'revoke' ? mocks.revoke : mocks.removeSecret
  f.api[action]({ ...record, ownerUserId: 99, createdByUserId: 99 }); expect(mocks.confirmation).not.toHaveBeenCalled()
  f.api[action](record); expect(operation).not.toHaveBeenCalled(); const confirm = mocks.confirmation.mock.lastCall?.[0] as { onPositiveClick: () => Promise<void> }
  operation.mockRejectedValueOnce(new Error('offline')); await confirm.onPositiveClick(); expect(mocks.error).toHaveBeenCalled()
  await confirm.onPositiveClick(); expect(operation).toHaveBeenLastCalledWith(record.id); expect(mocks.success).toHaveBeenCalled(); f.app.unmount()
 })
 it('ignores superseded consumers and group queries and reports consumer errors', async () => {
  const f = secretEditor(), old = deferred<unknown>(), record = ownedSecret()
  mocks.consumers.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ data: { hostCount: 1, snippetCount: 2 } })
  const first = f.api.openConsumers(record); await f.api.openConsumers(record); old.resolve({ data: { hostCount: 99, snippetCount: 99 } }); await first; expect(record.usageCount).toBe(3)
  mocks.consumers.mockRejectedValueOnce(new Error('offline')); await f.api.openConsumers(record); expect(f.state.showConsumersModal).toBe(false); expect(mocks.error).toHaveBeenLastCalledWith('secrets.consumers.loadError')
  const oldGroups = deferred<unknown>(); mocks.groups.mockReturnValueOnce(oldGroups.promise); const query = f.state.loadGroups(); await f.state.loadGroups(); oldGroups.resolve({ data: [{ id: 99 }] }); await query
  expect(f.state.groups).toEqual([{ id: 8, name: 'Operations' }]); f.app.unmount()
 })
})
describe('PEM payloads and lifecycle', () => {
 it('validates encrypted imports, trims input and clears successful drafts', async () => {
  const f = pemEditor(); f.api.openCreate(); await f.state.save(); expect(mocks.warning).toHaveBeenLastCalledWith('pemKeys.messages.fillRequired')
  f.state.form.name = ' key '; f.state.form.key = '-----BEGIN ENCRYPTED PRIVATE KEY-----\nfixture\n-----END ENCRYPTED PRIVATE KEY-----'
  await f.state.save(); expect(mocks.warning).toHaveBeenLastCalledWith('pemKeys.messages.passphraseRequired')
  f.state.form.passphrase = 'synthetic'; await f.state.save(); expect(mocks.createPem).toHaveBeenCalledWith({ name: 'key', key: '-----BEGIN ENCRYPTED PRIVATE KEY-----\nfixture\n-----END ENCRYPTED PRIVATE KEY-----', passphrase: 'synthetic' })
  expect(f.state.form.key).toBe(''); expect(f.state.form.passphrase).toBe(''); f.app.unmount()
 })
 it('retains rejected imports, prevents double save and suppresses late success', async () => {
  const f = pemEditor(); f.api.openCreate(); f.state.form.name = 'key'; f.state.form.key = 'synthetic'
  mocks.createPem.mockRejectedValueOnce({ response: { data: { message: 'rejected fixture' } } }); await f.state.save(); expect(mocks.error).toHaveBeenLastCalledWith('rejected fixture'); expect(f.state.form.key).toBe('synthetic')
  const pending = deferred<void>(); mocks.createPem.mockReturnValue(pending.promise); const saving = f.state.save(); await f.state.save(); expect(mocks.createPem).toHaveBeenCalledTimes(2)
  f.app.unmount(); pending.resolve(); await saving; expect(mocks.success).not.toHaveBeenCalled()
 })
 it('reads selected and dropped files, keeps chosen names, rejects obsolete reads and reports errors', async () => {
  const f = pemEditor(); f.api.openCreate(); const input = { files: [file('gateway.pem', () => Promise.resolve(' fixture '))], value: 'selected' }
  await f.state.onPemKeyFileSelected({ target: input } as unknown as Event); expect(input.value).toBe(''); expect(f.state.form.name).toBe('gateway'); expect(f.state.form.key).toBe('fixture')
  await f.state.onPemKeyFileDrop({ dataTransfer: { files: [file('other.key', () => Promise.resolve('other'))] } } as unknown as DragEvent); expect(f.state.form.name).toBe('gateway'); expect(f.state.form.key).toBe('other')
  const old = deferred<string>(), reading = f.state.readPemKeyFile(file('old.pem', () => old.promise)); f.state.showModal = false; f.api.openCreate(); old.resolve('old'); await reading; expect(f.state.form.key).toBe('')
  await f.state.readPemKeyFile(file('broken', () => Promise.reject(new Error('offline')))); expect(mocks.error).toHaveBeenLastCalledWith('pemKeys.messages.fileReadError'); f.app.unmount()
 })
 it('enforces passphrase/delete ownership and permits clearing and retry', async () => {
  const f = pemEditor(), record = ownedPem(); f.api.openPassphrase({ ...record, createdById: 99 }); expect(f.state.passphraseKey).toBeNull(); f.api.remove({ ...record, createdById: 99 }); expect(mocks.confirmation).not.toHaveBeenCalled()
  await f.state.savePassphrase(); expect(mocks.passphrase).not.toHaveBeenCalled(); f.api.openPassphrase(record); f.state.passphrase = 'new synthetic'
  mocks.passphrase.mockRejectedValueOnce(new Error('offline')); await f.state.savePassphrase(); expect(f.state.passphraseKey).not.toBeNull()
  f.state.passphrase = ''; await f.state.savePassphrase(); expect(mocks.passphrase).toHaveBeenLastCalledWith(record.id, { passphrase: null }); expect(f.state.passphraseKey).toBeNull()
  f.api.remove(record); const confirm = mocks.confirmation.mock.lastCall?.[0] as { onPositiveClick: () => Promise<void> }
  mocks.removePem.mockRejectedValueOnce(new Error('offline')); await confirm.onPositiveClick(); expect(mocks.error).toHaveBeenCalled(); await confirm.onPositiveClick(); expect(mocks.removePem).toHaveBeenLastCalledWith(record.id); f.app.unmount()
 })
})

describe('Server-rendered editor contracts', () => {
 it.each([true, false])('renders secret controls only when licensed=%s', async licensed => {
  const app = createSSRApp(SecretActions, { licensed }); app.config.globalProperties.$t = (key: string) => key
  const html = await renderToString(app)
  expect(html.includes('secrets.modal.alias')).toBe(licensed)
  expect(mocks.createSecret).not.toHaveBeenCalled(); expect(mocks.groups).not.toHaveBeenCalled()
 })
 it('renders import and passphrase controls without loading private material', async () => {
  const app = createSSRApp(PemKeyActions); app.config.globalProperties.$t = (key: string) => key
  const html = await renderToString(app)
  expect(html).toContain('pemKeys.modal.contentLabel'); expect(html).toContain('type="password"')
  expect(html).not.toContain('BEGIN PRIVATE KEY'); expect(mocks.createPem).not.toHaveBeenCalled()
 })
})

describe('Permission boundaries and asynchronous disposal', () => {
 it('does not dispatch any secret operations without a license or after unmount', async () => {
  const f = mount(SecretActions, { licensed: false }), api = f.vm as unknown as SecretActionHandle, record = ownedSecret()
  for (const run of [() => api.openCreate(), () => api.openEdit(record), () => api.openRotate(record), () => api.openConsumers(record), () => api.revoke(record), () => api.remove(record), () => f.state.save(), () => f.state.rotate()]) await Promise.resolve(run())
  expect(mocks.groups).not.toHaveBeenCalled(); expect(mocks.consumers).not.toHaveBeenCalled(); expect(mocks.confirmation).not.toHaveBeenCalled(); expect(mocks.createSecret).not.toHaveBeenCalled(); expect(mocks.rotate).not.toHaveBeenCalled()
  f.app.unmount()
  const pem = pemEditor(); pem.app.unmount(); pem.api.openCreate(); pem.api.openPassphrase(ownedPem()); pem.api.remove(ownedPem()); await pem.state.save(); await pem.state.savePassphrase()
  expect(mocks.createPem).not.toHaveBeenCalled(); expect(mocks.passphrase).not.toHaveBeenCalled(); expect(mocks.confirmation).not.toHaveBeenCalled()
 })
 it('allows an administrator to manage other owners while revoked secrets cannot rotate or revoke', async () => {
  mocks.auth.isAdmin = true
  const f = secretEditor(), record = { ...ownedSecret(), ownerUserId: 99, createdByUserId: 99 }
  f.api.openEdit(record); expect(f.state.showFormModal).toBe(true)
  f.api.openRotate(record); expect(f.state.rotatingSecret).not.toBeNull()
  f.api.revoke({ ...record, revokedAt: new Date().toISOString() }); expect(mocks.confirmation).not.toHaveBeenCalled()
  f.api.remove(record); expect(mocks.confirmation).toHaveBeenCalledTimes(1)
  const pem = pemEditor(); pem.api.openPassphrase({ ...ownedPem(), createdById: 99 }); expect(pem.state.passphraseKey).not.toBeNull()
  pem.api.remove({ ...ownedPem(), createdById: 99 }); expect(mocks.confirmation).toHaveBeenCalledTimes(2)
  await flush(); f.app.unmount(); pem.app.unmount()
 })
 it.each(['update', 'rotate', 'revoke', 'remove'] as const)('suppresses successful %s completion after editor disposal', async operation => {
  const f = secretEditor(), record = ownedSecret(), pending = deferred<void>()
  const request = operation === 'remove' ? mocks.removeSecret : mocks[operation]
  request.mockReturnValue(pending.promise)
  let saving: Promise<void>
  if (operation === 'update') { f.api.openEdit(record); saving = f.state.save() }
  else if (operation === 'rotate') { f.api.openRotate(record); f.state.rotateValue = 'synthetic'; saving = f.state.rotate() }
  else { f.api[operation](record); saving = (mocks.confirmation.mock.lastCall?.[0] as { onPositiveClick: () => Promise<void> }).onPositiveClick() }
  expect(request).toHaveBeenCalledTimes(1); f.app.unmount(); pending.resolve(); await saving
  expect(mocks.success).not.toHaveBeenCalled(); expect(mocks.error).not.toHaveBeenCalled()
 })
 it('prevents duplicate passphrase submission and suppresses completion after disposal', async () => {
  const f = pemEditor(), pending = deferred<void>(); f.api.openPassphrase(ownedPem()); f.state.passphrase = 'synthetic'; mocks.passphrase.mockReturnValue(pending.promise)
  const saving = f.state.savePassphrase(); await f.state.savePassphrase(); expect(mocks.passphrase).toHaveBeenCalledTimes(1)
  f.app.unmount(); pending.resolve(); await saving; expect(mocks.success).not.toHaveBeenCalled(); expect(f.state.passphrase).toBe('')
 })
 it('does not notify after a pending PEM deletion completes in a disposed editor', async () => {
  const f = pemEditor(), pending = deferred<void>(); f.api.remove(ownedPem()); mocks.removePem.mockReturnValue(pending.promise)
  const saving = (mocks.confirmation.mock.lastCall?.[0] as { onPositiveClick: () => Promise<void> }).onPositiveClick()
  f.app.unmount(); pending.resolve(); await saving; expect(mocks.success).not.toHaveBeenCalled()
 })
})

async function renderScenario(component: Component, state: Record<string, unknown>): Promise<string> {
 const original = component as unknown as { setup: (props: Record<string, unknown>, context: SetupContext) => Record<string, unknown> }
 const configured = { ...component, setup(props: Record<string, unknown>, context: SetupContext) {
  const bindings = original.setup(props, context)
  Object.assign(proxyRefs(bindings), state)
  return bindings
 } }
 const app = createSSRApp(configured, { licensed: true }); app.config.globalProperties.$t = (key: string) => key
 return renderToString(app)
}
describe('Rendered operation states', () => {
 it('renders impacted hosts and snippets distinctly and does not show the empty-state claim', async () => {
  const html = await renderScenario(SecretActions, { showConsumersModal: true, consumersSecret: ownedSecret(), consumers: { hostCount: 1, snippetCount: 1, hosts: [{ id: 1, name: 'Demo bastion', sshUser: 'operator' }], snippets: [{ id: 2, name: 'Demo snippet' }] } })
  expect(html).toContain('Demo bastion'); expect(html).toContain('operator'); expect(html).toContain('Demo snippet')
  expect(html).not.toContain('secrets.consumers.empty')
 })
 it('shows loading separately from empty consumers', async () => {
  const loading = await renderScenario(SecretActions, { showConsumersModal: true, consumersLoading: true })
  expect(loading).toContain('common.loading'); expect(loading).not.toContain('secrets.consumers.empty')
  const empty = await renderScenario(SecretActions, { showConsumersModal: true, consumers: { hostCount: 0, snippetCount: 0, hosts: [], snippets: [] } })
  expect(empty).toContain('secrets.consumers.empty'); expect(empty).not.toContain('common.loading')
 })
 it('shows group lookup recovery and edit/rotation without rendering existing secret values', async () => {
  const html = await renderScenario(SecretActions, { showFormModal: true, editingSecret: ownedSecret(), groupError: true, groups: [{ id: 8, name: 'Operations' }], showRotateModal: true, rotatingSecret: ownedSecret(), form: { alias: 'edited', description: '', value: '', scope: 'GROUP', groupId: 8 } })
  expect(html).toContain('vault.groupsError'); expect(html).toContain('vault.retry'); expect(html).toContain('secrets.modal.editTitle')
  expect(html).not.toContain('secrets.modal.valuePlaceholder')
 })
 it('warns on encrypted import and names the selected passphrase target', async () => {
  const html = await renderScenario(PemKeyActions, { showModal: true, form: { name: 'encrypted', key: '-----BEGIN ENCRYPTED PRIVATE KEY-----', passphrase: '' }, passphraseKey: ownedPem(), pemKeyDragOver: true })
  expect(html).toContain('pemKeys.modal.encryptedDetected'); expect(html).toContain('pemKeys.modal.passphraseRequiredLabel'); expect(html).toContain('pemKeys.passphraseModal.title')
 })
})
