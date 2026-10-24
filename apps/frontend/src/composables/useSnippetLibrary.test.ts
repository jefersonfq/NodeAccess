import {describe,it,expect,vi} from 'vitest'
import {reactive,effectScope,nextTick} from 'vue'
import {useSnippetLibrary} from './useSnippetLibrary'
const auth=reactive({user:{id:100,tenantId:1}})
vi.mock('@/stores/auth',()=>({useAuthStore:()=>auth}))
describe('scoped snippet preferences',()=>{
  it('keeps favorites and recents isolated by tenant/user',async()=>{
    const memory=new Map<string,string>()
    vi.stubGlobal('localStorage',{getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>memory.set(key,value)})
    const scope=effectScope()
    const lib=scope.run(()=>useSnippetLibrary())!
    lib.toggle(12);lib.record(12)
    expect(lib.data.value.favorites).toEqual([12])
    auth.user={id:100,tenantId:2};await nextTick()
    expect(lib.data.value.favorites).toEqual([])
    expect(lib.data.value.recent).toEqual({})
    auth.user={id:101,tenantId:1};await nextTick()
    expect(lib.data.value.favorites).toEqual([])
    auth.user={id:100,tenantId:1};await nextTick()
    expect(lib.data.value.favorites).toEqual([12])
    lib.toggle(12);expect(lib.data.value.favorites).toEqual([])
    scope.stop();vi.unstubAllGlobals()
  })
  it('continues in memory when storage is unavailable',()=>{
    auth.user={id:102,tenantId:1}
    vi.stubGlobal('localStorage',{getItem:()=>{throw Error('disabled')},setItem:()=>{throw Error('disabled')}})
    const scope=effectScope(),lib=scope.run(()=>useSnippetLibrary())!
    expect(()=>{lib.toggle(5);lib.record(5)}).not.toThrow()
    expect(lib.data.value.favorites).toEqual([5]);scope.stop();vi.unstubAllGlobals()
  })
})
