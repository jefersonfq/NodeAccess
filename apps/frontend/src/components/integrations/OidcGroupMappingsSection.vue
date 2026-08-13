<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NAlert, NButton, NEmpty, NFormItem, NInput, NPopconfirm, NSelect, NSpin, useMessage } from 'naive-ui'
import type { GroupPublic, OidcGroupMappingPublic } from '@nodeaccess/shared'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import { groupService } from '@/services/group.service'
import { oidcGroupMappingService } from '@/services/oidc-group-mapping.service'

const { t } = useI18n()
const message = useMessage()
const loading = ref(true)
const saving = ref(false)
const externalGroup = ref('')
const groupId = ref<number | null>(null)
const mappings = ref<OidcGroupMappingPublic[]>([])
const groups = ref<GroupPublic[]>([])
const availableGroups = computed(() => groups.value.filter((group) => !mappings.value.some((mapping) => mapping.groupId === group.id)).map((group) => ({ label: group.name, value: group.id })))

async function load() {
  loading.value = true
  try {
    const [mappingResponse, groupResponse] = await Promise.all([oidcGroupMappingService.list(), groupService.list()])
    mappings.value = mappingResponse.data
    groups.value = groupResponse.data
  } catch { message.error(t('admin.integrations.oidc.groupMappings.loadError')) }
  finally { loading.value = false }
}

async function create() {
  if (!externalGroup.value.trim() || !groupId.value) return
  saving.value = true
  try {
    const { data } = await oidcGroupMappingService.create({ externalGroup: externalGroup.value.trim(), groupId: groupId.value })
    mappings.value = [...mappings.value, data].sort((a, b) => a.externalGroup.localeCompare(b.externalGroup))
    externalGroup.value = ''
    groupId.value = null
    message.success(t('admin.integrations.oidc.groupMappings.created'))
  } catch (error: unknown) {
    const apiError = error as { response?: { data?: { message?: string } } }
    message.error(apiError.response?.data?.message ?? t('admin.integrations.oidc.groupMappings.createError'))
  } finally { saving.value = false }
}

async function remove(id: number) {
  try {
    await oidcGroupMappingService.delete(id)
    mappings.value = mappings.value.filter((item) => item.id !== id)
    message.success(t('admin.integrations.oidc.groupMappings.deleted'))
  } catch { message.error(t('admin.integrations.oidc.groupMappings.deleteError')) }
}

onMounted(load)
</script>

<template>
  <CollapsibleSection :title="$t('admin.integrations.oidc.groupMappings.title')" body-class="mt-2 !bg-transparent">
    <NSpin :show="loading">
      <div class="space-y-4" data-testid="oidc-group-mappings">
        <NAlert type="warning" :show-icon="false">{{ $t('admin.integrations.oidc.groupMappings.warning') }}</NAlert>
        <div class="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
          <NFormItem :label="$t('admin.integrations.oidc.groupMappings.externalGroup')" :show-feedback="false">
            <NInput v-model:value="externalGroup" data-testid="oidc-external-group" :placeholder="$t('admin.integrations.oidc.groupMappings.externalPlaceholder')" @keyup.enter="create" />
          </NFormItem>
          <NFormItem :label="$t('admin.integrations.oidc.groupMappings.internalGroup')" :show-feedback="false">
            <NSelect v-model:value="groupId" data-testid="oidc-internal-group" :options="availableGroups" :placeholder="$t('admin.integrations.oidc.groupMappings.selectGroup')" filterable />
          </NFormItem>
          <NButton type="primary" :loading="saving" :disabled="!externalGroup.trim() || !groupId" @click="create">{{ $t('common.create') }}</NButton>
        </div>
        <NEmpty v-if="!mappings.length && !loading" :description="$t('admin.integrations.oidc.groupMappings.empty')" />
        <div v-else class="space-y-2">
          <div v-for="mapping in mappings" :key="mapping.id" class="mapping-row">
            <div class="min-w-0"><strong class="block truncate">{{ mapping.externalGroup }}</strong><span class="text-xs opacity-70">→ {{ mapping.groupName }}</span></div>
            <NPopconfirm @positive-click="remove(mapping.id)">
              <template #trigger><NButton tertiary type="error" size="small" :aria-label="$t('admin.integrations.oidc.groupMappings.removeFor', { group: mapping.externalGroup })">{{ $t('common.delete') }}</NButton></template>
              {{ $t('admin.integrations.oidc.groupMappings.removeConfirm') }}
            </NPopconfirm>
          </div>
        </div>
      </div>
    </NSpin>
  </CollapsibleSection>
</template>

<style scoped>
.mapping-row { display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:.75rem; border:1px solid var(--na-border); border-radius:.75rem; background:var(--na-surface-soft); }
@media (max-width:640px) { .mapping-row { align-items:flex-start; } }
</style>
