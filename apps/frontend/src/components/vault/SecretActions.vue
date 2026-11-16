<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { NAlert, NButton, NEmpty, NForm, NFormItem, NInput, NModal, NSelect, useDialog, useMessage } from 'naive-ui'
import type { GroupPublic, SecretConsumers, SecretPublic, SecretScope } from '@nodeaccess/shared'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { secretService } from '@/services/secret.service'
import { groupService } from '@/services/group.service'
import { canManageVaultSecret } from '@/services/vault-catalog'

const props = defineProps<{ licensed: boolean }>()
const emit = defineEmits<{ changed: [] }>()
const { t } = useI18n()
const message = useMessage()
const dialog = useDialog()
const auth = useAuthStore()
let active = true
let consumerRequest = 0
let groupRequest = 0
const confirmations: Array<{ destroy: () => void }> = []
const groups = ref<GroupPublic[]>([])
const groupError = ref(false)
const consumers = ref<SecretConsumers | null>(null)
const consumersSecret = ref<SecretPublic | null>(null)
const consumersLoading = ref(false)
const showConsumersModal = ref(false)

async function loadGroups(): Promise<void> {
  const request = ++groupRequest
  groupError.value = false
  try {
    const { data } = await groupService.list()
    if (active && request === groupRequest) groups.value = data
  } catch {
    if (active && request === groupRequest) groupError.value = true
  }
}
const showFormModal = ref(false)
const formLoading = ref(false)
const editingSecret = ref<SecretPublic | null>(null)
const form = ref<{ alias: string; description: string; value: string; scope: SecretScope; groupId: number | null }>({
  alias: '',
  description: '',
  value: '',
  scope: 'PERSONAL',
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

async function openConsumers(secret: SecretPublic): Promise<void> {
  if (!active || !props.licensed || !canManageVaultSecret(secret, auth.user?.id, auth.isAdmin)) return
  const request = ++consumerRequest
  consumersSecret.value = secret
  consumers.value = null
  consumersLoading.value = true
  showConsumersModal.value = true
  try {
    const { data } = await secretService.consumers(secret.id)
    if (!active || request !== consumerRequest) return
    consumers.value = data
    secret.usageCount = data.hostCount + data.snippetCount
  } catch (err) {
    if (!active || request !== consumerRequest) return
    message.error(getErrorMessage(err, t('secrets.consumers.loadError')))
    showConsumersModal.value = false
  } finally {
    if (active && request === consumerRequest) consumersLoading.value = false
  }
}

function resetForm(): void {
  editingSecret.value = null
  form.value = {
    alias: '',
    description: '',
    value: '',
    scope: 'PERSONAL',
    groupId: null,
  }
}

function openCreate(): void {
  if (!active || !props.licensed) return
  resetForm()
  void loadGroups()
  showFormModal.value = true
}

function openEdit(secret: SecretPublic): void {
  if (!active || !props.licensed) return
  if (!canManageVaultSecret(secret, auth.user?.id, auth.isAdmin)) return
  if (secret.revokedAt) return
  void loadGroups()
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

function openRotate(secret: SecretPublic): void {
  if (!active || !props.licensed) return
  if (!canManageVaultSecret(secret, auth.user?.id, auth.isAdmin)) return
  if (secret.revokedAt) return
  rotatingSecret.value = secret
  rotateValue.value = ''
  showRotateModal.value = true
}

function validateForm(): boolean {
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

function getErrorMessage(error: unknown, fallback: string): string {
  const err = error as { response?: { data?: { message?: string } } }
  const apiMessage = err.response?.data?.message
  if (apiMessage?.includes('body/alias') || apiMessage?.includes('Alias deve usar')) {
    return t('secrets.messages.aliasInvalid')
  }
  return apiMessage ?? fallback
}

function normalizeAlias(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, '-')
}

async function save(): Promise<void> {
  if (formLoading.value || (form.value.scope === 'GROUP' && groupError.value)) return
  if (!active || !props.licensed) return
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
      if (!active) return
      message.success(t('secrets.messages.updated'))
    } else {
      await secretService.create({
        ...baseDto,
        value: form.value.value,
        source: 'MANUAL',
      })
      if (!active) return
      message.success(t('secrets.messages.created'))
    }

    showFormModal.value = false
    resetForm()
    emit('changed')
  } catch (error) {
    if (active) message.error(getErrorMessage(error, t('secrets.messages.saveError')))
  } finally {
    formLoading.value = false
  }
}

async function rotate(): Promise<void> {
  if (rotateLoading.value) return
  if (!active || !props.licensed) return
  if (!rotatingSecret.value || !rotateValue.value) {
    message.warning(t('secrets.messages.valueRequired'))
    return
  }

  rotateLoading.value = true
  try {
    await secretService.rotate(rotatingSecret.value.id, { value: rotateValue.value })
    if (!active) return
    message.success(t('secrets.messages.rotated'))
    showRotateModal.value = false
    rotatingSecret.value = null
    rotateValue.value = ''
    emit('changed')
  } catch (error) {
    if (active) message.error(getErrorMessage(error, t('secrets.messages.rotateError')))
  } finally {
    rotateLoading.value = false
  }
}

function revoke(secret: SecretPublic): void {
  if (!active || !props.licensed) return
  if (!canManageVaultSecret(secret, auth.user?.id, auth.isAdmin)) return
  if (secret.revokedAt) return
  confirmations.push(dialog.warning({
    title: t('secrets.revokeDialog.title', { alias: secret.alias }),
    content: t('secrets.revokeDialog.content'),
    positiveText: t('secrets.revokeDialog.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      if (!active || !props.licensed) return
      try {
        await secretService.revoke(secret.id)
        if (!active) return
        message.success(t('secrets.messages.revoked'))
        emit('changed')
      } catch (error) {
        if (active) message.error(getErrorMessage(error, t('secrets.messages.revokeError')))
      }
    },
  }))
}

function remove(secret: SecretPublic): void {
  if (!active || !props.licensed) return
  if (!canManageVaultSecret(secret, auth.user?.id, auth.isAdmin)) return
  confirmations.push(dialog.error({
    title: t('secrets.deleteDialog.title', { alias: secret.alias }),
    content: t('secrets.deleteDialog.content'),
    positiveText: t('secrets.deleteDialog.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      if (!active || !props.licensed) return
      try {
        await secretService.remove(secret.id)
        if (!active) return
        message.success(t('secrets.messages.deleted'))
        emit('changed')
      } catch (error) {
        if (active) message.error(getErrorMessage(error, t('secrets.messages.deleteError')))
      }
    },
  }))
}

onBeforeUnmount(() => {
  active = false
  consumerRequest++
  groupRequest++
  resetForm()
  rotateValue.value = ''
  for (const confirmation of confirmations) confirmation.destroy()
})
defineExpose({ openCreate, openEdit, openRotate, openConsumers, revoke, remove })
</script>
<template>
  <NModal
    v-model:show="showConsumersModal"
    preset="card"
    :title="$t('secrets.consumers.title', { alias: consumersSecret?.alias ?? '' })"
    style="width: min(560px, calc(100vw - 32px))"
  >
    <div
      v-if="consumersLoading"
      aria-live="polite"
    >
      {{ $t('common.loading') }}
    </div>
    <template v-else-if="consumers">
      <NAlert
        :type="consumers.hostCount ? 'warning' : 'success'"
        class="mb-3"
      >
        {{ $t('secrets.consumers.summary', { hosts: consumers.hostCount, snippets: consumers.snippetCount }) }}
      </NAlert>
      <NEmpty
        v-if="consumers.hostCount === 0 && consumers.snippetCount === 0"
        :description="$t('secrets.consumers.empty')"
      />
      <h3
        v-if="consumers.hostCount"
        class="mb-2 font-semibold"
      >
        {{ $t('secrets.consumers.hosts') }} ({{ consumers.hostCount }})
      </h3>
      <ul
        v-if="consumers.hostCount"
        class="space-y-2"
        :aria-label="$t('secrets.consumers.hosts')"
      >
        <li
          v-for="host in consumers.hosts"
          :key="host.id"
          class="rounded border border-gray-700 p-3"
        >
          <div class="font-medium">
            {{ host.name }}
          </div>
          <div class="text-xs text-gray-400">
            {{ host.sshUser }}
          </div>
        </li>
      </ul>
      <h3
        v-if="consumers.snippetCount"
        class="mt-4 font-semibold"
      >
        {{ $t('secrets.consumers.snippets') }} ({{ consumers.snippetCount }})
      </h3>
      <ul
        v-if="consumers.snippetCount"
        class="mt-3 space-y-2"
        :aria-label="$t('secrets.consumers.snippets')"
      >
        <li
          v-for="snippet in consumers.snippets"
          :key="snippet.id"
          class="rounded border border-gray-700 p-3"
        >
          <div class="font-medium">
            {{ snippet.name }}
          </div>
        </li>
      </ul>
    </template>
  </NModal>

  <NModal
    v-if="props.licensed"
    v-model:show="showFormModal"
    preset="card"
    :title="editingSecret ? $t('secrets.modal.editTitle') : $t('secrets.modal.createTitle')"
    style="width:min(560px, calc(100vw - 32px))"
    @after-leave="resetForm"
  >
    <NForm
      autocomplete="off"
      @submit.prevent="save"
    >
      <NAlert
        v-if="groupError"
        type="warning"
        class="mb-3"
      >
        {{ $t('vault.groupsError') }} <NButton
          size="small"
          @click="loadGroups"
        >
          {{ $t('vault.retry') }}
        </NButton>
      </NAlert>
      <input
        type="text"
        name="fake-secret-username"
        :aria-label="$t('secrets.modal.alias')"
        autocomplete="username"
        class="hidden"
        tabindex="-1"
      >
      <input
        type="password"
        name="fake-secret-password"
        :aria-label="$t('secrets.modal.value')"
        autocomplete="current-password"
        class="hidden"
        tabindex="-1"
      >
      <NFormItem :label="$t('secrets.modal.alias')">
        <NInput
          v-model:value="form.alias"
          :input-props="{ 'aria-label': $t('secrets.modal.alias') }"
          :placeholder="$t('secrets.modal.aliasPlaceholder')"
          autocomplete="off"
          @blur="form.alias = normalizeAlias(form.alias)"
        />
        <template #feedback>
          {{ $t('secrets.modal.aliasHelp') }}
        </template>
      </NFormItem>

      <NFormItem :label="$t('common.description')">
        <NInput
          v-model:value="form.description"
          :placeholder="$t('secrets.modal.descriptionPlaceholder')"
        />
      </NFormItem>

      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <NFormItem :label="$t('secrets.modal.scope')">
          <NSelect
            v-model:value="form.scope"
            :options="scopeOptions"
          />
        </NFormItem>
        <NFormItem
          v-if="form.scope === 'GROUP'"
          :label="$t('secrets.modal.group')"
        >
          <NSelect
            v-model:value="form.groupId"
            :options="groupOptions"
            :placeholder="$t('secrets.modal.groupPlaceholder')"
          />
        </NFormItem>
      </div>

      <NFormItem
        v-if="!editingSecret"
        :label="$t('secrets.modal.value')"
      >
        <NInput
          v-model:value="form.value"
          :input-props="{ 'aria-label': $t('secrets.modal.value') }"
          type="password"
          show-password-on="click"
          autocomplete="new-password"
          :placeholder="$t('secrets.modal.valuePlaceholder')"
        />
      </NFormItem>

      <NAlert
        type="warning"
        class="mb-4"
        :show-icon="true"
      >
        {{ editingSecret ? $t('secrets.modal.editWarning') : $t('secrets.modal.createWarning') }}
      </NAlert>

      <div class="flex justify-end gap-2">
        <NButton @click="showFormModal = false">
          {{ $t('common.cancel') }}
        </NButton>
        <NButton
          type="primary"
          :loading="formLoading"
          @click="save"
        >
          {{ $t('common.save') }}
        </NButton>
      </div>
    </NForm>
  </NModal>

  <NModal
    v-if="props.licensed"
    v-model:show="showRotateModal"
    preset="card"
    :title="$t('secrets.rotateTitle', { alias: rotatingSecret?.alias ?? '' })"
    style="width:min(520px, calc(100vw - 32px))"
    @after-leave="rotateValue = ''"
  >
    <NForm
      autocomplete="off"
      @submit.prevent="rotate"
    >
      <input
        type="text"
        name="fake-rotate-username"
        :aria-label="$t('secrets.modal.alias')"
        autocomplete="username"
        class="hidden"
        tabindex="-1"
      >
      <input
        type="password"
        name="fake-rotate-password"
        :aria-label="$t('secrets.modal.value')"
        autocomplete="current-password"
        class="hidden"
        tabindex="-1"
      >
      <NFormItem :label="$t('secrets.modal.newValue')">
        <NInput
          v-model:value="rotateValue"
          :input-props="{ 'aria-label': $t('secrets.modal.newValue') }"
          type="password"
          show-password-on="click"
          autocomplete="new-password"
          :placeholder="$t('secrets.modal.newValuePlaceholder')"
        />
      </NFormItem>
      <NAlert
        type="warning"
        class="mb-4"
        :show-icon="true"
      >
        {{ $t('secrets.modal.rotateWarning') }}
      </NAlert>
      <div class="flex justify-end gap-2">
        <NButton @click="showRotateModal = false">
          {{ $t('common.cancel') }}
        </NButton>
        <NButton
          type="primary"
          :loading="rotateLoading"
          @click="rotate"
        >
          {{ $t('secrets.rotate') }}
        </NButton>
      </div>
    </NForm>
  </NModal>
</template>
