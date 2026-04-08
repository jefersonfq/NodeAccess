<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NAlert, NButton, NDataTable, NForm, NFormItem, NInput,
  NInputNumber, NModal, NSpace, NSwitch, NTag, useMessage,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import type { CreateTenantDto, TenantPublic } from '@nodeaccess/shared'
import { tenantService } from '@/services/tenant.service'
import SkeletonTable from '@/components/SkeletonTable.vue'

const { t } = useI18n()
const msg = useMessage()

const tenants = ref<TenantPublic[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const showModal = ref(false)
const modalLoading = ref(false)
const firstAdminPassword = ref<string | null>(null)

const form = ref<CreateTenantDto>({
  name: '',
  slug: '',
  active: true,
  maxUsers: 50,
  firstAdmin: {
    name: '',
    email: '',
  },
})

const columns = computed<DataTableColumns<TenantPublic>>(() => [
  { title: t('admin.tenants.columns.name'), key: 'name' },
  { title: t('admin.tenants.columns.slug'), key: 'slug' },
  {
    title: t('admin.tenants.columns.status'),
    key: 'active',
    render: (row) => h(NTag, { type: row.active ? 'success' : 'warning', bordered: false }, () => (
      row.active ? t('common.active') : t('common.inactive')
    )),
  },
  { title: t('admin.tenants.columns.users'), key: 'users', render: (row) => `${row.activeUsers}/${row.maxUsers ?? t('common.unlimited')}` },
  {
    title: t('common.actions'),
    key: 'actions',
    render: (row) => h(NSpace, {}, () => [
      h(NButton, {
        size: 'small',
        type: row.active ? 'warning' : 'success',
        onClick: () => toggleActive(row),
      }, () => row.active ? t('admin.tenants.actions.deactivate') : t('admin.tenants.actions.activate')),
    ]),
  },
])

async function load() {
  loading.value = true
  error.value = null
  try {
    const { data } = await tenantService.list()
    tenants.value = data
  } catch {
    error.value = t('admin.tenants.messages.loadError')
  } finally {
    loading.value = false
  }
}

function resetForm() {
  firstAdminPassword.value = null
  form.value = {
    name: '',
    slug: '',
    active: true,
    maxUsers: 50,
    firstAdmin: { name: '', email: '' },
  }
}

function openCreate() {
  resetForm()
  showModal.value = true
}

function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
}

function normalizeCurrentSlug() {
  form.value.slug = normalizeSlug(form.value.slug)
}

async function save() {
  modalLoading.value = true
  try {
    const payload: CreateTenantDto = {
      ...form.value,
      firstAdmin: form.value.firstAdmin?.email ? form.value.firstAdmin : undefined,
    }
    const { data } = await tenantService.create(payload)
    firstAdminPassword.value = data.firstAdminTemporaryPassword ?? null
    msg.success(t('admin.tenants.messages.created'))
    await load()
    if (!firstAdminPassword.value) showModal.value = false
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('admin.tenants.messages.saveError'))
  } finally {
    modalLoading.value = false
  }
}

async function toggleActive(row: TenantPublic) {
  try {
    await tenantService.update(row.id, { active: !row.active })
    msg.success(row.active ? t('admin.tenants.messages.deactivated') : t('admin.tenants.messages.activated'))
    await load()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('admin.tenants.messages.saveError'))
  }
}

onMounted(load)
</script>

<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-xl font-semibold text-white">{{ $t('admin.tenants.title') }}</h1>
        <p class="text-sm text-gray-500 mt-1">{{ $t('admin.tenants.subtitle') }}</p>
      </div>
      <NButton type="primary" @click="openCreate">{{ $t('admin.tenants.newTenant') }}</NButton>
    </div>

    <NAlert v-if="error" type="error" class="mb-4" :title="error" />

    <SkeletonTable v-if="loading && tenants.length === 0" :rows="5" :columns="5" />
    <NDataTable v-else :loading="loading" :columns="columns" :data="tenants" :row-key="(r) => r.id" :bordered="false" />

    <NModal v-model:show="showModal" preset="card" :title="$t('admin.tenants.modal.createTitle')" style="width: 620px">
      <NAlert v-if="firstAdminPassword" type="success" class="mb-4" :title="$t('admin.tenants.modal.passwordTitle')">
        <div class="font-mono text-sm">{{ firstAdminPassword }}</div>
        <div class="text-xs mt-2">{{ $t('admin.tenants.modal.passwordHint') }}</div>
      </NAlert>

      <NForm v-else @submit.prevent="save">
        <NAlert type="info" class="mb-4" :title="$t('admin.tenants.modal.scopeTitle')">
          {{ $t('admin.tenants.modal.scopeHelp') }}
        </NAlert>

        <div class="tenant-form-section">{{ $t('admin.tenants.modal.companySection') }}</div>

        <NFormItem :label="$t('admin.tenants.modal.nameLabel')">
          <NInput v-model:value="form.name" :placeholder="$t('admin.tenants.modal.namePlaceholder')" />
          <template #feedback>
            {{ $t('admin.tenants.modal.nameHelp') }}
          </template>
        </NFormItem>
        <NFormItem :label="$t('admin.tenants.modal.slugLabel')">
          <NInput v-model:value="form.slug" placeholder="cliente-a" @blur="normalizeCurrentSlug" />
          <template #feedback>
            {{ $t('admin.tenants.modal.slugHelp') }}
          </template>
        </NFormItem>
        <NFormItem :label="$t('admin.tenants.modal.maxUsersLabel')">
          <NInputNumber v-model:value="form.maxUsers" :min="1" class="w-full" />
          <template #feedback>
            {{ $t('admin.tenants.modal.maxUsersHelp') }}
          </template>
        </NFormItem>
        <NFormItem :label="$t('admin.tenants.modal.activeLabel')">
          <NSwitch v-model:value="form.active" />
          <template #feedback>
            {{ $t('admin.tenants.modal.activeHelp') }}
          </template>
        </NFormItem>

        <div class="tenant-form-section">{{ $t('admin.tenants.modal.firstAdminSection') }}</div>
        <p class="tenant-form-help">{{ $t('admin.tenants.modal.firstAdminSectionHelp') }}</p>

        <NFormItem :label="$t('admin.tenants.modal.adminNameLabel')">
          <NInput v-model:value="form.firstAdmin!.name" :placeholder="$t('admin.tenants.modal.adminNamePlaceholder')" />
          <template #feedback>
            {{ $t('admin.tenants.modal.adminNameHelp') }}
          </template>
        </NFormItem>
        <NFormItem :label="$t('admin.tenants.modal.adminEmailLabel')">
          <NInput v-model:value="form.firstAdmin!.email" :placeholder="$t('admin.tenants.modal.adminEmailPlaceholder')" />
          <template #feedback>
            {{ $t('admin.tenants.modal.adminEmailHelp') }}
          </template>
        </NFormItem>
        <div class="tenant-form-actions">
          <NButton @click="showModal = false">{{ $t('common.cancel') }}</NButton>
          <NButton type="primary" :loading="modalLoading" @click="save">
            {{ $t('admin.tenants.modal.create') }}
          </NButton>
        </div>
      </NForm>
    </NModal>
  </div>
</template>

<style scoped>
.tenant-form-section {
  margin: 12px 0 8px;
  color: #e5e7eb;
  font-size: 13px;
  font-weight: 600;
}

.tenant-form-help {
  margin: -2px 0 12px;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.5;
}

.tenant-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
</style>
