import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { tlsService, type TlsStatus, type TlsAuditEvent } from '@/services/tls.service'
export function useTlsManagement() {
  const {t}=useI18n(),auth=useAuthStore()
  const status=ref<TlsStatus|null>(null),loading=ref(false),submitting=ref(false),error=ref(''),errorCode=ref(''),recoveryMessage=ref('')
  const audit=ref<TlsAuditEvent[]>([]),auditError=ref('')
  const storageKey='nodeaccess:tls:pending:'+auth.user?.id
  let pending:string|null=null
  try{pending=sessionStorage.getItem(storageKey)}catch{/* Memory remains usable if storage is disabled. */}
  const pendingId=ref(pending)
  let disposed=false,timer:ReturnType<typeof setTimeout>|undefined
  function remember(id:string|null){pendingId.value=id;try{if(id)sessionStorage.setItem(storageKey,id);else sessionStorage.removeItem(storageKey)}catch{}}
  const busy=computed(()=>loading.value||submitting.value||!!pendingId.value||status.value?.job?.status==='running')
  function schedule(){clearTimeout(timer);if(!disposed&&!document.hidden&&(pendingId.value||status.value?.job?.status==='running'))timer=setTimeout(()=>void refresh(),2000)}
  async function loadAudit(){try{const rows=await tlsService.audit();if(!disposed){audit.value=rows;auditError.value=''}}catch{if(!disposed)auditError.value=t('tls.auditUnavailable')}}
  async function refresh(){
    if(disposed||loading.value)return
    loading.value=true
    try{
      const result=await tlsService.status()
      if(disposed)return
      status.value=result;error.value='';errorCode.value=''
      if(pendingId.value){
        try{
          const job=await tlsService.operation(pendingId.value)
          if(disposed)return
          status.value.job=job
          if(job.status!=='running'){remember(null);recoveryMessage.value=t('tls.operationRecovered')}
        }catch(e:any){
          if(e.response?.status===404){remember(null);recoveryMessage.value=t('tls.operationNotAccepted')}
          else throw e
        }
      }
      void loadAudit()
    }catch(e:any){if(!disposed){error.value=e.response?.data?.message||t('tls.unavailable');errorCode.value=e.response?.data?.code||''}}
    finally{if(!disposed){loading.value=false;schedule()}}
  }
  async function operate(body:Record<string,unknown>){
    if(busy.value||error.value)return false
    submitting.value=true;error.value='';errorCode.value='';recoveryMessage.value=''
    const requestId=crypto.randomUUID();remember(requestId)
    try{
      const job=await tlsService.operate({...body,requestId,expectedFingerprint:status.value?.active?.fingerprint||''})
      if(!disposed&&status.value)status.value.job=job
      return true
    }catch(e:any){
      if(!disposed){
        if(e.response?.status>=400&&e.response?.status<500)remember(null)
        error.value=e.response?.data?.message||t('tls.operationUnknown');errorCode.value=e.response?.data?.code||''
      }
      return false
    }finally{if(!disposed){submitting.value=false;schedule()}}
  }
  function visibility(){clearTimeout(timer);if(!document.hidden)void refresh()}
  onMounted(()=>{void refresh();document.addEventListener('visibilitychange',visibility)})
  onBeforeUnmount(()=>{disposed=true;clearTimeout(timer);document.removeEventListener('visibilitychange',visibility)})
  return {status,loading,submitting,error,errorCode,busy,refresh,operate,pendingId,recoveryMessage,audit,auditError}
}
