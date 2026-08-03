<script setup lang="ts">
import { computed, h, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NAlert,
  NButton,
  NCheckbox,
  NEmpty,
  NFormItem,
  NSelect,
  NSpace,
  NSpin,
  NTooltip,
  useDialog,
  useMessage,
} from 'naive-ui'
import type {
  AclPrincipalType,
  InventoryAclImpactPreviewResult,
  InventoryAclEntryPublic,
  InventoryPermissions,
} from '@nodeaccess/shared'
import { groupService } from '@/services/group.service'
import { inventoryAclService } from '@/services/inventory-acl.service'
import { userService } from '@/services/user.service'
import InventoryAclEntriesTable from './InventoryAclEntriesTable.vue'

const props = defineProps<{
  inventoryNodeId?: number | null
  itemName: string
  active?: boolean
}>()

const { t } = useI18n()
const dialog = useDialog()
const message = useMessage()
const loading = ref(false)
const saving = ref(false)
const previewing = ref(false)
const error = ref('')
const entries = ref<InventoryAclEntryPublic[]>([])
const principalType = ref<AclPrincipalType>('GROUP')
const principalId = ref<number | null>(null)
const permissions = ref<InventoryPermissions>({
  view: true,
  connect: false,
  edit: false,
  admin: false,
})
const userOptions = ref<Array<{ label: string; value: number }>>([])
const groupOptions = ref<Array<{ label: string; value: number }>>([])

const active = computed(() => props.active !== false && props.inventoryNodeId != null)
const localEntries = computed(() => entries.value.filter((entry) => entry.local))
const inheritedEntries = computed(() => entries.value.filter((entry) => !entry.local))
const principalOptions = computed(() =>
  principalType.value === 'USER' ? userOptions.value : groupOptions.value,
)

function labelsFromPermissions(value: InventoryPermissions): string[] {
  return [
    value.view && t('hosts.inventoryAcl.view'),
    value.connect && t('hosts.inventoryAcl.connect'),
    value.edit && t('hosts.inventoryAcl.edit'),
    value.admin && t('hosts.inventoryAcl.admin'),
  ].filter((item): item is string => Boolean(item))
}

function permissionSummary(value: InventoryPermissions | null | undefined): string {
  const labels = value ? labelsFromPermissions(value) : []
  return labels.length ? labels.join(', ') : t('hosts.inventoryAcl.impact.none')
}

function renderImpactContent(preview: InventoryAclImpactPreviewResult, intro?: string) {
  return h('div', { class: 'acl-impact-preview' }, [
    ...(intro ? [h('p', { class: 'acl-impact-preview__intro' }, intro)] : []),
    h('div', { class: 'acl-impact-preview__meta' }, [
      h('div', { class: 'acl-impact-preview__meta-row' }, t('hosts.inventoryAcl.impact.hosts', { count: preview.affectedHostCount })),
      h('div', { class: 'acl-impact-preview__meta-row' }, t('hosts.inventoryAcl.impact.sessions', { count: preview.activeSessionCount })),
    ]),
    h('div', { class: 'acl-impact-preview__permissions' }, [
      h('div', { class: 'acl-impact-preview__permission-row' }, [
        h('span', { class: 'acl-impact-preview__permission-label' }, t('hosts.inventoryAcl.impact.beforeLabel')),
        h('strong', { class: 'acl-impact-preview__permission-value' }, permissionSummary(preview.before)),
      ]),
      h('div', { class: 'acl-impact-preview__permission-row' }, [
        h('span', { class: 'acl-impact-preview__permission-label' }, t('hosts.inventoryAcl.impact.afterLabel')),
        h('strong', { class: 'acl-impact-preview__permission-value' }, permissionSummary(preview.after)),
      ]),
    ]),
    ...(preview.mayRevokeConnect
      ? [h('p', { class: 'acl-impact-preview__warning' }, t('hosts.inventoryAcl.impact.mayRevokeConnect'))]
      : []),
  ])
}

function resetGrant() {
  principalId.value = null
  permissions.value = { view: true, connect: false, edit: false, admin: false }
}

async function load() {
  if (!active.value || props.inventoryNodeId == null) {
    entries.value = []
    return
  }
  loading.value = true
  error.value = ''
  try {
    const [aclResponse, usersResponse, groupsResponse] = await Promise.all([
      inventoryAclService.list(props.inventoryNodeId),
      userService.list({ page: 1, limit: 100, active: true }),
      groupService.list(),
    ])
    entries.value = aclResponse.data
    userOptions.value = usersResponse.data.data.map((user) => ({ label: user.name, value: user.id }))
    groupOptions.value = groupsResponse.data.map((group) => ({ label: group.name, value: group.id }))
  } catch (cause: any) {
    error.value = cause?.response?.data?.message ?? t('hosts.inventoryAcl.loadError')
  } finally {
    loading.value = false
  }
}

async function performSave() {
  if (props.inventoryNodeId == null || principalId.value === null) return
  saving.value = true
  try {
    entries.value = (await inventoryAclService.upsert(props.inventoryNodeId, {
      principalType: principalType.value,
      principalId: principalId.value,
      permissions: permissions.value,
    })).data
    resetGrant()
    message.success(t('hosts.inventoryAcl.saved'))
  } catch (cause: any) {
    message.error(cause?.response?.data?.message ?? t('hosts.inventoryAcl.saveError'))
  } finally {
    saving.value = false
  }
}

async function save() {
  if (props.inventoryNodeId == null || principalId.value === null) return
  if (!Object.values(permissions.value).some(Boolean)) {
    message.warning(t('hosts.inventoryAcl.selectPermission'))
    return
  }
  previewing.value = true
  try {
    const { data } = await inventoryAclService.previewImpact(props.inventoryNodeId, {
      action: 'upsert',
      principalType: principalType.value,
      principalId: principalId.value,
      permissions: permissions.value,
    })
    dialog.warning({
      title: t('hosts.inventoryAcl.impact.grantTitle'),
      content: () => renderImpactContent(data),
      positiveText: t('hosts.inventoryAcl.impact.confirm'),
      negativeText: t('common.cancel'),
      onPositiveClick: performSave,
    })
  } catch (cause: any) {
    message.error(cause?.response?.data?.message ?? t('hosts.inventoryAcl.impact.loadError'))
  } finally {
    previewing.value = false
  }
}

function confirmDelete(entry: InventoryAclEntryPublic) {
  if (props.inventoryNodeId == null) return
  previewing.value = true
  inventoryAclService.previewImpact(props.inventoryNodeId, {
    action: 'delete',
    principalType: entry.principalType,
    principalId: entry.principalId,
  }).then(({ data }) => {
    dialog.warning({
      title: t('hosts.inventoryAcl.revokeTitle'),
      content: () => renderImpactContent(data, t('hosts.inventoryAcl.revokeConfirm', { name: entry.principalName })),
      positiveText: t('hosts.inventoryAcl.revoke'),
      negativeText: t('common.cancel'),
      async onPositiveClick() {
        await inventoryAclService.delete(props.inventoryNodeId!, entry.principalType, entry.principalId)
        entries.value = entries.value.filter((item) => item.id !== entry.id)
        message.success(t('hosts.inventoryAcl.revoked'))
      },
    })
  }).catch((cause: any) => {
    message.error(cause?.response?.data?.message ?? t('hosts.inventoryAcl.impact.loadError'))
  }).finally(() => {
    previewing.value = false
  })
}

watch(() => [props.inventoryNodeId, props.active] as const, () => {
  void load()
}, { immediate: true })

watch(principalType, () => { principalId.value = null })
</script>

<template>
  <div class="acl-inline-panel">
    <div class="acl-inline-panel__header">
      <div>
        <h3>{{ t('hosts.inventoryAcl.title', { host: itemName }) }}</h3>
        <p>{{ t('hosts.inventoryFolders.description') }}</p>
      </div>
    </div>

    <NEmpty
      v-if="!active"
      :description="t('hosts.inventoryFolders.empty')"
      size="small"
      class="py-8"
    />

    <NSpin v-else :show="loading">
      <NAlert v-if="error" type="error" class="mb-4">
        {{ error }}
        <div class="mt-2"><NButton text @click="load">{{ t('hosts.inventoryAcl.retry') }}</NButton></div>
      </NAlert>

      <template v-else>
        <section class="acl-section" aria-labelledby="acl-inline-inherited-title">
          <h4 id="acl-inline-inherited-title">{{ t('hosts.inventoryAcl.inheritedTitle') }}</h4>
          <InventoryAclEntriesTable
            :entries="inheritedEntries"
            :empty-description="t('hosts.inventoryAcl.inheritedEmpty')"
          />
        </section>

        <section class="acl-section" aria-labelledby="acl-inline-local-title">
          <h4 id="acl-inline-local-title">{{ t('hosts.inventoryAcl.localTitle') }}</h4>
          <InventoryAclEntriesTable
            :entries="localEntries"
            :empty-description="t('hosts.inventoryAcl.localEmpty')"
            show-actions
            :action-disabled="previewing || saving"
            @revoke="confirmDelete"
          />
        </section>

        <section class="acl-section acl-grant" aria-labelledby="acl-inline-add-title">
          <h4 id="acl-inline-add-title">{{ t('hosts.inventoryAcl.addTitle') }}</h4>
          <div class="acl-grid">
            <NFormItem :label="t('hosts.inventoryAcl.principalType')">
              <NSelect
                v-model:value="principalType"
                :options="[{ label: t('hosts.inventoryAcl.group'), value: 'GROUP' }, { label: t('hosts.inventoryAcl.user'), value: 'USER' }]"
              />
            </NFormItem>
            <NFormItem :label="t('hosts.inventoryAcl.principal')">
              <NSelect
                v-model:value="principalId"
                filterable
                :options="principalOptions"
                :placeholder="t('hosts.inventoryAcl.select')"
              />
            </NFormItem>
          </div>
          <NSpace vertical>
            <NTooltip trigger="hover" placement="right">
              <template #trigger>
                <NCheckbox v-model:checked="permissions.view">{{ t('hosts.inventoryAcl.view') }}</NCheckbox>
              </template>
              {{ t('hosts.inventoryAcl.tooltips.view') }}
            </NTooltip>
            <NTooltip trigger="hover" placement="right">
              <template #trigger>
                <NCheckbox v-model:checked="permissions.connect">{{ t('hosts.inventoryAcl.connect') }}</NCheckbox>
              </template>
              {{ t('hosts.inventoryAcl.tooltips.connect') }}
            </NTooltip>
            <NTooltip trigger="hover" placement="right">
              <template #trigger>
                <NCheckbox v-model:checked="permissions.edit">{{ t('hosts.inventoryAcl.edit') }}</NCheckbox>
              </template>
              {{ t('hosts.inventoryAcl.tooltips.edit') }}
            </NTooltip>
            <NTooltip trigger="hover" placement="right">
              <template #trigger>
                <NCheckbox v-model:checked="permissions.admin">{{ t('hosts.inventoryAcl.admin') }}</NCheckbox>
              </template>
              {{ t('hosts.inventoryAcl.tooltips.admin') }}
            </NTooltip>
          </NSpace>
          <div class="acl-actions">
            <NButton type="primary" :disabled="principalId === null || previewing" :loading="saving || previewing" @click="save">
              {{ t('hosts.inventoryAcl.save') }}
            </NButton>
          </div>
        </section>
      </template>
    </NSpin>
  </div>
</template>

<style scoped>
.acl-inline-panel { min-height: 100%; }
.acl-inline-panel__header { margin-bottom: 14px; }
.acl-inline-panel__header h3 { margin: 0; font-size: 14px; font-weight: 700; color: #fff; }
.acl-inline-panel__header p { margin: 4px 0 0; color: #8b8b91; font-size: 12px; line-height: 1.45; }
.acl-section { padding: 14px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.09); }
.acl-section h4 { margin: 0 0 12px; font-size: 13px; font-weight: 700; color: #f4f4f5; }
.acl-grant { border-bottom: 0; }
.acl-grid { display: grid; grid-template-columns: 1fr 1.4fr; gap: 12px; }
.acl-actions { display: flex; justify-content: flex-end; margin-top: 18px; }
:global(.acl-impact-preview) { display: grid; gap: 12px; font-size: 13px; line-height: 1.45; }
:global(.acl-impact-preview__intro) { margin: 0; color: #d4d4d8; }
:global(.acl-impact-preview__meta) { display: grid; gap: 6px; }
:global(.acl-impact-preview__meta-row) { color: #a1a1aa; }
:global(.acl-impact-preview__permissions) { display: grid; gap: 8px; }
:global(.acl-impact-preview__permission-row) { display: grid; gap: 3px; padding: 9px 10px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px; background: rgba(255, 255, 255, 0.03); }
:global(.acl-impact-preview__permission-label) { color: #8b8b91; font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
:global(.acl-impact-preview__permission-value) { color: #f4f4f5; font-size: 13px; font-weight: 600; }
:global(.acl-impact-preview__warning) { margin: 0; color: #facc15; font-size: 12px; }
@media (max-width: 720px) { .acl-grid { grid-template-columns: 1fr; gap: 0; } }
</style>
