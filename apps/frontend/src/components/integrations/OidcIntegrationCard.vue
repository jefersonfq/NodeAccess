<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NAlert, NButton, NCard, NCheckbox, NDivider, NFormItem, NInput, NSpin, NSwitch, NTag, NText, useMessage } from 'naive-ui'
import type { OidcConfigPublic } from '@nodeaccess/shared'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import OidcIdentityLinksSection from '@/components/integrations/OidcIdentityLinksSection.vue'
import { integrationService } from '@/services/integration.service'

const { t } = useI18n()
const message = useMessage()
const loading = ref(true)
const saving = ref(false)
const saved = ref<OidcConfigPublic | null>(null)
const enabled = ref(false)
const name = ref('SSO corporativo')
const issuer = ref('')
const clientId = ref('')
const clientSecret = ref('')
const scopes = ref('openid, profile, email')
const allowedDomains = ref('')
const autoProvision = ref(false)
const requireMfaClaim = ref(false)
const acceptedAmrValues = ref('mfa')
const acceptedAcrValues = ref('')

const callbackUrl = computed(() => `${window.location.origin}/auth/oidc/callback`)
const configured = computed(() => Boolean(saved.value?.issuer && saved.value?.clientId && saved.value?.hasClientSecret))
const isMicrosoftEntra = computed(() => {
  try {
    return new URL(issuer.value.trim()).hostname.toLowerCase() === 'login.microsoftonline.com'
  } catch {
    return false
  }
})
const isMicrosoftEntraIssuerValid = computed(() => {
  if (!isMicrosoftEntra.value) return true
  try {
    const url = new URL(issuer.value.trim())
    return /^\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/v2\.0\/?$/i.test(url.pathname)
      && !url.search
      && !url.hash
  } catch {
    return false
  }
})
const isOkta = computed(() => {
  try {
    const hostname = new URL(issuer.value.trim()).hostname.toLowerCase()
    return hostname.endsWith('.okta.com')
      || hostname.endsWith('.oktapreview.com')
      || hostname.endsWith('.okta-emea.com')
  } catch {
    return false
  }
})
const oktaGroupsScopeConfigured = computed(() => list(scopes.value).some((scope) => scope.toLowerCase() === 'groups'))

function list(value: string): string[] {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))]
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const { data } = await integrationService.getOidc()
    saved.value = data
    enabled.value = data.enabled
    name.value = data.name ?? 'SSO corporativo'
    issuer.value = data.issuer ?? ''
    clientId.value = data.clientId ?? ''
    scopes.value = data.scopes.length ? data.scopes.join(', ') : 'openid, profile, email'
    allowedDomains.value = data.allowedDomains.join(', ')
    autoProvision.value = data.autoProvision
    requireMfaClaim.value = data.requireMfaClaim
    acceptedAmrValues.value = data.acceptedAmrValues.join(', ')
    acceptedAcrValues.value = data.acceptedAcrValues.join(', ')
  } catch (error: unknown) {
    const apiError = error as { response?: { data?: { message?: string } } }
    message.error(apiError.response?.data?.message ?? t('admin.integrations.oidc.messages.loadError'))
  } finally {
    loading.value = false
  }
}

async function save(): Promise<void> {
  if (!name.value.trim() || !issuer.value.trim() || !clientId.value.trim()) {
    message.warning(t('admin.integrations.oidc.messages.required'))
    return
  }
  if (enabled.value && !saved.value?.hasClientSecret && !clientSecret.value.trim()) {
    message.warning(t('admin.integrations.oidc.messages.secretRequired'))
    return
  }
  if (!isMicrosoftEntraIssuerValid.value) {
    message.warning(t('admin.integrations.oidc.messages.entraIssuerRequired'))
    return
  }
  if (requireMfaClaim.value && !list(acceptedAmrValues.value).length && !list(acceptedAcrValues.value).length) {
    message.warning(t('admin.integrations.oidc.messages.mfaEvidenceRequired'))
    return
  }
  saving.value = true
  try {
    const { data } = await integrationService.upsertOidc({
      enabled: enabled.value,
      name: name.value.trim(),
      issuer: issuer.value.trim(),
      clientId: clientId.value.trim(),
      clientSecret: clientSecret.value.trim() || undefined,
      scopes: list(scopes.value),
      allowedDomains: list(allowedDomains.value),
      autoProvision: isMicrosoftEntra.value ? false : autoProvision.value,
      requireMfaClaim: requireMfaClaim.value,
      acceptedAmrValues: list(acceptedAmrValues.value),
      acceptedAcrValues: list(acceptedAcrValues.value),
    })
    saved.value = data
    clientSecret.value = ''
    message.success(t('admin.integrations.oidc.messages.saved'))
  } catch (error: unknown) {
    const apiError = error as { response?: { data?: { message?: string } } }
    message.error(apiError.response?.data?.message ?? t('admin.integrations.oidc.messages.saveError'))
  } finally {
    saving.value = false
  }
}

async function copyCallback(): Promise<void> {
  await navigator.clipboard.writeText(callbackUrl.value)
  message.success(t('admin.integrations.oidc.messages.callbackCopied'))
}

onMounted(load)
</script>

<template>
  <NCard
    data-testid="oidc-integration-card"
    :bordered="false"
    style="background: var(--na-surface-raised);"
    class="mb-4"
  >
    <div class="flex items-start justify-between gap-4">
      <div class="flex items-center gap-4 min-w-0">
        <div
          class="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 text-sm font-semibold"
          style="background:#202c4a;color:#bfdbfe;"
        >
          OIDC
        </div>
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-semibold text-white">{{ $t('admin.integrations.oidc.name') }}</span>
            <NTag
              v-if="saved?.enabled && configured"
              type="success"
              size="small"
            >
              {{ $t('admin.integrations.status.active') }}
            </NTag>
            <NTag
              v-else-if="configured"
              type="warning"
              size="small"
            >
              {{ $t('admin.integrations.status.disabled') }}
            </NTag>
            <NTag
              v-else
              size="small"
            >
              {{ $t('admin.integrations.status.notConfigured') }}
            </NTag>
          </div>
          <NText
            depth="3"
            class="text-xs"
          >
            {{ $t('admin.integrations.oidc.description') }}
          </NText>
        </div>
      </div>
      <NSwitch
        v-model:value="enabled"
        :disabled="loading || (!configured && !clientSecret.trim())"
        :aria-label="$t('admin.integrations.oidc.enabledLabel')"
      />
    </div>

    <NDivider style="margin: 16px 0;" />
    <CollapsibleSection
      :title="$t('admin.integrations.oidc.configuration')"
      body-class="mt-2 !bg-transparent"
    >
      <NSpin :show="loading">
        <div class="space-y-4">
          <NAlert
            type="info"
            :show-icon="false"
          >
            {{ $t('admin.integrations.oidc.securityAlert') }}
          </NAlert>

          <NFormItem
            :label="$t('admin.integrations.oidc.callbackLabel')"
            :show-feedback="false"
          >
            <div class="flex flex-col sm:flex-row gap-2 w-full">
              <NInput
                :value="callbackUrl"
                readonly
                class="font-mono"
              />
              <NButton
                attr-type="button"
                @click="copyCallback"
              >
                {{ $t('admin.integrations.oidc.copy') }}
              </NButton>
            </div>
          </NFormItem>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <NFormItem
              :label="$t('admin.integrations.oidc.nameLabel')"
              :show-feedback="false"
            >
              <NInput
                v-model:value="name"
                data-testid="oidc-name"
                :placeholder="$t('admin.integrations.oidc.namePlaceholder')"
              />
            </NFormItem>
            <NFormItem
              :label="$t('admin.integrations.oidc.clientIdLabel')"
              :show-feedback="false"
            >
              <NInput
                v-model:value="clientId"
                data-testid="oidc-client-id"
                placeholder="nodeaccess"
                class="font-mono"
              />
            </NFormItem>
          </div>

          <NFormItem
            :label="$t('admin.integrations.oidc.issuerLabel')"
            :show-feedback="isMicrosoftEntra && !isMicrosoftEntraIssuerValid"
            :validation-status="isMicrosoftEntra && !isMicrosoftEntraIssuerValid ? 'error' : undefined"
            :feedback="isMicrosoftEntra && !isMicrosoftEntraIssuerValid ? $t('admin.integrations.oidc.entraIssuerHelp') : undefined"
          >
            <NInput
              v-model:value="issuer"
              data-testid="oidc-issuer"
              placeholder="https://login.example.com/tenant/v2.0"
              class="font-mono"
            />
          </NFormItem>
          <NAlert
            v-if="isMicrosoftEntra && isMicrosoftEntraIssuerValid"
            type="info"
            :show-icon="false"
            data-testid="oidc-entra-guidance"
          >
            {{ $t('admin.integrations.oidc.entraGuidance') }}
          </NAlert>
          <NAlert
            v-else-if="isOkta"
            type="info"
            :show-icon="false"
            data-testid="oidc-okta-guidance"
          >
            {{ $t('admin.integrations.oidc.oktaGuidance') }}
          </NAlert>
          <NFormItem
            :label="$t('admin.integrations.oidc.secretLabel')"
            :show-feedback="false"
          >
            <NInput
              v-model:value="clientSecret"
              data-testid="oidc-client-secret"
              type="password"
              show-password-on="click"
              :placeholder="saved?.hasClientSecret ? $t('admin.integrations.oidc.secretSaved') : $t('admin.integrations.oidc.secretPlaceholder')"
            />
          </NFormItem>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <NFormItem
              :label="$t('admin.integrations.oidc.scopesLabel')"
              :show-feedback="isOkta && !oktaGroupsScopeConfigured"
            >
              <NInput
                v-model:value="scopes"
                data-testid="oidc-scopes"
                placeholder="openid, profile, email"
              />
              <template
                v-if="isOkta && !oktaGroupsScopeConfigured"
                #feedback
              >
                {{ $t('admin.integrations.oidc.oktaGroupsHelp') }}
              </template>
            </NFormItem>
            <NFormItem
              :label="$t('admin.integrations.oidc.domainsLabel')"
              :show-feedback="false"
            >
              <NInput
                v-model:value="allowedDomains"
                data-testid="oidc-domains"
                placeholder="empresa.com, subsidiaria.com"
              />
            </NFormItem>
          </div>

          <NCheckbox
            v-model:checked="autoProvision"
            :disabled="isMicrosoftEntra"
          >
            {{ $t('admin.integrations.oidc.autoProvisionLabel') }}
          </NCheckbox>
          <NText
            v-if="isMicrosoftEntra"
            depth="3"
            class="text-xs"
          >
            {{ $t('admin.integrations.oidc.entraProvisioningHelp') }}
          </NText>
          <div class="oidc-assurance-panel">
            <NCheckbox v-model:checked="requireMfaClaim">
              {{ $t('admin.integrations.oidc.requireMfaClaimLabel') }}
            </NCheckbox>
            <NText
              depth="3"
              class="text-xs"
            >
              {{ $t('admin.integrations.oidc.requireMfaClaimHelp') }}
            </NText>
            <div
              v-if="requireMfaClaim"
              class="grid grid-cols-1 md:grid-cols-2 gap-3"
            >
              <NFormItem
                :label="$t('admin.integrations.oidc.acceptedAmrLabel')"
                :show-feedback="false"
              >
                <NInput
                  v-model:value="acceptedAmrValues"
                  data-testid="oidc-accepted-amr"
                  placeholder="mfa, otp"
                />
              </NFormItem>
              <NFormItem
                :label="$t('admin.integrations.oidc.acceptedAcrLabel')"
                :show-feedback="false"
              >
                <NInput
                  v-model:value="acceptedAcrValues"
                  data-testid="oidc-accepted-acr"
                  placeholder="urn:example:mfa"
                />
              </NFormItem>
            </div>
          </div>
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
    <NDivider style="margin: 16px 0;" />
    <OidcIdentityLinksSection />
  </NCard>
</template>

<style scoped>
.oidc-assurance-panel { display:flex; flex-direction:column; gap:.5rem; padding:.875rem; border:1px solid var(--na-border); border-radius:.75rem; background:var(--na-surface-soft); }
</style>
