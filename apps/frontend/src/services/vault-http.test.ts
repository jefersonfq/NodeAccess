import { describe, it, expect, vi } from 'vitest'
import { createVaultTransport } from './vault-http'
const identity={userId:1,tenantId:2,origin:'https://vault.example',accessToken:'synthetic-access',refreshToken:'synthetic-refresh'}
describe('Isolated vault HTTP adapter',()=>{
  it.each([[401,'login'],[403,'denied'],[409,'expired'],[423,'locked'],[429,'quota'],[503,'unavailable']] as const)('handles %s locally without retry',async(status,reason)=>{
    const fetcher=vi.fn(()=>Promise.resolve(new Response('private error material',{status})))
    await expect(createVaultTransport(fetcher).post('operations/consume',{},identity,'client')).rejects.toMatchObject({message:reason,reason})
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('uses the captured bearer, no ambient cookies, no caching or redirects',async()=>{
    const fetcher=vi.fn(()=>Promise.resolve(new Response('{"state":"LOCKED"}')))
    await expect(createVaultTransport(fetcher).post('sessions/lock',{},identity,'client')).resolves.toEqual({state:'LOCKED'})
    const init=vi.mocked(fetcher).mock.calls as unknown as Array<[string, RequestInit]>
    expect(init[0][0]).toBe('/api/v1/vault-security/sessions/lock')
    expect(init[0][1]).toMatchObject({method:'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'})
    expect(init[0][1].headers).toMatchObject({Authorization:'Bearer synthetic-access','x-vault-client':'client'})
  })
  it.each(['not-json', 'x'.repeat(32769)])('sanitizes malformed or oversized responses',async response=>{
    await expect(createVaultTransport(vi.fn(()=>Promise.resolve(new Response(response)))).post('clients',{},identity)).rejects.toMatchObject({reason:'unavailable'})
  })
  it('bounds chunked body reads in bytes and cancels the stream before accepting more data', async()=>{
    const cancel=vi.fn();let reads=0
    const stream=new ReadableStream<Uint8Array>({pull(controller){reads++;controller.enqueue(new Uint8Array(16384))},cancel})
    const fetcher=vi.fn(()=>Promise.resolve(new Response(stream)))
    await expect(createVaultTransport(fetcher).post('operations/consume',{},identity)).rejects.toMatchObject({reason:'unavailable'})
    expect(cancel).toHaveBeenCalledTimes(1);expect(reads).toBeLessThanOrEqual(4)
  })
  it('cancels the single in-flight fetch, without trying again',async()=>{
    const controller=new AbortController()
    const fetcher=vi.fn((_url: string | URL | Request, init?: RequestInit)=>new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new Error('private diagnostic')))))
    const promise=createVaultTransport(fetcher).post('operations/consume',{},identity,'client',controller.signal)
    controller.abort(); await expect(promise).rejects.toMatchObject({reason:'unavailable'}); expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
