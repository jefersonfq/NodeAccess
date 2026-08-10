<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NAlert, NButton, NCard, NDivider, NInput, NInputNumber, NSpin, NSwitch, NTag, NText, useMessage } from 'naive-ui'
import type { BreakGlassStatus, TenantAuthPolicyDto, TenantAuthPolicyPublic } from '@nodeaccess/shared'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import { tenantAuthPolicyService } from '@/services/tenant-auth-policy.service'

const { t } = useI18n()
const message = useMessage()
const loading = ref(true)
const saving = ref(false)
const state = ref<TenantAuthPolicyPublic | null>(null)
const breakGlass = ref<BreakGlassStatus>({ configured: false, userId: null, email: null, validatedAt: null })
const breakGlassEmail = ref('')
const breakGlassPassword = ref('')
const validatingBreakGlass = ref(false)
const enforcementStatus = computed(() => {
  if (state.value?.enforcementEnabled) return 'enforced'
  if (state.value?.ssoRequiredEnforced
    || state.value?.localLoginEnforced
    || state.value?.emailTenantDiscoveryEnforced
    || state.value?.lockoutPolicyEnforced
    || state.value?.tokenLifetimeEnforced) return 'partial'
  return 'preview'
})
const form = reactive<TenantAuthPolicyDto>({
  localLoginEnabled: true,
  ssoRequired: false,
  mfaRequired: true,
  jitProvisioningEnabled: false,
  automaticAccountLinkingEnabled: false,
  emailTenantDiscoveryEnabled: true,
  lockoutMaxAttempts: 5,
  lockoutDurationMinutes: 15,
  accessTokenMinutes: 15,
  refreshTokenDays: 7,
})

function apply(data: TenantAuthPolicyPublic): void {
  state.value = data
  Object.assign(form, data.requested)
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const [policyResponse, breakGlassResponse] = await Promise.all([
      tenantAuthPolicyService.get(),
      tenantAuthPolicyService.getBreakGlass(),
    ])
    apply(policyResponse.data)
    breakGlass.value = breakGlassResponse.data
    breakGlassEmail.value = breakGlassResponse.data.email ?? ''
  } catch (error: unknown) {
    const apiError = error as { response?: { data?: { message?: string } } }
    message.error(apiError.response?.data?.message ?? t('admin.integrations.authPolicy.messages.loadError'))
  } finally {
    loading.value = false
  }
}

async function validateBreakGlass(): Promise<void> {
  if (!breakGlassEmail.value.trim() || !breakGlassPassword.value) {
    message.warning(t('admin.integrations.authPolicy.messages.breakGlassRequired'))
    return
  }
  validatingBreakGlass.value = true
  try {
    breakGlass.value = (await tenantAuthPolicyService.validateBreakGlass({
      email: breakGlassEmail.value.trim(),
      password: breakGlassPassword.value,
    })).data
    breakGlassPassword.value = ''
    message.success(t('admin.integrations.authPolicy.messages.breakGlassValidated'))
  } catch (error: unknown) {
    const apiError = error as { response?: { data?: { message?: string } } }
    message.error(apiError.response?.data?.message ?? t('admin.integrations.authPolicy.messages.breakGlassError'))
  } finally {
    validatingBreakGlass.value = false
  }
}

async function save(): Promise<void> {
  saving.value = true
  try {
    apply((await tenantAuthPolicyService.update({ ...form })).data)
    message.success(t('admin.integrations.authPolicy.messages.saved'))
  } catch (error: unknown) {
    const apiError = error as { response?: { data?: { message?: string } } }
    message.error(apiError.response?.data?.message ?? t('admin.integrations.authPolicy.messages.saveError'))
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <NCard
    data-testid="tenant-auth-policy-card"
    :bordered="false"
    style="background: var(--na-surface-raised);"
    class="mb-4"
  >
    <div class="flex items-start justify-between gap-4">
      <div>
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-semibold text-white">{{ $t('admin.integrations.authPolicy.name') }}</span>
          <NTag
            :type="enforcementStatus === 'enforced' ? 'success' : 'warning'"
            size="small"
          >
            {{ $t(`admin.integrations.authPolicy.${enforcementStatus}`) }}
          </NTag>
        </div>
        <NText
          depth="3"
          class="text-xs"
        >
          {{ $t('admin.integrations.authPolicy.description') }}
        </NText>
      </div>
    </div>
    <NDivider style="margin: 16px 0;" />
    <CollapsibleSection
      :title="$t('admin.integrations.authPolicy.configuration')"
      body-class="mt-2 !bg-transparent"
    >
      <NSpin :show="loading">
        <div class="space-y-4">
          <NAlert
            :type="state?.ssoRequiredEnforced ? 'info' : 'warning'"
            :show-icon="false"
          >
            {{ $t('admin.integrations.authPolicy.previewAlert') }}
          </NAlert>
          <div class="break-glass-panel">
            <div class="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div class="policy-title">
                  {{ $t('admin.integrations.authPolicy.breakGlassTitle') }}
                </div>
                <NText
                  depth="3"
                  class="text-xs"
                >
                  {{ $t('admin.integrations.authPolicy.breakGlassHelp') }}
                </NText>
              </div>
              <NTag
                :type="breakGlass.configured ? 'success' : 'warning'"
                size="small"
              >
                {{ breakGlass.configured ? $t('admin.integrations.authPolicy.breakGlassReady') : $t('admin.integrations.authPolicy.breakGlassMissing') }}
              </NTag>
            </div>
            <NAlert
              v-if="breakGlass.configured"
              type="success"
              :show-icon="false"
            >
              {{ $t('admin.integrations.authPolicy.breakGlassConfigured', { email: breakGlass.email, at: breakGlass.validatedAt ? new Date(breakGlass.validatedAt).toLocaleString() : '-' }) }}
            </NAlert>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <NInput
                v-model:value="breakGlassEmail"
                :placeholder="$t('admin.integrations.authPolicy.breakGlassEmail')"
                :input-props="{ autocomplete: 'username' }"
              />
              <NInput
                v-model:value="breakGlassPassword"
                type="password"
                show-password-on="click"
                :placeholder="$t('admin.integrations.authPolicy.breakGlassPassword')"
                :input-props="{ autocomplete: 'current-password' }"
              />
            </div>
            <div class="flex justify-end">
              <NButton
                attr-type="button"
                :loading="validatingBreakGlass"
                @click="validateBreakGlass"
              >
                {{ $t('admin.integrations.authPolicy.validateBreakGlass') }}
              </NButton>
            </div>
          </div>
          <div class="policy-row">
            <div>
              <div class="policy-title">
                {{ $t('admin.integrations.authPolicy.localLogin') }}
              </div><NText
                depth="3"
                class="text-xs"
              >
                {{ $t('admin.integrations.authPolicy.localLoginHelp') }}
              </NText>
            </div>
            <NSwitch
              v-model:value="form.localLoginEnabled"
              :disabled="!breakGlass.configured"
              :aria-label="$t('admin.integrations.authPolicy.localLogin')"
            />
          </div>
          <div class="policy-row">
            <div>
              <div class="policy-title">
                {{ $t('admin.integrations.authPolicy.ssoRequired') }}
              </div><NText
                depth="3"
                class="text-xs"
              >
                {{ $t('admin.integrations.authPolicy.ssoRequiredHelp') }}
              </NText>
            </div>
            <NSwitch
              v-model:value="form.ssoRequired"
              :disabled="!breakGlass.configured"
              :aria-label="$t('admin.integrations.authPolicy.ssoRequired')"
            />
          </div>
          <div class="policy-row">
            <div>
              <div class="policy-title">
                {{ $t('admin.integrations.authPolicy.mfa') }}
              </div><NText
                depth="3"
                class="text-xs"
              >
                {{ $t('admin.integrations.authPolicy.mfaHelp') }}
              </NText>
            </div>
            <NSwitch
              v-model:value="form.mfaRequired"
              :aria-label="$t('admin.integrations.authPolicy.mfa')"
            />
          </div>
          <div class="policy-row">
            <div>
              <div class="policy-title">
                {{ $t('admin.integrations.authPolicy.jit') }}
              </div><NText
                depth="3"
                class="text-xs"
              >
                {{ $t('admin.integrations.authPolicy.jitHelp') }}
              </NText>
            </div>
            <NSwitch
              v-model:value="form.jitProvisioningEnabled"
              :aria-label="$t('admin.integrations.authPolicy.jit')"
            />
          </div>
          <div class="policy-row">
            <div>
              <div class="policy-title">
                {{ $t('admin.integrations.authPolicy.linking') }}
              </div><NText
                depth="3"
                class="text-xs"
              >
                {{ $t('admin.integrations.authPolicy.linkingHelp') }}
              </NText>
            </div>
            <NSwitch
              v-model:value="form.automaticAccountLinkingEnabled"
              :aria-label="$t('admin.integrations.authPolicy.linking')"
            />
          </div>
          <div class="policy-row">
            <div>
              <div class="policy-title">
                {{ $t('admin.integrations.authPolicy.discovery') }}
              </div><NText
                depth="3"
                class="text-xs"
              >
                {{ $t('admin.integrations.authPolicy.discoveryHelp') }}
              </NText>
            </div>
            <NSwitch
              v-model:value="form.emailTenantDiscoveryEnabled"
              :aria-label="$t('admin.integrations.authPolicy.discovery')"
            />
          </div>
          <NDivider />
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="policy-field"><span>{{ $t('admin.integrations.authPolicy.lockoutAttempts') }}</span><NInputNumber
              v-model:value="form.lockoutMaxAttempts"
              :min="1"
              :max="100"
            /></label>
            <label class="policy-field"><span>{{ $t('admin.integrations.authPolicy.lockoutMinutes') }}</span><NInputNumber
              v-model:value="form.lockoutDurationMinutes"
              :min="1"
              :max="10080"
            /></label>
            <label class="policy-field"><span>{{ $t('admin.integrations.authPolicy.accessMinutes') }}</span><NInputNumber
              v-model:value="form.accessTokenMinutes"
              :min="1"
              :max="1440"
            /></label>
            <label class="policy-field"><span>{{ $t('admin.integrations.authPolicy.refreshDays') }}</span><NInputNumber
              v-model:value="form.refreshTokenDays"
              :min="1"
              :max="365"
            /></label>
          </div>
          <NAlert
            v-if="state"
            type="info"
            :show-icon="false"
          >
            {{ $t('admin.integrations.authPolicy.effectiveSummary', { attempts: state.effective.lockoutMaxAttempts, access: state.effective.accessTokenMinutes, refresh: state.effective.refreshTokenDays }) }}
          </NAlert>
          <div class="flex justify-end">
            <NButton
              type="primary"
              attr-type="button"
              :loading="saving"
              @click="save"
            >
              {{ $t('admin.integrations.save') }}
            </NButton>
          </div>
        </div>
      </NSpin>
    </CollapsibleSection>
  </NCard>
</template>

<style scoped>
.policy-row { display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:.25rem 0; }
.policy-title { color:#e5e7eb; font-size:.875rem; font-weight:500; }
.policy-field { display:flex; flex-direction:column; gap:.375rem; color:#d1d5db; font-size:.8125rem; }
.break-glass-panel { display:flex; flex-direction:column; gap:.75rem; padding:1rem; border:1px solid var(--na-border); border-radius:.75rem; background:var(--na-surface-soft); }
@media (max-width: 480px) { .policy-row { align-items:flex-start; } }
</style>
