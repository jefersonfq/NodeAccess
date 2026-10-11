import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useManualStore } from './manual'
const mocks=vi.hoisted(()=>({get:vi.fn(),patch:vi.fn(),auth:null as any}))
vi.mock('@/services/api',()=>({default:{get:mocks.get,patch:mocks.patch}}))
vi.mock('./auth',()=>({useAuthStore:()=>mocks.auth}))
let store:ReturnType<typeof useManualStore>
const flush=async()=>{await Promise.resolve();await Promise.resolve()}
beforeEach(()=>{vi.resetAllMocks();mocks.auth=reactive({user:{id:1,tenantId:7}});setActivePinia(createPinia());mocks.get.mockResolvedValue({data:{enabled:false}})})
afterEach(()=>{store?.$dispose()})
it('defaults to disabled until a valid enabled response',async()=>{
 store=useManualStore();expect(store.enabled).toBe(false);await flush();expect(store.enabled).toBe(false)
 mocks.get.mockResolvedValue({data:{enabled:true}});await store.load();expect(store.enabled).toBe(true)
})
it('keeps the previous setting when saving fails',async()=>{
 store=useManualStore();await flush();mocks.patch.mockRejectedValue(new Error('offline'))
 await expect(store.save(true)).rejects.toThrow('offline');expect(store.enabled).toBe(false)
})
it('clears availability when reading fails and recovers on retry',async()=>{
 store=useManualStore();await flush();mocks.get.mockRejectedValue(new Error('offline'));await store.load()
 expect(store.failed).toBe(true);expect(store.enabled).toBe(false)
 mocks.get.mockResolvedValue({data:{enabled:true}});await store.load();expect(store.failed).toBe(false);expect(store.enabled).toBe(true)
})
it('ignores a slow enabled response from a previous tenant',async()=>{
 let resolveOld!:(value:any)=>void
 mocks.get.mockReturnValueOnce(new Promise(resolve=>{resolveOld=resolve}))
 store=useManualStore();mocks.auth.user.tenantId=8;await flush();expect(store.enabled).toBe(false)
 resolveOld({data:{enabled:true}});await flush();expect(store.enabled).toBe(false)
})
it('does not apply a save response to a different tenant',async()=>{
 store=useManualStore();await flush();let finish!:(value:any)=>void
 mocks.patch.mockReturnValueOnce(new Promise(resolve=>{finish=resolve}))
 const saving=store.save(true);mocks.auth.user.tenantId=8;await flush();finish({data:{enabled:true}});await saving
 expect(store.enabled).toBe(false)
})
it('keeps a successful save when an older read finishes later',async()=>{
 let finish!:(value:any)=>void;mocks.get.mockReturnValueOnce(new Promise(resolve=>{finish=resolve}))
 store=useManualStore();mocks.patch.mockResolvedValue({data:{enabled:true}});await store.save(true)
 finish({data:{enabled:false}});await flush();expect(store.enabled).toBe(true)
})
it('clears the manual immediately on logout without requesting anonymous settings',async()=>{
 mocks.get.mockResolvedValue({data:{enabled:true}});store=useManualStore();await flush();expect(store.enabled).toBe(true)
 mocks.auth.user=null;expect(store.enabled).toBe(false);expect(store.loading).toBe(false);expect(mocks.get).toHaveBeenCalledTimes(1)
})
it('reconciles the actual setting if the server commits but the response is lost',async()=>{
 store=useManualStore();await flush()
 mocks.patch.mockRejectedValue(new Error('response lost'))
 mocks.get.mockResolvedValue({data:{enabled:true}})
 await expect(store.save(true)).rejects.toThrow('response lost')
 expect(store.enabled).toBe(true)
})
