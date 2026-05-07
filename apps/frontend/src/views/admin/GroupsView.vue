<script setup lang="ts">
import { ref, onMounted, onUnmounted, h, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NDataTable, NButton, NSpace, NAlert, NModal, NForm, NSpin,
  NFormItem, NInput, NPagination, NSelect, NText, useMessage, useDialog,
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
const total   = ref(0)
const page    = ref(1)
const limit   = ref(20)
const search  = ref('')

const showHelp     = ref(false)
const showModal    = ref(false)
const modalLoading = ref(false)
const editingId    = ref<number | null>(null)
const form = ref<CreateGroupDto>({ name: '', description: '' })
let searchTimer: ReturnType<typeof setTimeout> | null = null

const hasSearch = computed(() => search.value.trim().length > 0)
const visibleRangeStart = computed(() => total.value === 0 ? 0 : ((page.value - 1) * limit.value) + 1)
const visibleRangeEnd = computed(() => Math.min(page.value * limit.value, total.value))
const pageSizeOptions = [
  { label: '20 / pág', value: 20 },
  { label: '40 / pág', value: 40 },
  { label: '80 / pág', value: 80 },
]

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
    const { data } = await groupService.listPaginated({
      page:   page.value,
      limit:  limit.value,
      search: search.value.trim() || undefined,
    })
    groups.value = data.data
    total.value  = data.total
    page.value   = data.page
    limit.value  = data.limit
  } catch {
    error.value = 'Erro ao carregar grupos'
  } finally {
    loading.value = false
  }
}

onMounted(load)
onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer)
})

watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    page.value = 1
    void load()
  }, 300)
})

function onPageChange(nextPage: number) {
  page.value = nextPage
  void load()
}

function onPageSizeChange(nextLimit: number) {
  limit.value = nextLimit
  page.value = 1
  void load()
}

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
    page.value = 1
    await load()
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
        if (groups.value.length === 1 && page.value > 1) page.value -= 1
        await load()
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } }
        msg.error(e.response?.data?.message ?? t('admin.groups.messages.deleteError'))
      }
    },
  })
}
</script>

<template>
  <div class="p-6 max-w-5xl">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-xl font-semibold text-white">{{ $t('admin.groups.title') }}</h1>
      <NButton type="primary" @click="openCreate">{{ $t('admin.groups.newGroup') }}</NButton>
    </div>

    <NAlert v-if="error" type="error" class="mb-4" :title="error" />

    <!-- Help section -->
    <div class="mb-4 na-panel rounded-xl border overflow-hidden">
      <button class="w-full flex items-center justify-between px-5 py-3.5 text-left" @click="showHelp = !showHelp">
        <span class="text-sm font-semibold text-gray-200">O que são Grupos e como usar</span>
        <span class="text-gray-500 text-xs">{{ showHelp ? '▲' : '▼' }}</span>
      </button>
      <div v-if="showHelp" class="border-t border-gray-800">
        <div class="px-5 py-4 space-y-4">

          <p class="text-sm text-gray-400">
            Grupos organizam hosts em conjuntos lógicos. Use-os para estruturar ambientes, aplicar bastions de forma centralizada e restringir o acesso de usuários a subconjuntos de hosts.
          </p>

          <!-- Cenários práticos -->
          <div>
            <p class="text-xs font-semibold text-gray-300 mb-2">Cenários práticos</p>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">

              <div class="na-code rounded-lg border p-3 space-y-1.5">
                <div class="flex items-center gap-2">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#60a5fa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0">
                    <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
                  </svg>
                  <p class="text-xs font-medium text-gray-200">Ambientes separados</p>
                </div>
                <p class="text-[11px] text-gray-500 leading-relaxed">Crie grupos <span class="text-green-400 font-mono">Producao</span>, <span class="text-green-400 font-mono">Staging</span> e <span class="text-green-400 font-mono">Dev</span>. Atribua os hosts ao grupo correto e controle quem tem acesso a cada ambiente.</p>
              </div>

              <div class="na-code rounded-lg border p-3 space-y-1.5">
                <div class="flex items-center gap-2">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#34d399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0">
                    <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
                  </svg>
                  <p class="text-xs font-medium text-gray-200">Bastion centralizado</p>
                </div>
                <p class="text-[11px] text-gray-500 leading-relaxed">Vincule um bastion ao grupo <span class="text-green-400 font-mono">Producao</span>. Todos os hosts do grupo passam pelo bastion automaticamente — sem configurar host por host.</p>
              </div>

              <div class="na-code rounded-lg border p-3 space-y-1.5">
                <div class="flex items-center gap-2">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#f472b6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                  <p class="text-xs font-medium text-gray-200">Acesso por equipe</p>
                </div>
                <p class="text-[11px] text-gray-500 leading-relaxed">Crie o grupo <span class="text-green-400 font-mono">DBA</span> para servidores de banco. Restrinja usuários específicos a esse grupo — eles verão apenas os hosts necessários.</p>
              </div>

            </div>
          </div>

          <!-- Como funciona -->
          <div class="na-code rounded-lg p-4 space-y-2">
            <p class="text-xs font-semibold text-gray-300 mb-1">Como funciona</p>
            <div v-for="(step, i) in [
              'Crie um grupo com nome e descrição (ex: Servidores de Producao — us-east)',
              'Ao cadastrar ou editar um host, selecione o grupo na configuração do host',
              'Opcional: vincule um bastion ao grupo em Bastions — todos os hosts herdam a rota de jump',
            ]" :key="i" class="flex items-start gap-3 text-xs text-gray-400">
              <span class="shrink-0 w-5 h-5 rounded-full bg-blue-900 text-blue-300 flex items-center justify-center text-[10px] font-bold mt-0.5">{{ i + 1 }}</span>
              <p>{{ step }}</p>
            </div>
          </div>

          <!-- Comportamentos -->
          <div class="na-code rounded-lg px-4 py-3 space-y-1 text-xs text-gray-500">
            <p class="font-medium text-gray-400">Comportamentos</p>
            <p>Um host pode pertencer a <span class="text-gray-300">vários grupos</span> simultaneamente</p>
            <p>O bastion definido no grupo é <span class="text-gray-300">herdado</span> pelos hosts sem bastion próprio configurado</p>
            <p>{{ $t('admin.groups.activeHostsHint') }}</p>
          </div>

        </div>
      </div>
    </div>

    <div class="mb-4 na-panel rounded-xl border p-4">
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div class="w-full md:max-w-md">
          <NInput
            v-model:value="search"
            clearable
            :placeholder="$t('admin.groups.searchPlaceholder')"
            aria-label="Pesquisar grupos"
          />
        </div>
      </div>
    </div>

    <div
      v-if="total > 0"
      class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-800 bg-[#17171c] px-3 py-2"
    >
      <NText depth="3" class="text-xs">
        {{ $t('admin.groups.showingRange', { start: visibleRangeStart, end: visibleRangeEnd, total }) }}
      </NText>
      <div class="flex items-center gap-3">
        <NSelect
          :value="limit"
          size="small"
          style="width: 110px"
          :options="pageSizeOptions"
          @update:value="onPageSizeChange"
        />
        <NPagination
          :page="page"
          :page-size="limit"
          :item-count="total"
          size="small"
          @update:page="onPageChange"
        />
      </div>
    </div>

    <SkeletonTable v-if="loading && groups.length === 0" :rows="4" :columns="3" />
    <NSpin v-else :show="loading">
      <NDataTable :columns="columns" :data="groups" :row-key="(r) => r.id" :bordered="false">
        <template v-if="!loading && groups.length === 0" #empty>
          <div class="py-16 flex flex-col items-center gap-3">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="#444" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"/>
            </svg>
            <p class="text-sm text-gray-500">{{ hasSearch ? $t('admin.groups.emptySearch') : $t('admin.groups.emptyDesc') }}</p>
            <NButton v-if="!hasSearch" type="primary" size="small" @click="openCreate">{{ $t('admin.groups.createFirst') }}</NButton>
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
