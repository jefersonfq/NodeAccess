<script setup lang="ts">
import type { SecretActionHandle } from '@/components/vault/action-handles'
import { computed, h, onMounted, onBeforeUnmount, watch, ref } from 'vue'
import { NAlert, NButton, NDataTable, NDropdown, NEmpty, NInput, NSpace, NTag, NText } from 'naive-ui'
import type { VNodeChild } from 'vue'
import type { DataTableColumns } from 'naive-ui'
import type { GroupPublic, SecretPublic, SecretScope } from '@nodeaccess/shared'
import { useI18n } from 'vue-i18n'
import { secretService } from '@/services/secret.service'
import { groupService } from '@/services/group.service'
import { useAuthStore } from '@/stores/auth'
import { featuresService, FEATURES_UPDATED_EVENT } from '@/services/features.service'
import SecretActions from '@/components/vault/SecretActions.vue'
const { t } = useI18n()
const auth = useAuthStore()
const actions = ref<SecretActionHandle | null>(null)
const secrets = ref<SecretPublic[]>([])
const groups = ref<GroupPublic[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const secretsLicensed = ref(false)
const generation = ref(0)
let active = true
const includeRevoked = ref(false)
const search = ref('')
const openCreate = (): void => actions.value?.openCreate()
const openEdit = (row: SecretPublic): void => actions.value?.openEdit(row)
const openRotate = (row: SecretPublic): void => actions.value?.openRotate(row)
const openConsumers = (row: SecretPublic): void => { void actions.value?.openConsumers(row) }
const revoke = (row: SecretPublic): void => actions.value?.revoke(row)
const remove = (row: SecretPublic): void => actions.value?.remove(row)
const filteredSecrets = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  if (!query) return secrets.value
  return secrets.value.filter((secret) =>
    [secret.alias, secret.description, secret.createdByUsername, secret.scope]
      .some((value) => value?.toLocaleLowerCase().includes(query)),
  )
})

function canManageSecret(row: SecretPublic): boolean {
  return auth.isAdmin || row.ownerUserId === auth.user?.id || (row.scope === 'GROUP' && row.createdByUserId === auth.user?.id)
}

const columns = computed<DataTableColumns<SecretPublic>>(() => [
  {
    title: t('secrets.columns.alias'),
    key: 'alias',
    render: (row): VNodeChild => h('div', { class: 'space-y-1' }, [
      h('div', { class: 'font-mono text-sm text-gray-100' }, row.alias),
      row.description
        ? h('div', { class: 'text-xs text-gray-500' }, row.description)
        : h('div', { class: 'text-xs text-gray-600' }, t('secrets.noDescription')),
    ]),
  },
  {
    title: t('secrets.columns.scope'),
    key: 'scope',
    width: 180,
    render: (row): VNodeChild => h('div', { class: 'space-y-1' }, [
      h(NTag, { size: 'small', type: scopeTagType(row.scope) }, () => t(`secrets.scopes.${row.scope}`)),
      row.scope === 'GROUP' && row.groupId
        ? h('div', { class: 'text-[11px] text-gray-500' }, groupName(row.groupId))
        : null,
    ]),
  },
  {
    title: t('secrets.columns.createdBy'),
    key: 'createdBy',
    width: 180,
    render: (row): VNodeChild => h('div', { class: 'space-y-0.5' }, [
      h('div', { class: 'text-sm text-gray-300' }, row.createdByUsername ?? t('common.unknown')),
      h('div', { class: 'text-[11px] text-gray-500' }, t(`secrets.sources.${row.source}`)),
    ]),
  },
  {
    title: t('secrets.columns.status'),
    key: 'status',
    width: 150,
    render: (row): VNodeChild => h(NTag, { size: 'small', type: row.revokedAt ? 'error' : 'success' }, () =>
      row.revokedAt ? t('secrets.status.revoked') : t('secrets.status.active'),
    ),
  },
  {
    title: t('secrets.columns.rotatedAt'),
    key: 'rotatedAt',
    width: 170,
    render: (row): VNodeChild => row.rotatedAt ? new Date(row.rotatedAt).toLocaleString() : t('common.none'),
  },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 210,
    render: (row): VNodeChild => h(NSpace, { size: 8, wrap: false }, () => [
      h(NButton, { size: 'small', secondary: true, disabled: !canManageSecret(row), 'aria-label': `${t('secrets.consumers.action')}: ${row.usageCount ?? '—'}`, onClick: () => { void openConsumers(row) } }, {
        default: () => [
          h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'aria-hidden': 'true', class: 'mr-1' }, [
            h('path', { d: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2' }),
          ]),
          t('secrets.consumers.action'),
          h('span', { class: 'ml-2 rounded-full bg-cyan-400/15 px-1.5 text-xs font-semibold text-cyan-300', 'data-secret-usage': row.id }, String(row.usageCount ?? '—')),
        ],
      }),
      h(NDropdown, {
        trigger: 'click', placement: 'bottom-end',
        options: [
          { key: 'edit', label: t('common.edit'), disabled: !!row.revokedAt },
          { key: 'rotate', label: t('secrets.rotate'), disabled: !!row.revokedAt },
          { key: 'revoke', label: t('secrets.revoke'), disabled: !!row.revokedAt },
          { type: 'divider', key: 'divider' },
          { key: 'delete', label: () => h('span', { class: 'text-red-400' }, t('common.delete')) },
        ],
        onSelect: (key: string): void => {
          if (key === 'edit') openEdit(row)
          else if (key === 'rotate') openRotate(row)
          else if (key === 'revoke') void revoke(row)
          else if (key === 'delete') void remove(row)
        },
      }, { default: () => h(NButton, { size: 'small', secondary: true, disabled: !canManageSecret(row), 'aria-label': `${t('common.actions')}: ${row.alias}` }, () => t('common.actions')) }),
    ]),
  },
])

function scopeTagType(scope: SecretScope): 'warning' | 'info' | 'default' {
  if (scope === 'TENANT') return 'warning'
  if (scope === 'GROUP') return 'info'
  return 'default'
}

function groupName(groupId: number): string {
  return groups.value.find((group) => group.id === groupId)?.name ?? t('secrets.groupUnknown')
}

async function load(): Promise<void> {
  const request = ++generation.value
  secretsLicensed.value = false
  secrets.value = []
  groups.value = []
  loading.value = true
  error.value = null
  try {
    const features = await featuresService.get()
    if (!active || request !== generation.value) return
    secretsLicensed.value = features.secretsLicensed
    if (!secretsLicensed.value) return
    const [{ data: secretRows }, { data: groupRows }] = await Promise.all([
      secretService.list(includeRevoked.value), groupService.list(),
    ])
    if (!active || request !== generation.value) return
    secrets.value = secretRows
    groups.value = groupRows
  } catch {
    if (active && request === generation.value) error.value = t('secrets.messages.loadError')
  } finally {
    if (active && request === generation.value) loading.value = false
  }
}
watch(() => [auth.user?.id, auth.user?.tenantId, auth.user?.actingTenantId, auth.isAdmin], () => {
  search.value = ''
  includeRevoked.value = false
  void load()
}, { immediate: true })
function onFeaturesUpdated(): void { void load() }
onMounted(() => window.addEventListener(FEATURES_UPDATED_EVENT, onFeaturesUpdated))
onBeforeUnmount(() => {
  active = false
  generation.value++
  window.removeEventListener(FEATURES_UPDATED_EVENT, onFeaturesUpdated)
})
</script>
<template>
  <div class="p-6">
    <div class="flex items-center justify-between gap-4 mb-3">
      <div>
        <h1 class="text-xl font-semibold text-white">
          {{ $t('secrets.title') }}
        </h1>
        <NText
          depth="3"
          class="text-xs"
        >
          {{ $t('secrets.subtitle') }}
        </NText>
      </div>
      <NButton
        type="primary"
        :disabled="!secretsLicensed"
        @click="openCreate"
      >
        + {{ $t('secrets.new') }}
      </NButton>
    </div>

    <NAlert
      v-if="!secretsLicensed"
      type="warning"
      class="mb-4"
      :show-icon="true"
    >
      <template #header>
        {{ $t('secrets.license.title') }}
      </template>
      {{ $t('secrets.license.description') }}
    </NAlert>

    <div
      v-if="secretsLicensed"
      class="grid grid-cols-1 gap-3 mb-4 xl:grid-cols-3"
    >
      <NAlert
        type="info"
        :show-icon="true"
      >
        {{ $t('secrets.security.storage') }}
      </NAlert>
      <NAlert
        type="warning"
        :show-icon="true"
      >
        {{ $t('secrets.security.noReveal') }}
      </NAlert>
      <NAlert
        type="success"
        :show-icon="true"
      >
        {{ $t('secrets.security.usage') }}
      </NAlert>
    </div>

    <div
      v-if="secretsLicensed"
      class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <NText
        depth="3"
        class="text-xs"
      >
        {{ $t('secrets.policyHint') }}
      </NText>
      <div class="flex w-full gap-2 sm:w-auto">
        <NInput
          v-model:value="search"
          clearable
          :placeholder="$t('secrets.searchPlaceholder')"
          class="min-w-0 sm:w-64"
        />
        <NButton
          size="small"
          ghost
          @click="includeRevoked = !includeRevoked; load()"
        >
          {{ includeRevoked ? $t('secrets.hideRevoked') : $t('secrets.showRevoked') }}
        </NButton>
      </div>
    </div>

    <NAlert
      v-if="error"
      type="error"
      class="mb-4"
      :title="error"
    />
    <NAlert
      v-if="!secretsLicensed"
      type="info"
      class="mb-4"
      :show-icon="true"
    >
      {{ $t('secrets.license.description') }}
    </NAlert>

    <NDataTable
      v-if="secretsLicensed"
      :columns="columns"
      :data="filteredSecrets"
      :loading="loading"
      :row-key="(row) => row.id"
    />
    <NEmpty
      v-if="secretsLicensed && !loading && filteredSecrets.length === 0"
      class="py-12"
      :description="search ? $t('secrets.noSearchResults') : $t('secrets.empty')"
    >
      <template
        v-if="!search"
        #extra
      >
        <NButton
          type="primary"
          @click="openCreate"
        >
          {{ $t('secrets.new') }}
        </NButton>
      </template>
    </NEmpty>

    <SecretActions
      v-if="secretsLicensed"
      :key="generation"
      ref="actions"
      :licensed="secretsLicensed"
      @changed="load"
    />
  </div>
</template>
