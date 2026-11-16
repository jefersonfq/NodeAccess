import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { createRenderer, nextTick, reactive, ssrContextKey, type Component } from 'vue'
import VaultDeliveryPanel from './VaultDeliveryPanel.vue'
import type { VaultDeliveryDependencies } from '@/services/vault-delivery'
const mocks = vi.hoisted(()=>({ create: vi.fn(), unlock: vi.fn(), deliver: vi.fn(), tick: vi.fn(), dismiss: vi.fn(), lock: vi.fn(), dispose: vi.fn(), confirmCopy: vi.fn() }))
const state=reactive({phase:'locked',value:'',error:null,copied:false})
const auth=reactive({isManagingTenant:false,accessToken:'portal-fixture',refreshToken:'origin-fixture',user:{id:41,tenantId:7,actingTenantId:undefined as number|undefined}})
vi.mock('@/services/vault-delivery',()=>({createVaultDelivery:mocks.create}))
vi.mock('@/stores/auth',()=>({useAuthStore:()=>auth}))
vi.mock('vue-i18n',()=>({useI18n:()=>({t:(key:string)=>key})}))
interface HostNode { parent:HostNode|null; children:HostNode[] }
function node():HostNode {return {parent:null,children:[]}}
interface Panel {
 dialog:boolean; password:string; token:string; itemName:string; busy:boolean; secure:boolean; title:string
 request(action:'reveal'|'copy',id:number,name:string):void;unlock():Promise<void>;close():void;reset():void;visibility():void
}
function mount() {
 const renderer=createRenderer<HostNode,HostNode>({createElement:node,createText:node,createComment:node,setText:()=>{},setElementText:()=>{},patchProp:()=>{},parentNode:n=>n.parent,nextSibling:()=>null,
 insert:(n,p)=>{n.parent=p;p.children.push(n)},remove:n=>{if(n.parent)n.parent.children=n.parent.children.filter(c=>c!==n)}})
 const app=renderer.createApp({...VaultDeliveryPanel as Component,render:()=>null});app.provide(ssrContextKey,{modules:new Set()})
 const vm=app.mount(node());return {panel:(vm.$ as unknown as {setupState:Panel}).setupState,unmount:()=>app.unmount()}
}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r});return {promise,resolve}}
let documentFixture:EventTarget & {visibilityState:string}
beforeEach(()=>{
 vi.useFakeTimers();for(const mock of Object.values(mocks))mock.mockReset()
 Object.assign(state,{phase:'locked',value:'',error:null,copied:false});Object.assign(auth,{isManagingTenant:false,accessToken:'portal-fixture',refreshToken:'origin-fixture'});Object.assign(auth.user,{id:41,tenantId:7,actingTenantId:undefined})
 mocks.lock.mockImplementation(()=>{state.phase='locked';state.value=''});mocks.dismiss.mockImplementation(()=>{state.value='';if(state.phase!=='locked')state.phase='unlocked'})
 mocks.unlock.mockImplementation(()=>{state.phase='unlocked';return Promise.resolve()});mocks.deliver.mockResolvedValue(undefined)
 mocks.create.mockReturnValue({state,unlock:mocks.unlock,deliver:mocks.deliver,tick:mocks.tick,dismiss:mocks.dismiss,lock:mocks.lock,dispose:mocks.dispose,confirmCopy:mocks.confirmCopy})
 vi.stubGlobal('isSecureContext',true);vi.stubGlobal('window',Object.assign(new EventTarget(),{location:{protocol:'https:',origin:'https://vault.example'}}))
 documentFixture=Object.assign(new EventTarget(),{visibilityState:'visible'});vi.stubGlobal('document',documentFixture)
})
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals()})
describe('Vault delivery panel orchestration',()=>{
 it('captures eligible portal identity without assigning vault material to auth',()=>{
  const f=mount(),deps=mocks.create.mock.calls[0][0] as VaultDeliveryDependencies
  expect(deps.identity()).toMatchObject({userId:41,tenantId:7,origin:'https://vault.example'})
  auth.isManagingTenant=true;expect(deps.identity()).toBeNull();auth.isManagingTenant=false;auth.user.actingTenantId=9;expect(deps.identity()).toBeNull()
  auth.user.actingTenantId=undefined;auth.accessToken='';expect(deps.identity()).toBeNull();f.unmount()
 })
 it('requires unlock, clears the form before awaiting, then dispatches the selected intent once',async()=>{
  const f=mount();f.panel.request('copy',9,'safe-label');expect(f.panel.dialog).toBe(true);expect(f.panel.title).toContain('safe-label')
  expect(mocks.deliver).not.toHaveBeenCalled();f.panel.password='typed-password';f.panel.token='123456'
  const wait=deferred();mocks.unlock.mockImplementation(()=>{state.phase='unlocking';return wait.promise})
  const pending=f.panel.unlock();expect(f.panel.password).toBe('');expect(f.panel.token).toBe('');expect(f.panel.busy).toBe(true)
  state.phase='unlocked';wait.resolve();await pending;expect(mocks.deliver).toHaveBeenCalledExactlyOnceWith('copy',9);f.unmount()
 })
 it('dispatches immediately only for an already unlocked session and refuses parallel requests',()=>{
  const f=mount();state.phase='unlocked';f.panel.request('reveal',4,'item');expect(mocks.deliver).toHaveBeenCalledExactlyOnceWith('reveal',4)
  state.phase='delivering';f.panel.request('copy',5,'other');expect(mocks.deliver).toHaveBeenCalledTimes(1);f.unmount()
 })
 it.each(['close','reset','unmount','tenant','origin'] as const)('does not continue a late unlock after %s',async cause=>{
  const f=mount();f.panel.request('reveal',4,'item');const wait=deferred();mocks.unlock.mockReturnValueOnce(wait.promise)
  const pending=f.panel.unlock()
  if(cause==='close')f.panel.close();if(cause==='reset')f.panel.reset();if(cause==='unmount')f.unmount()
  if(cause==='tenant')auth.user.tenantId=8;if(cause==='origin')auth.refreshToken='another-login'
  state.phase='unlocked';wait.resolve();await pending;expect(mocks.deliver).not.toHaveBeenCalled();if(cause!=='unmount')f.unmount()
 })
 it.each(['blur','pagehide','nodeaccess:tenant-context-changed'] as const)('locks on %s and removes its listener on unmount',event=>{
  const f=mount();f.panel.request('reveal',4,'item');f.panel.password='typed-password';window.dispatchEvent(new Event(event))
  expect(f.panel.dialog).toBe(false);expect(f.panel.password).toBe('');expect(mocks.lock).toHaveBeenCalled();f.unmount()
  const calls=mocks.lock.mock.calls.length;window.dispatchEvent(new Event(event));expect(mocks.lock).toHaveBeenCalledTimes(calls)
 })
 it('locks on hidden, checks time on visibility return, and stops its clock on unmount',async()=>{
  const f=mount();documentFixture.visibilityState='hidden';document.dispatchEvent(new Event('visibilitychange'));expect(mocks.lock).toHaveBeenCalled()
  documentFixture.visibilityState='visible';document.dispatchEvent(new Event('visibilitychange'));expect(mocks.tick).toHaveBeenCalled()
  vi.advanceTimersByTime(500);await nextTick();expect(mocks.tick).toHaveBeenCalledTimes(3);f.unmount();vi.advanceTimersByTime(500);expect(mocks.tick).toHaveBeenCalledTimes(3)
 })
 it('does not open a sensitive dialog over HTTP',()=>{
  vi.stubGlobal('isSecureContext',false);const f=mount();expect(f.panel.secure).toBe(false);f.panel.request('reveal',4,'item');expect(f.panel.dialog).toBe(false);expect(mocks.unlock).not.toHaveBeenCalled();f.unmount()
 })
})
