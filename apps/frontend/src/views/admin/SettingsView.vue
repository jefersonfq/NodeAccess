<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NAlert, NButton, NCard, NDescriptions, NDescriptionsItem, NProgress, NSelect,
  NSpace, NSpin, NTag, NText, NTransfer, useMessage,
} from 'naive-ui'
import type { SessionAuditPolicyMode, SessionAuditPolicyPublic, UserPublic, GroupPublic } from '@nodeaccess/shared'
import { settingsService, type SettingsData } from '@/services/settings.service'
import { sessionAuditPolicyService } from '@/services/sessionAuditPolicy.service'
import { userService } from '@/services/user.service'
import { groupService } from '@/services/group.service'

const { t } = useI18n()
const message = useMessage()

const loading = ref(false)
const error   = ref<string | null>(null)
const data    = ref<SettingsData | null>(null)
const policySaving = ref(false)
const policy = ref<SessionAuditPolicyPublic | null>(null)
const users = ref<UserPublic[]>([])
const groups = ref<GroupPublic[]>([])

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
          </NDescriptions>
          <NProgress
            type="line"
            :percentage="licensePercent"
            :status="licenseStatus"
            :show-indicator="true"
          />
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
