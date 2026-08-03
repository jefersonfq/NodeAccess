<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  NAlert,
  NButton,
  NCard,
  NEmpty,
  NFormItem,
  NModal,
  NSelect,
  NSpace,
  NSpin,
  NTag,
  NText,
  useDialog,
  useMessage,
} from 'naive-ui'
import type { EffectiveHostInventoryPermissions, HostPublic, InventoryIntegrityReport, InventoryPermissions } from '@nodeaccess/shared'
import InventoryFolderPermissionsPanel from '@/components/InventoryFolderPermissionsPanel.vue'
import { hostService } from '@/services/host.service'
import { inventoryAclService } from '@/services/inventory-acl.service'
import { userService, type UserInventoryAccessEntry } from '@/services/user.service'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const message = useMessage()
const dialog = useDialog()

const usersLoading = ref(false)
const userOptions = ref<Array<{ label: string; value: number }>>([])
const hostsLoading = ref(false)
const hostOptions = ref<Array<{ label: string; value: number; host: HostPublic }>>([])
const selectedHostId = ref<number | null>(null)
let hostSearchTimer: ReturnType<typeof setTimeout> | null = null
let latestHostSearchId = 0
const userId = ref<number | null>(null)
const accessUserId = ref<number | null>(null)
const userAccessEntries = ref<UserInventoryAccessEntry[]>([])
const userAccessLoading = ref(false)
const userAccessError = ref('')
const diagnosis = ref<EffectiveHostInventoryPermissions | null>(null)
const diagnosisLoading = ref(false)
const diagnosisError = ref('')
const integrity = ref<InventoryIntegrityReport | null>(null)
const integrityLoading = ref(false)
const integrityRepairing = ref(false)
const integrityError = ref('')
const inventoryPanelKey = ref(0)
const showHelp = ref(false)
const helpQuickItems = computed(() => ['what', 'inheritance', 'diagnosis'])
const helpConcepts = computed(() => ['corporateTree', 'personalFolders', 'groups', 'hostConfig'])
const helpScenarios = computed(() => ['grantTeam', 'viewOnly', 'bulkImport'])
const helpRules = computed(() => ['aclPrecedence', 'rootAcl', 'leastPrivilege'])
const helpFlowSteps = computed(() => ['organize', 'grant', 'evaluate', 'apply'])
const initialInventoryNodeId = computed(() => {
  const value = route.query.inventoryNodeId
  const raw = Array.isArray(value) ? value[0] : value
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
})

const canDiagnose = computed(() => selectedHostId.value !== null && userId.value !== null && !diagnosisLoading.value)
const selectedUserLabel = computed(() => userOptions.value.find((user) => user.value === userId.value)?.label ?? '')
const selectedAccessUserLabel = computed(() => userOptions.value.find((user) => user.value === accessUserId.value)?.label ?? '')
const selectedHost = computed(() => hostOptions.value.find((host) => host.value === selectedHostId.value)?.host ?? null)
const canLoadUserAccess = computed(() => accessUserId.value !== null && !userAccessLoading.value)
const diagnosisHasAccess = computed(() => diagnosis.value?.explanation.access !== 'none')
const hostsWithoutInventoryNode = computed(() => integrity.value?.hostsWithoutInventoryNode)
const hasInventoryIssues = computed(() => (hostsWithoutInventoryNode.value?.total ?? 0) > 0)
const diagnosisPrincipalCounts = computed(() => {
  const counts = { user: 0, group: 0, role: 0 }
  for (const source of diagnosis.value?.sources ?? []) {
    if (source.principalType === 'USER') counts.user += 1
    if (source.principalType === 'GROUP') counts.group += 1
    if (source.principalType === 'ROLE') counts.role += 1
  }
  return counts
})
const diagnosisSummary = computed(() => {
  if (!diagnosis.value) return ''
  if (!diagnosisHasAccess.value) {
    return t('admin.acl.diagnosis.noAccessSummary', { user: selectedUserLabel.value || t('admin.acl.diagnosis.selectedUser') })
  }
  return t('admin.acl.diagnosis.accessSummary', {
    user: selectedUserLabel.value || t('admin.acl.diagnosis.selectedUser'),
    access: accessLabel(diagnosis.value.explanation.access),
    sources: diagnosis.value.explanation.sourceCount,
  })
})

const diagnosisDecisionRows = computed(() => {
  if (!diagnosis.value) return []
  const labels = permissionLabels(diagnosis.value)
  const principalCounts = diagnosisPrincipalCounts.value
  return [
    {
      label: t('admin.acl.diagnosis.finalAccess'),
      value: accessLabel(diagnosis.value.explanation.access),
    },
    {
      label: t('admin.acl.diagnosis.effectivePermissions'),
      value: labels.length ? labels.join(', ') : t('hosts.inventoryAcl.effective.noAccess'),
    },
    {
      label: t('admin.acl.diagnosis.originBreakdown'),
      value: t('hosts.inventoryAcl.effective.sourceSummary', {
        total: diagnosis.value.explanation.sourceCount,
        local: diagnosis.value.explanation.localSourceCount,
        inherited: diagnosis.value.explanation.inheritedSourceCount,
      }),
    },
    {
      label: t('admin.acl.diagnosis.principalBreakdown'),
      value: t('admin.acl.diagnosis.principalSummary', {
        users: principalCounts.user,
        groups: principalCounts.group,
        roles: principalCounts.role,
      }),
    },
  ]
})

function permissionLabels(value: InventoryPermissions): string[] {
  return [
    value.view && t('hosts.inventoryAcl.view'),
    value.connect && t('hosts.inventoryAcl.connect'),
    value.edit && t('hosts.inventoryAcl.edit'),
    value.admin && t('hosts.inventoryAcl.admin'),
  ].filter((item): item is string => Boolean(item))
}

function accessLabel(value: EffectiveHostInventoryPermissions['explanation']['access']) {
  return t(`hosts.inventoryAcl.effective.access.${value}`)
}

function accessTagType(value: EffectiveHostInventoryPermissions['explanation']['access']): 'default' | 'success' | 'warning' {
  return value === 'none' ? 'warning' : 'success'
}

function sourceOrigin(source: EffectiveHostInventoryPermissions['sources'][number]) {
  return source.inventoryNodeName
}

function sourceOriginBadge(source: EffectiveHostInventoryPermissions['sources'][number]) {
  return source.local
    ? t('hosts.inventoryAcl.effective.sourceLocal')
    : t('hosts.inventoryAcl.effective.sourceInherited')
}

function sourcePrincipal(source: EffectiveHostInventoryPermissions['sources'][number]) {
  if (source.principalType !== 'ROLE') return source.principalName
  return t(source.principalId === 2 ? 'hosts.inventoryAcl.tenantAdmins' : 'hosts.inventoryAcl.allUsers')
}

function sourcePrincipalBadge(source: EffectiveHostInventoryPermissions['sources'][number]) {
  return t(`hosts.inventoryAcl.effective.sourcePrincipal.${source.principalType}`)
}

function sourcePrincipalTagType(source: EffectiveHostInventoryPermissions['sources'][number]): 'default' | 'info' | 'success' {
  if (source.principalType === 'GROUP') return 'success'
  if (source.principalType === 'ROLE') return 'info'
  return 'default'
}

function principalTagType(type: UserInventoryAccessEntry['principalType']): 'default' | 'info' | 'success' {
  if (type === 'GROUP') return 'success'
  if (type === 'ROLE') return 'info'
  return 'default'
}

function principalTypeLabel(type: UserInventoryAccessEntry['principalType']) {
  return t(`hosts.inventoryAcl.effective.sourcePrincipal.${type}`)
}

function inventoryNodeTypeLabel(entry: UserInventoryAccessEntry) {
  if (entry.inventoryNodeType === 'ROOT') return t('hosts.inventoryFolders.root')
  if (entry.inventoryNodeType === 'HOST') return t('admin.acl.userAccess.hostNode')
  return t('admin.acl.userAccess.folderNode')
}

async function loadUsers() {
  usersLoading.value = true
  try {
    const { data } = await userService.list({ page: 1, limit: 100, active: true })
    userOptions.value = data.data.map((user) => ({ label: `${user.name} · ${user.email}`, value: user.id }))
  } catch {
    message.error(t('admin.acl.diagnosis.usersLoadError'))
  } finally {
    usersLoading.value = false
  }
}

async function loadUserAccess() {
  if (accessUserId.value === null) return
  userAccessLoading.value = true
  userAccessError.value = ''
  userAccessEntries.value = []
  try {
    const { data } = await userService.listInventoryAccess(accessUserId.value)
    userAccessEntries.value = data
  } catch {
    userAccessError.value = t('admin.acl.userAccess.loadError')
  } finally {
    userAccessLoading.value = false
  }
}

async function loadHosts(search = '') {
  const requestId = ++latestHostSearchId
  const term = search.trim()
  const directHostId = /^\d+$/.test(term) ? Number(term) : null
  hostsLoading.value = true
  try {
    const [{ data }, directHostResult] = await Promise.all([
      hostService.list({ page: 1, limit: 50, ...(term && { search: term }) }),
      directHostId !== null
        ? hostService.get(directHostId).then((response) => response.data).catch(() => null)
        : Promise.resolve(null),
    ])
    if (requestId !== latestHostSearchId) return
    const hosts = directHostResult && !data.data.some((host) => host.id === directHostResult.id)
      ? [directHostResult, ...data.data]
      : data.data
    const nextOptions = hosts.map((host) => ({
      label: `${host.name} · ${host.ip}:${host.port}`,
      value: host.id,
      host,
    }))
    const selectedOption = hostOptions.value.find((option) => option.value === selectedHostId.value)
    hostOptions.value = selectedOption && !nextOptions.some((option) => option.value === selectedOption.value)
      ? [selectedOption, ...nextOptions]
      : nextOptions
  } catch {
    if (requestId === latestHostSearchId) message.error(t('admin.acl.diagnosis.hostsLoadError'))
  } finally {
    if (requestId === latestHostSearchId) hostsLoading.value = false
  }
}

function searchHosts(query: string) {
  if (hostSearchTimer !== null) clearTimeout(hostSearchTimer)
  hostSearchTimer = setTimeout(() => {
    hostSearchTimer = null
    void loadHosts(query)
  }, 250)
}

async function loadIntegrity() {
  integrityLoading.value = true
  integrityError.value = ''
  try {
    integrity.value = (await inventoryAclService.integrity()).data
  } catch (cause: any) {
    integrityError.value = cause?.response?.data?.message ?? t('admin.acl.integrity.loadError')
  } finally {
    integrityLoading.value = false
  }
}

function confirmRepairIntegrity() {
  const pendingHosts = hostsWithoutInventoryNode.value?.total ?? 0
  if (pendingHosts <= 0 || integrityRepairing.value) return
  dialog.warning({
    title: t('admin.acl.integrity.repairConfirmTitle'),
    content: t('admin.acl.integrity.repairConfirmContent', { count: pendingHosts }),
    positiveText: t('admin.acl.integrity.repairAction'),
    negativeText: t('common.cancel'),
    async onPositiveClick() {
      integrityRepairing.value = true
      integrityError.value = ''
      try {
        const { data } = await inventoryAclService.repairIntegrity()
        integrity.value = data.report
        inventoryPanelKey.value += 1
        message.success(t('admin.acl.integrity.repairSuccess', { count: data.repairedHosts }))
      } catch (cause: any) {
        message.error(cause?.response?.data?.message ?? t('admin.acl.integrity.repairError'))
      } finally {
        integrityRepairing.value = false
      }
    },
  })
}

async function diagnose() {
  if (!canDiagnose.value || userId.value === null || selectedHostId.value === null) return
  diagnosisLoading.value = true
  diagnosisError.value = ''
  diagnosis.value = null
  try {
    diagnosis.value = (await inventoryAclService.effectiveHost(selectedHostId.value, userId.value)).data
  } catch (cause: any) {
    diagnosisError.value = cause?.response?.data?.message ?? t('admin.acl.diagnosis.loadError')
  } finally {
    diagnosisLoading.value = false
  }
}

function openAclAudit() {
  void router.push({
    name: 'admin-logs',
    query: {
      tab: 'acl',
      ...(diagnosis.value ? { targetId: String(diagnosis.value.inventoryNode.id) } : {}),
    },
  })
}

function focusInventoryNode(nodeId: number) {
  inventoryPanelKey.value += 1
  void router.replace({
    name: 'admin-acl',
    query: {
      ...route.query,
      inventoryNodeId: String(nodeId),
    },
  })
}

onMounted(() => {
  void loadUsers()
  void loadHosts()
  void loadIntegrity()
})

onBeforeUnmount(() => {
  if (hostSearchTimer !== null) {
    clearTimeout(hostSearchTimer)
    hostSearchTimer = null
  }
})
</script>

<template>
  <div class="p-6">
    <div class="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold text-white">{{ $t('admin.acl.title') }}</h1>
        <NText depth="3" class="text-sm">{{ $t('admin.acl.subtitle') }}</NText>
      </div>
      <NSpace>
        <NButton secondary @click="showHelp = true">{{ $t('admin.acl.help.action') }}</NButton>
        <NButton secondary @click="openAclAudit">{{ $t('admin.acl.actions.audit') }}</NButton>
      </NSpace>
    </div>

    <div class="space-y-4">
      <NCard v-if="integrityError || hasInventoryIssues" :bordered="false" class="na-card">
        <div class="mb-4">
          <h2 class="text-sm font-semibold text-white">{{ $t('admin.acl.tree.title') }}</h2>
          <NText depth="3" class="mt-1 block text-sm">{{ $t('admin.acl.tree.description') }}</NText>
        </div>
        <InventoryFolderPermissionsPanel
          :key="inventoryPanelKey"
          :initial-node-id="initialInventoryNodeId"
        />
      </NCard>

      <NCard :bordered="false" class="na-card">
        <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-sm font-semibold text-white">{{ $t('admin.acl.integrity.title') }}</h2>
            <NText depth="3" class="mt-1 block text-sm">{{ $t('admin.acl.integrity.description') }}</NText>
          </div>
          <NSpace>
            <NButton size="small" secondary :loading="integrityLoading" :disabled="integrityRepairing" @click="loadIntegrity">
              {{ $t('admin.acl.integrity.refresh') }}
            </NButton>
            <NButton
              v-if="hasInventoryIssues"
              size="small"
              type="warning"
              secondary
              :loading="integrityRepairing"
              :disabled="integrityLoading"
              @click="confirmRepairIntegrity"
            >
              {{ $t('admin.acl.integrity.repairAction') }}
            </NButton>
          </NSpace>
        </div>

        <NAlert v-if="integrityError" type="error">
          {{ integrityError }}
        </NAlert>

        <NSpin v-else :show="integrityLoading">
          <NAlert
            v-if="integrity && hasInventoryIssues && hostsWithoutInventoryNode"
            type="warning"
            :title="$t('admin.acl.integrity.warningTitle', { count: hostsWithoutInventoryNode.total })"
          >
            <div class="text-sm">{{ $t('admin.acl.integrity.warningDescription') }}</div>
            <div v-if="hostsWithoutInventoryNode.sample.length > 0" class="mt-3">
              <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                {{ $t('admin.acl.integrity.sampleTitle') }}
              </div>
              <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                <div
                  v-for="host in hostsWithoutInventoryNode.sample"
                  :key="host.id"
                  class="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2"
                  :title="`Host ID ${host.id}`"
                >
                  <div class="truncate text-sm font-medium text-white">{{ host.name }}</div>
                  <div class="mt-1 text-xs text-gray-400">{{ host.ip }}</div>
                </div>
              </div>
              <div
                v-if="hostsWithoutInventoryNode.total > hostsWithoutInventoryNode.sample.length"
                class="mt-2 text-xs text-gray-400"
              >
                {{ $t('admin.acl.integrity.sampleLimit', {
                  count: hostsWithoutInventoryNode.sample.length,
                  total: hostsWithoutInventoryNode.total,
                }) }}
              </div>
            </div>
          </NAlert>
        </NSpin>
      </NCard>

      <NCard :bordered="false" class="na-card">
        <div class="mb-4">
          <h2 class="text-sm font-semibold text-white">{{ $t('admin.acl.diagnosis.title') }}</h2>
          <NText depth="3" class="mt-1 block text-sm">{{ $t('admin.acl.diagnosis.description') }}</NText>
        </div>

        <div class="grid gap-3 md:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)_auto]">
          <NFormItem :label="$t('admin.acl.diagnosis.host')">
            <NSelect
              v-model:value="selectedHostId"
              :options="hostOptions"
              :loading="hostsLoading"
              filterable
              remote
              clearable
              :placeholder="$t('admin.acl.diagnosis.hostPlaceholder')"
              @search="searchHosts"
            />
          </NFormItem>
          <NFormItem :label="$t('admin.acl.diagnosis.user')">
            <NSelect
              v-model:value="userId"
              :options="userOptions"
              :loading="usersLoading"
              filterable
              clearable
              :placeholder="$t('admin.acl.diagnosis.userPlaceholder')"
            />
          </NFormItem>
          <div class="flex items-end pb-6">
            <NButton type="primary" :disabled="!canDiagnose" :loading="diagnosisLoading" @click="diagnose">
              {{ $t('admin.acl.diagnosis.action') }}
            </NButton>
          </div>
        </div>
        <NText v-if="selectedHost" depth="3" class="mb-4 block text-xs">
          {{ $t('admin.acl.diagnosis.selectedHostContext', {
            name: selectedHost.name,
            address: `${selectedHost.ip}:${selectedHost.port}`,
            id: selectedHost.id,
          }) }}
        </NText>

        <NAlert v-if="diagnosisError" type="error" class="mb-4">
          {{ diagnosisError }}
        </NAlert>

        <NSpin :show="diagnosisLoading">
          <template v-if="diagnosis">
            <div class="rounded-md border border-white/10 bg-white/[0.03] p-4">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div class="text-sm font-semibold text-white">{{ diagnosis.inventoryNode.name }}</div>
                  <NText v-if="diagnosis.inventoryNode.path" depth="3" class="mt-1 block text-xs">
                    {{ diagnosis.inventoryNode.path }}
                  </NText>
                </div>
                <NTag :type="accessTagType(diagnosis.explanation.access)">
                  {{ accessLabel(diagnosis.explanation.access) }}
                </NTag>
              </div>
              <NAlert
                class="mt-4"
                :type="diagnosisHasAccess ? 'success' : 'warning'"
                :title="$t('admin.acl.diagnosis.resultTitle')"
              >
                {{ diagnosisSummary }}
              </NAlert>
              <div class="mt-4 flex flex-wrap gap-2">
                <NTag v-for="label in permissionLabels(diagnosis)" :key="label" size="small">{{ label }}</NTag>
                <NTag v-if="permissionLabels(diagnosis).length === 0" size="small">
                  {{ $t('hosts.inventoryAcl.effective.noAccess') }}
                </NTag>
              </div>
              <div class="mt-4 text-xs text-gray-400">
                {{ $t('hosts.inventoryAcl.effective.sourceSummary', {
                  total: diagnosis.explanation.sourceCount,
                  local: diagnosis.explanation.localSourceCount,
                  inherited: diagnosis.explanation.inheritedSourceCount,
                }) }}
              </div>
              <div class="mt-4 grid gap-2 md:grid-cols-2">
                <div
                  v-for="row in diagnosisDecisionRows"
                  :key="row.label"
                  class="rounded border border-white/10 bg-black/10 px-3 py-2"
                >
                  <div class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{{ row.label }}</div>
                  <div class="mt-1 text-sm text-gray-200">{{ row.value }}</div>
                </div>
              </div>
              <NAlert class="mt-4" type="default" :show-icon="false">
                {{ $t('admin.acl.diagnosis.precedenceHint') }}
              </NAlert>
              <NAlert v-if="!diagnosisHasAccess" class="mt-4" type="info">
                {{ $t('hosts.inventoryAcl.effective.noAccessFixHint') }}
              </NAlert>
              <div class="mt-4">
                <NButton size="small" secondary @click="openAclAudit">{{ $t('admin.acl.actions.audit') }}</NButton>
              </div>
            </div>

            <div class="mt-4">
              <NEmpty
                v-if="diagnosis.sources.length === 0"
                :description="$t('hosts.inventoryAcl.effective.noSources')"
                size="small"
              />
              <div v-for="source in diagnosis.sources" :key="source.aclEntryId" class="border-b border-white/10 py-3 last:border-b-0">
                <div class="mb-2 flex flex-wrap gap-2">
                  <NTag size="tiny" :type="source.local ? 'success' : 'info'">
                    {{ sourceOriginBadge(source) }}
                  </NTag>
                  <NTag size="tiny" :type="sourcePrincipalTagType(source)">
                    {{ sourcePrincipalBadge(source) }}
                  </NTag>
                  <NTag v-if="!source.local && source.inheritToChildren" size="tiny" type="warning">
                    {{ $t('hosts.inventoryAcl.effective.sourceInheritedByFlag') }}
                  </NTag>
                </div>
                <div class="text-sm font-medium text-white">{{ sourcePrincipal(source) }}</div>
                <div class="mt-1 text-xs text-gray-500">{{ sourceOrigin(source) }}</div>
                <div class="mt-2 flex flex-wrap gap-2">
                  <NTag v-for="label in permissionLabels(source.permissions)" :key="label" size="small">{{ label }}</NTag>
                </div>
                <div class="mt-2">
                  <NButton size="tiny" secondary @click="focusInventoryNode(source.inventoryNodeId)">
                    {{ $t('admin.acl.diagnosis.viewSourceInTree') }}
                  </NButton>
                </div>
              </div>
            </div>
          </template>
        </NSpin>

        <div class="mt-6 border-t border-white/10 pt-5">
          <div class="mb-4">
            <h3 class="text-sm font-semibold text-white">{{ $t('admin.acl.userAccess.title') }}</h3>
            <NText depth="3" class="mt-1 block text-sm">{{ $t('admin.acl.userAccess.description') }}</NText>
          </div>

          <div class="grid gap-3 md:grid-cols-[minmax(220px,1fr)_auto]">
            <NFormItem :label="$t('admin.acl.userAccess.user')">
              <NSelect
                v-model:value="accessUserId"
                :options="userOptions"
                :loading="usersLoading"
                filterable
                clearable
                :placeholder="$t('admin.acl.userAccess.userPlaceholder')"
              />
            </NFormItem>
            <div class="flex items-end pb-6">
              <NButton type="primary" secondary :disabled="!canLoadUserAccess" :loading="userAccessLoading" @click="loadUserAccess">
                {{ $t('admin.acl.userAccess.action') }}
              </NButton>
            </div>
          </div>

          <NAlert v-if="userAccessError" type="error" class="mb-4">
            {{ userAccessError }}
          </NAlert>

          <NSpin :show="userAccessLoading">
            <NEmpty
              v-if="!userAccessLoading && !userAccessError && accessUserId !== null && userAccessEntries.length === 0"
              :description="$t('admin.acl.userAccess.empty')"
              size="small"
            />

            <div v-else-if="userAccessEntries.length" class="space-y-3">
              <NAlert type="info" :show-icon="false">
                {{ $t('admin.acl.userAccess.summary', {
                  user: selectedAccessUserLabel || $t('admin.acl.diagnosis.selectedUser'),
                  count: userAccessEntries.length,
                }) }}
              </NAlert>

              <div
                v-for="entry in userAccessEntries"
                :key="entry.aclEntryId"
                class="rounded-md border border-white/10 bg-white/[0.03] p-3"
              >
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <NTag size="tiny" :type="entry.inventoryNodeType === 'HOST' ? 'warning' : 'info'">
                        {{ inventoryNodeTypeLabel(entry) }}
                      </NTag>
                      <NTag size="tiny" :type="principalTagType(entry.principalType)">
                        {{ principalTypeLabel(entry.principalType) }}
                      </NTag>
                      <span class="truncate text-sm font-semibold text-white">
                        {{ entry.inventoryNodeType === 'ROOT' ? $t('hosts.inventoryFolders.root') : entry.inventoryNodeName }}
                      </span>
                    </div>
                    <div class="mt-1 flex flex-wrap items-center gap-1 text-xs text-gray-500">
                      <span>{{ $t('admin.acl.userAccess.source', { name: entry.principalName }) }}</span>
                      <span>·</span>
                      <span>{{ $t('admin.acl.userAccess.hostImpact', { count: entry.hostCount }) }}</span>
                      <span v-if="entry.inheritToChildren">· {{ $t('admin.acl.userAccess.inherited') }}</span>
                    </div>
                  </div>
                  <div class="flex flex-wrap justify-end gap-1">
                    <NTag v-for="label in permissionLabels(entry.permissions)" :key="label" size="small" type="success">
                      {{ label }}
                    </NTag>
                  </div>
                </div>
                <div class="mt-3">
                  <NButton size="tiny" secondary @click="focusInventoryNode(entry.inventoryNodeId)">
                    {{ $t('admin.acl.userAccess.viewInTree') }}
                  </NButton>
                </div>
              </div>
            </div>
          </NSpin>
        </div>
      </NCard>
    </div>

    <NModal v-model:show="showHelp">
      <NCard
        style="width: min(920px, calc(100vw - 32px))"
        :title="$t('admin.acl.help.title')"
        :bordered="false"
        role="dialog"
        aria-modal="true"
      >
        <div class="max-h-[78vh] overflow-y-auto pr-1">
          <div class="mb-5 rounded border border-white/10 p-4">
            <NText depth="3" class="block text-sm">{{ $t('admin.acl.help.subtitle') }}</NText>
            <div class="mt-4 grid gap-3 md:grid-cols-3">
              <div
                v-for="item in helpQuickItems"
                :key="item"
                class="rounded bg-white/5 p-3"
              >
                <NText strong class="block text-sm">{{ $t(`admin.acl.help.quick.${item}.title`) }}</NText>
                <NText depth="3" class="block text-xs mt-1">{{ $t(`admin.acl.help.quick.${item}.description`) }}</NText>
              </div>
            </div>
          </div>

          <div class="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
            <section>
              <h2 class="mb-3 text-sm font-semibold text-white">{{ $t('admin.acl.help.flowTitle') }}</h2>
              <div class="mb-5 grid gap-3 rounded border border-white/10 bg-white/[0.02] p-3 md:grid-cols-4">
                <div
                  v-for="(step, index) in helpFlowSteps"
                  :key="step"
                  class="relative rounded border border-white/10 bg-white/[0.04] p-3"
                >
                  <NTag size="small" :type="index === 3 ? 'success' : 'info'">
                    {{ $t('admin.acl.help.flow.step', { number: index + 1 }) }}
                  </NTag>
                  <NText strong class="mt-2 block text-sm">{{ $t(`admin.acl.help.flow.${step}.title`) }}</NText>
                  <NText depth="3" class="mt-1 block text-xs">{{ $t(`admin.acl.help.flow.${step}.description`) }}</NText>
                  <div
                    v-if="index < helpFlowSteps.length - 1"
                    class="pointer-events-none absolute -bottom-3 left-1/2 z-10 -translate-x-1/2 text-xs text-gray-500 md:-right-3 md:bottom-auto md:left-auto md:top-1/2 md:-translate-y-1/2 md:translate-x-0"
                    aria-hidden="true"
                  >
                    →
                  </div>
                </div>
              </div>

              <h2 class="mb-3 text-sm font-semibold text-white">{{ $t('admin.acl.help.conceptsTitle') }}</h2>
              <div class="overflow-hidden rounded border border-white/10">
                <div
                  v-for="concept in helpConcepts"
                  :key="concept"
                  class="grid gap-2 border-b border-white/10 p-3 last:border-b-0 md:grid-cols-[160px_1fr]"
                >
                  <NText strong class="text-sm">{{ $t(`admin.acl.help.concepts.${concept}.title`) }}</NText>
                  <NText depth="3" class="text-sm">{{ $t(`admin.acl.help.concepts.${concept}.description`) }}</NText>
                </div>
              </div>
            </section>

            <section>
              <h2 class="mb-3 text-sm font-semibold text-white">{{ $t('admin.acl.help.scenariosTitle') }}</h2>
              <div class="space-y-3">
                <div
                  v-for="scenario in helpScenarios"
                  :key="scenario"
                  class="rounded border border-white/10 p-3"
                >
                  <NTag size="small" type="info">{{ $t(`admin.acl.help.scenarios.${scenario}.title`) }}</NTag>
                  <NText depth="3" class="mt-2 block text-sm">{{ $t(`admin.acl.help.scenarios.${scenario}.description`) }}</NText>
                </div>
              </div>
            </section>
          </div>

          <section class="mt-5">
            <h2 class="mb-3 text-sm font-semibold text-white">{{ $t('admin.acl.help.rulesTitle') }}</h2>
            <div class="grid gap-3 md:grid-cols-3">
              <div
                v-for="rule in helpRules"
                :key="rule"
                class="rounded border border-white/10 bg-white/[0.03] p-3"
              >
                <NText strong class="block text-sm">{{ $t(`admin.acl.help.rules.${rule}.title`) }}</NText>
                <NText depth="3" class="mt-1 block text-xs">{{ $t(`admin.acl.help.rules.${rule}.description`) }}</NText>
              </div>
            </div>
          </section>
        </div>
        <template #footer>
          <div class="flex justify-end">
            <NButton @click="showHelp = false">{{ $t('common.close') }}</NButton>
          </div>
        </template>
      </NCard>
    </NModal>
  </div>
</template>
