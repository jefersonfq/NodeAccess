<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, h, computed, watch, type VNode } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  NDataTable, NButton, NSpace, NTag, NInput, NAlert, NSpin,
  NModal, NForm, NFormItem, NSelect, NSwitch, NTransfer, NCheckbox,
  NDrawer, NDrawerContent, NEmpty, NTooltip, NDropdown, useMessage, useDialog,
} from 'naive-ui'
import type { DataTableColumns, DropdownDividerOption, DropdownOption } from 'naive-ui'
import type { UserPublic, UserListItem, CreateUserDto, UpdateUserDto } from '@nodeaccess/shared'
import { userService, type UserInventoryAccessEntry } from '@/services/user.service'
import { groupService } from '@/services/group.service'
import { platformAdminService } from '@/services/platform-admin.service'
import { useAuthStore } from '@/stores/auth'
import SkeletonTable from '@/components/SkeletonTable.vue'
import SessionSupervisionPermission from '@/components/SessionSupervisionPermission.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import VaultAdministration from '@/components/vault/VaultAdministration.vue'
import { createVaultTransport } from '@/services/vault-http'
import { vaultAdministrationStatus } from '@/services/vault-manager'
import UserLoginSessions from '@/components/users/UserLoginSessions.vue'
import { loginSessionsService } from '@/services/login-sessions.service'

const { t } = useI18n()
const router = useRouter()
const auth = useAuthStore()

const msg    = useMessage()
const dialog = useDialog()

const users          = ref<UserListItem[]>([])
const total          = ref(0)
const loading        = ref(false)
const error          = ref<string | null>(null)
const search         = ref('')
const includeDeleted = ref(false)
const vaultManagersOnly = ref(false)
let listRequest = 0
let contextGeneration = 0
let disposed = false
const listIdentity = (): string => JSON.stringify([auth.user?.id, auth.user?.tenantId, auth.user?.actingTenantId])
const captureIdentity = (): { key: string; generation: number } => ({ key: listIdentity(), generation: contextGeneration })
const sameIdentity = (identity: ReturnType<typeof captureIdentity>): boolean =>
  !disposed && identity.generation === contextGeneration && identity.key === listIdentity()
const promotingUserId = ref<number | null>(null)
const accessDrawerUser = ref<UserPublic | null>(null)
const accessLoading = ref(false)
const accessError = ref('')
const accessEntries = ref<UserInventoryAccessEntry[]>([])
// NA-0186: vault permissions per user, only for vault managers (NodeAccess admin alone is not enough).
// Manager-only approval controls remain separate from the read-only list indicator.
const vaultManager = ref(false)
/** False until a status read succeeded: unknown (no vault, HTTP, another tenant, error) shows no vault action at all. */
const vaultKnown = ref(false)
const vaultUser = ref<UserPublic | null>(null)
const vaultReview = ref(false)
const vaultPending = ref(0)
const vaultTransport = createVaultTransport()
let vaultTimer: ReturnType<typeof setInterval> | undefined
async function loadVaultStatus(): Promise<void> {
  const identity = captureIdentity()
  const status = await vaultAdministrationStatus(vaultTransport, auth)
  if (!sameIdentity(identity) || !status) return // a failed poll keeps the last known state
  vaultKnown.value = true
  vaultManager.value = status.manager; vaultPending.value = status.pending
}
function closeVault(): void {
  vaultUser.value = null; vaultReview.value = false
  void loadVaultStatus()
  void load()
}
// NA-0187: who is online (session used in the last 15 min) and one user's login sessions.
const onlineUsers = ref(new Map<number, number>())
const sessionsUser = ref<UserPublic | null>(null)
async function loadOnline(): Promise<void> {
  const identity = captureIdentity()
  try {
    const online = await loginSessionsService.online()
    if (sameIdentity(identity)) onlineUsers.value = new Map(online.map(u => [u.userId, u.sessions]))
  } catch { if (sameIdentity(identity)) onlineUsers.value = new Map() }
}

const groupOptions = ref<{ label: string; value: number }[]>([])
const userOptions = computed(() =>
  users.value.map((user) => ({ label: `${user.name} (${user.email})`, value: user.id })),
)

async function loadGroups(): Promise<void> {
  const identity = captureIdentity()
  try {
    const { data } = await groupService.list()
    if (!sameIdentity(identity)) return
    groupOptions.value = data.map((g) => ({ label: g.name, value: g.id }))
  } catch {
    // grupos opcionais — falha silenciosa
  }
}

const roleOptions = computed(() => [
  { label: t('admin.users.roles.user'),  value: 'user' },
  { label: t('admin.users.roles.admin'), value: 'admin' },
])

type UserActionKey =
  | 'dashboard'
  | 'access'
  | 'edit'
  | 'promote-superadmin'
  | 'activate'
  | 'deactivate'
  | 'reset-password'
  | 'reset-mfa'
  | 'vault'
  | 'login-sessions'
  | 'delete'
  | 'restore'

// ─── Modal criar ────────────────────────────────────────────────────────────

const showCreateModal    = ref(false)
const createLoading      = ref(false)
const tempPassword       = ref<string | null>(null)
const createForm = ref<CreateUserDto>({
  name: '', email: '', role: 'user', canManageHosts: false, canViewLiveSessions: false, groupIds: [], password: '',
})
const copyGroupsFromCreateUserId = ref<number | null>(null)

function openCreate(): void {
  createForm.value = { name: '', email: '', role: 'user', canManageHosts: false, canViewLiveSessions: false, groupIds: [], password: '' }
  tempPassword.value = null
  copyGroupsFromCreateUserId.value = null
  showCreateModal.value = true
}

async function createUser(): Promise<void> {
  createLoading.value = true
  tempPassword.value  = null
  try {
    const payload: CreateUserDto = { ...createForm.value }
    if (!payload.password) delete payload.password
    const { data } = await userService.create(payload)
    if (data.temporaryPassword) {
      tempPassword.value = data.temporaryPassword
    } else {
      showCreateModal.value = false
    }
    msg.success(t('admin.users.messages.created'))
    void load()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('admin.users.messages.createError'))
  } finally {
    createLoading.value = false
  }
}

// ─── Modal editar ────────────────────────────────────────────────────────────

const showEditModal  = ref(false)
const editLoading    = ref(false)
const editingId      = ref<number | null>(null)
const editForm = ref<UpdateUserDto>({
  name: '', role: 'user', canManageHosts: false, canViewLiveSessions: false, groupIds: [],
})
const copyGroupsFromEditUserId = ref<number | null>(null)

async function openEdit(user: UserPublic): Promise<void> {
  editingId.value = user.id
  editForm.value  = {
    name:           user.name,
    role:           user.role,
    canManageHosts: user.canManageHosts,
    canViewLiveSessions: user.canViewLiveSessions,
    groupIds:       [],
  }
  showEditModal.value = true
  copyGroupsFromEditUserId.value = null
  try {
    const { data } = await userService.get(user.id)
    editForm.value.groupIds = data.groupIds
  } catch {
    // se falhar, o select fica vazio — não bloqueia a edição
  }
}

async function copyGroups(target: 'create' | 'edit'): Promise<void> {
  const sourceId = target === 'create' ? copyGroupsFromCreateUserId.value : copyGroupsFromEditUserId.value
  if (!sourceId) return

  try {
    const { data } = await userService.get(sourceId)
    if (target === 'create') {
      createForm.value.groupIds = [...data.groupIds]
    } else {
      editForm.value.groupIds = [...data.groupIds]
    }
    msg.success(t('admin.users.messages.groupsCopied'))
  } catch {
    msg.error(t('admin.users.messages.copyGroupsError'))
  }
}

const editCopyUserOptions = computed(() =>
  userOptions.value.filter((option) => option.value !== editingId.value),
)

async function saveEdit(): Promise<void> {
  if (editingId.value === null) return
  editLoading.value = true
  try {
    await userService.update(editingId.value, editForm.value)
    msg.success(t('admin.users.messages.updated'))
    showEditModal.value = false
    void load()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('admin.users.messages.updateError'))
  } finally {
    editLoading.value = false
  }
}

function openUserDashboard(userId: number): void {
  void router.push({ name: 'admin-dashboard-user', params: { userId } })
}

function permissionLabels(entry: UserInventoryAccessEntry): string[] {
  return [
    entry.permissions.view && t('hosts.inventoryAcl.view'),
    entry.permissions.connect && t('hosts.inventoryAcl.connect'),
    entry.permissions.edit && t('hosts.inventoryAcl.edit'),
    entry.permissions.admin && t('hosts.inventoryAcl.admin'),
  ].filter((label): label is string => typeof label === 'string')
}

async function openAccessDrawer(user: UserPublic): Promise<void> {
  accessDrawerUser.value = user
  accessLoading.value = true
  accessError.value = ''
  accessEntries.value = []
  try {
    const { data } = await userService.listInventoryAccess(user.id)
    accessEntries.value = data
  } catch {
    accessError.value = t('admin.users.access.loadError')
  } finally {
    accessLoading.value = false
  }
}

function closeAccessDrawer(): void {
  accessDrawerUser.value = null
  accessEntries.value = []
  accessError.value = ''
}

function renderStateIcon(enabled: boolean, label: string, tooltip = label): VNode {
  const icon = enabled
    ? h('svg', {
      class: 'user-state-icon',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2.4',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    }, [
      h('path', { d: 'M20 6 9 17l-5-5' }),
    ])
    : h('svg', {
      class: 'user-state-icon',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2.1',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    }, [
      h('circle', { cx: '12', cy: '12', r: '9' }),
      h('path', { d: 'm15 9-6 6' }),
      h('path', { d: 'm9 9 6 6' }),
    ])

  return h(NTooltip, { trigger: 'hover', placement: 'top' }, {
    trigger: () => h('span', {
      class: ['user-state-cell', enabled ? 'user-state-cell--yes' : 'user-state-cell--no'],
      role: 'img',
      'aria-label': label,
      title: label,
    }, [icon]),
    default: () => tooltip,
  })
}

function userStatusLabel(user: UserPublic): string {
  if (user.deletedAt) return t('admin.users.status.deleted')
  return user.active ? t('admin.users.status.active') : t('admin.users.status.inactive')
}

function userActionOptions(user: UserPublic): Array<DropdownOption | DropdownDividerOption> {
  if (user.deletedAt) {
    return [
      { label: t('admin.users.actions.restore'), key: 'restore' },
    ]
  }

  return [
    { label: 'Dashboard', key: 'dashboard' },
    { label: t('admin.users.actions.access'), key: 'access' },
    { label: t('admin.users.actions.edit'), key: 'edit' },
    ...(auth.isPlatformAdmin && user.role === 'admin' && !user.isPlatformAdmin
      ? [{
          label: promotingUserId.value === user.id
            ? `${t('admin.users.actions.promoteSuperadmin')}...`
            : t('admin.users.actions.promoteSuperadmin'),
          key: 'promote-superadmin',
          disabled: promotingUserId.value === user.id,
        }]
      : []),
    { type: 'divider', key: 'account-divider' },
    {
      label: user.active ? t('admin.users.actions.deactivate') : t('admin.users.actions.activate'),
      key: user.active ? 'deactivate' : 'activate',
    },
    { label: t('admin.users.actions.resetPassword'), key: 'reset-password' },
    { label: t('admin.users.actions.resetMfa'), key: 'reset-mfa' },
    ...(user.active && vaultKnown.value ? [vaultManager.value
      ? { label: t('admin.users.actions.vault'), key: 'vault' }
      : { label: t('admin.users.actions.vaultManagersOnly'), key: 'vault', disabled: true }] : []),
    { label: t('admin.users.actions.loginSessions'), key: 'login-sessions' },
    { type: 'divider', key: 'danger-divider' },
    {
      label: (): VNode => h('span', { class: 'user-action-danger' }, t('admin.users.actions.delete')),
      key: 'delete',
    },
  ]
}

function handleUserAction(action: UserActionKey, user: UserPublic): void | Promise<void> {
  if (action === 'dashboard') return openUserDashboard(user.id)
  if (action === 'access') return openAccessDrawer(user)
  if (action === 'edit') return openEdit(user)
  if (action === 'promote-superadmin') return confirmPromotePlatformAdmin(user)
  if (action === 'activate') return toggleActive(user, true)
  if (action === 'deactivate') return toggleActive(user, false)
  if (action === 'reset-password') return resetPwd(user.id)
  if (action === 'reset-mfa') return confirmResetMfa(user)
  if (action === 'vault') { if (vaultManager.value) vaultUser.value = user; return }
  if (action === 'login-sessions') { sessionsUser.value = user; return }
  if (action === 'delete') return confirmDeleteUser(user)
  if (action === 'restore') return restoreUser(user)
}

// ─── Tabela ──────────────────────────────────────────────────────────────────

// The list indicator is informational; only the separate vault status enables approval controls.
const columns = computed<DataTableColumns<UserListItem>>(() => {
  const online = onlineUsers.value
  return [
  {
    title: t('admin.users.columns.name'),
    key: 'name',
    minWidth: 220,
    render: (row): VNode => h('div', { class: 'users-name-cell' }, [
      h(UserAvatar, { user: row, size: 32 }),
      h('div', { class: 'users-name-cell__text' }, [
        h('span', { class: 'users-name-cell__name' }, [
          row.name,
          online.has(row.id)
            ? h(NTag, { size: 'tiny', type: 'success', round: true, class: 'ml-2', 'data-testid': `user-online-${row.id}` },
              () => t('admin.users.online', { count: online.get(row.id) ?? 0 }))
            : null,
          row.isVaultManager === true && row.active && !row.deletedAt
            ? h(NTag, { size: 'tiny', type: 'info', round: true, class: 'ml-2', 'data-testid': `user-vault-manager-${row.id}`, title: t('admin.users.vaultManagerHelp') },
              () => t('admin.users.vaultManager'))
            : null,
        ]),
        h('span', { class: 'users-name-cell__email' }, row.email),
      ]),
    ]),
  },
  {
    title: t('admin.users.columns.role'), key: 'role',
    render: (row): VNode => h(NTag, { type: row.role === 'admin' ? 'warning' : 'default', size: 'small' }, () =>
      row.role === 'admin' ? t('admin.users.roles.admin') : t('admin.users.roles.user'),
    ),
  },
  {
    title: t('admin.users.columns.canManageHosts'), key: 'canManageHosts',
    align: 'center',
    width: 124,
    render: (row): VNode => renderStateIcon(
      row.canManageHosts,
      row.canManageHosts ? t('admin.users.manage.yes') : t('admin.users.manage.no'),
      row.canManageHosts
        ? `${t('admin.users.columns.canManageHosts')}: ${t('admin.users.manage.yes')}`
        : `${t('admin.users.columns.canManageHosts')}: ${t('admin.users.manage.no')}`,
    ),
  },
  {
    title: 'Sessões abertas', key: 'canViewLiveSessions',
    render: (row): VNode => h(NTag, { type: row.canViewLiveSessions ? 'success' : 'default', size: 'small' }, () => row.canViewLiveSessions ? t('admin.users.manage.yes') : t('admin.users.manage.no')),
  },
  {
    title: t('admin.users.columns.status'), key: 'active',
    align: 'center',
    width: 92,
    render: (row): VNode => renderStateIcon(row.active && !row.deletedAt, userStatusLabel(row), userStatusLabel(row)),
  },
  {
    title: t('admin.users.columns.groups'), key: 'groupIds',
    render: (row): VNode => h(NTag, { type: row.groupIds.length > 0 ? 'info' : 'default', size: 'small' }, () =>
      row.groupIds.length > 0
        ? t('admin.users.groupsCount', { count: row.groupIds.length })
        : t('admin.users.noGroups'),
    ),
  },
  {
    title: t('admin.users.columns.actions'), key: 'actions',
    align: 'right',
    width: 96,
    render: (row): VNode => h(NDropdown, {
      trigger: 'click',
      placement: 'bottom-end',
      options: userActionOptions(row),
      onSelect: (key: string) => { void handleUserAction(key as UserActionKey, row) },
    }, {
      default: () => h(NButton, { size: 'small', secondary: true }, () => t('admin.users.columns.actions')),
    }),
  },
  ]
})

// ─── Ações ───────────────────────────────────────────────────────────────────

async function load(): Promise<void> {
  const request = ++listRequest
  const identity = captureIdentity()
  const current = (): boolean => request === listRequest && sameIdentity(identity)
  loading.value = true
  error.value = null
  try {
    const { data } = await userService.list({
      search: search.value || undefined,
      includeDeleted: includeDeleted.value || undefined,
      vaultManager: vaultManagersOnly.value || undefined,
    })
    if (!current()) return
    users.value = data.data
    total.value = data.total
  } catch {
    if (!current()) return
    users.value = []
    total.value = 0
    error.value = t('admin.users.messages.loadError')
  } finally {
    if (current()) loading.value = false
  }
}

watch(listIdentity, () => {
  contextGeneration++
  users.value = []; total.value = 0; error.value = null
  vaultManager.value = false; vaultKnown.value = false; vaultPending.value = 0
  vaultUser.value = null; vaultReview.value = false; sessionsUser.value = null
  onlineUsers.value = new Map(); groupOptions.value = []
  void load(); void loadGroups(); void loadVaultStatus(); void loadOnline()
}, { flush: 'sync' })

onMounted(() => {
  void load()
  void loadGroups()
  void loadVaultStatus()
  vaultTimer = setInterval(() => { if (!vaultUser.value && !vaultReview.value) void loadVaultStatus() }, 60_000)
  void loadOnline()
})
onBeforeUnmount(() => { disposed = true; listRequest++; if (vaultTimer) clearInterval(vaultTimer) })

async function toggleActive(user: UserPublic, active: boolean): Promise<void> {
  try {
    if (active) await userService.activate(user.id)
    else        await userService.deactivate(user.id)
    msg.success(active ? t('admin.users.messages.activated') : t('admin.users.messages.deactivated'))
    void load()
  } catch {
    msg.error(t('admin.users.messages.updateError'))
  }
}

function confirmDeleteUser(user: UserPublic): void {
  dialog.warning({
    title:        t('admin.users.deleteConfirm.title'),
    content:      t('admin.users.deleteConfirm.content', { name: user.name, email: user.email }),
    positiveText: t('admin.users.deleteConfirm.confirm'),
    negativeText: t('admin.users.deleteConfirm.cancel'),
    onPositiveClick: async () => {
      try {
        await userService.delete(user.id)
        msg.success(t('admin.users.messages.deleted'))
        void load()
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } }
        msg.error(e.response?.data?.message ?? t('admin.users.messages.deleteError'))
      }
    },
  })
}

async function restoreUser(user: UserPublic): Promise<void> {
  try {
    await userService.restore(user.id)
    msg.success(t('admin.users.messages.restored'))
    void load()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('admin.users.messages.restoreError'))
  }
}

function resetPwd(id: number): void {
  dialog.warning({
    title:        t('admin.users.resetPassword.dialogTitle'),
    content:      t('admin.users.resetPassword.dialogContent'),
    positiveText: t('admin.users.resetPassword.confirm'),
    negativeText: t('admin.users.resetPassword.cancel'),
    onPositiveClick: async () => {
      try {
        const { data } = await userService.resetPassword(id)
        dialog.info({
          title:   t('admin.users.resetPassword.successTitle'),
          content: t('admin.users.resetPassword.successContent', { password: data.temporaryPassword }),
        })
      } catch {
        msg.error(t('admin.users.resetPassword.error'))
      }
    },
  })
}

function confirmResetMfa(user: UserPublic): void {
  dialog.warning({
    title:        t('admin.users.resetMfa.dialogTitle'),
    content:      t('admin.users.resetMfa.dialogContent', { name: user.name, email: user.email }),
    positiveText: t('admin.users.resetMfa.confirm'),
    negativeText: t('admin.users.resetMfa.cancel'),
    onPositiveClick: async () => {
      try {
        await userService.resetMfa(user.id)
        msg.success(t('admin.users.resetMfa.success'))
        await load()
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } }
        msg.error(e.response?.data?.message ?? t('admin.users.resetMfa.error'))
      }
    },
  })
}

function confirmPromotePlatformAdmin(user: UserPublic): void {
  dialog.warning({
    title: t('admin.users.promoteSuperadmin.dialogTitle'),
    content: t('admin.users.promoteSuperadmin.dialogContent', { name: user.name, email: user.email }),
    positiveText: t('admin.users.promoteSuperadmin.confirm'),
    negativeText: t('admin.users.promoteSuperadmin.cancel'),
    onPositiveClick: async () => {
      promotingUserId.value = user.id
      try {
        const { data } = await platformAdminService.promoteUser(user.id)
        msg.success(t('admin.users.messages.promotedSuperadmin'))
        if (data.temporaryPassword) {
          dialog.info({
            title: t('admin.users.resetPassword.successTitle'),
            content: t('admin.users.resetPassword.successContent', { password: data.temporaryPassword }),
          })
        }
        await load()
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } }
        msg.error(e.response?.data?.message ?? t('admin.users.messages.promoteSuperadminError'))
      } finally {
        promotingUserId.value = null
      }
    },
  })
}
</script>

<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-xl font-semibold text-white">
        {{ $t('admin.users.title') }}
      </h1>
      <NButton
        type="primary"
        @click="openCreate"
      >
        {{ $t('admin.users.newUser') }}
      </NButton>
    </div>

    <NSpace
      class="mb-4"
      align="center"
    >
      <NInput
        v-model:value="search"
        :placeholder="$t('admin.users.searchPlaceholder')"
        clearable
        style="width:240px"
        @keyup.enter="load"
      />
      <NButton @click="load">
        {{ $t('common.search') }}
      </NButton>
      <NCheckbox
        v-model:checked="includeDeleted"
        @update:checked="load"
      >
        {{ $t('admin.users.showDeleted') }}
      </NCheckbox>
      <NCheckbox
        v-model:checked="vaultManagersOnly"
        data-testid="users-vault-managers-filter"
        @update:checked="load"
      >
        {{ $t('admin.users.vaultManagersOnly') }}
      </NCheckbox>
    </NSpace>

    <details
      class="users-vault-help mb-4"
      data-testid="users-vault-help"
    >
      <summary>{{ $t('admin.users.vaultManagersHelpTitle') }}</summary>
      <p>{{ $t('admin.users.vaultManagerHelp') }}</p>
      <p>{{ $t('admin.users.vaultManagersSetupHelp') }}</p>
    </details>

    <NAlert
      v-if="error"
      type="error"
      class="mb-4"
      :title="error"
    />

    <NAlert
      v-if="vaultManager && vaultPending > 0"
      type="info"
      class="mb-4"
      data-testid="users-vault-pending"
    >
      <div class="flex flex-wrap items-center justify-between gap-3">
        <span>{{ $t('admin.users.vaultPending', { count: vaultPending }, vaultPending) }}</span>
        <NButton
          size="small"
          type="primary"
          data-testid="users-vault-review"
          @click="vaultReview = true"
        >
          {{ $t('admin.users.vaultReview') }}
        </NButton>
      </div>
    </NAlert>

    <SkeletonTable
      v-if="loading && users.length === 0"
      :rows="6"
      :columns="5"
    />
    <NSpin
      v-else
      :show="loading"
    >
      <NDataTable
        :columns="columns"
        :data="users"
        :row-key="(r) => r.id"
        :bordered="false"
      >
        <template
          v-if="!error && !loading && users.length === 0"
          #empty
        >
          <div class="py-16 flex flex-col items-center gap-3">
            <svg
              viewBox="0 0 24 24"
              width="40"
              height="40"
              fill="none"
              stroke="#444"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle
                cx="9"
                cy="7"
                r="4"
              />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <p class="text-sm text-gray-500">
              {{ $t(vaultManagersOnly ? 'admin.users.vaultManagersEmpty' : 'admin.users.emptyDesc') }}
            </p>
            <NButton
              v-if="!vaultManagersOnly"
              type="primary"
              size="small"
              @click="openCreate"
            >
              {{ $t('admin.users.createFirst') }}
            </NButton>
          </div>
        </template>
      </NDataTable>
    </NSpin>

    <!-- Modal: criar usuário -->
    <NModal
      v-model:show="showCreateModal"
      preset="card"
      :title="$t('admin.users.createModal.title')"
      style="width: 480px"
    >
      <NAlert
        v-if="tempPassword"
        type="success"
        class="mb-4"
        :title="$t('admin.users.resetPassword.tempPasswordLabel', { password: tempPassword })"
        :description="$t('admin.users.createModal.tempPasswordNote')"
      />

      <NForm
        v-if="!tempPassword"
        @submit.prevent="createUser"
      >
        <NFormItem :label="$t('admin.users.createModal.nameLabel')">
          <NInput
            v-model:value="createForm.name"
            :input-props="{ autocomplete: 'off' }"
          />
        </NFormItem>
        <NFormItem :label="$t('admin.users.createModal.emailLabel')">
          <NInput
            v-model:value="createForm.email"
            :input-props="{ inputmode: 'email', autocomplete: 'off' }"
          />
        </NFormItem>
        <NFormItem :label="$t('admin.users.createModal.roleLabel')">
          <NSelect
            v-model:value="createForm.role"
            :options="roleOptions"
          />
        </NFormItem>
        <NFormItem :label="$t('admin.users.createModal.canManageLabel')">
          <NSwitch v-model:value="createForm.canManageHosts" />
        </NFormItem>
        <NFormItem label="Pode visualizar sessões abertas">
          <NSwitch v-model:value="createForm.canViewLiveSessions" />
        </NFormItem>
        <NFormItem :label="$t('admin.users.createModal.passwordLabel')">
          <NInput
            v-model:value="createForm.password"
            type="password"
            show-password-on="click"
            clearable
            :placeholder="$t('admin.users.createModal.passwordPlaceholder')"
            :input-props="{ autocomplete: 'new-password' }"
          />
        </NFormItem>
        <NFormItem :label="$t('admin.users.createModal.groupsLabel')">
          <div class="w-full flex flex-col gap-3">
            <NAlert
              type="info"
              :show-icon="false"
            >
              {{ $t('admin.users.groupAclHint') }}
            </NAlert>
            <div class="text-xs text-gray-400">
              {{ $t('admin.users.groupSummary', { count: createForm.groupIds.length }) }}
            </div>
            <div class="flex gap-2">
              <NSelect
                v-model:value="copyGroupsFromCreateUserId"
                :options="userOptions"
                clearable
                filterable
                :placeholder="$t('admin.users.createModal.copyGroupsPlaceholder')"
              />
              <NButton @click="copyGroups('create')">
                {{ $t('admin.users.createModal.copyGroupsAction') }}
              </NButton>
            </div>
            <NTransfer
              v-model:value="createForm.groupIds"
              :options="groupOptions"
              source-filterable
              target-filterable
            />
          </div>
        </NFormItem>
        <div class="flex justify-end gap-2 mt-2">
          <NButton @click="showCreateModal = false">
            {{ $t('admin.users.createModal.cancel') }}
          </NButton>
          <NButton
            type="primary"
            :loading="createLoading"
            @click="createUser"
          >
            {{ $t('admin.users.createModal.create') }}
          </NButton>
        </div>
      </NForm>

      <div
        v-if="tempPassword"
        class="flex justify-end mt-2"
      >
        <NButton @click="showCreateModal = false">
          {{ $t('common.close') }}
        </NButton>
      </div>
    </NModal>

    <!-- Modal: editar usuário -->
    <NModal
      v-model:show="showEditModal"
      preset="card"
      :title="$t('admin.users.editModal.title')"
      style="width: 480px"
    >
      <NForm @submit.prevent="saveEdit">
        <NFormItem :label="$t('admin.users.createModal.nameLabel')">
          <NInput v-model:value="editForm.name" />
        </NFormItem>
        <NFormItem :label="$t('admin.users.createModal.roleLabel')">
          <NSelect
            v-model:value="editForm.role"
            :options="roleOptions"
          />
        </NFormItem>
        <NFormItem :label="$t('admin.users.createModal.canManageLabel')">
          <NSwitch v-model:value="editForm.canManageHosts" />
        </NFormItem>
        <NFormItem label="Pode visualizar sessões abertas">
          <NSwitch v-model:value="editForm.canViewLiveSessions" />
        </NFormItem>
        <SessionSupervisionPermission
          v-if="editingId"
          :key="editingId"
          :user-id="editingId"
        />
        <NFormItem :label="$t('admin.users.editModal.groupsLabel')">
          <div class="w-full flex flex-col gap-3">
            <NAlert
              type="info"
              :show-icon="false"
            >
              {{ $t('admin.users.groupAclHint') }}
            </NAlert>
            <div class="text-xs text-gray-400">
              {{ $t('admin.users.groupSummary', { count: editForm.groupIds?.length ?? 0 }) }}
            </div>
            <div class="flex gap-2">
              <NSelect
                v-model:value="copyGroupsFromEditUserId"
                :options="editCopyUserOptions"
                clearable
                filterable
                :placeholder="$t('admin.users.editModal.copyGroupsPlaceholder')"
              />
              <NButton @click="copyGroups('edit')">
                {{ $t('admin.users.editModal.copyGroupsAction') }}
              </NButton>
            </div>
            <NTransfer
              v-model:value="editForm.groupIds"
              :options="groupOptions"
              source-filterable
              target-filterable
            />
          </div>
        </NFormItem>
        <div class="flex justify-end gap-2 mt-2">
          <NButton @click="showEditModal = false">
            {{ $t('admin.users.editModal.cancel') }}
          </NButton>
          <NButton
            type="primary"
            :loading="editLoading"
            @click="saveEdit"
          >
            {{ $t('admin.users.editModal.save') }}
          </NButton>
        </div>
      </NForm>
    </NModal>

    <NModal
      :show="vaultUser !== null || vaultReview"
      preset="card"
      :title="vaultUser ? $t('admin.users.vaultModal.title', { name: vaultUser.name }) : $t('admin.users.vaultModal.reviewTitle')"
      style="width: min(860px, 100vw)"
      data-testid="users-vault-modal"
      @update:show="(value) => { if (!value) closeVault() }"
    >
      <p class="mb-3 text-sm text-gray-400">
        {{ $t('admin.users.vaultModal.hint') }}
      </p>
      <VaultAdministration
        v-if="vaultUser"
        :key="vaultUser.id"
        :user-id="vaultUser.id"
      />
      <VaultAdministration
        v-else-if="vaultReview"
        review
      />
    </NModal>

    <NModal
      :show="sessionsUser !== null"
      preset="card"
      :title="$t('admin.users.loginSessions.title', { name: sessionsUser?.name ?? '' })"
      style="width: min(880px, 100vw)"
      data-testid="users-login-sessions-modal"
      @update:show="(value) => { if (!value) sessionsUser = null }"
    >
      <UserLoginSessions
        v-if="sessionsUser"
        :key="sessionsUser.id"
        :user-id="sessionsUser.id"
        :user-name="sessionsUser.name"
        :self="sessionsUser.id === auth.user?.id"
        @changed="loadOnline"
      />
    </NModal>

    <NDrawer
      :show="accessDrawerUser !== null"
      width="min(760px, 100vw)"
      placement="right"
      @update:show="(value) => { if (!value) closeAccessDrawer() }"
    >
      <NDrawerContent
        :title="$t('admin.users.access.title', { name: accessDrawerUser?.name ?? '' })"
        closable
      >
        <NSpin :show="accessLoading">
          <NAlert
            v-if="accessError"
            type="error"
            class="mb-4"
          >
            {{ accessError }}
          </NAlert>
          <NAlert
            v-else
            type="info"
            :show-icon="false"
            class="mb-4"
          >
            {{ $t('admin.users.access.description') }}
          </NAlert>

          <NEmpty
            v-if="!accessLoading && !accessError && accessEntries.length === 0"
            :description="$t('admin.users.access.empty')"
          />

          <div
            v-else
            class="space-y-3"
          >
            <div
              v-for="entry in accessEntries"
              :key="entry.aclEntryId"
              class="rounded-lg border border-gray-800 bg-[#111113] p-3"
            >
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <NTag
                      size="small"
                      :type="entry.inventoryNodeType === 'HOST' ? 'warning' : 'info'"
                    >
                      {{ entry.inventoryNodeType === 'ROOT' ? $t('hosts.inventoryFolders.root') : entry.inventoryNodeType }}
                    </NTag>
                    <span class="truncate text-sm font-semibold text-white">
                      {{ entry.inventoryNodeType === 'ROOT' ? $t('hosts.inventoryFolders.root') : entry.inventoryNodeName }}
                    </span>
                  </div>
                  <div class="mt-1 flex flex-wrap items-center gap-1 text-xs text-gray-500">
                    <span>{{ $t('admin.users.access.source', { name: entry.principalName }) }}</span>
                    <span>·</span>
                    <span>{{ $t('admin.users.access.hostImpact', { count: entry.hostCount }) }}</span>
                    <span v-if="entry.inheritToChildren">· {{ $t('admin.users.access.inherited') }}</span>
                  </div>
                </div>
                <div class="flex flex-wrap justify-end gap-1">
                  <NTag
                    v-for="label in permissionLabels(entry)"
                    :key="label"
                    size="small"
                    type="success"
                  >
                    {{ label }}
                  </NTag>
                </div>
              </div>
            </div>
          </div>
        </NSpin>
      </NDrawerContent>
    </NDrawer>
  </div>
</template>

<style scoped>
:deep(.user-state-cell) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  line-height: 1;
}

:deep(.user-state-cell--yes) {
  color: #22c55e;
}

:deep(.user-state-cell--no) {
  color: #ef4444;
  opacity: 0.88;
}

:deep(.user-state-icon) {
  display: block;
  width: 16px;
  height: 16px;
}

:deep(.user-action-danger) {
  color: #f87171;
}

:deep(.users-name-cell) {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

:deep(.users-name-cell__text) {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

:deep(.users-name-cell__name),
:deep(.users-name-cell__email) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.users-name-cell__name) {
  white-space: normal;
  overflow-wrap: anywhere;
  color: #f9fafb;
  font-weight: 600;
}

:deep(.users-name-cell__email) {
  color: #9ca3af;
  font-size: 12px;
}
.users-vault-help {
  color: var(--na-text-muted, #9ca3af);
  font-size: 13px;
  line-height: 1.5;
}
.users-vault-help summary { cursor: pointer; width: fit-content; }
.users-vault-help summary:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
.users-vault-help p { margin-top: 8px; max-width: 72ch; }
</style>
