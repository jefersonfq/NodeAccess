<script setup lang="ts">
import type { SecretActionHandle, PemActionHandle } from '@/components/vault/action-handles'
import { computed, h, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NAlert, NButton, NDataTable, NDropdown, NEmpty, NInput, NSelect, NTag, NText } from 'naive-ui'
import type { VNodeChild } from 'vue'
import type { DropdownOption } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { FEATURES_UPDATED_EVENT } from '@/services/features.service'
import { useVaultCatalog } from '@/composables/useVaultCatalog'
import { canManageVaultEntry, filterVaultEntries, type VaultEntry, type VaultKind } from '@/services/vault-catalog'
import SecretActions from '@/components/vault/SecretActions.vue'
import PemKeyActions from '@/components/vault/PemKeyActions.vue'
import VaultDeliveryPanel from '@/components/vault/VaultDeliveryPanel.vue'
import ExtensionDevices from '@/components/vault/ExtensionDevices.vue'
import { useRoute, useRouter } from 'vue-router'

const { t } = useI18n()
const auth = useAuthStore()
const catalog = useVaultCatalog()
const { secretState, pemState, loading, generation } = catalog
const secretActions = ref<SecretActionHandle | null>(null)
const pemActions = ref<PemActionHandle | null>(null)
const deliveryPanel = ref<InstanceType<typeof VaultDeliveryPanel> | null>(null)
const search = ref('')
const kind = ref<VaultKind | 'all'>('all')
const includeRevoked = ref(false)
const canListPem = computed(() => auth.isAdmin || !!auth.user?.canManageHosts)
const route = useRoute(), router = useRouter()
// NA-0183: the extension opens items as /vault?kind=<secret|pem>&id=<n>; only that entry is shown until cleared.
const focus = computed(() => {
  const k = route.query.kind, id = route.query.id
  return (k === 'secret' || k === 'pem') && typeof id === 'string' && /^\d{1,9}$/.test(id) ? `${k}:${id}` : ''
})
function clearFocus(): void { void router.replace({ name: 'vault' }) }
const filtered = computed(() => {
  const entries = filterVaultEntries(catalog.entries.value, search.value, kind.value)
  return focus.value ? entries.filter(entry => entry.key === focus.value) : entries
})
const partialError = computed(() => secretState.value === 'error' || pemState.value === 'error')
const typeOptions = computed(() => [
  { label: t('vault.allTypes'), value: 'all' },
  { label: t('vault.secretType'), value: 'secret' },
  { label: t('vault.pemType'), value: 'pem' },
])
function reload(): Promise<void> {
  deliveryPanel.value?.lock()
  return catalog.load({ includeRevoked: includeRevoked.value, canListPem: canListPem.value })
}
watch(() => [auth.user?.id, auth.user?.tenantId, auth.user?.actingTenantId, auth.isAdmin, canListPem.value], () => {
  search.value = ''
  kind.value = 'all'
  includeRevoked.value = false
  void reload()
}, { immediate: true })
function onFeaturesUpdated(): void { void reload() }
onMounted(() => window.addEventListener(FEATURES_UPDATED_EVENT, onFeaturesUpdated))
onBeforeUnmount(() => {
  window.removeEventListener(FEATURES_UPDATED_EVENT, onFeaturesUpdated)
  catalog.dispose()
})
function act(entry: VaultEntry, action: string): void {
  if (!canManageVaultEntry(entry, auth.user?.id, auth.isAdmin)) return
  if (entry.kind === 'pem') {
    if (action === 'passphrase') pemActions.value?.openPassphrase(entry.record)
    if (action === 'delete') void pemActions.value?.remove(entry.record)
    return
  }
  if (action === 'consumers') void secretActions.value?.openConsumers(entry.record)
  if (action === 'edit') secretActions.value?.openEdit(entry.record)
  if (action === 'rotate') secretActions.value?.openRotate(entry.record)
  if (action === 'revoke') secretActions.value?.revoke(entry.record)
  if (action === 'delete') secretActions.value?.remove(entry.record)
}
function actionOptions(entry: VaultEntry): DropdownOption[] {
  if (entry.kind === 'pem') return [
    { key: 'passphrase', label: t(entry.record.hasPassphrase ? 'pemKeys.changePassphrase' : 'pemKeys.addPassphrase') },
    { key: 'delete', label: t('common.delete') },
  ]
  return [
    { key: 'consumers', label: `${t('secrets.consumers.action')} (${entry.record.usageCount ?? '—'})` },
    { key: 'edit', label: t('common.edit'), disabled: !!entry.record.revokedAt },
    { key: 'rotate', label: t('secrets.rotate'), disabled: !!entry.record.revokedAt },
    { key: 'revoke', label: t('secrets.revoke'), disabled: !!entry.record.revokedAt },
    { key: 'delete', label: t('common.delete') },
  ]
}
const columns = computed<DataTableColumns<VaultEntry>>(() => [
  { title: t('vault.name'), key: 'name', minWidth: 220, render: (entry): VNodeChild => h('div', { class: 'break-words' }, [
    h('div', { class: entry.kind === 'secret' ? 'font-mono' : 'font-medium' }, entry.name),
    entry.kind === 'secret' && entry.record.description ? h('div', { class: 'mt-1 text-xs text-gray-400' }, entry.record.description) : null,
  ]) },
  { title: t('vault.type'), key: 'kind', width: 120, render: (entry): VNodeChild => t(entry.kind === 'secret' ? 'vault.secretType' : 'vault.pemType') },
  { title: t('vault.access'), key: 'access', width: 190, render: (entry): VNodeChild => entry.kind === 'secret'
    ? `${t(`secrets.scopes.${entry.record.scope}`)}${entry.record.scope === 'GROUP' ? ` · #${entry.record.groupId}` : ''}`
    : entry.record.createdByName
      ? t('vault.pemOwnerNamed', { name: entry.record.createdByName, id: entry.record.createdById })
      : t('vault.pemOwner', { id: entry.record.createdById }) },
  { title: t('vault.status'), key: 'status', width: 170, render: (entry): VNodeChild => entry.kind === 'secret'
    ? h(NTag, { size: 'small', type: entry.record.revokedAt ? 'error' : 'success' }, () => t(entry.record.revokedAt ? 'secrets.status.revoked' : 'secrets.status.active'))
    : t(entry.record.hasPassphrase ? 'vault.withPassphrase' : 'vault.withoutPassphrase') },
  { title: t('vaultDelivery.values'), key: 'delivery', width: 190, render: (entry): VNodeChild => entry.kind === 'secret' && !entry.record.revokedAt
    ? h('div', { class: 'flex flex-wrap gap-2' }, (['reveal', 'copy'] as const).map(action => h(NButton, {
      size: 'small', secondary: true, disabled: deliveryPanel.value?.available !== true, 'aria-label': `${t(`vaultDelivery.${action}`)}: ${entry.name}`,
      onClick: (): void => { deliveryPanel.value?.request(action, entry.record.id, entry.name) },
    }, () => t(`vaultDelivery.${action}`)))) : '—' },
  { title: t('common.actions'), key: 'actions', width: 130, render: (entry): VNodeChild => h(NDropdown, {
    trigger: 'click', placement: 'bottom-end', options: actionOptions(entry), onSelect: (action: string) => act(entry, action),
  }, { default: () => h(NButton, {
    size: 'small', secondary: true, disabled: !canManageVaultEntry(entry, auth.user?.id, auth.isAdmin),
    'aria-label': `${t('common.actions')}: ${entry.name}`,
  }, () => t('common.actions')) }) },
])
</script>

<template>
  <section
    class="min-w-0 p-4 sm:p-6"
    aria-labelledby="vault-title"
  >
    <header class="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <h1
          id="vault-title"
          class="text-xl font-semibold"
        >
          VaultNAccess
        </h1>
        <NText depth="3">
          {{ t('vault.subtitle') }}
        </NText>
      </div>
      <div class="flex flex-wrap gap-2">
        <NButton
          v-if="secretState === 'ready'"
          type="primary"
          @click="secretActions?.openCreate()"
        >
          {{ t('secrets.new') }}
        </NButton>
        <NButton
          v-if="pemState === 'ready'"
          secondary
          @click="pemActions?.openCreate()"
        >
          {{ t('vault.importPem') }}
        </NButton>
        <NButton
          :loading="loading"
          @click="reload"
        >
          {{ t('vault.refresh') }}
        </NButton>
      </div>
    </header>
    <p class="mb-4 text-sm text-gray-400">
      {{ t('vaultDelivery.catalogHint') }}
    </p>
    <VaultDeliveryPanel ref="deliveryPanel" />
    <ExtensionDevices />
    <NAlert
      v-if="focus"
      type="info"
      class="mb-4"
      data-testid="vault-focus"
    >
      {{ t('vaultExtension.focused') }}
      <NButton
        text
        type="primary"
        class="ml-2"
        @click="clearFocus"
      >
        {{ t('vaultExtension.showAll') }}
      </NButton>
    </NAlert>
    <NAlert
      v-if="secretState === 'unlicensed'"
      type="info"
      class="mb-4"
    >
      {{ t('secrets.license.description') }}
    </NAlert>
    <NAlert
      v-if="partialError"
      type="error"
      class="mb-4"
      :title="t('vault.partialError')"
      role="alert"
    >
      <p v-if="secretState === 'error'">
        {{ t('vault.secretError') }}
      </p>
      <p v-if="pemState === 'error'">
        {{ t('vault.pemError') }}
      </p>
      <NButton
        class="mt-2"
        size="small"
        :loading="loading"
        @click="reload"
      >
        {{ t('vault.retry') }}
      </NButton>
    </NAlert>
    <div class="mb-4 flex flex-col gap-3 sm:flex-row">
      <NInput
        v-model:value="search"
        clearable
        :placeholder="t('vault.search')"
        :input-props="{ 'aria-label': t('vault.search') }"
      />
      <NSelect
        v-model:value="kind"
        :options="typeOptions"
        :aria-label="t('vault.type')"
        class="sm:max-w-48"
      />
      <NButton
        v-if="secretState === 'ready'"
        :aria-pressed="includeRevoked"
        @click="includeRevoked = !includeRevoked; reload()"
      >
        {{ t(includeRevoked ? 'secrets.hideRevoked' : 'secrets.showRevoked') }}
      </NButton>
    </div>
    <div
      class="min-w-0"
      :aria-busy="loading"
    >
      <NDataTable
        :columns="columns"
        :data="filtered"
        :loading="loading"
        :row-key="(entry: VaultEntry) => entry.key"
        :row-props="(entry: VaultEntry) => ({ class: 'vault-row', 'data-vault-id': entry.key })"
        :scroll-x="1020"
      >
        <template #empty>
          <NEmpty :description="t(partialError ? 'vault.partialEmpty' : search || kind !== 'all' ? 'vault.noResults' : 'vault.empty')" />
        </template>
      </NDataTable>
    </div>
    <SecretActions
      v-if="secretState === 'ready'"
      :key="`secret:${generation}`"
      ref="secretActions"
      :licensed="true"
      @changed="reload"
    />
    <PemKeyActions
      v-if="pemState === 'ready'"
      :key="`pem:${generation}`"
      ref="pemActions"
      @changed="reload"
    />
  </section>
</template>
