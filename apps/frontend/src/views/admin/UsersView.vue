<script setup lang="ts">
import { ref, onMounted, h, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NDataTable, NButton, NSpace, NTag, NInput, NAlert, NSpin,
  NModal, NForm, NFormItem, NSelect, NSwitch, NTransfer, useMessage, useDialog,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import type { UserPublic, CreateUserDto, UpdateUserDto } from '@nodeaccess/shared'
import { userService } from '@/services/user.service'
import { groupService } from '@/services/group.service'
import SkeletonTable from '@/components/SkeletonTable.vue'

const { t } = useI18n()

const msg    = useMessage()
const dialog = useDialog()

const users   = ref<UserPublic[]>([])
const total   = ref(0)
const loading = ref(false)
const error   = ref<string | null>(null)
const search  = ref('')

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

// ─── Modal criar ────────────────────────────────────────────────────────────

const showCreateModal    = ref(false)
const createLoading      = ref(false)
const tempPassword       = ref<string | null>(null)
const createForm = ref<CreateUserDto>({
  name: '', email: '', role: 'user', canManageHosts: false, groupIds: [],
})
const copyGroupsFromCreateUserId = ref<number | null>(null)

function openCreate() {
  createForm.value = { name: '', email: '', role: 'user', canManageHosts: false, groupIds: [] }
  tempPassword.value = null
  copyGroupsFromCreateUserId.value = null
  showCreateModal.value = true
}

async function createUser() {
  createLoading.value = true
  tempPassword.value  = null
  try {
    const { data } = await userService.create(createForm.value)
    tempPassword.value = data.temporaryPassword
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
  name: '', role: 'user', canManageHosts: false, groupIds: [],
})
const copyGroupsFromEditUserId = ref<number | null>(null)

async function openEdit(user: UserPublic) {
  editingId.value = user.id
  editForm.value  = {
    name:           user.name,
    role:           user.role,
    canManageHosts: user.canManageHosts,
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

// ─── Tabela ──────────────────────────────────────────────────────────────────

const columns = computed<DataTableColumns<UserPublic>>(() => [
  { title: t('admin.users.columns.name'),   key: 'name' },
  { title: t('admin.users.columns.email'),  key: 'email' },
  {
    title: t('admin.users.columns.role'), key: 'role',
    render: (row) => h(NTag, { type: row.role === 'admin' ? 'warning' : 'default', size: 'small' }, () => row.role),
  },
  {
    title: t('admin.users.columns.canManageHosts'), key: 'canManageHosts',
    render: (row) => h(NTag, { type: row.canManageHosts ? 'info' : 'default', size: 'small' }, () => row.canManageHosts ? t('admin.users.manage.yes') : t('admin.users.manage.no')),
  },
  {
    title: t('admin.users.columns.status'), key: 'active',
    render: (row) => h(NTag, { type: row.active ? 'success' : 'default', size: 'small' }, () => row.active ? t('admin.users.status.active') : t('admin.users.status.inactive')),
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
    render: (row) => h(NSpace, {}, () => [
      h(NButton, { size: 'small', onClick: () => openEdit(row) }, () => t('admin.users.actions.edit')),
      row.active
        ? h(NButton, { size: 'small', onClick: () => toggleActive(row, false) }, () => t('admin.users.actions.deactivate'))
        : h(NButton, { size: 'small', type: 'primary', onClick: () => toggleActive(row, true) }, () => t('admin.users.actions.activate')),
      h(NButton, { size: 'small', onClick: () => resetPwd(row.id) }, () => t('admin.users.actions.resetPassword')),
    ]),
  },
])

// ─── Ações ───────────────────────────────────────────────────────────────────

async function load() {
  loading.value = true
  error.value   = null
  try {
    const { data } = await userService.list({ search: search.value || undefined })
    users.value = data.data
    total.value = data.total
  } catch {
    error.value = 'Erro ao carregar usuários'
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
</script>

<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-xl font-semibold text-white">{{ $t('admin.users.title') }}</h1>
      <NButton type="primary" @click="openCreate">{{ $t('admin.users.newUser') }}</NButton>
    </div>

    <NSpace class="mb-4">
      <NInput v-model:value="search" :placeholder="$t('admin.users.searchPlaceholder')" clearable style="width:240px" @keyup.enter="load" />
      <NButton @click="load">{{ $t('common.search') }}</NButton>
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
          <NInput v-model:value="createForm.name" />
        </NFormItem>
        <NFormItem :label="$t('admin.users.createModal.emailLabel')">
          <NInput v-model:value="createForm.email" :input-props="{ inputmode: 'email' }" />
        </NFormItem>
        <NFormItem :label="$t('admin.users.createModal.roleLabel')">
          <NSelect v-model:value="createForm.role" :options="roleOptions" />
        </NFormItem>
        <NFormItem :label="$t('admin.users.createModal.canManageLabel')">
          <NSwitch v-model:value="createForm.canManageHosts" />
        </NFormItem>
        <NFormItem :label="$t('admin.users.createModal.groupsLabel')">
          <div class="w-full flex flex-col gap-3">
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
        <NButton @click="showCreateModal = false">{{ $t('common.cancel') }}</NButton>
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
        <NFormItem :label="$t('admin.users.createModal.groupsLabel')">
          <div class="w-full flex flex-col gap-3">
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
  </div>
</template>
