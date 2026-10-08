import { AxiosError } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isLocalAuditExportRecoveryRequest, isPublicAuthRequest } from './api-auth-classification'
const mocks=vi.hoisted(()=>({watch:vi.fn(),auth:{accessToken:'test-token',refresh:vi.fn(),isManagingTenant:false}}))
vi.mock('@/stores/auth',()=>({useAuthStore:()=>mocks.auth}))
vi.mock('@/services/auth-session.service',()=>({handleExpiredSession:vi.fn()}))
vi.mock('@/services/backend-recovery.service',()=>({isTransientBackendError:()=>true,watchBackendRecovery:mocks.watch}))
import api from './api'

describe('audit TXT local failure recovery',()=>{
  beforeEach(()=>mocks.watch.mockClear())
  it.each(['/session-audit/42/transcript','/session-audit/42/transcript?format=commands','/session-audit/42/transcript?format=technical'])('keeps %s authenticated without scheduling a global reload on 503',async url=>{
    expect(isPublicAuthRequest({url})).toBe(false)
    expect(isLocalAuditExportRecoveryRequest({url})).toBe(true)
    await expect(api.get(url,{adapter:config=>{
      expect(config.headers.Authorization).toBe('Bearer test-token')
      return Promise.reject(new AxiosError('Busy','ERR_BAD_RESPONSE',config,undefined,{status:503,statusText:'Busy',headers:{},config,data:{}}))
    }})).rejects.toMatchObject({response:{status:503}})
    expect(mocks.watch).not.toHaveBeenCalled()
  })
  it('preserves existing global recovery for unrelated requests',async()=>{
    expect(isLocalAuditExportRecoveryRequest({url:'/hosts'})).toBe(false)
    await expect(api.get('/hosts',{adapter:config=>Promise.reject(new AxiosError('Offline','ERR_BAD_RESPONSE',config,undefined,{status:503,statusText:'Offline',headers:{},config,data:{}}))})).rejects.toBeInstanceOf(AxiosError)
    expect(mocks.watch).toHaveBeenCalledOnce()
  })
})
