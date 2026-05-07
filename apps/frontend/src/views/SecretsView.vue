<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import {
  NAlert,
  NButton,
  NDataTable,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NSelect,
  NSpace,
  NTag,
  NText,
  useDialog,
  useMessage,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import type { GroupPublic, SecretPublic, SecretScope } from '@nodeaccess/shared'
import { useI18n } from 'vue-i18n'
import { secretService } from '@/services/secret.service'
import { groupService } from '@/services/group.service'
import { useAuthStore } from '@/stores/auth'
import { featuresService } from '@/services/features.service'

const { t } = useI18n()
const message = useMessage()
const dialog = useDialog()
const auth = useAuthStore()

const secrets = ref<SecretPublic[]>([])
const groups = ref<GroupPublic[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const secretsLicensed = ref(true)
const includeRevoked = ref(false)

const showFormModal = ref(false)
const formLoading = ref(false)
const editingSecret = ref<SecretPublic | null>(null)
const form = ref({
  alias: '',
  description: '',
  value: '',
  scope: 'PERSONAL' as SecretScope,
  groupId: null as number | null,
})
const aliasPattern = /^[a-zA-Z0-9_.:-]+$/

const showRotateModal = ref(false)
const rotateLoading = ref(false)
const rotatingSecret = ref<SecretPublic | null>(null)
const rotateValue = ref('')

const scopeOptions = computed(() => [
  { label: t('secrets.scopes.PERSONAL'), value: 'PERSONAL' },
  { label: t('secrets.scopes.GROUP'), value: 'GROUP' },
  ...(auth.isAdmin ? [{ label: t('secrets.scopes.TENANT'), value: 'TENANT' }] : []),
])

const groupOptions = computed(() =>
  groups.value.map((group) => ({ label: group.name, value: group.id })),
)

const columns = computed<DataTableColumns<SecretPublic>>(() => [
  {
    title: t('secrets.columns.alias'),
    key: 'alias',
    render: (row) => h('div', { class: 'space-y-1' }, [
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
    render: (row) => h('div', { class: 'space-y-1' }, [
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
    render: (row) => h('div', { class: 'space-y-0.5' }, [
      h('div', { class: 'text-sm text-gray-300' }, row.createdByUsername ?? t('common.unknown')),
      h('div', { class: 'text-[11px] text-gray-500' }, t(`secrets.sources.${row.source}`)),
    ]),
  },
  {
    title: t('secrets.columns.status'),
    key: 'status',
    width: 150,
    render: (row) => h(NTag, { size: 'small', type: row.revokedAt ? 'error' : 'success' }, () =>
      row.revokedAt ? t('secrets.status.revoked') : t('secrets.status.active'),
    ),
  },
  {
    title: t('secrets.columns.rotatedAt'),
    key: 'rotatedAt',
    width: 170,
    render: (row) => row.rotatedAt ? new Date(row.rotatedAt).toLocaleString() : t('common.none'),
  },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 240,
    render: (row) => h(NSpace, { size: 8 }, () => [
      h(NButton, { size: 'small', disabled: !!row.revokedAt, onClick: () => openEdit(row) }, () => t('common.edit')),
      h(NButton, { size: 'small', disabled: !!row.revokedAt, onClick: () => openRotate(row) }, () => t('secrets.rotate')),
      h(NButton, { size: 'small', type: 'error', ghost: true, disabled: !!row.revokedAt, onClick: () => revoke(row) }, () => t('secrets.revoke')),
      h(NButton, { size: 'small', type: 'error', text: true, onClick: () => remove(row) }, () => t('common.delete')),
    ]),
  },
])

onMounted(() => {
  void load()
})

function scopeTagType(scope: SecretScope) {
  if (scope === 'TENANT') return 'warning'
  if (scope === 'GROUP') return 'info'
  return 'default'
}

function groupName(groupId: number) {
  return groups.value.find((group) => group.id === groupId)?.name ?? t('secrets.groupUnknown')
}

function resetForm() {
  editingSecret.value = null
  form.value = {
    alias: '',
    description: '',
    value: '',
    scope: 'PERSONAL',
    groupId: null,
  }
}

async function load() {
  const features = await featuresService.get()
  secretsLicensed.value = features.secretsLicensed
  if (!secretsLicensed.value) {
    secrets.value = []
    groups.value = []
    error.value = null
    return
  }

  loading.value = true
  error.value = null
  try {
    const [{ data: secretRows }, { data: groupRows }] = await Promise.all([
      secretService.list(includeRevoked.value),
      groupService.list(),
    ])
    secrets.value = secretRows
    groups.value = groupRows
  } catch {
    error.value = t('secrets.messages.loadError')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  if (!secretsLicensed.value) return
  resetForm()
  showFormModal.value = true
}

function openEdit(secret: SecretPublic) {
  if (!secretsLicensed.value) return
  editingSecret.value = secret
  form.value = {
    alias: secret.alias,
    description: secret.description ?? '',
    value: '',
    scope: secret.scope,
    groupId: secret.groupId,
  }
  showFormModal.value = true
}

function openRotate(secret: SecretPublic) {
  if (!secretsLicensed.value) return
  rotatingSecret.value = secret
  rotateValue.value = ''
  showRotateModal.value = true
}

function validateForm() {
  const alias = normalizeAlias(form.value.alias)
  form.value.alias = alias
  if (!alias) {
    message.warning(t('secrets.messages.aliasRequired'))
    return false
  }
  if (!aliasPattern.test(alias)) {
    message.warning(t('secrets.messages.aliasInvalid'))
    return false
  }
  if (editingSecret.value === null && !form.value.value) {
    message.warning(t('secrets.messages.valueRequired'))
    return false
  }
  if (form.value.scope === 'GROUP' && !form.value.groupId) {
    message.warning(t('secrets.messages.groupRequired'))
    return false
  }
  return true
}

function getErrorMessage(error: unknown, fallback: string) {
  const err = error as { response?: { data?: { message?: string } } }
  const apiMessage = err.response?.data?.message
  if (apiMessage?.includes('body/alias') || apiMessage?.includes('Alias deve usar')) {
    return t('secrets.messages.aliasInvalid')
  }
  return apiMessage ?? fallback
}

function normalizeAlias(value: string) {
  return value
    .trim()
    .replace(/\s+/g, '-')
}

async function save() {
  if (!secretsLicensed.value) return
  if (!validateForm()) return

  formLoading.value = true
  try {
    const baseDto = {
      alias: normalizeAlias(form.value.alias),
      description: form.value.description.trim() || undefined,
      scope: form.value.scope,
      ...(form.value.scope === 'GROUP' && form.value.groupId ? { groupId: form.value.groupId } : {}),
    }

    if (editingSecret.value) {
      await secretService.update(editingSecret.value.id, {
        ...baseDto,
        description: form.value.description.trim() || null,
      })
      message.success(t('secrets.messages.updated'))
    } else {
      await secretService.create({
        ...baseDto,
        value: form.value.value,
        source: 'MANUAL',
      })
      message.success(t('secrets.messages.created'))
    }

    showFormModal.value = false
    resetForm()
    await load()
  } catch (error) {
    message.error(getErrorMessage(error, t('secrets.messages.saveError')))
  } finally {
    formLoading.value = false
  }
}

async function rotate() {
  if (!secretsLicensed.value) return
  if (!rotatingSecret.value || !rotateValue.value) {
    message.warning(t('secrets.messages.valueRequired'))
    return
  }

  rotateLoading.value = true
  try {
    await secretService.rotate(rotatingSecret.value.id, { value: rotateValue.value })
    message.success(t('secrets.messages.rotated'))
    showRotateModal.value = false
    rotatingSecret.value = null
    rotateValue.value = ''
    await load()
  } catch (error) {
    message.error(getErrorMessage(error, t('secrets.messages.rotateError')))
  } finally {
    rotateLoading.value = false
  }
}

function revoke(secret: SecretPublic) {
  if (!secretsLicensed.value) return
  dialog.warning({
    title: t('secrets.revokeDialog.title', { alias: secret.alias }),
    content: t('secrets.revokeDialog.content'),
    positiveText: t('secrets.revokeDialog.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      try {
        await secretService.revoke(secret.id)
        message.success(t('secrets.messages.revoked'))
        await load()
      } catch (error) {
        message.error(getErrorMessage(error, t('secrets.messages.revokeError')))
      }
    },
  })
}

function remove(secret: SecretPublic) {
  if (!secretsLicensed.value) return
  dialog.error({
    title: t('secrets.deleteDialog.title', { alias: secret.alias }),
    content: t('secrets.deleteDialog.content'),
    positiveText: t('secrets.deleteDialog.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      try {
        await secretService.remove(secret.id)
        message.success(t('secrets.messages.deleted'))
        await load()
      } catch (error) {
        message.error(getErrorMessage(error, t('secrets.messages.deleteError')))
      }
    },
  })
}
</script>

<template>
  <div class="p-6">
    <div class="flex items-center justify-between gap-4 mb-3">
      <div>
        <h1 class="text-xl font-semibold text-white">{{ $t('secrets.title') }}</h1>
        <NText depth="3" class="text-xs">{{ $t('secrets.subtitle') }}</NText>
      </div>
      <NButton type="primary" :disabled="!secretsLicensed" @click="openCreate">+ {{ $t('secrets.new') }}</NButton>
    </div>

    <NAlert v-if="!secretsLicensed" type="warning" class="mb-4" :show-icon="true">
      <template #header>{{ $t('secrets.license.title') }}</template>
      {{ $t('secrets.license.description') }}
    </NAlert>

    <div v-if="secretsLicensed" class="grid grid-cols-1 gap-3 mb-4 xl:grid-cols-3">
      <NAlert type="info" :show-icon="true">
        {{ $t('secrets.security.storage') }}
      </NAlert>
      <NAlert type="warning" :show-icon="true">
        {{ $t('secrets.security.noReveal') }}
      </NAlert>
      <NAlert type="success" :show-icon="true">
        {{ $t('secrets.security.usage') }}
      </NAlert>
    </div>

    <div v-if="secretsLicensed" class="mb-4 flex items-center justify-between gap-3">
      <NText depth="3" class="text-xs">{{ $t('secrets.policyHint') }}</NText>
      <NButton size="small" ghost @click="includeRevoked = !includeRevoked; load()">
        {{ includeRevoked ? $t('secrets.hideRevoked') : $t('secrets.showRevoked') }}
      </NButton>
    </div>

    <NAlert v-if="error" type="error" class="mb-4" :title="error" />
    <NAlert v-if="!secretsLicensed" type="info" class="mb-4" :show-icon="true">
      {{ $t('secrets.license.description') }}
    </NAlert>

    <NDataTable
      v-if="secretsLicensed"
      :columns="columns"
      :data="secrets"
      :loading="loading"
      :row-key="(row) => row.id"
    />

    <NModal
      v-if="secretsLicensed"
      v-model:show="showFormModal"
      preset="card"
      :title="editingSecret ? $t('secrets.modal.editTitle') : $t('secrets.modal.createTitle')"
      style="width: 560px"
      @after-leave="resetForm"
    >
      <NForm autocomplete="off" @submit.prevent="save">
        <input type="text" name="fake-secret-username" autocomplete="username" class="hidden" tabindex="-1">
        <input type="password" name="fake-secret-password" autocomplete="current-password" class="hidden" tabindex="-1">
        <NFormItem :label="$t('secrets.modal.alias')">
          <NInput
            v-model:value="form.alias"
            :placeholder="$t('secrets.modal.aliasPlaceholder')"
            autocomplete="off"
            @blur="form.alias = normalizeAlias(form.alias)"
          />
          <template #feedback>
            {{ $t('secrets.modal.aliasHelp') }}
          </template>
        </NFormItem>

        <NFormItem :label="$t('common.description')">
          <NInput v-model:value="form.description" :placeholder="$t('secrets.modal.descriptionPlaceholder')" />
        </NFormItem>

        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <NFormItem :label="$t('secrets.modal.scope')">
            <NSelect v-model:value="form.scope" :options="scopeOptions" />
          </NFormItem>
          <NFormItem v-if="form.scope === 'GROUP'" :label="$t('secrets.modal.group')">
            <NSelect v-model:value="form.groupId" :options="groupOptions" :placeholder="$t('secrets.modal.groupPlaceholder')" />
          </NFormItem>
        </div>

        <NFormItem v-if="!editingSecret" :label="$t('secrets.modal.value')">
          <NInput
            v-model:value="form.value"
            type="password"
            show-password-on="click"
            autocomplete="new-password"
            :placeholder="$t('secrets.modal.valuePlaceholder')"
          />
        </NFormItem>

        <NAlert type="warning" class="mb-4" :show-icon="true">
          {{ editingSecret ? $t('secrets.modal.editWarning') : $t('secrets.modal.createWarning') }}
        </NAlert>

        <div class="flex justify-end gap-2">
          <NButton @click="showFormModal = false">{{ $t('common.cancel') }}</NButton>
          <NButton type="primary" :loading="formLoading" @click="save">{{ $t('common.save') }}</NButton>
        </div>
      </NForm>
    </NModal>

    <NModal
      v-if="secretsLicensed"
      v-model:show="showRotateModal"
      preset="card"
      :title="$t('secrets.rotateTitle', { alias: rotatingSecret?.alias ?? '' })"
      style="width: 520px"
      @after-leave="rotateValue = ''"
    >
      <NForm autocomplete="off" @submit.prevent="rotate">
        <input type="text" name="fake-rotate-username" autocomplete="username" class="hidden" tabindex="-1">
        <input type="password" name="fake-rotate-password" autocomplete="current-password" class="hidden" tabindex="-1">
        <NFormItem :label="$t('secrets.modal.newValue')">
          <NInput
            v-model:value="rotateValue"
            type="password"
            show-password-on="click"
            autocomplete="new-password"
            :placeholder="$t('secrets.modal.newValuePlaceholder')"
          />
        </NFormItem>
        <NAlert type="warning" class="mb-4" :show-icon="true">
          {{ $t('secrets.modal.rotateWarning') }}
        </NAlert>
        <div class="flex justify-end gap-2">
          <NButton @click="showRotateModal = false">{{ $t('common.cancel') }}</NButton>
          <NButton type="primary" :loading="rotateLoading" @click="rotate">{{ $t('secrets.rotate') }}</NButton>
        </div>
      </NForm>
    </NModal>
  </div>
</template>
