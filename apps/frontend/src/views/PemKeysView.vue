<script setup lang="ts">
import type { PemActionHandle } from '@/components/vault/action-handles'
import { ref, computed, onBeforeUnmount, watch, h } from 'vue'
import { NDataTable, NButton, NSpace, NAlert, NText } from 'naive-ui'
import type { VNodeChild } from 'vue'
import type { DataTableColumns } from 'naive-ui'
import type { PemKeyPublic } from '@nodeaccess/shared'
import { useI18n } from 'vue-i18n'
import { pemKeyService } from '@/services/pem-key.service'
import { useAuthStore } from '@/stores/auth'
import PemKeyActions from '@/components/vault/PemKeyActions.vue'
const { t } = useI18n()
const auth = useAuthStore()
const generation = ref(0)
let active = true
const actions = ref<PemActionHandle | null>(null)
const keys = ref<PemKeyPublic[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const openCreate = (): void => actions.value?.openCreate()
const openPassphrase = (key: PemKeyPublic): void => actions.value?.openPassphrase(key)
const remove = (key: PemKeyPublic): void => actions.value?.remove(key)
const columns = computed<DataTableColumns<PemKeyPublic>>(() => [
  { title: t('pemKeys.columns.name'), key: 'name' },
  {
    title: t('pemKeys.columns.createdAt'),
    key: 'createdAt',
    render: (row): VNodeChild => new Date(row.createdAt).toLocaleDateString('pt-BR'),
  },
  {
    title: t('pemKeys.columns.actions'),
    key: 'actions',
    render: (row): VNodeChild => h(NSpace, {}, () => [
      h(NButton, { size: 'small', secondary: true, onClick: () => openPassphrase(row) }, () => row.hasPassphrase ? t('pemKeys.changePassphrase') : t('pemKeys.addPassphrase')),
      h(NButton, { size: 'small', type: 'error', onClick: () => remove(row) }, () => t('pemKeys.deleteBtn')),
    ]),
  },
])

async function load(): Promise<void> {
  const request = ++generation.value
  keys.value = []
  loading.value = true
  error.value   = null
  try {
    const { data } = await pemKeyService.list()
    if (active && request === generation.value) keys.value = data
  } catch {
    if (active && request === generation.value) error.value = t('pemKeys.messages.saveError')
  } finally {
    if (active && request === generation.value) loading.value = false
  }
}

watch(() => [auth.user?.id, auth.user?.tenantId, auth.user?.actingTenantId, auth.isAdmin], load, { immediate: true })
onBeforeUnmount(() => { active = false; generation.value++ })

</script>
<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-2">
      <div>
        <h1 class="text-xl font-semibold text-white">
          {{ $t('pemKeys.title') }}
        </h1>
        <NText
          depth="3"
          class="text-xs"
        >
          {{ auth.isAdmin ? $t('pemKeys.subtitleAdmin') : $t('pemKeys.subtitleUser') }}
        </NText>
      </div>
      <NButton
        type="primary"
        @click="openCreate"
      >
        {{ $t('pemKeys.newKey') }}
      </NButton>
    </div>

    <NAlert
      class="mb-4 mt-3"
      type="info"
      :show-icon="true"
    >
      {{ $t('pemKeys.infoText') }}
    </NAlert>

    <NAlert
      v-if="error"
      type="error"
      class="mb-4"
      :title="error"
    />

    <NDataTable
      :columns="columns"
      :data="keys"
      :loading="loading"
      :row-key="(r) => r.id"
    />

    <PemKeyActions
      v-if="!loading"
      :key="generation"
      ref="actions"
      @changed="load"
    />
  </div>
</template>
