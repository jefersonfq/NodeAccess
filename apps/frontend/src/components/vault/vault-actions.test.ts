import { createRenderer, ssrContextKey, defineComponent, h, nextTick, type Component } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { PemActionHandle, SecretActionHandle } from './action-handles'
import PemKeyActions from './PemKeyActions.vue'
import SecretActions from './SecretActions.vue'
import { pemFixture, secretFixture } from '@/services/vault-catalog.fixtures'
import { pemEntries, secretEntries } from '@/services/vault-catalog'
const mocks = vi.hoisted(() => ({
  createPem: vi.fn(), createSecret: vi.fn(), consumers: vi.fn(), groups: vi.fn(),
  removePem: vi.fn(), removeSecret: vi.fn(), confirmation: vi.fn(), destroy: vi.fn(),
}))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ isAdmin: false, user: { id: 41 } }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/services/pem-key.service', () => ({ pemKeyService: { create: mocks.createPem, delete: mocks.removePem } }))
vi.mock('@/services/secret.service', () => ({ secretService: { create: mocks.createSecret, consumers: mocks.consumers, remove: mocks.removeSecret } }))
vi.mock('@/services/group.service', () => ({ groupService: { list: mocks.groups } }))
vi.mock('naive-ui', () => {
  const names = ['NAlert', 'NButton', 'NEmpty', 'NForm', 'NFormItem', 'NInput', 'NModal', 'NSelect', 'NText']
  return { ...Object.fromEntries(names.map(name => [name, defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => h(name, attrs, slots.default?.()) })])),
    useMessage: () => ({ error: vi.fn(), warning: vi.fn(), success: vi.fn() }),
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
  return { app, vm, find: (type: string) => all(root).filter(node => node.type === type) }
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
