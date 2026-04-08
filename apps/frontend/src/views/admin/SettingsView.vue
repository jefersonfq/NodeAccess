<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NAlert, NButton, NCard, NDescriptions, NDescriptionsItem, NProgress, NSelect,
  NSpace, NSpin, NTag, NText, NTransfer, NCheckbox, NInputNumber, useMessage,
} from 'naive-ui'
import type { SessionAuditPolicyMode, SessionAuditPolicyPublic, UserPublic, GroupPublic } from '@nodeaccess/shared'
import { settingsService, type SettingsData } from '@/services/settings.service'
import { sessionAuditPolicyService } from '@/services/sessionAuditPolicy.service'
import { userService } from '@/services/user.service'
import { groupService } from '@/services/group.service'
import { featuresService } from '@/services/features.service'

const { t } = useI18n()
const message = useMessage()

const loading = ref(false)
const error   = ref<string | null>(null)
const data    = ref<SettingsData | null>(null)
const policySaving = ref(false)
const licenseSaving = ref(false)
const policy = ref<SessionAuditPolicyPublic | null>(null)
const users = ref<UserPublic[]>([])
const groups = ref<GroupPublic[]>([])
const FEATURES_UPDATED_EVENT = 'nodeaccess:features-updated'

const policyForm = ref<{
  enabled: boolean
  mode: SessionAuditPolicyMode
  userIds: number[]
  groupIds: number[]
}>({
  enabled: false,
  mode: 'DISABLED',
  userIds: [],
  groupIds: [],
})

const licenseForm = ref({
  limitHostsEnabled: false,
  maxHosts: 50 as number | null,
  agents: false,
  secrets: false,
  snippets: false,
  portForwarding: false,
  integrations: false,
  feedback: false,
  jira: false,
  google: false,
  onepassword: false,
})

async function load() {
  loading.value = true
  error.value   = null
  try {
    const [settingsRes, policyRes, usersRes, groupsRes] = await Promise.all([
      settingsService.get(),
      sessionAuditPolicyService.get().catch(() => ({ data: null })),
      userService.list({ limit: 200 }),
      groupService.list(),
    ])
    data.value = settingsRes.data
    syncLicenseForm(settingsRes.data)
    policy.value = policyRes.data
    users.value = usersRes.data.data
    groups.value = groupsRes.data

    if (policy.value) {
      policyForm.value = {
        enabled: policy.value.enabled,
        mode: policy.value.mode,
        userIds: [...policy.value.userIds],
        groupIds: [...policy.value.groupIds],
      }
    }
  } catch {
    error.value = 'Erro ao carregar configurações'
  } finally {
    loading.value = false
  }
}

onMounted(load)

function syncLicenseForm(settings: SettingsData) {
  licenseForm.value = {
    limitHostsEnabled: settings.license.maxHosts !== null,
    maxHosts: settings.license.maxHosts ?? 50,
    agents: settings.license.featureEntitlements.agents === true,
    secrets: settings.license.featureEntitlements.secrets === true,
    snippets: settings.license.featureEntitlements.snippets === true,
    portForwarding: settings.license.featureEntitlements.portForwarding === true,
    integrations: settings.license.featureEntitlements.integrations === true,
    feedback: settings.license.featureEntitlements.feedback === true,
    jira: settings.license.integrationEntitlements.jira === true,
    google: settings.license.integrationEntitlements.google === true,
    onepassword: settings.license.integrationEntitlements.onepassword === true,
  }
}

const licensePercent = computed(() => {
  if (!data.value) return 0
  const { activeUsers, maxUsers } = data.value.license
  return Math.round((activeUsers / maxUsers) * 100)
})

const licenseStatus = computed(() => {
  if (licensePercent.value >= 90) return 'error'
  if (licensePercent.value >= 70) return 'warning'
  return 'success'
})

const policyModeOptions = computed(() => [
  { label: t('admin.settings.sessionAudit.policy.modes.DISABLED'), value: 'DISABLED' },
  { label: t('admin.settings.sessionAudit.policy.modes.ALL'), value: 'ALL' },
  { label: t('admin.settings.sessionAudit.policy.modes.USERS'), value: 'USERS' },
  { label: t('admin.settings.sessionAudit.policy.modes.GROUPS'), value: 'GROUPS' },
  { label: t('admin.settings.sessionAudit.policy.modes.MIXED'), value: 'MIXED' },
])

const userTransferOptions = computed(() =>
  users.value.map((user) => ({
    label: `${user.name} (${user.email})`,
    value: user.id,
  })),
)

const groupTransferOptions = computed(() =>
  groups.value.map((group) => ({
    label: group.name,
    value: group.id,
  })),
)

const showUserScope = computed(() =>
  policyForm.value.mode === 'USERS' || policyForm.value.mode === 'MIXED',
)

const showGroupScope = computed(() =>
  policyForm.value.mode === 'GROUPS' || policyForm.value.mode === 'MIXED',
)

const licensedIntegrationProviders = computed(() =>
  Object.entries(data.value?.license.integrationEntitlements ?? {})
    .filter(([, enabled]) => enabled)
    .map(([provider]) => provider),
)

const canEditIntegrationProviders = computed(() => licenseForm.value.integrations)

async function savePolicy() {
  policySaving.value = true
  try {
    const payload = buildPolicyPayload()
    const { data: saved } = await sessionAuditPolicyService.update({
      enabled: payload.enabled,
      mode: payload.mode,
      userIds: payload.userIds,
      groupIds: payload.groupIds,
    })
    policy.value = saved
    policyForm.value = {
      enabled: saved.enabled,
      mode: saved.mode,
      userIds: [...saved.userIds],
      groupIds: [...saved.groupIds],
    }
    message.success(t('admin.settings.sessionAudit.policy.messages.saved'))
  } catch {
    message.error(t('admin.settings.sessionAudit.policy.messages.saveError'))
  } finally {
    policySaving.value = false
  }
}

async function saveLicense() {
  licenseSaving.value = true
  try {
    const payload = {
      maxHosts: licenseForm.value.limitHostsEnabled ? licenseForm.value.maxHosts : null,
      featureEntitlements: {
        agents: licenseForm.value.agents,
        secrets: licenseForm.value.secrets,
        snippets: licenseForm.value.snippets,
        portForwarding: licenseForm.value.portForwarding,
        integrations: licenseForm.value.integrations,
        feedback: licenseForm.value.feedback,
      },
      integrationEntitlements: {
        jira: licenseForm.value.integrations && licenseForm.value.jira,
        google: licenseForm.value.integrations && licenseForm.value.google,
        onepassword: licenseForm.value.integrations && licenseForm.value.onepassword,
      },
    }

    const response = await settingsService.updateLicense(payload)
    settingsService.clear()
    featuresService.clear()
    data.value = response.data
    syncLicenseForm(response.data)
    window.dispatchEvent(new Event(FEATURES_UPDATED_EVENT))
    message.success(t('admin.settings.license.editor.messages.saved'))
  } catch {
    message.error(t('admin.settings.license.editor.messages.saveError'))
  } finally {
    licenseSaving.value = false
  }
}

function buildPolicyPayload() {
  if (!policyForm.value.enabled || policyForm.value.mode === 'DISABLED' || policyForm.value.mode === 'ALL') {
    return {
      enabled: policyForm.value.enabled,
      mode: policyForm.value.enabled ? policyForm.value.mode : 'DISABLED' as SessionAuditPolicyMode,
      userIds: [],
      groupIds: [],
    }
  }

  if (policyForm.value.mode === 'USERS') {
    return {
      enabled: true,
      mode: 'USERS' as SessionAuditPolicyMode,
      userIds: policyForm.value.userIds,
      groupIds: [],
    }
  }

  if (policyForm.value.mode === 'GROUPS') {
    return {
      enabled: true,
      mode: 'GROUPS' as SessionAuditPolicyMode,
      userIds: [],
      groupIds: policyForm.value.groupIds,
    }
  }

  return {
    enabled: true,
    mode: 'MIXED' as SessionAuditPolicyMode,
    userIds: policyForm.value.userIds,
    groupIds: policyForm.value.groupIds,
  }
}
</script>

<template>
  <div class="p-6">
    <h1 class="text-xl font-semibold text-white mb-6">{{ $t('admin.settings.title') }}</h1>

    <NAlert v-if="error" type="error" class="mb-4" :title="error" />

    <NSpin :show="loading">
      <div v-if="data" class="flex flex-col gap-6">

        <!-- Tenant -->
        <NCard :title="$t('admin.settings.tenant.title')" :bordered="false" style="background: #1e1e22;">
          <NDescriptions :column="2" label-placement="left">
            <NDescriptionsItem :label="$t('admin.settings.tenant.name')">
              {{ data.tenant.name }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.tenant.slug')">
              <NText class="font-mono">{{ data.tenant.slug }}</NText>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.tenant.id')">
              {{ data.tenant.id }}
            </NDescriptionsItem>
          </NDescriptions>
        </NCard>

        <!-- Licença -->
        <NCard :title="$t('admin.settings.license.title')" :bordered="false" style="background: #1e1e22;">
          <NDescriptions :column="2" label-placement="left" class="mb-4">
            <NDescriptionsItem :label="$t('admin.settings.license.activeUsers')">
              {{ data.license.activeUsers }} / {{ data.license.maxUsers }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.license.registeredHosts')">
              {{ data.license.registeredHosts }} / {{ data.license.maxHosts ?? $t('common.unlimited') }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.license.key')">
              <NTag :type="data.license.hasKey ? 'success' : 'warning'" size="small">
                {{ data.license.hasKey ? $t('admin.settings.license.registered') : $t('admin.settings.license.notConfigured') }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.license.multiConnect')">
              <NTag :type="data.license.multiConnect ? 'success' : 'default'" size="small">
                {{ data.license.multiConnect ? $t('admin.settings.license.enabled') : $t('admin.settings.license.disabled') }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.license.sessionAudit')">
              <NTag :type="data.license.sessionAuditEnabled ? 'success' : 'default'" size="small">
                {{ data.license.sessionAuditEnabled ? $t('admin.settings.license.enabled') : $t('admin.settings.license.disabled') }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.license.agents')">
              <NTag :type="data.license.featureEntitlements.agents ? 'success' : 'default'" size="small">
                {{ data.license.featureEntitlements.agents ? $t('admin.settings.license.enabled') : $t('admin.settings.license.disabled') }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.license.secrets')">
              <NTag :type="data.license.featureEntitlements.secrets ? 'success' : 'default'" size="small">
                {{ data.license.featureEntitlements.secrets ? $t('admin.settings.license.enabled') : $t('admin.settings.license.disabled') }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.license.snippets')">
              <NTag :type="data.license.featureEntitlements.snippets ? 'success' : 'default'" size="small">
                {{ data.license.featureEntitlements.snippets ? $t('admin.settings.license.enabled') : $t('admin.settings.license.disabled') }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.license.localAccess')">
              <NTag :type="data.license.featureEntitlements.portForwarding ? 'success' : 'default'" size="small">
                {{ data.license.featureEntitlements.portForwarding ? $t('admin.settings.license.enabled') : $t('admin.settings.license.disabled') }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.license.integrations')">
              <NTag :type="data.license.featureEntitlements.integrations ? 'success' : 'default'" size="small">
                {{ data.license.featureEntitlements.integrations ? $t('admin.settings.license.enabled') : $t('admin.settings.license.disabled') }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.license.feedback')">
              <NTag :type="data.license.featureEntitlements.feedback ? 'success' : 'default'" size="small">
                {{ data.license.featureEntitlements.feedback ? $t('admin.settings.license.enabled') : $t('admin.settings.license.disabled') }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.license.integrationProviders')">
              <span v-if="licensedIntegrationProviders.length > 0">
                {{ licensedIntegrationProviders.join(', ') }}
              </span>
              <span v-else>{{ $t('common.none') }}</span>
            </NDescriptionsItem>
          </NDescriptions>
          <NProgress
            type="line"
            :percentage="licensePercent"
            :status="licenseStatus"
            :show-indicator="true"
          />

          <div class="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <div class="mb-4">
              <div class="text-sm font-semibold text-white">{{ $t('admin.settings.license.editor.title') }}</div>
              <div class="mt-1 text-xs text-zinc-400">{{ $t('admin.settings.license.editor.subtitle') }}</div>
            </div>

            <div class="grid gap-4 md:grid-cols-2">
              <div class="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                <label class="flex items-center gap-2 text-sm text-zinc-200">
                  <NCheckbox v-model:checked="licenseForm.limitHostsEnabled" />
                  <span>{{ $t('admin.settings.license.editor.limitHostsEnabled') }}</span>
                </label>
                <div class="mt-3">
                  <div class="mb-1 text-xs text-zinc-400">{{ $t('admin.settings.license.editor.maxHostsLabel') }}</div>
                  <NInputNumber
                    v-model:value="licenseForm.maxHosts"
                    :min="1"
                    :disabled="!licenseForm.limitHostsEnabled"
                    style="width: 100%;"
                  />
                  <div class="mt-1 text-xs text-zinc-500">{{ $t('admin.settings.license.editor.maxHostsHelp') }}</div>
                </div>
              </div>

              <div class="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  {{ $t('admin.settings.license.editor.featuresTitle') }}
                </div>
                <div class="flex flex-col gap-2 text-sm text-zinc-200">
                  <label class="flex items-center gap-2">
                    <NCheckbox v-model:checked="licenseForm.agents" />
                    <span>{{ $t('admin.settings.license.agents') }}</span>
                  </label>
                  <label class="flex items-center gap-2">
                    <NCheckbox v-model:checked="licenseForm.secrets" />
                    <span>{{ $t('admin.settings.license.secrets') }}</span>
                  </label>
                  <label class="flex items-center gap-2">
                    <NCheckbox v-model:checked="licenseForm.snippets" />
                    <span>{{ $t('admin.settings.license.snippets') }}</span>
                  </label>
                  <label class="flex items-center gap-2">
                    <NCheckbox v-model:checked="licenseForm.portForwarding" />
                    <span>{{ $t('admin.settings.license.localAccess') }}</span>
                  </label>
                  <label class="flex items-center gap-2">
                    <NCheckbox v-model:checked="licenseForm.integrations" />
                    <span>{{ $t('admin.settings.license.integrations') }}</span>
                  </label>
                  <label class="flex items-center gap-2">
                    <NCheckbox v-model:checked="licenseForm.feedback" />
                    <span>{{ $t('admin.settings.license.feedback') }}</span>
                  </label>
                </div>
              </div>
            </div>

            <div class="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
              <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                {{ $t('admin.settings.license.editor.providersTitle') }}
              </div>
              <div class="mb-2 text-xs text-zinc-500">{{ $t('admin.settings.license.editor.providersHelp') }}</div>
              <div class="flex flex-wrap gap-4 text-sm text-zinc-200">
                <label class="flex items-center gap-2">
                  <NCheckbox v-model:checked="licenseForm.jira" :disabled="!canEditIntegrationProviders" />
                  <span>JIRA</span>
                </label>
                <label class="flex items-center gap-2">
                  <NCheckbox v-model:checked="licenseForm.google" :disabled="!canEditIntegrationProviders" />
                  <span>Google</span>
                </label>
                <label class="flex items-center gap-2">
                  <NCheckbox v-model:checked="licenseForm.onepassword" :disabled="!canEditIntegrationProviders" />
                  <span>1Password</span>
                </label>
              </div>
            </div>

            <NSpace justify="end" class="mt-4">
              <NButton type="primary" :loading="licenseSaving" @click="saveLicense">
                {{ $t('admin.settings.license.editor.save') }}
              </NButton>
            </NSpace>
          </div>
        </NCard>

        <NCard :title="$t('admin.settings.sessionAudit.title')" :bordered="false" style="background: #1e1e22;">
          <NAlert
            v-if="!data.license.sessionAuditEnabled"
            type="warning"
            class="mb-4"
          >
            {{ $t('admin.settings.sessionAudit.notLicensed') }}
          </NAlert>

          <template v-else>
            <NDescriptions :column="2" label-placement="left" class="mb-4">
              <NDescriptionsItem :label="$t('admin.settings.sessionAudit.currentStatus')">
                <NTag :type="policyForm.enabled ? 'success' : 'default'" size="small">
                  {{ policyForm.enabled ? $t('admin.settings.license.enabled') : $t('admin.settings.license.disabled') }}
                </NTag>
              </NDescriptionsItem>
              <NDescriptionsItem :label="$t('admin.settings.sessionAudit.mode')">
                <NText>{{ $t(`admin.settings.sessionAudit.policy.modes.${policyForm.mode}`) }}</NText>
              </NDescriptionsItem>
            </NDescriptions>

            <div class="flex flex-col gap-4">
              <label class="flex items-center gap-2 text-sm text-zinc-200">
                <input v-model="policyForm.enabled" type="checkbox">
                <span>{{ $t('admin.settings.sessionAudit.enabledLabel') }}</span>
              </label>

              <div>
                <NText depth="3" class="text-sm">{{ $t('admin.settings.sessionAudit.mode') }}</NText>
                <NSelect
                  v-model:value="policyForm.mode"
                  :options="policyModeOptions"
                  class="mt-2"
                />
              </div>

              <div v-if="showUserScope">
                <NText depth="3" class="text-sm">{{ $t('admin.settings.sessionAudit.policy.usersTitle') }}</NText>
                <NTransfer
                  v-model:value="policyForm.userIds"
                  class="mt-2"
                  :options="userTransferOptions"
                  source-filterable
                  target-filterable
                />
              </div>

              <div v-if="showGroupScope">
                <NText depth="3" class="text-sm">{{ $t('admin.settings.sessionAudit.policy.groupsTitle') }}</NText>
                <NTransfer
                  v-model:value="policyForm.groupIds"
                  class="mt-2"
                  :options="groupTransferOptions"
                  source-filterable
                  target-filterable
                />
              </div>

              <NSpace justify="end">
                <NButton type="primary" :loading="policySaving" @click="savePolicy">
                  {{ $t('admin.settings.sessionAudit.policy.save') }}
                </NButton>
              </NSpace>
            </div>
          </template>
        </NCard>

        <NCard :title="$t('admin.settings.sessionLimits.title')" :bordered="false" style="background: #1e1e22;">
          <NDescriptions :column="2" label-placement="left">
            <NDescriptionsItem :label="$t('admin.settings.sessionLimits.activeSessions')">
              {{ data.sessionLimits.activeSessions }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.sessionLimits.maxPerUser')">
              {{ data.sessionLimits.maxPerUser ?? $t('common.unlimited') }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.sessionLimits.maxPerTenant')">
              {{ data.sessionLimits.maxPerTenant ?? $t('common.unlimited') }}
            </NDescriptionsItem>
          </NDescriptions>
          <NAlert type="info" class="mt-4" style="font-size: 12px;">
            {{ $t('admin.settings.sessionLimits.info') }}
          </NAlert>
        </NCard>

        <!-- Política de senhas -->
        <NCard :title="$t('admin.settings.passwordPolicy.title')" :bordered="false" style="background: #1e1e22;">
          <NDescriptions :column="1" label-placement="left">
            <NDescriptionsItem :label="$t('admin.settings.passwordPolicy.description')">
              {{ data.passwordPolicy.description }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.passwordPolicy.minLength')">
              {{ data.passwordPolicy.minLength }} {{ $t('admin.settings.passwordPolicy.characters') }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.passwordPolicy.regex')">
              <NText class="font-mono text-xs" depth="3">{{ data.passwordPolicy.regex }}</NText>
            </NDescriptionsItem>
          </NDescriptions>
          <NAlert type="info" class="mt-4" style="font-size: 12px;">
            {{ $t('admin.settings.passwordPolicy.envAlert') }}
          </NAlert>
        </NCard>

      </div>
    </NSpin>
  </div>
</template>
