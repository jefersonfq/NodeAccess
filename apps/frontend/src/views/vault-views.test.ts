import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, createSSRApp, defineComponent, h, nextTick, reactive, ssrContextKey, type Component, type VNodeChild } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { SecretPublic, PemKeyPublic } from '@nodeaccess/shared'
import type { SecretActionHandle, PemActionHandle } from '@/components/vault/action-handles'
import type { VaultEntry } from '@/services/vault-catalog'
import { secretEntries, pemEntries } from '@/services/vault-catalog'
import { secretFixture, pemFixture } from '@/services/vault-catalog.fixtures'
import VaultView from './VaultView.vue'
import SecretsView from './SecretsView.vue'
import PemKeysView from './PemKeysView.vue'
const mocks = vi.hoisted(() => ({ features: vi.fn(), secrets: vi.fn(), pem: vi.fn(), groups: vi.fn() }))
const auth = reactive({ isAdmin: false, user: { id: 41, tenantId: 7, actingTenantId: undefined as number | undefined, canManageHosts: true } })
vi.mock('@/stores/auth', () => ({ useAuthStore: () => auth }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string, values?: { name?: string; id?: number }) => key === 'vault.pemOwnerNamed' ? `${key}:${values?.name} (#${values?.id})` : key }) }))
vi.mock('@/services/features.service', () => ({ FEATURES_UPDATED_EVENT: 'features-updated', featuresService: { get: mocks.features } }))
vi.mock('@/services/secret.service', () => ({ secretService: { list: mocks.secrets } }))
vi.mock('@/services/pem-key.service', () => ({ pemKeyService: { list: mocks.pem } }))
vi.mock('@/services/group.service', () => ({ groupService: { list: mocks.groups } }))
vi.mock('@/components/vault/SecretActions.vue', () => ({ default: defineComponent({ render: () => null }) }))
vi.mock('@/components/vault/PemKeyActions.vue', () => ({ default: defineComponent({ render: () => null }) }))
vi.mock('@/components/vault/ExtensionDevices.vue', () => ({ default: defineComponent({ render: () => null }) }))
vi.mock('@/components/vault/ExtensionInstall.vue', () => ({ default: defineComponent({ render: () => null }) }))
vi.mock('@/components/vault/VaultAdministration.vue', () => ({ default: defineComponent({ render: () => null }) }))
const route = reactive({ query: {} })
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ replace: vi.fn() }) }))
vi.mock('naive-ui', () => ({ ...Object.fromEntries(['NAlert','NButton','NDropdown','NEmpty','NInput','NSelect','NTag','NText','NSpace'].map(name => [name, defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => h(name, attrs, slots.default?.()) })])),
 NModal: defineComponent({ props: ['show'], setup: (props, { slots }) => () => props.show ? slots.default?.() : null }),
 NDataTable: defineComponent({ props: ['data','columns'], setup: props => () => h('table', (props.data as unknown[]).map(row => h('tr', (props.columns as Column[]).map(col => h('td', col.render?.(row)))))) }) }))
interface Column { key: string; render?: (row: unknown) => VNodeChild }
interface HostNode { parent: HostNode | null; children: HostNode[] }
function node(): HostNode { return { parent: null, children: [] } }
function mount<S>(component: Component) {
 const renderer = createRenderer<HostNode, HostNode>({ createElement: node, createText: node, createComment: node, setText: () => {}, setElementText: () => {}, patchProp: () => {}, parentNode: n => n.parent, nextSibling: () => null,
 insert: (n,p) => { n.parent=p; p.children.push(n) }, remove: n => { if(n.parent) n.parent.children=n.parent.children.filter(c => c!==n) } })
 const app=renderer.createApp({ ...component, render: () => null }); app.provide(ssrContextKey,{ modules:new Set() })
 const vm=app.mount(node()); const setupState=(vm.$ as unknown as { setupState: Record<string, unknown> }).setupState; const state=setupState as unknown as S
 return { state, unmount: () => app.unmount(), html: async () => {
  const ssr=createSSRApp({ ...component, setup: () => setupState }); ssr.config.globalProperties.$t=(key: string) => key
  return renderToString(ssr)
 } }
}
async function flush() { for(let i=0;i<8;i++){ await Promise.resolve(); await nextTick() } }
function deferred<T>() { let resolve!: (v:T)=>void;let reject!: (v:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject} }
const secrets=()=>secretEntries([secretFixture]).map(e=>e.record) as SecretPublic[]
const keys=()=>pemEntries([pemFixture]).map(e=>e.record) as PemKeyPublic[]
function handles() { return { openCreate: vi.fn(), openEdit: vi.fn(), openRotate: vi.fn(), openConsumers: vi.fn().mockResolvedValue(undefined), revoke: vi.fn(), remove: vi.fn(), openPassphrase: vi.fn() } }
interface VaultState {
 search:string; kind:'all'|'secret'|'pem'; includeRevoked:boolean; filtered:VaultEntry[]; partialError:boolean; typeOptions:unknown[]; columns:Column[];
 secretActions:SecretActionHandle|null; pemActions:PemActionHandle|null; reload:()=>Promise<void>;act:(e:VaultEntry,a:string)=>void;
 actionOptions:(e:VaultEntry)=>Array<{key:string;disabled?:boolean;label:string}>
}
interface SecretState { secrets:SecretPublic[]; groups:Array<{id:number;name:string}>; search:string; includeRevoked:boolean; filteredSecrets:SecretPublic[]; error:string|null; secretsLicensed:boolean; loading:boolean; columns:Column[]; actions:SecretActionHandle|null;
 load:()=>Promise<void>; openCreate:()=>void; openEdit:(s:SecretPublic)=>void; openRotate:(s:SecretPublic)=>void; openConsumers:(s:SecretPublic)=>void; revoke:(s:SecretPublic)=>void; remove:(s:SecretPublic)=>void; canManageSecret:(s:SecretPublic)=>boolean }
interface PemState { keys:PemKeyPublic[]; loading:boolean; error:string|null; columns:Column[]; actions:PemActionHandle|null;load:()=>Promise<void>;openCreate:()=>void;openPassphrase:(k:PemKeyPublic)=>void;remove:(k:PemKeyPublic)=>void }
beforeEach(()=>{
 for(const mock of Object.values(mocks))mock.mockReset()
 auth.isAdmin=false;Object.assign(auth.user,{id:41,tenantId:7,actingTenantId:undefined,canManageHosts:true})
 mocks.features.mockResolvedValue({secretsLicensed:true});mocks.secrets.mockResolvedValue({data:secrets()});mocks.pem.mockResolvedValue({data:keys()});mocks.groups.mockResolvedValue({data:[{id:8,name:'Ops'}]})
 vi.stubGlobal('window',new EventTarget())
})
afterEach(()=>vi.unstubAllGlobals())
describe('Unified vault presentation and context',()=>{
 it('renders both types with their own status and actions, filters without exposing values',async()=>{
  const f=mount<VaultState>(VaultView);await flush();const s=f.state
  expect(s.filtered.map(e=>e.kind)).toEqual(['secret','pem']);expect(s.typeOptions).toHaveLength(3)
  let html=await f.html();expect(html).toContain('database');expect(html).toContain('gateway');expect(html).toContain('vault.withPassphrase');expect(html).toContain('secrets.status.active')
  s.search='no-match';expect(s.filtered).toEqual([]);s.search='';s.kind='pem';expect(s.filtered).toHaveLength(1);s.kind='all'
  const action=handles();s.secretActions=action;s.pemActions=action
  for(const value of ['consumers','edit','rotate','revoke','delete'])s.act(s.filtered[0],value)
  expect(action.openConsumers).toHaveBeenCalledWith(s.filtered[0].record);expect(action.openEdit).toHaveBeenCalled();expect(action.openRotate).toHaveBeenCalled();expect(action.revoke).toHaveBeenCalled();expect(action.remove).toHaveBeenCalledTimes(1)
  s.act(s.filtered[1],'passphrase');s.act(s.filtered[1],'delete');expect(action.openPassphrase).toHaveBeenCalled();expect(action.remove).toHaveBeenCalledTimes(2)
  const other=secretEntries([{...secretFixture,ownerUserId:99,createdByUserId:99}])[0];s.act(other,'delete');expect(action.remove).toHaveBeenCalledTimes(2)
  const revoked=secretEntries([{...secretFixture,revokedAt:secretFixture.createdAt,scope:'GROUP',groupId:8,description:null}])[0]
  expect(s.actionOptions(revoked).filter(o=>o.disabled).map(o=>o.key)).toEqual(['edit','rotate','revoke'])
  expect(s.actionOptions(pemEntries([{...pemFixture,hasPassphrase:false}])[0])[0].label).toBe('pemKeys.addPassphrase')
  mocks.secrets.mockResolvedValue({data:[revoked.record]});mocks.pem.mockResolvedValue({data:[{...pemFixture,hasPassphrase:false}]});await s.reload()
  html=await f.html();expect(html).toContain('secrets.status.revoked');expect(html).toContain('#8');expect(html).toContain('vault.withoutPassphrase')
  f.unmount()
 })
 it('shows only the item opened from the extension until the filter is cleared (NA-0183)',async()=>{
  route.query={kind:'pem',id:String(pemFixture.id)}
  const f=mount<VaultState>(VaultView);await flush()
  expect(f.state.filtered.map(e=>e.key)).toEqual([`pem:${pemFixture.id}`])
  route.query={kind:'secret',id:'abc'};expect(f.state.filtered).toHaveLength(2)
  route.query={};f.unmount()
 })
 it('shows the PEM owner supplied by the authorized listing and falls back to the ID label',async()=>{
  mocks.pem.mockResolvedValue({data:[{...pemFixture,createdByName:'actual-owner'}]})
  const f=mount<VaultState>(VaultView);await flush()
  expect(await f.html()).toContain('vault.pemOwnerNamed:actual-owner (#41)')
  mocks.pem.mockResolvedValue({data:[{...pemFixture,createdByName:undefined}]});await f.state.reload()
  const html=await f.html();expect(html).toContain('vault.pemOwner');expect(html).not.toContain('actual-owner');f.unmount()
 })
 it('closes licensing on feature errors while retaining authorized PEM and reacts to feature events',async()=>{
  const f=mount<VaultState>(VaultView);await flush();mocks.features.mockRejectedValueOnce(new Error('license unavailable'))
  window.dispatchEvent(new Event('features-updated'));await flush()
  expect(f.state.partialError).toBe(true);expect(f.state.filtered.map(e=>e.kind)).toEqual(['pem']);expect(await f.html()).toContain('vault.secretError')
  mocks.features.mockResolvedValue({secretsLicensed:false});await f.state.reload();expect(await f.html()).toContain('secrets.license.description')
  const before=mocks.features.mock.calls.length;f.unmount();window.dispatchEvent(new Event('features-updated'));await flush();expect(mocks.features).toHaveBeenCalledTimes(before)
 })
 it('resets selection and requests on tenant/permission change and reports PEM errors separately',async()=>{
  const f=mount<VaultState>(VaultView);await flush();f.state.search='old';f.state.kind='pem';f.state.includeRevoked=true
  auth.user.tenantId=8;auth.user.canManageHosts=false;await flush();expect(f.state.search).toBe('');expect(f.state.kind).toBe('all');expect(f.state.includeRevoked).toBe(false);expect(f.state.filtered.map(e=>e.kind)).toEqual(['secret'])
  auth.isAdmin=true;mocks.pem.mockRejectedValueOnce(new Error('offline'));await flush();expect(f.state.partialError).toBe(true);expect(await f.html()).toContain('vault.pemError')
  f.unmount()
 })
})
describe('Legacy vault routes',()=>{
 it('keeps Secret metadata, ownership and delegated operations',async()=>{
  const f=mount<SecretState>(SecretsView);await flush();const s=f.state
  expect(s.secretsLicensed).toBe(true);expect(await f.html()).toContain('database')
  s.search='prod';expect(s.filteredSecrets).toHaveLength(1);s.search='absent';expect(s.filteredSecrets).toEqual([]);s.search=''
  const action=handles();s.actions=action;const row=s.secrets[0];s.openCreate();s.openEdit(row);s.openRotate(row);s.openConsumers(row);s.revoke(row);s.remove(row)
  for(const key of ['openCreate','openEdit','openRotate','openConsumers','revoke','remove'] as const)expect(action[key]).toHaveBeenCalledTimes(1)
  expect(s.canManageSecret({...row,scope:'GROUP',ownerUserId:null,createdByUserId:41})).toBe(true)
  expect(s.canManageSecret({...row,scope:'TENANT',ownerUserId:null,createdByUserId:99})).toBe(false)
  s.secrets=[{...row,scope:'GROUP',groupId:8,rotatedAt:new Date(),revokedAt:new Date(),createdByUsername:null,description:null},{...row,id:2,scope:'TENANT',groupId:999,usageCount:2}]
  let html=await f.html();expect(html).toContain('Ops');expect(html).toContain('secrets.status.revoked');expect(html).toContain('secrets.noDescription')
  s.groups=[];html=await f.html();expect(html).toContain('secrets.groupUnknown');auth.isAdmin=true;expect(s.canManageSecret({...row,ownerUserId:null})).toBe(true)
  f.unmount()
 })
 it('fails closed before data dispatch, resets identity, discards stale success/error and removes listeners',async()=>{
  const f=mount<SecretState>(SecretsView);await flush();const s=f.state
  const pending=deferred<{secretsLicensed:boolean}>();mocks.features.mockReturnValueOnce(pending.promise)
  const old=s.load();auth.user.tenantId=8;await flush();pending.resolve({secretsLicensed:true});await old
  expect(s.secrets).toHaveLength(1)
  const oldRows=deferred<{data:SecretPublic[]}>();mocks.secrets.mockReturnValueOnce(oldRows.promise);const request=s.load();await flush();await s.load();oldRows.resolve({data:[]});await request;expect(s.secrets).toHaveLength(1)
  const failed=deferred<unknown>();mocks.secrets.mockReturnValueOnce(failed.promise);const stale=s.load();await flush();await s.load();failed.reject(new Error('old'));await stale;expect(s.error).toBeNull()
  mocks.features.mockResolvedValue({secretsLicensed:false});await s.load();expect(s.secrets).toEqual([]);expect(s.secretsLicensed).toBe(false)
  mocks.features.mockRejectedValueOnce(new Error('offline'));window.dispatchEvent(new Event('features-updated'));await flush();expect(s.error).toBe('secrets.messages.loadError')
  const before=mocks.features.mock.calls.length;f.unmount();window.dispatchEvent(new Event('features-updated'));await flush();expect(mocks.features).toHaveBeenCalledTimes(before)
 })
 it('does not publish PEM results after context change or unmount and retains action payloads',async()=>{
  const f=mount<PemState>(PemKeysView);await flush();const s=f.state,action=handles();s.actions=action
  s.openCreate();s.openPassphrase(s.keys[0]);s.remove(s.keys[0]);expect(action.openCreate).toHaveBeenCalled();expect(action.openPassphrase).toHaveBeenCalledWith(s.keys[0]);expect(action.remove).toHaveBeenCalledWith(s.keys[0])
  expect(await f.html()).toContain('pemKeys.changePassphrase');s.keys=[{...s.keys[0],hasPassphrase:false}];expect(await f.html()).toContain('pemKeys.addPassphrase')
  const pending=deferred<{data:PemKeyPublic[]}>();mocks.pem.mockReturnValueOnce(pending.promise);const old=s.load();auth.user.tenantId=8;await flush();pending.resolve({data:[]});await old;expect(s.keys).toHaveLength(1)
  mocks.pem.mockRejectedValueOnce(new Error('offline'));await s.load();expect(s.error).toBe('pemKeys.messages.saveError')
  const late=deferred<unknown>();mocks.pem.mockReturnValueOnce(late.promise);const last=s.load();f.unmount();late.reject(new Error('late'));await last
  expect(s.keys).toEqual([])
 })
})
