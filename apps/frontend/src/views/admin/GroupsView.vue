<script setup lang="ts">
import { ref, onMounted, h, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NDataTable, NButton, NSpace, NAlert, NModal, NForm, NSpin,
  NFormItem, NInput, useMessage, useDialog,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import type { GroupPublic, CreateGroupDto } from '@nodeaccess/shared'
import { groupService } from '@/services/group.service'
import SkeletonTable from '@/components/SkeletonTable.vue'

const { t } = useI18n()

const msg    = useMessage()
const dialog = useDialog()

const groups  = ref<GroupPublic[]>([])
const loading = ref(false)
const error   = ref<string | null>(null)

const showModal    = ref(false)
const modalLoading = ref(false)
const editingId    = ref<number | null>(null)
const form = ref<CreateGroupDto>({ name: '', description: '' })

const columns = computed<DataTableColumns<GroupPublic>>(() => [
  { title: t('admin.groups.columns.name'),        key: 'name' },
  { title: t('admin.groups.columns.description'), key: 'description', render: (r) => r.description ?? '—' },
  {
    title: t('admin.groups.columns.actions'), key: 'actions',
    render: (row) => h(NSpace, {}, () => [
      h(NButton, { size: 'small', onClick: () => openEdit(row) }, () => t('admin.groups.actions.edit')),
      h(NButton, { size: 'small', type: 'error', onClick: () => remove(row) }, () => t('admin.groups.actions.delete')),
    ]),
  },
])

async function load() {
  loading.value = true
  error.value   = null
  try {
    const { data } = await groupService.list()
    groups.value = data
  } catch {
    error.value = 'Erro ao carregar grupos'
  } finally {
    loading.value = false
  }
}

onMounted(load)

function openCreate() {
  editingId.value = null
  form.value      = { name: '', description: '' }
  showModal.value = true
}

function openEdit(group: GroupPublic) {
  editingId.value      = group.id
  form.value.name        = group.name
  form.value.description = group.description ?? ''
  showModal.value      = true
}

async function save() {
  modalLoading.value = true
  try {
    if (editingId.value) {
      await groupService.update(editingId.value, form.value)
      msg.success(t('admin.groups.messages.updated'))
    } else {
      await groupService.create(form.value)
      msg.success(t('admin.groups.messages.created'))
    }
    showModal.value = false
    load()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('admin.groups.messages.saveError'))
  } finally {
    modalLoading.value = false
  }
}

async function remove(group: GroupPublic) {
  dialog.warning({
    title:        t('admin.groups.deleteDialog.title', { name: group.name }),
    content:      t('admin.groups.deleteDialog.content'),
    positiveText: t('admin.groups.deleteDialog.confirm'),
    negativeText: t('admin.groups.deleteDialog.cancel'),
    onPositiveClick: async () => {
      try {
        await groupService.delete(group.id)
        msg.success(t('admin.groups.messages.deleted'))
        load()
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } }
        msg.error(e.response?.data?.message ?? t('admin.groups.messages.deleteError'))
      }
    },
  })
}
</script>

<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-xl font-semibold text-white">{{ $t('admin.groups.title') }}</h1>
      <NButton type="primary" @click="openCreate">{{ $t('admin.groups.newGroup') }}</NButton>
    </div>

    <NAlert v-if="error" type="error" class="mb-4" :title="error" />
    <NAlert type="info" class="mb-4" :title="$t('admin.groups.activeHostsHint')" />

    <SkeletonTable v-if="loading && groups.length === 0" :rows="4" :columns="3" />
    <NSpin v-else :show="loading">
      <NDataTable :columns="columns" :data="groups" :row-key="(r) => r.id" :bordered="false">
        <template v-if="!loading && groups.length === 0" #empty>
          <div class="py-16 flex flex-col items-center gap-3">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="#444" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"/>
            </svg>
            <p class="text-sm text-gray-500">{{ $t('admin.groups.emptyDesc') }}</p>
            <NButton type="primary" size="small" @click="openCreate">{{ $t('admin.groups.createFirst') }}</NButton>
          </div>
        </template>
      </NDataTable>
    </NSpin>

    <NModal v-model:show="showModal" preset="card" :title="editingId ? $t('admin.groups.modal.editTitle') : $t('admin.groups.modal.createTitle')" style="width: 420px">
      <NForm @submit.prevent="save">
        <NFormItem :label="$t('admin.groups.modal.nameLabel')">
          <NInput v-model:value="form.name" />
        </NFormItem>
        <NFormItem :label="$t('admin.groups.modal.descriptionLabel')">
          <NInput v-model:value="form.description" type="textarea" :rows="2" />
        </NFormItem>
        <NButton type="primary" :loading="modalLoading" @click="save">
          {{ editingId ? $t('admin.groups.modal.save') : $t('admin.groups.modal.create') }}
        </NButton>
      </NForm>
    </NModal>
  </div>
</template>
