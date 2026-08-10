<script setup lang="ts">
import { ref, computed, onMounted, h } from 'vue'
import {
  NDataTable, NButton, NSpace, NAlert, NModal, NForm,
  NFormItem, NInput, NText, useMessage, useDialog,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import type { PemKeyPublic } from '@nodeaccess/shared'
import { useI18n } from 'vue-i18n'
import { pemKeyService } from '@/services/pem-key.service'
import { isEncryptedPrivateKey } from '@/services/pem-key-encryption'
import { useAuthStore } from '@/stores/auth'

const { t } = useI18n()
const msg    = useMessage()
const dialog = useDialog()
const auth   = useAuthStore()

const keys    = ref<PemKeyPublic[]>([])
const loading = ref(false)
const error   = ref<string | null>(null)

const showModal    = ref(false)
const modalLoading = ref(false)
const form = ref({ name: '', key: '', passphrase: '' })
const passphraseKey = ref<PemKeyPublic | null>(null)
const passphrase = ref('')
const pemKeyFileInput = ref<HTMLInputElement | null>(null)
const pemKeyDragOver = ref(false)
const keyNeedsPassphrase = computed(() => isEncryptedPrivateKey(form.value.key))

const columns = computed<DataTableColumns<PemKeyPublic>>(() => [
  { title: t('pemKeys.columns.name'), key: 'name' },
  {
    title: t('pemKeys.columns.createdAt'),
    key: 'createdAt',
    render: (row) => new Date(row.createdAt).toLocaleDateString('pt-BR'),
  },
  {
    title: t('pemKeys.columns.actions'),
    key: 'actions',
    render: (row) => h(NSpace, {}, () => [
      h(NButton, { size: 'small', secondary: true, onClick: () => openPassphrase(row) }, () => row.hasPassphrase ? t('pemKeys.changePassphrase') : t('pemKeys.addPassphrase')),
      h(NButton, { size: 'small', type: 'error', onClick: () => remove(row) }, () => t('pemKeys.deleteBtn')),
    ]),
  },
])

async function load() {
  loading.value = true
  error.value   = null
  try {
    const { data } = await pemKeyService.list()
    keys.value = data
  } catch {
    error.value = t('pemKeys.messages.saveError')
  } finally {
    loading.value = false
  }
}

onMounted(load)

function openCreate() {
  form.value = { name: '', key: '', passphrase: '' }
  pemKeyDragOver.value = false
  showModal.value = true
}

function triggerPemKeyFileSelect() {
  pemKeyFileInput.value?.click()
}

function nameFromPemFile(file: File): string {
  return file.name.replace(/\.(pem|key|ppk|txt)$/i, '').trim() || file.name
}

async function readPemKeyFile(file: File) {
  try {
    const content = await file.text()
    form.value.key = content.trim()
    if (!form.value.name.trim()) form.value.name = nameFromPemFile(file)
  } catch {
    msg.error(t('pemKeys.messages.fileReadError'))
  }
}

async function onPemKeyFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) await readPemKeyFile(file)
  input.value = ''
}

async function onPemKeyFileDrop(event: DragEvent) {
  pemKeyDragOver.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) await readPemKeyFile(file)
}

async function save() {
  if (!form.value.name.trim() || !form.value.key.trim()) {
    msg.warning(t('pemKeys.messages.fillRequired'))
    return
  }
  if (keyNeedsPassphrase.value && !form.value.passphrase) {
    msg.warning(t('pemKeys.messages.passphraseRequired'))
    return
  }
  modalLoading.value = true
  try {
    await pemKeyService.create({ name: form.value.name.trim(), key: form.value.key.trim(), passphrase: form.value.passphrase || undefined })
    msg.success(t('pemKeys.messages.saved'))
    showModal.value = false
    load()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('pemKeys.messages.saveError'))
  } finally {
    modalLoading.value = false
  }
}

function openPassphrase(key: PemKeyPublic) {
  passphraseKey.value = key
  passphrase.value = ''
}

async function savePassphrase() {
  if (!passphraseKey.value) return
  modalLoading.value = true
  try {
    await pemKeyService.updatePassphrase(passphraseKey.value.id, { passphrase: passphrase.value || null })
    msg.success(t('pemKeys.messages.passphraseSaved'))
    passphraseKey.value = null
    await load()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('pemKeys.messages.passphraseError'))
  } finally {
    modalLoading.value = false
  }
}

async function remove(key: PemKeyPublic) {
  dialog.warning({
    title:        t('pemKeys.deleteDialog.title', { name: key.name }),
    content:      t('pemKeys.deleteDialog.content'),
    positiveText: t('pemKeys.deleteDialog.confirm'),
    negativeText: t('pemKeys.deleteDialog.cancel'),
    onPositiveClick: async () => {
      try {
        await pemKeyService.delete(key.id)
        msg.success(t('pemKeys.deleteBtn'))
        load()
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } }
        msg.error(e.response?.data?.message ?? t('pemKeys.messages.deleteError'))
      }
    },
  })
}
</script>

<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-2">
      <div>
        <h1 class="text-xl font-semibold text-white">{{ $t('pemKeys.title') }}</h1>
        <NText depth="3" class="text-xs">
          {{ auth.isAdmin ? $t('pemKeys.subtitleAdmin') : $t('pemKeys.subtitleUser') }}
        </NText>
      </div>
      <NButton type="primary" @click="openCreate">{{ $t('pemKeys.newKey') }}</NButton>
    </div>

    <NAlert class="mb-4 mt-3" type="info" :show-icon="true">
      {{ $t('pemKeys.infoText') }}
    </NAlert>

    <NAlert v-if="error" type="error" class="mb-4" :title="error" />

    <NDataTable :columns="columns" :data="keys" :loading="loading" :row-key="(r) => r.id" />

    <NModal v-model:show="showModal" preset="card" :title="$t('pemKeys.modal.title')" style="width:min(560px, calc(100vw - 32px))">
      <NForm @submit.prevent="save">
        <NFormItem :label="$t('pemKeys.modal.nameLabel')">
          <NInput v-model:value="form.name" :placeholder="$t('pemKeys.modal.namePlaceholder')" :input-props="{ 'aria-label': $t('pemKeys.modal.nameLabel') }" />
        </NFormItem>
        <NFormItem :label="$t('pemKeys.modal.contentLabel')">
          <div class="w-full space-y-2">
            <NInput
              v-model:value="form.key"
              type="textarea"
              :rows="10"
              :placeholder="$t('pemKeys.modal.contentPlaceholder')"
              style="font-family: monospace; font-size: 12px;"
            />
            <input
              ref="pemKeyFileInput"
              type="file"
              accept=".pem,.key,.ppk,.txt,text/plain"
              class="hidden"
              @change="onPemKeyFileSelected"
            />
            <div
              class="rounded border border-dashed px-3 py-3 text-center text-xs transition-colors"
              :class="pemKeyDragOver ? 'border-blue-400 bg-blue-500/10 text-blue-200' : 'border-gray-700 text-gray-400'"
              @dragenter.prevent="pemKeyDragOver = true"
              @dragover.prevent="pemKeyDragOver = true"
              @dragleave.prevent="pemKeyDragOver = false"
              @drop.prevent="onPemKeyFileDrop"
            >
              <div>{{ $t('pemKeys.modal.fileDropHint') }}</div>
              <NButton size="small" secondary class="mt-2" :disabled="modalLoading" @click="triggerPemKeyFileSelect">
                {{ $t('pemKeys.modal.fileSelect') }}
              </NButton>
            </div>
          </div>
        </NFormItem>
        <NAlert v-if="keyNeedsPassphrase" type="warning" class="mb-3" :show-icon="true">
          {{ $t('pemKeys.modal.encryptedDetected') }}
        </NAlert>
        <NFormItem :label="keyNeedsPassphrase ? $t('pemKeys.modal.passphraseRequiredLabel') : $t('pemKeys.modal.passphraseLabel')">
          <NInput v-model:value="form.passphrase" type="password" show-password-on="click" autocomplete="new-password" :placeholder="$t('pemKeys.modal.passphrasePlaceholder')" :input-props="{ 'aria-label': keyNeedsPassphrase ? $t('pemKeys.modal.passphraseRequiredLabel') : $t('pemKeys.modal.passphraseLabel') }" />
        </NFormItem>
        <NAlert type="warning" class="mb-3" :show-icon="true">
          {{ $t('pemKeys.modal.warning') }}
        </NAlert>
        <div class="flex justify-end gap-2">
          <NButton @click="showModal = false">{{ $t('pemKeys.modal.cancel') }}</NButton>
          <NButton type="primary" :loading="modalLoading" @click="save">{{ $t('pemKeys.modal.save') }}</NButton>
        </div>
      </NForm>
    </NModal>

    <NModal :show="!!passphraseKey" preset="card" :title="$t('pemKeys.passphraseModal.title', { name: passphraseKey?.name })" style="width:min(480px, calc(100vw - 32px))" @update:show="(value) => { if (!value) passphraseKey = null }">
      <NForm @submit.prevent="savePassphrase">
        <NFormItem :label="$t('pemKeys.modal.passphraseLabel')">
          <NInput v-model:value="passphrase" type="password" show-password-on="click" autocomplete="new-password" autofocus :placeholder="$t('pemKeys.modal.passphrasePlaceholder')" />
        </NFormItem>
        <NText depth="3" class="text-xs">{{ $t('pemKeys.passphraseModal.hint') }}</NText>
        <div class="mt-4 flex justify-end gap-2">
          <NButton @click="passphraseKey = null">{{ $t('pemKeys.modal.cancel') }}</NButton>
          <NButton type="primary" attr-type="submit" :loading="modalLoading">{{ $t('pemKeys.passphraseModal.save') }}</NButton>
        </div>
      </NForm>
    </NModal>
  </div>
</template>
