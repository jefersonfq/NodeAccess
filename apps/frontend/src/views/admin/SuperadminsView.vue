<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NAlert, NButton, NCheckbox, NDataTable, NForm, NFormItem, NInput,
  NModal, NPopconfirm, NSelect, NSpace, NTag, useMessage,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import type { TenantPublic } from '@nodeaccess/shared'
import SkeletonTable from '@/components/SkeletonTable.vue'
import { tenantService } from '@/services/tenant.service'
import {
  platformAdminService,
  type CreatePlatformAdminPayload,
  type PlatformAdminPublic,
} from '@/services/platform-admin.service'

const { t } = useI18n()
const msg = useMessage()

const admins = ref<PlatformAdminPublic[]>([])
const tenants = ref<TenantPublic[]>([])
const loading = ref(false)
const tenantsLoading = ref(false)
const error = ref<string | null>(null)
const showModal = ref(false)
const saving = ref(false)
const temporaryPassword = ref<string | null>(null)

const form = ref<CreatePlatformAdminPayload>({
  name: '',
  email: '',
  tenantId: undefined,
  resetPassword: true,
})

const tenantOptions = computed(() =>
  tenants.value.map((tenant) => ({
    label: `${tenant.name} (${tenant.slug})`,
    value: tenant.id,
  })),
)

const defaultTenantId = computed(() =>
  tenants.value.find((tenant) => tenant.slug === 'default')?.id ?? tenants.value[0]?.id,
)

const columns = computed<DataTableColumns<PlatformAdminPublic>>(() => [
  { title: t('common.name'), key: 'name' },
  { title: t('common.email'), key: 'email' },
  {
    title: t('admin.superadmins.columns.tenant'),
    key: 'tenant',
    render: (row) => `${row.tenantName} (${row.tenantSlug})`,
  },
  {
    title: t('common.status'),
    key: 'active',
    render: (row) => h(NTag, { type: row.active ? 'success' : 'warning', bordered: false }, () => (
      row.active ? t('common.active') : t('common.inactive')
    )),
  },
  {
    title: t('common.actions'),
    key: 'actions',
    render: (row) => h(NSpace, {}, () => [
      h(NPopconfirm, {
        onPositiveClick: () => resetPassword(row),
      }, {
        trigger: () => h(NButton, { size: 'small' }, () => t('admin.superadmins.actions.resetPassword')),
        default: () => t('admin.superadmins.reset.confirm', { email: row.email }),
      }),
      h(NPopconfirm, {
        onPositiveClick: () => revoke(row),
      }, {
        trigger: () => h(NButton, { size: 'small', type: 'error', ghost: true }, () => t('admin.superadmins.actions.revoke')),
        default: () => t('admin.superadmins.revoke.confirm', { email: row.email }),
      }),
    ]),
  },
])

async function load() {
  loading.value = true
  error.value = null
  try {
    const { data } = await platformAdminService.list()
    admins.value = data
  } catch {
    error.value = t('admin.superadmins.messages.loadError')
  } finally {
    loading.value = false
  }
}

async function loadTenants() {
  tenantsLoading.value = true
  try {
    const { data } = await tenantService.list()
    tenants.value = data
    if (!form.value.tenantId) {
      form.value.tenantId = defaultTenantId.value
    }
  } catch {
    msg.error(t('admin.superadmins.messages.tenantsLoadError'))
  } finally {
    tenantsLoading.value = false
  }
}

function openCreate() {
  if (tenants.value.length === 0 && !tenantsLoading.value) {
    void loadTenants()
  }
  temporaryPassword.value = null
  form.value = {
    name: '',
    email: '',
    tenantId: defaultTenantId.value,
    resetPassword: true,
  }
  showModal.value = true
}

async function save() {
  if (!form.value.tenantId) {
    msg.error(t('admin.superadmins.messages.tenantRequired'))
    return
  }
  saving.value = true
  try {
    const payload: CreatePlatformAdminPayload = {
      email: form.value.email,
      ...(form.value.name?.trim() && { name: form.value.name.trim() }),
      tenantId: form.value.tenantId,
      resetPassword: form.value.resetPassword,
    }
    const { data } = await platformAdminService.create(payload)
    temporaryPassword.value = data.temporaryPassword ?? null
    msg.success(t('admin.superadmins.messages.saved'))
    await load()
    if (!temporaryPassword.value) showModal.value = false
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('admin.superadmins.messages.saveError'))
  } finally {
    saving.value = false
  }
}

async function resetPassword(row: PlatformAdminPublic) {
  try {
    const { data } = await platformAdminService.resetPassword(row.id)
    temporaryPassword.value = data.temporaryPassword ?? null
    showModal.value = true
    msg.success(t('admin.superadmins.messages.passwordReset'))
    await load()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('admin.superadmins.messages.passwordResetError'))
  }
}

async function revoke(row: PlatformAdminPublic) {
  try {
    await platformAdminService.revoke(row.id)
    msg.success(t('admin.superadmins.messages.revoked'))
    await load()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('admin.superadmins.messages.revokeError'))
  }
}

onMounted(() => {
  load()
  loadTenants()
})
</script>

<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-xl font-semibold text-white">{{ $t('admin.superadmins.title') }}</h1>
        <p class="text-sm text-gray-500 mt-1">{{ $t('admin.superadmins.subtitle') }}</p>
      </div>
      <NButton type="primary" @click="openCreate">{{ $t('admin.superadmins.newAdmin') }}</NButton>
    </div>

    <NAlert v-if="error" type="error" class="mb-4" :title="error" />

    <SkeletonTable v-if="loading && admins.length === 0" :rows="5" :columns="5" />
    <NDataTable v-else :loading="loading" :columns="columns" :data="admins" :row-key="(r) => r.id" :bordered="false" />

    <NModal v-model:show="showModal" preset="card" :title="$t('admin.superadmins.modal.title')" style="width: 560px">
      <NAlert v-if="temporaryPassword" type="success" class="mb-4" :title="$t('admin.superadmins.modal.passwordTitle')">
        <div class="font-mono text-sm">{{ temporaryPassword }}</div>
        <div class="text-xs mt-2">{{ $t('admin.superadmins.modal.passwordHint') }}</div>
      </NAlert>

      <NForm v-else @submit.prevent="save">
        <NAlert type="info" class="mb-4" :title="$t('admin.superadmins.modal.scopeTitle')">
          {{ $t('admin.superadmins.modal.scopeHelp') }}
        </NAlert>

        <NFormItem :label="$t('common.name')">
          <NInput v-model:value="form.name" :placeholder="$t('admin.superadmins.modal.namePlaceholder')" />
          <template #feedback>
            {{ $t('admin.superadmins.modal.nameHelp') }}
          </template>
        </NFormItem>
        <NFormItem :label="$t('common.email')">
          <NInput v-model:value="form.email" placeholder="admin@empresa.com" />
          <template #feedback>
            {{ $t('admin.superadmins.modal.emailHelp') }}
          </template>
        </NFormItem>
        <NFormItem :label="$t('admin.superadmins.modal.tenantLabel')">
          <NSelect
            v-model:value="form.tenantId"
            :options="tenantOptions"
            :loading="tenantsLoading"
            filterable
            :placeholder="$t('admin.superadmins.modal.tenantPlaceholder')"
          />
          <template #feedback>
            {{ $t('admin.superadmins.modal.tenantHelp') }}
          </template>
        </NFormItem>
        <NFormItem>
          <NCheckbox v-model:checked="form.resetPassword">
            {{ $t('admin.superadmins.modal.resetPassword') }}
          </NCheckbox>
        </NFormItem>
        <div class="superadmin-form-actions">
          <NButton @click="showModal = false">{{ $t('common.cancel') }}</NButton>
          <NButton type="primary" :loading="saving" :disabled="!form.tenantId || tenantsLoading" @click="save">
            {{ $t('common.save') }}
          </NButton>
        </div>
      </NForm>
    </NModal>
  </div>
</template>

<style scoped>
.superadmin-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
</style>
