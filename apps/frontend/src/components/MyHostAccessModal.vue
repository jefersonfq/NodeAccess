<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { NAlert, NButton, NModal, NSpin } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { EffectiveInventoryPermissions } from '@nodeaccess/shared'
import { inventoryAclService } from '@/services/inventory-acl.service'
import { useAuthStore } from '@/stores/auth'
import AclPermissionSummary from './AclPermissionSummary.vue'
const props = defineProps<{ hostId: number; hostName: string }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const auth = useAuthStore()
const result = ref<EffectiveInventoryPermissions | null>(null)
const loading = ref(false)
const error = ref(false)
let generation = 0
async function load(): Promise<void> {
  const current = ++generation
  loading.value = true; error.value = false; result.value = null
  try {
    const { data } = await inventoryAclService.ownHostAccess(props.hostId)
    if (current === generation) result.value = data
  } catch { if (current === generation) error.value = true }
  finally { if (current === generation) loading.value = false }
}
watch(() => props.hostId, () => { void load() }, { immediate: true })
onUnmounted(() => { generation++ })
</script>
<template>
  <NModal
    class="my-host-access-modal"
    :show="true"
    preset="card"
    :title="`${t('hosts.inventoryAcl.ux.myAccess')} — ${hostName}`"
    style="width: min(640px, calc(100vw - 32px))"
    @update:show="emit('close')"
  >
    <NSpin
      :show="loading"
      style="max-height: 70vh; overflow-y: auto"
    >
      <NAlert
        v-if="error"
        type="error"
      >
        {{ t('hosts.inventoryAcl.ux.myAccessError') }}
        <NButton
          text
          @click="load"
        >
          {{ t('hosts.inventoryAcl.retry') }}
        </NButton>
      </NAlert>
      <template v-else-if="result">
        <AclPermissionSummary :permissions="result" />
        <p
          v-if="auth.isAdmin"
          class="mt-3"
        >
          {{ t('hosts.inventoryAcl.ux.adminAccess') }}
        </p>
        <p
          v-if="!result.admin && result.sources.some(source => source.permissions.admin)"
          class="mt-3"
        >
          {{ t('hosts.inventoryAcl.ux.managementRequired') }}
        </p>
        <ul class="mt-4 space-y-2">
          <li
            v-for="source in result.sources"
            :key="source.aclEntryId"
          >
            <strong>{{ source.principalName }}</strong> · {{ source.inventoryNodeName }}
            <AclPermissionSummary :permissions="source.permissions" />
          </li>
        </ul>
      </template>
    </NSpin>
  </NModal>
</template>
