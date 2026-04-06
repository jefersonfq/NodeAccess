<script setup lang="ts">
import { ref, computed, onMounted, h } from 'vue'
import {
  NDataTable, NButton, NSpace, NAlert, NModal, NForm,
  NFormItem, NInput, NText, NTag, useMessage, useDialog,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import type { PemKeyPublic } from '@nodeaccess/shared'
import { useI18n } from 'vue-i18n'
import { pemKeyService } from '@/services/pem-key.service'
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
const form = ref({ name: '', key: '' })

const columns = computed<DataTableColumns<PemKeyPublic>>(() => [
  { title: t('pemKeys.columns.name'), key: 'name' },
  {
    title: t('pemKeys.columns.type'),
    key: 'type',
    width: 100,
    render: () => h(NTag, { type: 'info', size: 'small' }, () => 'PEM'),
  },
  {
    title: t('pemKeys.columns.createdAt'),
    key: 'createdAt',
    render: (row) => new Date(row.createdAt).toLocaleDateString('pt-BR'),
  },
  {
    title: t('pemKeys.columns.actions'),
    key: 'actions',
    render: (row) => h(NButton, { size: 'small', type: 'error', onClick: () => remove(row) }, () => t('pemKeys.deleteBtn')),
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
  form.value = { name: '', key: '' }
  showModal.value = true
}

async function save() {
  if (!form.value.name.trim() || !form.value.key.trim()) {
    msg.warning(t('pemKeys.messages.fillRequired'))
    return
  }
  modalLoading.value = true
  try {
    await pemKeyService.create({ name: form.value.name.trim(), key: form.value.key.trim() })
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

    <NModal v-model:show="showModal" preset="card" :title="$t('pemKeys.modal.title')" style="width: 500px">
      <NForm @submit.prevent="save">
        <NFormItem :label="$t('pemKeys.modal.nameLabel')">
          <NInput v-model:value="form.name" :placeholder="$t('pemKeys.modal.namePlaceholder')" />
        </NFormItem>
        <NFormItem :label="$t('pemKeys.modal.contentLabel')">
          <NInput
            v-model:value="form.key"
            type="textarea"
            :rows="10"
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAA...
-----END OPENSSH PRIVATE KEY-----"
            style="font-family: monospace; font-size: 12px;"
          />
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
  </div>
</template>
