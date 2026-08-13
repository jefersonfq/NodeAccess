<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NAlert, NButton, NCard, NCode, NDivider, NSpin, NSwitch, NTag, NText, useDialog, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import { scimService, type ScimConfigPublic } from '@/services/scim.service'

const { t } = useI18n()
const dialog = useDialog()
const message = useMessage()
const loading = ref(true)
const saving = ref(false)
const rotating = ref(false)
const loadError = ref(false)
const config = ref<ScimConfigPublic | null>(null)
const newToken = ref<string | null>(null)
const baseUrl = computed(() => `${window.location.origin}/api/v1/scim/v2`)

async function load() {
  loading.value = true
  loadError.value = false
  try { config.value = (await scimService.getConfig()).data } catch { loadError.value = true } finally { loading.value = false }
}

async function toggle(enabled: boolean) {
  if (!config.value) return
  saving.value = true
  try {
    config.value = (await scimService.setEnabled(enabled)).data
    message.success(t('admin.integrations.scim.saved'))
  } catch (error: unknown) {
    const apiError = error as { response?: { data?: { message?: string } } }
    message.error(apiError.response?.data?.message ?? t('admin.integrations.scim.saveError'))
  } finally { saving.value = false }
}

function confirmRotate() {
  dialog.warning({
    title: t('admin.integrations.scim.rotateTitle'),
    content: t('admin.integrations.scim.rotateWarning'),
    positiveText: t('admin.integrations.scim.rotate'), negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      rotating.value = true
      try {
        const { data } = await scimService.rotateToken()
        newToken.value = data.token
        config.value = { enabled: false, tokenConfigured: true, tokenPrefix: data.tokenPrefix, rotatedAt: data.rotatedAt }
        message.success(t('admin.integrations.scim.rotated'))
      } catch { message.error(t('admin.integrations.scim.rotateError')); return false } finally { rotating.value = false }
    },
  })
}

onMounted(load)
</script>

<template>
  <NCard :bordered="false" class="mb-4" style="background: var(--na-surface-raised);">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div class="flex items-center gap-2">
          <span class="font-semibold text-white">SCIM 2.0</span>
          <NTag :type="config?.enabled ? 'success' : 'default'" size="small">
            {{ config?.enabled ? $t('admin.integrations.scim.active') : $t('admin.integrations.scim.inactive') }}
          </NTag>
        </div>
        <NText depth="3" class="text-xs">{{ $t('admin.integrations.scim.description') }}</NText>
      </div>
      <NSwitch
        :value="config?.enabled ?? false"
        :disabled="!config?.tokenConfigured || loading"
        :loading="saving"
        :aria-label="$t('admin.integrations.scim.enable')"
        @update:value="toggle"
      />
    </div>
    <NDivider style="margin: 16px 0;" />
    <CollapsibleSection :title="$t('admin.integrations.scim.configuration')" body-class="mt-2 !bg-transparent">
      <NSpin :show="loading">
        <NAlert v-if="loadError" type="error" :title="$t('admin.integrations.scim.loadError')">
          <NButton size="small" class="mt-2" @click="load">{{ $t('admin.integrations.scim.retry') }}</NButton>
        </NAlert>
        <div v-else class="space-y-3">
          <div>
            <div class="text-xs font-medium text-gray-300">{{ $t('admin.integrations.scim.endpoint') }}</div>
            <NCode :code="baseUrl" word-wrap />
          </div>
          <NAlert type="info" :show-icon="false">{{ $t('admin.integrations.scim.tokenHelp') }}</NAlert>
          <NAlert v-if="newToken" type="warning" :title="$t('admin.integrations.scim.copyNow')">
            <NCode :code="newToken" word-wrap />
          </NAlert>
          <div v-else-if="config?.tokenConfigured" class="text-xs text-gray-400">
            {{ $t('admin.integrations.scim.tokenConfigured', { prefix: config.tokenPrefix }) }}
          </div>
          <div class="flex justify-end">
            <NButton :loading="rotating" @click="confirmRotate">{{ $t('admin.integrations.scim.rotate') }}</NButton>
          </div>
        </div>
      </NSpin>
    </CollapsibleSection>
  </NCard>
</template>
