<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import {
  NAlert, NButton, NDataTable, NForm, NFormItem, NInput,
  NInputNumber, NModal, NPopconfirm, NSpace, NSwitch, NTag, useMessage,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import {
  RESERVED_TENANT_SLUGS,
  TENANT_SLUG_REGEX,
  type CreateTenantDto,
  type TenantDashboardSummary,
  type TenantDashboardTenant,
  type TenantPublic,
  type UpdateTenantDto,
} from '@nodeaccess/shared'
import { tenantService } from '@/services/tenant.service'
import { useAuthStore } from '@/stores/auth'
import SkeletonTable from '@/components/SkeletonTable.vue'
import TenantLicenseEditor from '@/components/platform/TenantLicenseEditor.vue'

const { t } = useI18n()
const msg = useMessage()
const router = useRouter()
const auth = useAuthStore()
const RESERVED_TENANT_SLUG_SET = new Set<string>(RESERVED_TENANT_SLUGS)

const tenants = ref<TenantPublic[]>([])
const dashboard = ref<TenantDashboardSummary | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const showModal = ref(false)
const showAdminModal = ref(false)
const showEditModal = ref(false)
const modalLoading = ref(false)
const adminModalLoading = ref(false)
const editModalLoading = ref(false)
const firstAdminPassword = ref<string | null>(null)
const adminTenant = ref<TenantPublic | null>(null)
const adminForm = ref({ name: '', email: '' })
const editTenant = ref<TenantPublic | null>(null)
const licenseTenant = ref<TenantPublic | null>(null)
const editForm = ref<UpdateTenantDto>({ name: '', slug: '', active: true })

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
        type: 'primary',
        ghost: true,
        onClick: () => enterTenant(row),
      }, () => t('admin.tenants.actions.manage')),
      h(NButton, {
        size: 'small',
        onClick: () => openEdit(row),
      }, () => t('common.edit')),
      h(NButton, {
        size: 'small',
        type: 'info',
        ghost: true,
        onClick: () => { licenseTenant.value = row },
      }, () => 'Licença'),
      h(NButton, {
        size: 'small',
        onClick: () => openCreateAdmin(row),
      }, () => t('admin.tenants.actions.createAdmin')),
      h(NButton, {
        size: 'small',
        type: row.active ? 'warning' : 'success',
        onClick: () => toggleActive(row),
      }, () => row.active ? t('admin.tenants.actions.deactivate') : t('admin.tenants.actions.activate')),
      h(NPopconfirm, {
        onPositiveClick: () => deleteTenant(row),
      }, {
        trigger: () => h(NButton, {
          size: 'small',
          type: 'error',
          ghost: true,
        }, () => t('common.delete')),
        default: () => t('admin.tenants.delete.confirm'),
      }),
    ]),
  },
])

const maxDailyActivity = computed(() => {
  const values = dashboard.value?.dailyActivity.flatMap((day) => [day.logins, day.sessions]) ?? []
  return Math.max(...values, 1)
})

const topTenantMaxActivity = computed(() => {
  const values = dashboard.value?.topTenantsByActivity.map((tenant) => tenant.loginsLast7Days + tenant.sessionsLast7Days) ?? []
  return Math.max(...values, 1)
})

const isCreateSlugValid = computed(() => isValidTenantSlug(form.value.slug))
const isEditSlugValid = computed(() => isValidTenantSlug(editForm.value.slug ?? ''))
const createSlugAlreadyExists = computed(() =>
  tenants.value.some((tenant) => tenant.slug === form.value.slug),
)
const editSlugAlreadyExists = computed(() =>
  tenants.value.some((tenant) => tenant.slug === editForm.value.slug && tenant.id !== editTenant.value?.id),
)
const canCreateTenant = computed(() =>
  isCreateSlugValid.value && !createSlugAlreadyExists.value && isValidEmail(form.value.firstAdmin?.email ?? ''),
)
const canSaveEditTenant = computed(() => isEditSlugValid.value && !editSlugAlreadyExists.value)
const createSlugLoginPreview = computed(() => loginSlugPreview(form.value.slug))
const editSlugLoginPreview = computed(() => loginSlugPreview(editForm.value.slug ?? ''))

function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat().format(value ?? 0)
}

function resourceTotal(tenant: TenantDashboardTenant) {
  return tenant.hosts
    + tenant.snippets
    + tenant.hostLinks
    + tenant.associatedLinks
    + tenant.bastions
    + tenant.pemKeys
    + tenant.secrets
    + tenant.agents
}

function formatLastLogin(value: Date | string | null) {
  if (!value) return t('admin.tenants.dashboard.never')
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

async function load() {
  loading.value = true
  error.value = null
  try {
    const [tenantResponse, dashboardResponse] = await Promise.all([
      tenantService.list(),
      tenantService.dashboard(),
    ])
    tenants.value = tenantResponse.data
    dashboard.value = dashboardResponse.data
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

function openCreateAdmin(row: TenantPublic) {
  adminTenant.value = row
  adminForm.value = { name: '', email: '' }
  firstAdminPassword.value = null
  showAdminModal.value = true
}

function openEdit(row: TenantPublic) {
  editTenant.value = row
  editForm.value = {
    name: row.name,
    slug: row.slug,
    active: row.active,
  }
  showEditModal.value = true
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

function isValidTenantSlug(value: string) {
  return value.length >= 2
    && value.length <= 63
    && TENANT_SLUG_REGEX.test(value)
    && !RESERVED_TENANT_SLUG_SET.has(value)
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

function slugValidationStatus(value: string) {
  if (!value) return undefined
  if (!isValidTenantSlug(value)) return 'error'
  if (tenants.value.some((tenant) => tenant.slug === value && tenant.id !== editTenant.value?.id)) return 'error'
  return 'success'
}

function slugFeedback(value: string) {
  if (!value || isValidTenantSlug(value)) return t('admin.tenants.modal.slugHelp')
  if (value.length < 2) return t('admin.tenants.modal.slugMinError')
  if (value.length > 63) return t('admin.tenants.modal.slugMaxError')
  if (RESERVED_TENANT_SLUG_SET.has(value)) return t('admin.tenants.modal.slugReservedError')
  return t('admin.tenants.modal.slugFormatError')
}

function tenantFormErrorMessage(err: unknown, fallback: string) {
  const data = (err as { response?: { data?: { code?: string; message?: string } } })?.response?.data
  if (data?.message?.includes('Slug de tenant')) return t('admin.tenants.messages.slugConflict')
  if (data?.message?.includes('E-mail')) return t('admin.tenants.messages.emailConflict')
  if (data?.code === 'VALIDATION_ERROR') return data.message ?? t('admin.tenants.messages.validationError')
  return data?.message ?? fallback
}

function loginSlugPreview(slug: string) {
  if (!isValidTenantSlug(slug)) return ''
  const currentHost = typeof window !== 'undefined' ? window.location.host : ''
  if (!currentHost) return slug
  return `${slug}.${currentHost}`
}

function normalizeCurrentSlug() {
  form.value.slug = normalizeSlug(form.value.slug)
}

function updateCreateSlug(value: string) {
  form.value.slug = normalizeSlug(value)
}

function updateEditSlug(value: string) {
  editForm.value.slug = normalizeSlug(value)
}

async function save() {
  form.value.slug = normalizeSlug(form.value.slug)
  if (!isCreateSlugValid.value) {
    msg.error(t('admin.tenants.modal.slugFormatError'))
    return
  }
  if (createSlugAlreadyExists.value) {
    msg.error(t('admin.tenants.messages.slugConflict'))
    return
  }
  if (!isValidEmail(form.value.firstAdmin?.email ?? '')) {
    msg.error(t('admin.tenants.messages.adminEmailInvalid'))
    return
  }
  modalLoading.value = true
  try {
    const payload: CreateTenantDto = {
      ...form.value,
      firstAdmin: form.value.firstAdmin!,
    }
    const { data } = await tenantService.create(payload)
    firstAdminPassword.value = data.firstAdminTemporaryPassword ?? null
    msg.success(t('admin.tenants.messages.created'))
    await load()
    if (!firstAdminPassword.value) showModal.value = false
  } catch (err: unknown) {
    msg.error(tenantFormErrorMessage(err, t('admin.tenants.messages.saveError')))
  } finally {
    modalLoading.value = false
  }
}

async function createTenantAdmin() {
  if (!adminTenant.value) return
  adminModalLoading.value = true
  try {
    const { data } = await tenantService.createAdmin(adminTenant.value.id, adminForm.value)
    firstAdminPassword.value = data.temporaryPassword
    msg.success(t('admin.tenants.messages.adminCreated'))
    await load()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('admin.tenants.messages.adminCreateError'))
  } finally {
    adminModalLoading.value = false
  }
}

async function saveEdit() {
  if (!editTenant.value) return
  editForm.value.slug = normalizeSlug(editForm.value.slug ?? '')
  if (!isEditSlugValid.value) {
    msg.error(t('admin.tenants.modal.slugFormatError'))
    return
  }
  if (editSlugAlreadyExists.value) {
    msg.error(t('admin.tenants.messages.slugConflict'))
    return
  }
  editModalLoading.value = true
  try {
    await tenantService.update(editTenant.value.id, editForm.value)
    msg.success(t('admin.tenants.messages.updated'))
    showEditModal.value = false
    await load()
  } catch (err: unknown) {
    msg.error(tenantFormErrorMessage(err, t('admin.tenants.messages.saveError')))
  } finally {
    editModalLoading.value = false
  }
}

async function deleteTenant(row: TenantPublic) {
  try {
    await tenantService.delete(row.id)
    msg.success(t('admin.tenants.messages.deleted'))
    await load()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('admin.tenants.messages.deleteError'))
  }
}

async function enterTenant(row: TenantPublic) {
  try {
    await auth.enterTenantManagement(row.id)
    msg.success(t('admin.tenants.messages.enteredTenant', { name: row.name }))
    await router.push({ name: 'admin-dashboard' })
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('admin.tenants.messages.enterTenantError'))
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

    <section v-if="dashboard" class="tenant-dashboard">
      <div class="tenant-dashboard-grid">
        <div class="tenant-kpi">
          <span>{{ $t('admin.tenants.dashboard.activeTenants') }}</span>
          <strong>{{ formatNumber(dashboard.totals.activeTenants) }}/{{ formatNumber(dashboard.totals.tenants) }}</strong>
        </div>
        <div class="tenant-kpi">
          <span>{{ $t('admin.tenants.dashboard.activeUsers') }}</span>
          <strong>{{ formatNumber(dashboard.totals.activeUsers) }}</strong>
        </div>
        <div class="tenant-kpi">
          <span>{{ $t('admin.tenants.dashboard.hosts') }}</span>
          <strong>{{ formatNumber(dashboard.totals.hosts) }}</strong>
        </div>
        <div class="tenant-kpi">
          <span>{{ $t('admin.tenants.dashboard.resources') }}</span>
          <strong>{{ formatNumber(dashboard.totals.resources) }}</strong>
        </div>
        <div class="tenant-kpi">
          <span>{{ $t('admin.tenants.dashboard.logins7d') }}</span>
          <strong>{{ formatNumber(dashboard.totals.loginsLast7Days) }}</strong>
        </div>
        <div class="tenant-kpi">
          <span>{{ $t('admin.tenants.dashboard.sessions7d') }}</span>
          <strong>{{ formatNumber(dashboard.totals.sessionsLast7Days) }}</strong>
        </div>
      </div>

      <div class="tenant-dashboard-panels">
        <div class="tenant-panel">
          <div class="tenant-panel-header">
            <h2>{{ $t('admin.tenants.dashboard.dailyActivity') }}</h2>
            <span>{{ $t('admin.tenants.dashboard.last7Days') }}</span>
          </div>
          <div class="daily-chart" :aria-label="$t('admin.tenants.dashboard.dailyActivity')">
            <div v-for="day in dashboard.dailyActivity" :key="day.date" class="daily-chart-day">
              <span class="daily-value">{{ (day.logins + day.sessions) || '' }}</span>
              <div class="daily-bars">
                <span class="daily-bar login" :style="{ height: `${Math.max(4, (day.logins / maxDailyActivity) * 100)}%` }" />
                <span class="daily-bar session" :style="{ height: `${Math.max(4, (day.sessions / maxDailyActivity) * 100)}%` }" />
              </div>
              <span class="daily-label">{{ day.date.slice(5) }}</span>
            </div>
          </div>
          <div class="tenant-chart-legend">
            <span><i class="legend-dot login" />{{ $t('admin.tenants.dashboard.logins') }}</span>
            <span><i class="legend-dot session" />{{ $t('admin.tenants.dashboard.sessions') }}</span>
          </div>
        </div>

        <div class="tenant-panel">
          <div class="tenant-panel-header">
            <h2>{{ $t('admin.tenants.dashboard.topActivity') }}</h2>
            <span>{{ $t('admin.tenants.dashboard.loginsAndSessions') }}</span>
          </div>
          <div class="tenant-activity-list">
            <div v-for="tenant in dashboard.topTenantsByActivity" :key="tenant.tenantId" class="tenant-activity-row">
              <div class="tenant-activity-main">
                <strong>{{ tenant.name }}</strong>
                <span>{{ tenant.slug }} · {{ $t('admin.tenants.dashboard.lastLogin') }} {{ formatLastLogin(tenant.lastLoginAt) }}</span>
              </div>
              <div class="tenant-activity-meter">
                <span :style="{ width: `${((tenant.loginsLast7Days + tenant.sessionsLast7Days) / topTenantMaxActivity) * 100}%` }" />
              </div>
              <div class="tenant-activity-value">
                {{ formatNumber(tenant.loginsLast7Days + tenant.sessionsLast7Days) }}
              </div>
            </div>
            <div v-if="dashboard.topTenantsByActivity.length === 0" class="tenant-empty">
              {{ $t('admin.tenants.dashboard.noActivity') }}
            </div>
          </div>
        </div>
      </div>

      <div class="tenant-panel tenant-usage-panel">
        <div class="tenant-panel-header">
          <h2>{{ $t('admin.tenants.dashboard.resourceUsage') }}</h2>
          <span>{{ $t('admin.tenants.dashboard.resourceUsageHint') }}</span>
        </div>
        <div class="tenant-usage-grid">
          <div v-for="tenant in dashboard.tenantUsage.slice(0, 8)" :key="tenant.tenantId" class="tenant-usage-item">
            <div>
              <strong>{{ tenant.name }}</strong>
              <span>{{ tenant.slug }}</span>
            </div>
            <div class="tenant-usage-numbers">
              <span>{{ formatNumber(tenant.activeUsers) }}/{{ tenant.maxUsers ?? $t('common.unlimited') }} {{ $t('admin.tenants.dashboard.usersShort') }}</span>
              <span>{{ formatNumber(resourceTotal(tenant)) }} {{ $t('admin.tenants.dashboard.resourcesShort') }}</span>
            </div>
          </div>
        </div>
      </div>
    </section>

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
        <NAlert type="warning" class="mb-4" :title="$t('admin.tenants.modal.loginImpactTitle')">
          {{ $t('admin.tenants.modal.loginImpactHelp') }}
        </NAlert>

        <div class="tenant-form-section">{{ $t('admin.tenants.modal.companySection') }}</div>

        <NFormItem :label="$t('admin.tenants.modal.nameLabel')">
          <NInput v-model:value="form.name" :placeholder="$t('admin.tenants.modal.namePlaceholder')" />
          <template #feedback>
            {{ $t('admin.tenants.modal.nameHelp') }}
          </template>
        </NFormItem>
        <NFormItem
          :label="$t('admin.tenants.modal.slugLabel')"
          :validation-status="slugValidationStatus(form.slug)"
          :feedback="slugFeedback(form.slug)"
        >
          <NInput
            :value="form.slug"
            placeholder="cliente-a"
            :maxlength="63"
            show-count
            :input-props="{ autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' }"
            @update:value="updateCreateSlug"
            @blur="normalizeCurrentSlug"
          />
          <template #feedback>
            {{ slugFeedback(form.slug) }}
          </template>
        </NFormItem>
        <NAlert v-if="createSlugAlreadyExists" type="error" class="mb-4" :title="$t('admin.tenants.messages.slugConflict')" />
        <NAlert v-else-if="createSlugLoginPreview" type="info" class="mb-4" :title="$t('admin.tenants.modal.slugPreviewTitle')">
          {{ $t('admin.tenants.modal.slugPreviewHelp', { slug: form.slug, host: createSlugLoginPreview }) }}
        </NAlert>
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
        <NAlert v-if="form.active === false" type="warning" class="mb-4" :title="$t('admin.tenants.modal.inactiveLoginWarningTitle')">
          {{ $t('admin.tenants.modal.inactiveLoginWarning') }}
        </NAlert>

        <div class="tenant-form-section">{{ $t('admin.tenants.modal.firstAdminSection') }}</div>
        <p class="tenant-form-help">{{ $t('admin.tenants.modal.firstAdminSectionHelp') }}</p>

        <NFormItem :label="$t('admin.tenants.modal.adminNameLabel')">
          <NInput v-model:value="form.firstAdmin!.name" :placeholder="$t('admin.tenants.modal.adminNamePlaceholder')" />
          <template #feedback>
            {{ $t('admin.tenants.modal.adminNameHelp') }}
          </template>
        </NFormItem>
        <NFormItem
          :label="$t('admin.tenants.modal.adminEmailLabel')"
          :validation-status="form.firstAdmin?.email && !isValidEmail(form.firstAdmin.email) ? 'error' : undefined"
        >
          <NInput
            v-model:value="form.firstAdmin!.email"
            :placeholder="$t('admin.tenants.modal.adminEmailPlaceholder')"
            :input-props="{ inputmode: 'email', autocomplete: 'email', autocapitalize: 'none', spellcheck: 'false' }"
          />
          <template #feedback>
            {{ form.firstAdmin?.email && !isValidEmail(form.firstAdmin.email) ? $t('admin.tenants.messages.adminEmailInvalid') : $t('admin.tenants.modal.adminEmailHelp') }}
          </template>
        </NFormItem>
        <div class="tenant-form-actions">
          <NButton @click="showModal = false">{{ $t('common.cancel') }}</NButton>
          <NButton type="primary" :loading="modalLoading" :disabled="!canCreateTenant" @click="save">
            {{ $t('admin.tenants.modal.create') }}
          </NButton>
        </div>
      </NForm>
    </NModal>

    <NModal v-model:show="showAdminModal" preset="card" :title="$t('admin.tenants.adminModal.title')" style="width: 560px">
      <NAlert v-if="firstAdminPassword" type="success" class="mb-4" :title="$t('admin.tenants.modal.passwordTitle')">
        <div class="font-mono text-sm">{{ firstAdminPassword }}</div>
        <div class="text-xs mt-2">{{ $t('admin.tenants.modal.passwordHint') }}</div>
      </NAlert>

      <NForm v-else @submit.prevent="createTenantAdmin">
        <NAlert type="info" class="mb-4" :title="adminTenant?.name">
          {{ $t('admin.tenants.adminModal.help') }}
        </NAlert>

        <NFormItem :label="$t('admin.tenants.modal.adminNameLabel')">
          <NInput v-model:value="adminForm.name" :placeholder="$t('admin.tenants.modal.adminNamePlaceholder')" />
          <template #feedback>
            {{ $t('admin.tenants.adminModal.nameHelp') }}
          </template>
        </NFormItem>
        <NFormItem :label="$t('admin.tenants.modal.adminEmailLabel')">
          <NInput v-model:value="adminForm.email" :placeholder="$t('admin.tenants.modal.adminEmailPlaceholder')" />
          <template #feedback>
            {{ $t('admin.tenants.adminModal.emailHelp') }}
          </template>
        </NFormItem>
        <div class="tenant-form-actions">
          <NButton @click="showAdminModal = false">{{ $t('common.cancel') }}</NButton>
          <NButton type="primary" :loading="adminModalLoading" @click="createTenantAdmin">
            {{ $t('admin.tenants.adminModal.create') }}
          </NButton>
        </div>
      </NForm>
    </NModal>

    <NModal v-model:show="showEditModal" preset="card" :title="$t('admin.tenants.editModal.title')" style="width: 560px">
      <NForm @submit.prevent="saveEdit">
        <NAlert type="warning" class="mb-4" :title="$t('admin.tenants.editModal.slugWarningTitle')">
          {{ $t('admin.tenants.editModal.slugWarning') }}
        </NAlert>

        <NFormItem :label="$t('admin.tenants.modal.nameLabel')">
          <NInput v-model:value="editForm.name" :placeholder="$t('admin.tenants.modal.namePlaceholder')" />
        </NFormItem>
        <NFormItem
          :label="$t('admin.tenants.modal.slugLabel')"
          :validation-status="slugValidationStatus(editForm.slug ?? '')"
          :feedback="slugFeedback(editForm.slug ?? '')"
        >
          <NInput
            :value="editForm.slug"
            placeholder="cliente-a"
            :maxlength="63"
            show-count
            :input-props="{ autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' }"
            @update:value="updateEditSlug"
            @blur="editForm.slug = normalizeSlug(editForm.slug ?? '')"
          />
          <template #feedback>
            {{ slugFeedback(editForm.slug ?? '') }}
          </template>
        </NFormItem>
        <NAlert v-if="editSlugAlreadyExists" type="error" class="mb-4" :title="$t('admin.tenants.messages.slugConflict')" />
        <NAlert v-else-if="editSlugLoginPreview" type="info" class="mb-4" :title="$t('admin.tenants.modal.slugPreviewTitle')">
          {{ $t('admin.tenants.modal.slugPreviewHelp', { slug: editForm.slug, host: editSlugLoginPreview }) }}
        </NAlert>
        <NFormItem :label="$t('admin.tenants.modal.activeLabel')">
          <NSwitch v-model:value="editForm.active" />
        </NFormItem>
        <NAlert v-if="editForm.active === false" type="warning" class="mb-4" :title="$t('admin.tenants.modal.inactiveLoginWarningTitle')">
          {{ $t('admin.tenants.modal.inactiveLoginWarning') }}
        </NAlert>
        <div class="tenant-form-actions">
          <NButton @click="showEditModal = false">{{ $t('common.cancel') }}</NButton>
          <NButton type="primary" :loading="editModalLoading" :disabled="!canSaveEditTenant" @click="saveEdit">
            {{ $t('common.save') }}
          </NButton>
        </div>
      </NForm>
    </NModal>
    <TenantLicenseEditor
      :show="licenseTenant !== null"
      :tenant-id="licenseTenant?.id ?? null"
      :tenant-name="licenseTenant?.name ?? ''"
      @close="licenseTenant = null"
      @saved="load"
    />
  </div>
</template>

<style scoped>
.tenant-form-section {
  margin: 12px 0 8px;
  color: var(--na-text-strong);
  font-size: 13px;
  font-weight: 600;
}

.tenant-form-help {
  margin: -2px 0 12px;
  color: var(--na-text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.tenant-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}

.tenant-dashboard {
  display: grid;
  gap: 14px;
  margin-bottom: 18px;
}

.tenant-dashboard-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
}

.tenant-kpi,
.tenant-panel {
  border: 1px solid var(--na-border);
  border-radius: 8px;
  background: var(--na-surface-raised);
}

.tenant-kpi {
  min-height: 76px;
  padding: 12px;
}

.tenant-kpi span,
.tenant-panel-header span,
.tenant-activity-main span,
.tenant-usage-item span,
.tenant-usage-numbers span,
.tenant-empty {
  color: var(--na-text-muted);
  font-size: 12px;
}

.tenant-kpi strong {
  display: block;
  margin-top: 8px;
  color: var(--na-text-strong);
  font-size: 22px;
  font-weight: 650;
  line-height: 1.1;
}

.tenant-dashboard-panels {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 14px;
}

.tenant-panel {
  padding: 14px;
}

.tenant-panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.tenant-panel-header h2 {
  margin: 0;
  color: var(--na-text-strong);
  font-size: 14px;
  font-weight: 650;
}

.daily-chart {
  display: grid;
  grid-template-columns: repeat(7, minmax(28px, 1fr));
  gap: 10px;
  min-height: 150px;
}

.daily-chart-day {
  display: grid;
  grid-template-rows: 14px 118px 18px;
  gap: 4px;
  min-width: 0;
}

.daily-bars {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 4px;
  border-bottom: 1px solid var(--na-border);
}

.daily-bar {
  width: 9px;
  border-radius: 5px 5px 0 0;
  transition: height 160ms ease;
}

.daily-bar.login,
.legend-dot.login {
  background: #60a5fa;
}

.daily-bar.session,
.legend-dot.session {
  background: #34d399;
}

.daily-value {
  font-size: 10px;
  color: #60a5fa;
  text-align: center;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.daily-label {
  overflow: hidden;
  color: var(--na-text-muted);
  font-size: 11px;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tenant-chart-legend {
  display: flex;
  gap: 14px;
  margin-top: 10px;
  color: var(--na-text-muted);
  font-size: 12px;
}

.tenant-chart-legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.legend-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 999px;
}

.tenant-activity-list,
.tenant-usage-grid {
  display: grid;
  gap: 10px;
}

.tenant-activity-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 96px 42px;
  align-items: center;
  gap: 10px;
}

.tenant-activity-main {
  min-width: 0;
}

.tenant-activity-main strong,
.tenant-usage-item strong {
  display: block;
  overflow: hidden;
  color: var(--na-text-strong);
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tenant-activity-meter {
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--na-surface-code);
}

.tenant-activity-meter span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #60a5fa;
}

.tenant-activity-value {
  color: var(--na-text-strong);
  font-size: 12px;
  text-align: right;
}

.tenant-usage-panel {
  overflow: hidden;
}

.tenant-usage-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.tenant-usage-item {
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--na-border);
  border-radius: 6px;
  background: var(--na-surface-soft);
}

.tenant-usage-numbers {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
}

@media (max-width: 1180px) {
  .tenant-dashboard-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .tenant-usage-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .tenant-dashboard-grid,
  .tenant-dashboard-panels,
  .tenant-usage-grid {
    grid-template-columns: 1fr;
  }

  .tenant-activity-row {
    grid-template-columns: minmax(0, 1fr) 64px 34px;
  }
}
</style>
