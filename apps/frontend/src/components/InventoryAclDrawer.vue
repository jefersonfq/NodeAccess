<script setup lang="ts">
import { computed, h, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  NAlert,
  NButton,
  NCheckbox,
  NEmpty,
  NFormItem,
  NModal,
  NSelect,
  NSpace,
  NSpin,
  NTag,
  NTooltip,
  useDialog,
  useMessage,
} from 'naive-ui'
import type {
  AclPrincipalType,
  EffectiveInventoryPermissions,
  InventoryAclImpactPreviewResult,
  InventoryAclEntryPublic,
  InventoryPermissions,
} from '@nodeaccess/shared'
import { inventoryAclService } from '@/services/inventory-acl.service'
import { groupService } from '@/services/group.service'
import { userService } from '@/services/user.service'
import InventoryAclEntriesTable from './InventoryAclEntriesTable.vue'

const props = defineProps<{
  show: boolean
  hostId?: number | null
  inventoryNodeId?: number | null
  itemName: string
}>()
const emit = defineEmits<{ close: [] }>()

const message = useMessage()
const dialog = useDialog()
const router = useRouter()
const { t } = useI18n()
const loading = ref(false)
const saving = ref(false)
const previewing = ref(false)
const error = ref('')
const nodeId = ref<number | null>(null)
const entries = ref<InventoryAclEntryPublic[]>([])
const principalType = ref<AclPrincipalType>('GROUP')
const principalId = ref<number | null>(null)
const permissions = ref<InventoryPermissions>({
  view: true,
  connect: false,
  edit: false,
  admin: false,
})
const permissionTemplates = [
  { key: 'viewOnly', permissions: { view: true, connect: false, edit: false, admin: false } },
  { key: 'sshOperator', permissions: { view: true, connect: true, edit: false, admin: false } },
  { key: 'inventoryEditor', permissions: { view: true, connect: true, edit: true, admin: false } },
  { key: 'aclAdmin', permissions: { view: true, connect: true, edit: true, admin: true } },
] satisfies Array<{ key: string; permissions: InventoryPermissions }>
const userOptions = ref<Array<{ label: string; value: number }>>([])
const groupOptions = ref<Array<{ label: string; value: number }>>([])
const effectiveUserId = ref<number | null>(null)
const effectiveLoading = ref(false)
const effectiveError = ref('')
const effectivePermissions = ref<EffectiveInventoryPermissions | null>(null)

const roleOptions = computed(() => [
  { label: t('hosts.inventoryAcl.allUsers'), value: 1 },
  { label: t('hosts.inventoryAcl.tenantAdmins'), value: 2 },
])
const principalTypeOptions = computed(() => [
  { label: t('hosts.inventoryAcl.group'), value: 'GROUP' },
  { label: t('hosts.inventoryAcl.user'), value: 'USER' },
  { label: t('hosts.inventoryAcl.effective.principalTypes.ROLE'), value: 'ROLE' },
])
const principalOptions = computed(() =>
  principalType.value === 'USER'
    ? userOptions.value
    : principalType.value === 'ROLE'
      ? roleOptions.value
      : groupOptions.value,
)
const localEntries = computed(() => entries.value.filter((entry) => entry.local))
const inheritedEntries = computed(() => entries.value.filter((entry) => !entry.local))
const selectedPrincipalLabel = computed(() =>
  principalOptions.value.find((option) => option.value === principalId.value)?.label ?? '',
)
const selectedLocalEntry = computed(() => {
  if (principalId.value === null) return null
  return localEntries.value.find((entry) =>
    entry.principalType === principalType.value && entry.principalId === principalId.value,
  ) ?? null
})
const isBroadTenantGrant = computed(() => principalType.value === 'ROLE' && principalId.value === 1)
const isAdminPermissionGrant = computed(() => Boolean(permissions.value.admin))
const isViewImplied = computed(() => Boolean(permissions.value.admin || permissions.value.connect || permissions.value.edit))
const selectedPermissionSummary = computed(() => permissionSummary(normalizePermissionSelection(permissions.value)))
const selectedEffectiveUserLabel = computed(() =>
  userOptions.value.find((user) => user.value === effectiveUserId.value)?.label ?? '',
)
const effectiveAccessSummary = computed(() => {
  if (!effectivePermissions.value || !selectedEffectiveUserLabel.value) return ''
  if (effectivePermissions.value.explanation.access === 'none') {
    return t('hosts.inventoryAcl.effective.noAccessSummary', {
      user: selectedEffectiveUserLabel.value,
    })
  }
  return t('hosts.inventoryAcl.effective.accessSummary', {
    user: selectedEffectiveUserLabel.value,
    access: effectiveAccessLabel(effectivePermissions.value.explanation.access),
    sources: effectivePermissions.value.explanation.sourceCount,
  })
})

function labelsFromPermissions(value: InventoryPermissions): string[] {
  const labels: string[] = []
  if (value.view) labels.push(t('hosts.inventoryAcl.view'))
  if (value.connect) labels.push(t('hosts.inventoryAcl.connect'))
  if (value.edit) labels.push(t('hosts.inventoryAcl.edit'))
  if (value.admin) labels.push(t('hosts.inventoryAcl.admin'))
  return labels
}

function normalizePermissionSelection(value: InventoryPermissions): InventoryPermissions {
  if (value.admin) {
    return { view: true, connect: true, edit: true, admin: true }
  }
  return {
    view: value.view || value.connect || value.edit,
    connect: value.connect,
    edit: value.edit,
    admin: false,
  }
}

function applyPermissionTemplate(template: InventoryPermissions) {
  permissions.value = { ...template }
}

function effectiveSourceLabel(source: EffectiveInventoryPermissions['sources'][number]): string {
  if (source.principalType !== 'ROLE') return source.principalName
  return t(source.principalId === 2 ? 'hosts.inventoryAcl.tenantAdmins' : 'hosts.inventoryAcl.allUsers')
}

function effectiveSourceOriginBadge(source: EffectiveInventoryPermissions['sources'][number]): string {
  return source.local
    ? t('hosts.inventoryAcl.effective.sourceLocal')
    : t('hosts.inventoryAcl.effective.sourceInherited')
}

function effectiveSourcePrincipalBadge(source: EffectiveInventoryPermissions['sources'][number]): string {
  return t(`hosts.inventoryAcl.effective.sourcePrincipal.${source.principalType}`)
}

function effectiveSourcePrincipalTagType(source: EffectiveInventoryPermissions['sources'][number]): 'default' | 'info' | 'success' {
  if (source.principalType === 'GROUP') return 'success'
  if (source.principalType === 'ROLE') return 'info'
  return 'default'
}

function effectiveSourcePrincipalIconClass(source: EffectiveInventoryPermissions['sources'][number]): string {
  return `acl-source-principal-icon--${effectiveSourcePrincipalTagType(source)}`
}

function effectiveOriginLabel(source: EffectiveInventoryPermissions['sources'][number]): string {
  return source.inventoryNodeName
}

function effectiveAccessLabel(value: EffectiveInventoryPermissions['explanation']['access']): string {
  return t(`hosts.inventoryAcl.effective.access.${value}`)
}

function effectivePrincipalTypeLabels(value: EffectiveInventoryPermissions): string {
  if (value.explanation.principalTypes.length === 0) return t('hosts.inventoryAcl.effective.noPrincipalTypes')
  return value.explanation.principalTypes
    .map((type) => t(`hosts.inventoryAcl.effective.principalTypes.${type}`))
    .join(', ')
}

function permissionSummary(value: InventoryPermissions | null | undefined): string {
  const labels = value ? labelsFromPermissions(value) : []
  return labels.length ? labels.join(', ') : t('hosts.inventoryAcl.impact.none')
}

function renderImpactContent(preview: InventoryAclImpactPreviewResult, intro?: string) {
  return h('div', { class: 'acl-impact-preview' }, [
    ...(intro ? [h('p', { class: 'acl-impact-preview__intro' }, intro)] : []),
    h('div', { class: 'acl-impact-preview__risk-grid' }, [
      h('div', { class: ['acl-impact-preview__risk-card', preview.affectedHostCount > 0 ? 'is-info' : 'is-muted'] }, [
        h('span', { class: 'acl-impact-preview__risk-label' }, t('hosts.inventoryAcl.impact.hostsLabel')),
        h('strong', { class: 'acl-impact-preview__risk-value' }, String(preview.affectedHostCount)),
        h('span', { class: 'acl-impact-preview__risk-description' }, t('hosts.inventoryAcl.impact.hostsDescription')),
      ]),
      h('div', { class: ['acl-impact-preview__risk-card', preview.activeSessionCount > 0 ? 'is-warning' : 'is-muted'] }, [
        h('span', { class: 'acl-impact-preview__risk-label' }, t('hosts.inventoryAcl.impact.sessionsLabel')),
        h('strong', { class: 'acl-impact-preview__risk-value' }, String(preview.activeSessionCount)),
        h('span', { class: 'acl-impact-preview__risk-description' }, t('hosts.inventoryAcl.impact.sessionsDescription')),
      ]),
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

async function load() {
  if (!props.show) return
  loading.value = true
  error.value = ''
  try {
    const [resolvedNodeId, usersResponse, groupsResponse] = await Promise.all([
      props.inventoryNodeId != null
        ? Promise.resolve(props.inventoryNodeId)
        : props.hostId != null
          ? inventoryAclService.getHostNode(props.hostId).then(({ data }) => data.id)
          : Promise.reject(new Error(t('hosts.inventoryAcl.loadError'))),
      userService.list({ page: 1, limit: 100, active: true }),
      groupService.list(),
    ])
    nodeId.value = resolvedNodeId
    userOptions.value = usersResponse.data.data.map((user) => ({ label: user.name, value: user.id }))
    groupOptions.value = groupsResponse.data.map((group) => ({ label: group.name, value: group.id }))
    entries.value = (await inventoryAclService.list(resolvedNodeId)).data
    if (effectiveUserId.value !== null) await loadEffectiveAccess(effectiveUserId.value)
  } catch (cause: any) {
    error.value = cause?.response?.data?.message ?? t('hosts.inventoryAcl.loadError')
  } finally {
    loading.value = false
  }
}

function resetGrant() {
  principalId.value = null
  permissions.value = { view: true, connect: false, edit: false, admin: false }
}

async function loadEffectiveAccess(userId: number | null) {
  effectiveUserId.value = userId
  effectivePermissions.value = null
  effectiveError.value = ''
  if (nodeId.value === null || userId === null) return
  effectiveLoading.value = true
  try {
    effectivePermissions.value = (await inventoryAclService.effective(nodeId.value, userId)).data
  } catch (cause: any) {
    effectiveError.value = cause?.response?.data?.message ?? t('hosts.inventoryAcl.effective.loadError')
  } finally {
    effectiveLoading.value = false
  }
}

async function performSave() {
  if (nodeId.value === null || principalId.value === null) return
  saving.value = true
  try {
    entries.value = (await inventoryAclService.upsert(nodeId.value, {
      principalType: principalType.value,
      principalId: principalId.value,
      permissions: permissions.value,
    })).data
    if (effectiveUserId.value !== null) await loadEffectiveAccess(effectiveUserId.value)
    resetGrant()
    message.success(t('hosts.inventoryAcl.saved'))
  } catch (cause: any) {
    message.error(cause?.response?.data?.message ?? t('hosts.inventoryAcl.saveError'))
  } finally {
    saving.value = false
  }
}

async function save() {
  if (nodeId.value === null || principalId.value === null) return
  if (!Object.values(permissions.value).some(Boolean)) {
    message.warning(t('hosts.inventoryAcl.selectPermission'))
    return
  }
  const grantIntro = t('hosts.inventoryAcl.grantConfirmDetailed', {
    principal: selectedPrincipalLabel.value,
    permissions: selectedPermissionSummary.value,
  })
  previewing.value = true
  try {
    const { data } = await inventoryAclService.previewImpact(nodeId.value, {
      action: 'upsert',
      principalType: principalType.value,
      principalId: principalId.value,
      permissions: permissions.value,
    })
    dialog.warning({
      title: t('hosts.inventoryAcl.impact.grantTitle'),
      content: () => renderImpactContent(data, grantIntro),
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
  if (nodeId.value === null) return
  const revokeIntro = t('hosts.inventoryAcl.revokeConfirmDetailed', {
    name: entry.principalName,
    permissions: permissionSummary(entry.permissions),
  })
  previewing.value = true
  inventoryAclService.previewImpact(nodeId.value, {
    action: 'delete',
    principalType: entry.principalType,
    principalId: entry.principalId,
  }).then(({ data }) => {
    dialog.warning({
      title: t('hosts.inventoryAcl.revokeTitle'),
      content: () => renderImpactContent(data, revokeIntro),
      positiveText: t('hosts.inventoryAcl.revoke'),
      negativeText: t('common.cancel'),
      async onPositiveClick() {
        await inventoryAclService.delete(nodeId.value!, entry.principalType, entry.principalId)
        entries.value = entries.value.filter((item) => item.id !== entry.id)
        if (effectiveUserId.value !== null) await loadEffectiveAccess(effectiveUserId.value)
        message.success(t('hosts.inventoryAcl.revoked'))
      },
    })
  }).catch((cause: any) => {
    message.error(cause?.response?.data?.message ?? t('hosts.inventoryAcl.impact.loadError'))
  }).finally(() => {
    previewing.value = false
  })
}

function openAclAudit() {
  void router.push({
    name: 'admin-logs',
    query: {
      tab: 'acl',
      ...(nodeId.value !== null ? { targetId: String(nodeId.value) } : { search: props.itemName }),
    },
  })
}

watch(() => props.show, (show) => {
  if (show) void load()
  else {
    resetGrant()
    effectiveUserId.value = null
    effectivePermissions.value = null
    effectiveError.value = ''
  }
})
watch(principalType, () => { principalId.value = null })
watch(() => permissions.value.admin, (enabled) => {
  if (!enabled) return
  permissions.value.view = true
  permissions.value.connect = true
  permissions.value.edit = true
})
watch(() => [permissions.value.connect, permissions.value.edit] as const, ([connect, edit]) => {
  if (connect || edit) permissions.value.view = true
})
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    :title="t('hosts.inventoryAcl.title', { host: itemName })"
    draggable
    style="width: min(1080px, calc(100vw - 32px))"
    @update:show="(value) => { if (!value) emit('close') }"
  >
    <div class="acl-modal-body">
      <NSpin :show="loading">
        <NAlert v-if="error" type="error" class="mb-4">
          {{ error }}
          <div class="mt-2"><NButton text @click="load">{{ t('hosts.inventoryAcl.retry') }}</NButton></div>
        </NAlert>

        <template v-else>
          <div class="acl-toolbar">
            <NButton size="small" secondary @click="openAclAudit">
              {{ t('hosts.inventoryAcl.audit') }}
            </NButton>
          </div>

          <section class="acl-section" aria-labelledby="acl-inherited-title">
            <h3 id="acl-inherited-title">{{ t('hosts.inventoryAcl.inheritedTitle') }}</h3>
            <InventoryAclEntriesTable
              :entries="inheritedEntries"
              :empty-description="t('hosts.inventoryAcl.inheritedEmpty')"
            />
          </section>

          <section class="acl-section" aria-labelledby="acl-local-title">
            <h3 id="acl-local-title">{{ t('hosts.inventoryAcl.localTitle') }}</h3>
            <InventoryAclEntriesTable
              :entries="localEntries"
              :empty-description="t('hosts.inventoryAcl.localEmpty')"
              show-actions
              :action-disabled="previewing || saving"
              @revoke="confirmDelete"
            />
          </section>

          <section class="acl-section" aria-labelledby="acl-effective-title">
            <h3 id="acl-effective-title">{{ t('hosts.inventoryAcl.effective.title') }}</h3>
            <p class="acl-section-hint">{{ t('hosts.inventoryAcl.effective.description') }}</p>
            <NFormItem :label="t('hosts.inventoryAcl.effective.user')">
              <NSelect
                :value="effectiveUserId"
                filterable
                clearable
                :options="userOptions"
                :placeholder="t('hosts.inventoryAcl.effective.selectUser')"
                @update:value="loadEffectiveAccess"
              />
            </NFormItem>
            <NSpin :show="effectiveLoading">
              <NAlert v-if="effectiveError" type="error" class="mb-3">
                {{ effectiveError }}
              </NAlert>
              <template v-else-if="effectivePermissions">
                <NAlert
                  class="mb-3"
                  :type="effectivePermissions.explanation.access === 'none' ? 'warning' : 'success'"
                  :show-icon="false"
                >
                  {{ effectiveAccessSummary }}
                </NAlert>
                <NAlert
                  v-if="effectivePermissions.explanation.access === 'none'"
                  class="mb-3"
                  type="info"
                  :show-icon="false"
                >
                  {{ t('hosts.inventoryAcl.effective.noAccessFixHint') }}
                </NAlert>
                <div class="acl-diagnosis">
                  <strong>{{ t('hosts.inventoryAcl.effective.diagnosis') }}</strong>
                  <div class="acl-diagnosis-grid">
                    <span>{{ t('hosts.inventoryAcl.effective.finalAccess') }}</span>
                    <strong>{{ effectiveAccessLabel(effectivePermissions.explanation.access) }}</strong>
                    <span>{{ t('hosts.inventoryAcl.effective.sources') }}</span>
                    <strong>
                      {{ t('hosts.inventoryAcl.effective.sourceSummary', {
                        total: effectivePermissions.explanation.sourceCount,
                        local: effectivePermissions.explanation.localSourceCount,
                        inherited: effectivePermissions.explanation.inheritedSourceCount,
                      }) }}
                    </strong>
                    <span>{{ t('hosts.inventoryAcl.effective.grantedBy') }}</span>
                    <strong>{{ effectivePrincipalTypeLabels(effectivePermissions) }}</strong>
                  </div>
                </div>
                <div class="acl-effective-summary">
                  <strong>{{ t('hosts.inventoryAcl.effective.result') }}</strong>
                  <div class="acl-tags">
                    <NTag
                      v-for="label in labelsFromPermissions(effectivePermissions)"
                      :key="label"
                      size="small"
                      type="success"
                    >
                      {{ label }}
                    </NTag>
                    <NTag v-if="labelsFromPermissions(effectivePermissions).length === 0" size="small">
                      {{ t('hosts.inventoryAcl.effective.noAccess') }}
                    </NTag>
                  </div>
                </div>
                <NEmpty
                  v-if="effectivePermissions.sources.length === 0"
                  :description="t('hosts.inventoryAcl.effective.noSources')"
                  size="small"
                />
                <div v-for="source in effectivePermissions.sources" :key="source.aclEntryId" class="acl-source">
                  <div>
                    <div class="acl-source-badges">
                      <NTag size="tiny" :type="source.local ? 'success' : 'info'">
                        {{ effectiveSourceOriginBadge(source) }}
                      </NTag>
                      <NTag v-if="!source.local && source.inheritToChildren" size="tiny" type="warning">
                        {{ t('hosts.inventoryAcl.effective.sourceInheritedByFlag') }}
                      </NTag>
                    </div>
                    <div class="acl-source-title">
                      <NTooltip trigger="hover" placement="top">
                        <template #trigger>
                          <span
                            class="acl-source-principal-icon"
                            :class="effectiveSourcePrincipalIconClass(source)"
                            role="img"
                            :aria-label="effectiveSourcePrincipalBadge(source)"
                            :title="effectiveSourcePrincipalBadge(source)"
                          >
                            <svg
                              v-if="source.principalType === 'GROUP'"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="1.9"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              aria-hidden="true"
                            >
                              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                              <circle cx="9" cy="7" r="4" />
                              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                            </svg>
                            <svg
                              v-else
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="1.9"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              aria-hidden="true"
                            >
                              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                              <circle cx="12" cy="7" r="4" />
                            </svg>
                          </span>
                        </template>
                        {{ effectiveSourcePrincipalBadge(source) }}
                      </NTooltip>
                      <strong>{{ effectiveSourceLabel(source) }}</strong>
                    </div>
                    <div class="acl-origin">{{ effectiveOriginLabel(source) }}</div>
                    <div class="acl-tags">
                      <NTag v-for="label in labelsFromPermissions(source.permissions)" :key="label" size="small">
                        {{ label }}
                      </NTag>
                    </div>
                  </div>
                </div>
              </template>
            </NSpin>
          </section>

          <section class="acl-section acl-grant" aria-labelledby="acl-add-title">
            <h3 id="acl-add-title">{{ t('hosts.inventoryAcl.addTitle') }}</h3>
            <div class="acl-grid">
              <NFormItem :label="t('hosts.inventoryAcl.principalType')">
                <NSelect
                  v-model:value="principalType"
                  :options="principalTypeOptions"
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
            <div class="acl-template-row" :aria-label="t('hosts.inventoryAcl.templates.title')">
              <NTooltip
                v-for="template in permissionTemplates"
                :key="template.key"
                trigger="hover"
                placement="top"
              >
                <template #trigger>
                  <NButton
                    size="tiny"
                    secondary
                    @click="applyPermissionTemplate(template.permissions)"
                  >
                    {{ t(`hosts.inventoryAcl.templates.${template.key}.label`) }}
                  </NButton>
                </template>
                {{ t(`hosts.inventoryAcl.templates.${template.key}.description`) }}
              </NTooltip>
            </div>
            <NSpace vertical>
              <NTooltip trigger="hover" placement="right">
                <template #trigger>
                  <NCheckbox v-model:checked="permissions.view" :disabled="isViewImplied">{{ t('hosts.inventoryAcl.view') }}</NCheckbox>
                </template>
                {{ t('hosts.inventoryAcl.tooltips.view') }}
              </NTooltip>
              <NTooltip trigger="hover" placement="right">
                <template #trigger>
                  <NCheckbox v-model:checked="permissions.connect" :disabled="permissions.admin">{{ t('hosts.inventoryAcl.connect') }}</NCheckbox>
                </template>
                {{ t('hosts.inventoryAcl.tooltips.connect') }}
              </NTooltip>
              <NTooltip trigger="hover" placement="right">
                <template #trigger>
                  <NCheckbox v-model:checked="permissions.edit" :disabled="permissions.admin">{{ t('hosts.inventoryAcl.edit') }}</NCheckbox>
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
            <NAlert
              v-if="isBroadTenantGrant"
              class="acl-grant-summary"
              type="warning"
              :show-icon="false"
            >
              {{ t('hosts.inventoryAcl.broadTenantGrantWarning') }}
            </NAlert>
            <NAlert
              v-if="isAdminPermissionGrant"
              class="acl-grant-summary"
              type="warning"
              :show-icon="false"
            >
              {{ t('hosts.inventoryAcl.adminGrantWarning') }}
            </NAlert>
            <NAlert
              v-if="principalId !== null"
              class="acl-grant-summary"
              :type="selectedLocalEntry ? 'warning' : 'info'"
              :show-icon="false"
            >
              <strong>
                {{ selectedLocalEntry ? t('hosts.inventoryAcl.grantUpdateTitle') : t('hosts.inventoryAcl.grantSummaryTitle') }}
              </strong>
              <span>
                {{ t('hosts.inventoryAcl.grantSummary', {
                  principal: selectedPrincipalLabel,
                  permissions: selectedPermissionSummary,
                }) }}
              </span>
              <span v-if="selectedLocalEntry">
                {{ t('hosts.inventoryAcl.grantExisting', {
                  permissions: permissionSummary(selectedLocalEntry.permissions),
                }) }}
              </span>
            </NAlert>
            <div class="acl-actions">
              <NButton type="primary" :disabled="principalId === null || previewing" :loading="saving || previewing" @click="save">
                {{ t('hosts.inventoryAcl.save') }}
              </NButton>
            </div>
          </section>
        </template>
      </NSpin>
    </div>
  </NModal>
</template>

<style scoped>
.acl-modal-body { max-height: calc(85vh - 132px); overflow-y: auto; padding-right: 4px; }
.acl-section { padding: 16px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.09); }
.acl-toolbar { display: flex; justify-content: flex-end; padding-bottom: 8px; }
.acl-section h3 { margin: 0 0 12px; font-size: 14px; font-weight: 600; }
.acl-section-hint { margin: -6px 0 12px; color: #8b8b91; font-size: 12px; line-height: 1.45; }
.acl-source { padding: 10px 0; }
.acl-source-badges { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
.acl-source-title { display: inline-flex; min-width: 0; align-items: center; gap: 6px; }
.acl-source-principal-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: #9ca3af;
  flex-shrink: 0;
}
.acl-source-principal-icon svg {
  width: 14px;
  height: 14px;
}
.acl-source-principal-icon--success { color: #a1a1aa; }
.acl-source-principal-icon--info { color: #93c5fd; }
.acl-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.acl-origin { margin-top: 3px; color: #8b8b91; font-size: 12px; }
.acl-diagnosis { margin: 8px 0 10px; padding: 12px; border: 1px solid rgba(255, 255, 255, 0.09); border-radius: 6px; background: rgba(255, 255, 255, 0.03); }
.acl-diagnosis-grid { display: grid; grid-template-columns: minmax(120px, 0.7fr) 1fr; gap: 6px 12px; margin-top: 8px; font-size: 12px; }
.acl-diagnosis-grid span { color: #8b8b91; }
.acl-effective-summary { padding: 10px 0 6px; }
.acl-grant { border-bottom: 0; }
.acl-grid { display: grid; grid-template-columns: 1fr 2fr; gap: 12px; }
.acl-template-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 0 12px;
}
.acl-grant-summary {
  margin-top: 14px;
}
.acl-grant-summary :deep(.n-alert-body__content) {
  display: grid;
  gap: 4px;
  font-size: 12px;
  line-height: 1.45;
}
.acl-actions { display: flex; justify-content: flex-end; margin-top: 18px; }
:global(.acl-impact-preview) { display: grid; gap: 12px; font-size: 13px; line-height: 1.45; }
:global(.acl-impact-preview__intro) { margin: 0; color: #d4d4d8; }
:global(.acl-impact-preview__risk-grid) { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
:global(.acl-impact-preview__risk-card) { display: grid; gap: 3px; padding: 10px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px; background: rgba(255, 255, 255, 0.03); }
:global(.acl-impact-preview__risk-card.is-info) { border-color: rgba(96, 165, 250, 0.35); background: rgba(59, 130, 246, 0.08); }
:global(.acl-impact-preview__risk-card.is-warning) { border-color: rgba(250, 204, 21, 0.45); background: rgba(250, 204, 21, 0.08); }
:global(.acl-impact-preview__risk-label) { color: #a1a1aa; font-size: 11px; font-weight: 700; text-transform: uppercase; }
:global(.acl-impact-preview__risk-value) { color: #f4f4f5; font-size: 22px; line-height: 1.1; }
:global(.acl-impact-preview__risk-description) { color: #a1a1aa; font-size: 11px; }
:global(.acl-impact-preview__permissions) { display: grid; gap: 8px; }
:global(.acl-impact-preview__permission-row) { display: grid; gap: 3px; padding: 9px 10px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px; background: rgba(255, 255, 255, 0.03); }
:global(.acl-impact-preview__permission-label) { color: #8b8b91; font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
:global(.acl-impact-preview__permission-value) { color: #f4f4f5; font-size: 13px; font-weight: 600; }
:global(.acl-impact-preview__warning) { margin: 0; color: #facc15; font-size: 12px; }
@media (max-width: 520px) {
  .acl-grid { grid-template-columns: 1fr; gap: 0; }
  :global(.acl-impact-preview__risk-grid) { grid-template-columns: 1fr; }
}
</style>
