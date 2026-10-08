<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NAlert, NButton, NCard, NModal, NSpin, NTag } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useTlsManagement } from '@/composables/useTlsManagement'
import CertificateUpload from '@/components/tls/CertificateUpload.vue'
const {t,locale}=useI18n(),{status,loading,error,errorCode,busy,refresh,operate,pendingId,recoveryMessage,audit,auditError}=useTlsManagement()
const selected=ref('provided'),email=ref(''),terms=ref(false),confirm=ref(false),upload=ref<InstanceType<typeof CertificateUpload>>()
let initialized=false
watch(status,value=>{if(value&&!initialized){selected.value=value.mode;email.value=value.email;initialized=true}})
const blocked=computed(()=>busy.value||!!error.value||!!status.value?.recoveryRequired)
const certificate=computed(()=>status.value?.active||status.value?.observed)
const acmeBlocked=computed(()=>blocked.value||Date.parse(status.value?.acmeBlockedUntil||'')>Date.now())
const candidate=computed(()=>status.value?.candidate)
const date=(value?:string|null)=>value?new Date(value).toLocaleString(locale.value):'—'
async function validate(certificate:string,privateKey:string){if(await operate({action:'validate',certificate,privateKey}))upload.value?.clear()}
async function apply(){confirm.value=false;await operate({action:'apply',candidateId:candidate.value?.id})}
async function automatic(){confirm.value=false;await operate({action:'automatic',email:email.value,agreeTerms:terms.value})}
const confirmAction=ref<'apply'|'automatic'|'pause'>('apply')
function ask(action:'apply'|'automatic'|'pause'){confirmAction.value=action;confirm.value=true}
async function proceed(){if(confirmAction.value==='apply')await apply();else if(confirmAction.value==='automatic')await automatic();else{confirm.value=false;await operate({action:'pause'})}}
</script>
<template>
  <main class="tls-page" data-tls-page>
    <header class="tls-heading"><div><h1>{{ $t('tls.title') }}</h1><p>{{ $t('tls.subtitle') }}</p></div><NButton :loading="loading" @click="refresh">{{ $t('tls.refresh') }}</NButton></header>
    <NAlert v-if="errorCode==='TLS_NOT_CONFIGURED'" type="info" role="status" :title="$t('tls.notConfigured')"><p>{{ $t('tls.setupHint') }}</p><p>{{ $t('tls.devHint') }}</p><p><code>docs/OPERATIONS-tls-management.md</code></p></NAlert>
    <NAlert v-else-if="error" type="error" role="alert" :title="$t('tls.unavailable')">{{ error }} <p>{{ $t('tls.retryHint') }}</p></NAlert>
    <NAlert v-if="recoveryMessage" type="info" role="status">{{ recoveryMessage }}</NAlert>
    <p v-if="pendingId">{{ $t('tls.operationId') }}: <code>{{ pendingId }}</code></p>
    <NSpin v-if="loading&&!status" :description="$t('tls.loading')" />
    <template v-if="status">
      <NAlert v-if="status.recoveryRequired" type="error">{{ $t('tls.recovery') }}</NAlert>
      <NAlert v-for="alert in status.alerts||[]" :key="alert.code" :type="alert.severity" role="alert">{{ alert.message }}<p v-if="alert.retryAt">{{ $t('tls.nextCheck') }}: {{ date(alert.retryAt) }}</p></NAlert>
      <NCard :title="$t('tls.current')">
        <div class="tls-summary"><div><span>{{ $t('tls.domain') }}</span><strong>{{ status.domain }}</strong></div><div><span>{{ $t('tls.mode') }}</span><strong>{{ $t('tls.'+status.mode) }}</strong></div><div><span>{{ $t('tls.expires') }}</span><strong>{{ date(status.active?.validTo||status.observed?.validTo) }}</strong></div></div>
        <NAlert v-if="!status.alerts?.length&&certificate?.daysRemaining!==undefined&&certificate.daysRemaining<30" :type="certificate.daysRemaining<7?'error':'warning'" class="tls-gap">{{ $t('tls.expiryWarning',{days:certificate.daysRemaining}) }}</NAlert>
        <p v-if="!status.active">{{ $t('tls.noLocal') }}</p>
        <p v-if="status.active">{{ $t('tls.issuer') }}: {{ status.active.issuer }}</p>
        <details v-if="status.active"><summary>{{ $t('tls.fingerprint') }}</summary><code>{{ status.active.fingerprint }}</code></details>
        <p>{{ $t('tls.lastVerified') }}: {{ date(status.observed?.checkedAt) }} · {{ $t('tls.nextCheck') }}: {{ date(status.nextCheck) }}</p>
        <div class="tls-actions"><NButton :disabled="blocked" @click="operate({action:'check'})">{{ $t('tls.test') }}</NButton><NButton v-if="status.mode==='automatic'" :disabled="acmeBlocked" @click="operate({action:'simulate'})">{{ $t('tls.simulate') }}</NButton><NButton v-if="status.mode==='automatic'" :disabled="acmeBlocked" @click="operate({action:'renew'})">{{ $t('tls.renew') }}</NButton></div>
      </NCard>
      <NAlert v-if="status.job" :type="status.job.status==='failed'?'error':status.job.status==='running'?'info':'success'" role="status" aria-live="polite">
        <strong>{{ $t('tls.job.'+status.job.status) }}</strong><p>{{ $t('tls.operationId') }}: {{ status.job.requestId||status.job.id }}</p><p>{{ status.job.error?.message||status.job.result?.message||$t('tls.background') }}</p>
      </NAlert>
      <ol v-if="status.job?.steps?.length" class="tls-history" :aria-label="$t('tls.diagnostics')"><li v-for="(step,index) in status.job.steps" :key="index"><strong>{{ $t('tls.steps.'+step.name) }}</strong> · {{ $t('tls.job.'+step.status) }}<p v-if="step.error">{{ step.error.message }}</p></li></ol>
      <p>{{ $t('tls.testHint') }}</p>
      <NCard :title="$t('tls.configure')">
        <fieldset :disabled="blocked" class="tls-modes"><legend>{{ $t('tls.choose') }}</legend>
          <label v-for="mode in ['automatic','provided','external']" :key="mode" :class="{selected:selected===mode}"><input v-model="selected" type="radio" name="tls-mode" :value="mode" :disabled="status.externalOnly?mode!=='external':mode==='external'" /><span><strong>{{ $t('tls.'+mode) }}</strong><small>{{ $t('tls.'+mode+'Hint') }}</small></span></label>
        </fieldset>
        <form v-if="selected==='automatic'" class="tls-form" @submit.prevent="ask('automatic')">
          <NAlert type="info">{{ $t('tls.acmeHint') }}</NAlert>
          <label>{{ $t('tls.email') }}<input v-model="email" type="email" required maxlength="254" :disabled="blocked" /></label>
          <label class="tls-terms"><input v-model="terms" type="checkbox" :disabled="blocked" required />{{ $t('tls.terms') }} <a href="https://letsencrypt.org/repository/" target="_blank" rel="noopener noreferrer">{{ $t('tls.readTerms') }}</a></label>
          <NButton attr-type="submit" type="primary" :disabled="acmeBlocked||!terms||!email">{{ $t('tls.enable') }}</NButton>
        </form>
        <template v-if="selected==='provided'">
          <CertificateUpload ref="upload" :disabled="blocked" @validate="validate" />
          <NButton v-if="status.mode==='automatic'" class="tls-gap" :disabled="blocked" @click="ask('pause')">{{ $t('tls.pause') }}</NButton>
          <div v-if="candidate" class="tls-preview"><h3>{{ $t('tls.preview') }}</h3><p>{{ candidate.domain }} · {{ date(candidate.validTo) }}</p><code>{{ candidate.fingerprint }}</code><p>{{ $t('tls.previewExpires') }}: {{ date(candidate.expiresAt) }}</p><NButton type="primary" :disabled="blocked" @click="ask('apply')">{{ $t('tls.apply') }}</NButton></div>
        </template>
        <NAlert v-if="selected==='external'" type="info">{{ $t('tls.externalHint') }}</NAlert>
      </NCard>
      <NCard :title="$t('tls.history')"><p v-if="!status.history.length">{{ $t('tls.empty') }}</p><ol v-else class="tls-history"><li v-for="job in status.history" :key="job.id"><div><strong>{{ $t('tls.action.'+job.action) }}</strong><NTag :type="job.status==='failed'?'error':'success'">{{ $t('tls.job.'+job.status) }}</NTag></div><small>{{ date(job.startedAt) }} · {{ job.actor }}</small><p>{{ job.error?.message||job.result?.message }}</p></li></ol></NCard>
      <NCard :title="$t('tls.centralAudit')">
        <NAlert v-if="auditError" type="warning">{{ auditError }}</NAlert>
        <p v-if="status.auditPending">{{ $t('tls.auditPending',{count:status.auditPending}) }}</p>
        <p v-if="!audit.length&&!auditError">{{ $t('tls.empty') }}</p>
        <ol class="tls-history"><li v-for="event in audit" :key="event.id"><strong>{{ event.details.action ? $t('tls.action.'+event.details.action) : $t('tls.alertChanged') }}</strong><p>{{ date(event.occurredAt) }} · {{ event.actor||$t('tls.system') }}</p><p>{{ event.details.error?.message||event.details.result?.message }}</p><small>{{ event.details.requestId||event.id }}</small></li></ol>
      </NCard>
    </template>
    <NModal v-model:show="confirm" preset="dialog" :title="$t('tls.confirmTitle')" :content="$t('tls.confirmHint')" :positive-text="$t('tls.confirm')" :negative-text="$t('tls.cancel')" @positive-click="proceed" />
  </main>
</template>
<style scoped>
.tls-page{max-width:1100px;margin:0 auto;padding:24px;display:grid;gap:20px}.tls-heading,.tls-actions{display:flex;align-items:center;justify-content:space-between;gap:12px}.tls-heading h1{font-size:24px;font-weight:600;margin:0}.tls-heading p{margin:6px 0}.tls-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.tls-summary div{display:grid;gap:6px}.tls-summary span,small{opacity:.8}.tls-modes{border:0;padding:0;margin:0 0 20px;display:grid;gap:10px}.tls-modes legend{padding-bottom:12px}.tls-modes label{display:flex;align-items:start;gap:12px;padding:16px;border:1px solid #8290a455;border-radius:8px}.tls-modes label.selected{border-color:#18a058}.tls-modes small{display:block;margin-top:5px}.tls-form{display:grid;gap:16px}.tls-form>label:not(.tls-terms){display:grid;gap:8px}.tls-form input[type=email]{padding:10px;background:transparent;border:1px solid #8290a4;border-radius:6px;color:inherit}.tls-terms{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.tls-preview{margin-top:20px;padding:16px;border:1px solid #18a058;border-radius:8px}code{display:block;overflow-wrap:anywhere;font-size:12px}.tls-history{list-style:none;padding:0}.tls-history li{padding:12px 0;border-bottom:1px solid #8290a433}.tls-history li>div{display:flex;justify-content:space-between;gap:8px}.tls-gap{margin-top:16px}:deep(.tls-button){padding:10px 16px;background:#176650;color:white;border-radius:6px;width:fit-content}:deep(button:disabled){opacity:.55;cursor:not-allowed}:deep(input:focus-visible),:deep(button:focus-visible),summary:focus-visible{outline:2px solid #18a058;outline-offset:3px}@media(max-width:640px){.tls-page{padding:14px}.tls-heading{align-items:flex-start}.tls-summary{grid-template-columns:1fr}.tls-actions{flex-wrap:wrap}}
</style>
