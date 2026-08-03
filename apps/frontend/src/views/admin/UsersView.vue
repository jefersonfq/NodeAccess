<script setup lang="ts">
import { ref, onMounted, h, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  NDataTable, NButton, NSpace, NTag, NInput, NAlert, NSpin,
  NModal, NForm, NFormItem, NSelect, NSwitch, NTransfer, NCheckbox,
  NDrawer, NDrawerContent, NEmpty, NTooltip, NDropdown, useMessage, useDialog,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import type { UserPublic, CreateUserDto, UpdateUserDto } from '@nodeaccess/shared'
import { userService, type UserInventoryAccessEntry } from '@/services/user.service'
import { groupService } from '@/services/group.service'
import { platformAdminService } from '@/services/platform-admin.service'
import { useAuthStore } from '@/stores/auth'
import SkeletonTable from '@/components/SkeletonTable.vue'
import UserAvatar from '@/components/UserAvatar.vue'

const { t } = useI18n()
const router = useRouter()
const auth = useAuthStore()

const msg    = useMessage()
const dialog = useDialog()

const users          = ref<UserPublic[]>([])
const total          = ref(0)
const loading        = ref(false)
const error          = ref<string | null>(null)
const search         = ref('')
const includeDeleted = ref(false)
const promotingUserId = ref<number | null>(null)
const accessDrawerUser = ref<UserPublic | null>(null)
const accessLoading = ref(false)
const accessError = ref('')
const accessEntries = ref<UserInventoryAccessEntry[]>([])

const groupOptions = ref<{ label: string; value: number }[]>([])
const userOptions = computed(() =>
  users.value.map((user) => ({ label: `${user.name} (${user.email})`, value: user.id })),
)

async function loadGroups() {
  try {
    const { data } = await groupService.list()
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

function openCreate() {
  createForm.value = { name: '', email: '', role: 'user', canManageHosts: false, canViewLiveSessions: false, groupIds: [], password: '' }
  tempPassword.value = null
  copyGroupsFromCreateUserId.value = null
  showCreateModal.value = true
}

async function createUser() {
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
    load()
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

async function openEdit(user: UserPublic) {
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

async function copyGroups(target: 'create' | 'edit') {
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

async function saveEdit() {
  if (editingId.value === null) return
  editLoading.value = true
  try {
    await userService.update(editingId.value, editForm.value)
    msg.success(t('admin.users.messages.updated'))
    showEditModal.value = false
    load()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('admin.users.messages.updateError'))
  } finally {
    editLoading.value = false
  }
}

function openUserDashboard(userId: number) {
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

async function openAccessDrawer(user: UserPublic) {
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

function closeAccessDrawer() {
  accessDrawerUser.value = null
  accessEntries.value = []
  accessError.value = ''
}

function renderStateIcon(enabled: boolean, label: string, tooltip = label) {
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

function userStatusLabel(user: UserPublic) {
  if (user.deletedAt) return t('admin.users.status.deleted')
  return user.active ? t('admin.users.status.active') : t('admin.users.status.inactive')
}

function userActionOptions(user: UserPublic) {
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
    { type: 'divider', key: 'danger-divider' },
    {
      label: () => h('span', { class: 'user-action-danger' }, t('admin.users.actions.delete')),
      key: 'delete',
    },
  ]
}

function handleUserAction(action: UserActionKey, user: UserPublic) {
  if (action === 'dashboard') return openUserDashboard(user.id)
  if (action === 'access') return openAccessDrawer(user)
  if (action === 'edit') return openEdit(user)
  if (action === 'promote-superadmin') return confirmPromotePlatformAdmin(user)
  if (action === 'activate') return toggleActive(user, true)
  if (action === 'deactivate') return toggleActive(user, false)
  if (action === 'reset-password') return resetPwd(user.id)
  if (action === 'reset-mfa') return confirmResetMfa(user)
  if (action === 'delete') return confirmDeleteUser(user)
  if (action === 'restore') return restoreUser(user)
}

// ─── Tabela ──────────────────────────────────────────────────────────────────

const columns = computed<DataTableColumns<UserPublic>>(() => [
  {
    title: t('admin.users.columns.name'),
    key: 'name',
    minWidth: 220,
    render: (row) => h('div', { class: 'users-name-cell' }, [
      h(UserAvatar, { user: row, size: 32 }),
      h('div', { class: 'users-name-cell__text' }, [
        h('span', { class: 'users-name-cell__name' }, row.name),
        h('span', { class: 'users-name-cell__email' }, row.email),
      ]),
    ]),
  },
  {
    title: t('admin.users.columns.role'), key: 'role',
    render: (row) => h(NTag, { type: row.role === 'admin' ? 'warning' : 'default', size: 'small' }, () =>
      row.role === 'admin' ? t('admin.users.roles.admin') : t('admin.users.roles.user'),
    ),
  },
  {
    title: t('admin.users.columns.canManageHosts'), key: 'canManageHosts',
    align: 'center',
    width: 124,
    render: (row) => renderStateIcon(
      row.canManageHosts,
      row.canManageHosts ? t('admin.users.manage.yes') : t('admin.users.manage.no'),
      row.canManageHosts
        ? `${t('admin.users.columns.canManageHosts')}: ${t('admin.users.manage.yes')}`
        : `${t('admin.users.columns.canManageHosts')}: ${t('admin.users.manage.no')}`,
    ),
  },
  {
    title: 'Sessões abertas', key: 'canViewLiveSessions',
    render: (row) => h(NTag, { type: row.canViewLiveSessions ? 'success' : 'default', size: 'small' }, () => row.canViewLiveSessions ? t('admin.users.manage.yes') : t('admin.users.manage.no')),
  },
  {
    title: t('admin.users.columns.status'), key: 'active',
    align: 'center',
    width: 92,
    render: (row) => renderStateIcon(row.active && !row.deletedAt, userStatusLabel(row), userStatusLabel(row)),
  },
  {
    title: t('admin.users.columns.groups'), key: 'groupIds',
    render: (row) => h(NTag, { type: row.groupIds.length > 0 ? 'info' : 'default', size: 'small' }, () =>
      row.groupIds.length > 0
        ? t('admin.users.groupsCount', { count: row.groupIds.length })
        : t('admin.users.noGroups'),
    ),
  },
  {
    title: t('admin.users.columns.actions'), key: 'actions',
    align: 'right',
    width: 96,
    render: (row) => h(NDropdown, {
      trigger: 'click',
      placement: 'bottom-end',
      options: userActionOptions(row),
      onSelect: (key: string) => handleUserAction(key as UserActionKey, row),
    }, {
      default: () => h(NButton, { size: 'small', secondary: true }, () => t('admin.users.columns.actions')),
    }),
  },
])

// ─── Ações ───────────────────────────────────────────────────────────────────

async function load() {
  loading.value = true
  error.value   = null
  try {
    const { data } = await userService.list({
      search: search.value || undefined,
      includeDeleted: includeDeleted.value || undefined,
    })
    users.value = data.data
    total.value = data.total
  } catch {
    error.value = t('admin.users.messages.loadError')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  load()
  loadGroups()
})

async function toggleActive(user: UserPublic, active: boolean) {
  try {
    if (active) await userService.activate(user.id)
    else        await userService.deactivate(user.id)
    msg.success(active ? t('admin.users.messages.activated') : t('admin.users.messages.deactivated'))
    load()
  } catch {
    msg.error(t('admin.users.messages.updateError'))
  }
}

function confirmDeleteUser(user: UserPublic) {
  dialog.warning({
    title:        t('admin.users.deleteConfirm.title'),
    content:      t('admin.users.deleteConfirm.content', { name: user.name, email: user.email }),
    positiveText: t('admin.users.deleteConfirm.confirm'),
    negativeText: t('admin.users.deleteConfirm.cancel'),
    onPositiveClick: async () => {
      try {
        await userService.delete(user.id)
        msg.success(t('admin.users.messages.deleted'))
        load()
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } }
        msg.error(e.response?.data?.message ?? t('admin.users.messages.deleteError'))
      }
    },
  })
}

async function restoreUser(user: UserPublic) {
  try {
    await userService.restore(user.id)
    msg.success(t('admin.users.messages.restored'))
    load()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('admin.users.messages.restoreError'))
  }
}

async function resetPwd(id: number) {
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

function confirmResetMfa(user: UserPublic) {
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

function confirmPromotePlatformAdmin(user: UserPublic) {
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
      <h1 class="text-xl font-semibold text-white">{{ $t('admin.users.title') }}</h1>
      <NButton type="primary" @click="openCreate">{{ $t('admin.users.newUser') }}</NButton>
    </div>

    <NSpace class="mb-4" align="center">
      <NInput v-model:value="search" :placeholder="$t('admin.users.searchPlaceholder')" clearable style="width:240px" @keyup.enter="load" />
      <NButton @click="load">{{ $t('common.search') }}</NButton>
      <NCheckbox v-model:checked="includeDeleted" @update:checked="load">
        {{ $t('admin.users.showDeleted') }}
      </NCheckbox>
    </NSpace>

    <NAlert v-if="error" type="error" class="mb-4" :title="error" />

    <SkeletonTable v-if="loading && users.length === 0" :rows="6" :columns="5" />
    <NSpin v-else :show="loading">
      <NDataTable
        :columns="columns"
        :data="users"
        :row-key="(r) => r.id"
        :bordered="false"
      >
        <template v-if="!loading && users.length === 0" #empty>
          <div class="py-16 flex flex-col items-center gap-3">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="#444" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
              <path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            <p class="text-sm text-gray-500">{{ $t('admin.users.emptyDesc') }}</p>
            <NButton type="primary" size="small" @click="openCreate">{{ $t('admin.users.createFirst') }}</NButton>
          </div>
        </template>
      </NDataTable>
    </NSpin>

    <!-- Modal: criar usuário -->
    <NModal v-model:show="showCreateModal" preset="card" :title="$t('admin.users.createModal.title')" style="width: 480px">
      <NAlert v-if="tempPassword" type="success" class="mb-4"
        :title="$t('admin.users.resetPassword.tempPasswordLabel', { password: tempPassword })"
        :description="$t('admin.users.createModal.tempPasswordNote')" />

      <NForm v-if="!tempPassword" @submit.prevent="createUser">
        <NFormItem :label="$t('admin.users.createModal.nameLabel')">
          <NInput v-model:value="createForm.name" :input-props="{ autocomplete: 'off' }" />
        </NFormItem>
        <NFormItem :label="$t('admin.users.createModal.emailLabel')">
          <NInput v-model:value="createForm.email" :input-props="{ inputmode: 'email', autocomplete: 'off' }" />
        </NFormItem>
        <NFormItem :label="$t('admin.users.createModal.roleLabel')">
          <NSelect v-model:value="createForm.role" :options="roleOptions" />
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
            <NAlert type="info" :show-icon="false">
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
          <NButton @click="showCreateModal = false">{{ $t('admin.users.createModal.cancel') }}</NButton>
          <NButton type="primary" :loading="createLoading" @click="createUser">{{ $t('admin.users.createModal.create') }}</NButton>
        </div>
      </NForm>

      <div v-if="tempPassword" class="flex justify-end mt-2">
        <NButton @click="showCreateModal = false">{{ $t('common.close') }}</NButton>
      </div>
    </NModal>

    <!-- Modal: editar usuário -->
    <NModal v-model:show="showEditModal" preset="card" :title="$t('admin.users.editModal.title')" style="width: 480px">
      <NForm @submit.prevent="saveEdit">
        <NFormItem :label="$t('admin.users.createModal.nameLabel')">
          <NInput v-model:value="editForm.name" />
        </NFormItem>
        <NFormItem :label="$t('admin.users.createModal.roleLabel')">
          <NSelect v-model:value="editForm.role" :options="roleOptions" />
        </NFormItem>
        <NFormItem :label="$t('admin.users.createModal.canManageLabel')">
          <NSwitch v-model:value="editForm.canManageHosts" />
        </NFormItem>
        <NFormItem label="Pode visualizar sessões abertas">
          <NSwitch v-model:value="editForm.canViewLiveSessions" />
        </NFormItem>
        <NFormItem :label="$t('admin.users.editModal.groupsLabel')">
          <div class="w-full flex flex-col gap-3">
            <NAlert type="info" :show-icon="false">
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
          <NButton @click="showEditModal = false">{{ $t('admin.users.editModal.cancel') }}</NButton>
          <NButton type="primary" :loading="editLoading" @click="saveEdit">{{ $t('admin.users.editModal.save') }}</NButton>
        </div>
      </NForm>
    </NModal>

    <NDrawer
      :show="accessDrawerUser !== null"
      width="min(760px, 100vw)"
      placement="right"
      @update:show="(value) => { if (!value) closeAccessDrawer() }"
    >
      <NDrawerContent :title="$t('admin.users.access.title', { name: accessDrawerUser?.name ?? '' })" closable>
        <NSpin :show="accessLoading">
          <NAlert v-if="accessError" type="error" class="mb-4">
            {{ accessError }}
          </NAlert>
          <NAlert v-else type="info" :show-icon="false" class="mb-4">
            {{ $t('admin.users.access.description') }}
          </NAlert>

          <NEmpty
            v-if="!accessLoading && !accessError && accessEntries.length === 0"
            :description="$t('admin.users.access.empty')"
          />

          <div v-else class="space-y-3">
            <div
              v-for="entry in accessEntries"
              :key="entry.aclEntryId"
              class="rounded-lg border border-gray-800 bg-[#111113] p-3"
            >
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <NTag size="small" :type="entry.inventoryNodeType === 'HOST' ? 'warning' : 'info'">
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
  color: #f9fafb;
  font-weight: 600;
}

:deep(.users-name-cell__email) {
  color: #9ca3af;
  font-size: 12px;
}
</style>
