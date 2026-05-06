<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import {
  NAlert,
  NButton,
  NDataTable,
  NDynamicInput,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NModal,
  NSelect,
  NSpace,
  NSwitch,
  NTag,
  NText,
  NEmpty,
  useDialog,
  useMessage,
} from 'naive-ui'
import type { DataTableColumns, SelectOption } from 'naive-ui'
import type {
  CreateDiagnosticPlaybookDto,
  DiagnosticPlaybookPublic,
  DiagnosticPlaybookRiskLevel,
} from '@nodeaccess/shared'
import type { DiagnosticPlaybookHistoryEntry } from '@/services/diagnostic-playbook.service'
import { diagnosticPlaybookService } from '@/services/diagnostic-playbook.service'

const message = useMessage()
const dialog = useDialog()

const loading = ref(false)
const modalLoading = ref(false)
const error = ref<string | null>(null)
const showModal = ref(false)
const showHelp = ref(false)
const showHistory = ref(false)
const editingId = ref<number | null>(null)
const playbooks = ref<DiagnosticPlaybookPublic[]>([])
const historyLoading = ref(false)
const historyTarget = ref<DiagnosticPlaybookPublic | null>(null)
const historyEntries = ref<DiagnosticPlaybookHistoryEntry[]>([])
const search = ref('')
const categoryFilter = ref<'all' | DiagnosticPlaybookPublic['category']>('all')
const riskFilter = ref<'all' | DiagnosticPlaybookPublic['riskLevel']>('all')
const statusFilter = ref<'all' | 'enabled' | 'disabled'>('all')
const targetOsFilter = ref<'all' | DiagnosticPlaybookPublic['targetOs']>('all')

type CommandForm = CreateDiagnosticPlaybookDto['commands'][number]
type PlaybookForm = CreateDiagnosticPlaybookDto
type StepType = 'command' | 'script'
type PlaybookStepForm = CommandForm & {
  type: StepType
}

const form = ref<PlaybookForm>(createEmptyForm())

const categoryOptions: SelectOption[] = [
  { label: 'Rede', value: 'network' },
  { label: 'Processamento', value: 'compute' },
  { label: 'Armazenamento', value: 'storage' },
  { label: 'Kernel', value: 'kernel' },
  { label: 'MySQL', value: 'mysql' },
  { label: 'Agente', value: 'agent' },
]

const riskOptions: SelectOption[] = [
  { label: 'Baixo', value: 'low' },
  { label: 'Médio', value: 'medium' },
  { label: 'Alto', value: 'high' },
]

const targetOsOptions: SelectOption[] = [
  { label: 'Linux', value: 'linux' },
  { label: 'Windows', value: 'windows' },
  { label: 'Qualquer', value: 'any' },
]
const categoryFilterOptions: SelectOption[] = [
  { label: 'Todas categorias', value: 'all' },
  ...categoryOptions,
]
const riskFilterOptions: SelectOption[] = [
  { label: 'Todos riscos', value: 'all' },
  ...riskOptions,
]
const statusFilterOptions: SelectOption[] = [
  { label: 'Todos status', value: 'all' },
  { label: 'Habilitado', value: 'enabled' },
  { label: 'Desabilitado', value: 'disabled' },
]
const targetOsFilterOptions: SelectOption[] = [
  { label: 'Todos sistemas', value: 'all' },
  ...targetOsOptions,
]
const stepTypeOptions: SelectOption[] = [
  { label: 'Command', value: 'command' },
  { label: 'Script (em breve)', value: 'script' },
]

const isEditing = computed(() => editingId.value !== null)
const estimatedTimeoutSeconds = computed(() => (
  form.value.commands.reduce((total, command) => total + (command.timeoutSeconds ?? 0), 0)
))
const formSteps = computed({
  get: (): PlaybookStepForm[] => form.value.commands.map((command): PlaybookStepForm => ({
    ...command,
    type: 'command' as StepType,
  })),
  set: (steps: PlaybookStepForm[]) => {
    form.value.commands = steps.map(({ type: _type, ...command }: PlaybookStepForm) => command)
  },
})
const normalizedSearch = computed(() => search.value.trim().toLowerCase())
const normalizedSlug = computed(() => form.value.slug.trim().toLowerCase())
const duplicateSlug = computed(() => playbooks.value.some((playbook) => (
  playbook.id !== editingId.value
  && playbook.slug.trim().toLowerCase() === normalizedSlug.value
)))
const duplicateCommandIds = computed(() => {
  const ids = new Set<string>()
  const duplicates = new Set<string>()
  for (const step of formSteps.value) {
    const id = step.id.trim().toLowerCase()
    if (!id) continue
    if (ids.has(id)) duplicates.add(id)
    ids.add(id)
  }
  return Array.from(duplicates)
})
const hasPotentiallyDestructiveCommand = computed(() => (
  formSteps.value.some((step) => destructiveCommandPattern.test(step.command))
))
const formErrors = computed(() => {
  const errors: string[] = []
  if (!form.value.name.trim()) errors.push('Informe um nome para o playbook.')
  if (!normalizedSlug.value) errors.push('Informe um slug para o playbook.')
  if (duplicateSlug.value) errors.push('Ja existe um playbook com esse slug.')
  if (!form.value.description.trim()) errors.push('Informe uma descricao curta para o playbook.')
  if (!formSteps.value.length) errors.push('Adicione pelo menos um step.')

  formSteps.value.forEach((step, index) => {
    const label = `Step ${index + 1}`
    if (!step.id.trim()) errors.push(`${label}: informe um ID.`)
    if (!step.label.trim()) errors.push(`${label}: informe um rotulo.`)
    if (step.type !== 'command') errors.push(`${label}: apenas o tipo command esta disponivel nesta fase.`)
    if (!step.command.trim()) errors.push(`${label}: informe o comando.`)
    if (!step.timeoutSeconds || step.timeoutSeconds < 1 || step.timeoutSeconds > 300) {
      errors.push(`${label}: timeout deve ficar entre 1s e 300s.`)
    }
  })

  if (duplicateCommandIds.value.length) {
    errors.push(`IDs de comando duplicados: ${duplicateCommandIds.value.join(', ')}`)
  }

  return errors
})
const canSave = computed(() => formErrors.value.length === 0)
const filteredPlaybooks = computed(() => playbooks.value.filter((playbook) => {
  const matchesSearch = !normalizedSearch.value
    || playbook.name.toLowerCase().includes(normalizedSearch.value)
    || playbook.slug.toLowerCase().includes(normalizedSearch.value)
    || playbook.description.toLowerCase().includes(normalizedSearch.value)
  const matchesCategory = categoryFilter.value === 'all' || playbook.category === categoryFilter.value
  const matchesRisk = riskFilter.value === 'all' || playbook.riskLevel === riskFilter.value
  const matchesStatus = statusFilter.value === 'all'
    || (statusFilter.value === 'enabled' ? playbook.enabled : !playbook.enabled)
  const matchesTargetOs = targetOsFilter.value === 'all' || playbook.targetOs === targetOsFilter.value
  return matchesSearch && matchesCategory && matchesRisk && matchesStatus && matchesTargetOs
}))
const editingPlaybookMeta = computed(() => (
  editingId.value !== null
    ? playbooks.value.find((playbook) => playbook.id === editingId.value) ?? null
    : null
))
const helpQuickItems = [
  {
    title: 'O que e',
    description: 'Catalogo administrativo dos playbooks de diagnostico usados no dashboard do host.',
  },
  {
    title: 'Como usar',
    description: 'Crie, edite ou duplique playbooks aprovados e mantenha o catalogo governado por risco, sistema operacional e steps permitidos.',
  },
  {
    title: 'Quando duplicar',
    description: 'Quando um playbook existente ja resolve boa parte do problema e voce quer variar categoria, tempo ou comandos sem recriar tudo.',
  },
]
const helpSections = [
  {
    title: 'Comandos aprovados',
    description: 'Cada playbook deve conter steps aprovados. Hoje o tipo suportado e command, mas a tela ja fica pronta para evoluir para script governado.',
  },
  {
    title: 'Risco e aprovacao',
    description: 'Use risco para sinalizar impacto operacional e a exigencia de confirmacao antes de executar.',
  },
  {
    title: 'Duplicar playbook',
    description: 'Cria uma copia editavel com nome e slug ajustados, acelerando a construcao de variantes.',
  },
]
const helpSteps = [
  'Escolha um playbook existente ou crie um novo.',
  'Revise nome, slug, risco, sistema operacional e steps.',
  'Use duplicar quando quiser partir de um modelo ja validado.',
  'Salve e depois valide o resultado no dashboard do host.',
]
const destructiveCommandPattern = /\b(rm\s+-rf|mkfs|fdisk|parted|shutdown|reboot|poweroff|systemctl\s+(restart|stop)|service\s+\S+\s+(restart|stop)|killall|kill\s+-9|userdel|groupdel|chmod\s+777|chown\s+-R)\b/i

const columns = computed<DataTableColumns<DiagnosticPlaybookPublic>>(() => [
  { title: 'Nome', key: 'name', minWidth: 220 },
  { title: 'Slug', key: 'slug', minWidth: 180 },
  {
    title: 'Categoria',
    key: 'category',
    width: 130,
    render: (row) => h(NTag, { size: 'small' }, () => row.category),
  },
  {
    title: 'Risco',
    key: 'riskLevel',
    width: 110,
    render: (row) => h(NTag, { size: 'small', type: riskTagType(row.riskLevel) }, () => row.riskLevel.toUpperCase()),
  },
  {
    title: 'SO',
    key: 'targetOs',
    width: 110,
    render: (row) => h(NTag, { size: 'small', type: 'default' }, () => row.targetOs),
  },
  {
    title: 'Comandos',
    key: 'commands',
    width: 100,
    render: (row) => row.commands.length,
  },
  {
    title: 'Status',
    key: 'enabled',
    width: 120,
    render: (row) => h(NTag, { size: 'small', type: row.enabled ? 'success' : 'warning' }, () => row.enabled ? 'Habilitado' : 'Desabilitado'),
  },
  {
    title: 'Versão',
    key: 'version',
    width: 90,
    render: (row) => `v${row.version}`,
  },
  {
    title: 'Atualizado',
    key: 'updatedAt',
    width: 160,
    render: (row) => formatPlaybookDate(row.updatedAt),
  },
  {
    title: 'Ações',
    key: 'actions',
    width: 320,
    render: (row) => h(NSpace, { size: 8 }, () => [
      h(NButton, { size: 'small', onClick: () => openEdit(row) }, () => 'Editar'),
      h(NButton, { size: 'small', ghost: true, onClick: () => openHistory(row) }, () => 'Ver histórico'),
      h(NButton, { size: 'small', ghost: true, onClick: () => openDuplicate(row) }, () => 'Duplicar'),
      h(NButton, { size: 'small', type: 'error', ghost: true, onClick: () => remove(row) }, () => 'Excluir'),
    ]),
  },
])

function createEmptyCommand(): CommandForm {
  return {
    id: '',
    label: '',
    command: '',
    timeoutSeconds: 10,
  }
}

function createEmptyStep(): PlaybookStepForm {
  return {
    ...createEmptyCommand(),
    type: 'command',
  }
}

function createEmptyForm(): PlaybookForm {
  return {
    slug: '',
    name: '',
    description: '',
    category: 'network',
    riskLevel: 'low',
    targetOs: 'linux',
    requiresApproval: true,
    enabled: true,
    commands: [createEmptyCommand()],
  }
}

function riskTagType(value: DiagnosticPlaybookRiskLevel) {
  if (value === 'high') return 'error'
  if (value === 'medium') return 'warning'
  return 'success'
}

function formatPlaybookDate(value: string | Date) {
  return new Date(value).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  })
}

function formatHistoryDate(value: string | Date) {
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function historyActionLabel(value: string) {
  const labels: Record<string, string> = {
    CREATE_DIAGNOSTIC_PLAYBOOK: 'Criação',
    UPDATE_DIAGNOSTIC_PLAYBOOK: 'Atualização',
    DELETE_DIAGNOSTIC_PLAYBOOK: 'Exclusão',
  }
  return labels[value] ?? value
}

async function load() {
  loading.value = true
  error.value = null
  try {
    const { data } = await diagnosticPlaybookService.listAdmin()
    playbooks.value = data
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    error.value = e.response?.data?.message ?? 'Erro ao carregar playbooks de diagnóstico'
  } finally {
    loading.value = false
  }
}

onMounted(load)

function openCreate() {
  editingId.value = null
  form.value = createEmptyForm()
  showModal.value = true
}

function openEdit(playbook: DiagnosticPlaybookPublic) {
  editingId.value = playbook.id
  form.value = {
    slug: playbook.slug,
    name: playbook.name,
    description: playbook.description,
    category: playbook.category,
    riskLevel: playbook.riskLevel,
    targetOs: playbook.targetOs,
    requiresApproval: playbook.requiresApproval,
    enabled: playbook.enabled,
    commands: playbook.commands.map((command) => ({ ...command })),
  }
  showModal.value = true
}

function openDuplicate(playbook: DiagnosticPlaybookPublic) {
  editingId.value = null
  form.value = {
    slug: `${playbook.slug}-copy`,
    name: `${playbook.name} (copia)`,
    description: playbook.description,
    category: playbook.category,
    riskLevel: playbook.riskLevel,
    targetOs: playbook.targetOs,
    requiresApproval: playbook.requiresApproval,
    enabled: playbook.enabled,
    commands: playbook.commands.map((command) => ({
      ...command,
      id: `${command.id}-copy`,
    })),
  }
  showModal.value = true
}

async function openHistory(playbook: DiagnosticPlaybookPublic) {
  showHistory.value = true
  historyTarget.value = playbook
  historyEntries.value = []
  historyLoading.value = true
  try {
    const { data } = await diagnosticPlaybookService.listAdminHistory(playbook.id)
    historyEntries.value = data
  } catch {
    message.error('Nao foi possivel carregar o historico do playbook')
  } finally {
    historyLoading.value = false
  }
}

async function save() {
  if (!canSave.value) {
    message.error(formErrors.value[0] ?? 'Revise o formulario antes de salvar.')
    return
  }
  modalLoading.value = true
  try {
    if (isEditing.value) {
      await diagnosticPlaybookService.updateAdmin(editingId.value!, form.value)
      message.success('Playbook atualizado')
    } else {
      await diagnosticPlaybookService.createAdmin(form.value)
      message.success('Playbook criado')
    }
    showModal.value = false
    await load()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    message.error(e.response?.data?.message ?? 'Nao foi possivel salvar o playbook')
  } finally {
    modalLoading.value = false
  }
}

function remove(playbook: DiagnosticPlaybookPublic) {
  dialog.warning({
    title: `Excluir ${playbook.name}?`,
    content: 'Essa ação remove o playbook do catálogo administrativo.',
    positiveText: 'Excluir',
    negativeText: 'Cancelar',
    onPositiveClick: async () => {
      try {
        await diagnosticPlaybookService.deleteAdmin(playbook.id)
        message.success('Playbook excluído')
        await load()
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } }
        message.error(e.response?.data?.message ?? 'Nao foi possivel excluir o playbook')
      }
    },
  })
}
</script>

<template>
  <div class="p-6">
    <div class="mb-6 flex items-center justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold text-white">Playbooks de diagnóstico</h1>
        <p class="mt-1 text-sm text-neutral-400">
          Catálogo administrativo separado para criar, editar, habilitar e desabilitar playbooks usados no dashboard do host.
        </p>
      </div>
      <NSpace>
        <NButton ghost @click="showHelp = true">Ajuda</NButton>
        <NButton type="primary" @click="openCreate">Novo playbook</NButton>
      </NSpace>
    </div>

    <NAlert v-if="error" type="error" class="mb-4" :title="error" />

    <NAlert type="info" class="mb-4">
      Os playbooks criados aqui ficam disponíveis para execução por host. Se a migration do catálogo ainda não tiver sido aplicada, a tela continua listando o catálogo base, mas criação e edição ficam bloqueadas pelo backend.
    </NAlert>

    <div class="mb-4 grid gap-3 md:grid-cols-5">
      <NInput
        v-model:value="search"
        placeholder="Buscar por nome, slug ou descrição"
        clearable
      />
      <NSelect v-model:value="categoryFilter" :options="categoryFilterOptions" />
      <NSelect v-model:value="riskFilter" :options="riskFilterOptions" />
      <NSelect v-model:value="statusFilter" :options="statusFilterOptions" />
      <NSelect v-model:value="targetOsFilter" :options="targetOsFilterOptions" />
    </div>

    <NDataTable
      :columns="columns"
      :data="filteredPlaybooks"
      :loading="loading"
      :bordered="false"
      size="small"
      :single-line="false"
    />
    <NEmpty
      v-if="!loading && !filteredPlaybooks.length"
      description="Nenhum playbook corresponde aos filtros atuais."
      class="py-6"
    />

    <NModal
      v-model:show="showModal"
      preset="card"
      class="max-w-5xl"
      :title="isEditing ? 'Editar playbook' : 'Novo playbook'"
      :bordered="false"
      :segmented="{ content: true }"
    >
      <NForm label-placement="top">
        <NAlert
          v-if="formErrors.length"
          type="error"
          class="mb-4"
          title="Revise os campos obrigatorios antes de salvar"
        >
          <ul class="list-disc pl-5 text-sm">
            <li v-for="item in formErrors" :key="item">{{ item }}</li>
          </ul>
        </NAlert>

        <NAlert
          v-if="hasPotentiallyDestructiveCommand"
          type="warning"
          class="mb-4"
          title="Possivel comando destrutivo detectado"
        >
          Revise o playbook. O catalogo de diagnostico deve priorizar comandos de leitura e baixo risco.
        </NAlert>

        <div class="grid gap-4 md:grid-cols-2">
          <NFormItem label="Nome">
            <NInput v-model:value="form.name" placeholder="Ex.: Rede Linux com foco em DNS" />
          </NFormItem>
          <NFormItem label="Slug">
            <NInput v-model:value="form.slug" placeholder="rede-linux-dns" />
          </NFormItem>
        </div>

        <NFormItem label="Descrição">
          <NInput v-model:value="form.description" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" />
        </NFormItem>

        <div class="grid gap-4 md:grid-cols-3">
          <NFormItem label="Categoria">
            <NSelect v-model:value="form.category" :options="categoryOptions" />
          </NFormItem>
          <NFormItem label="Risco">
            <NSelect v-model:value="form.riskLevel" :options="riskOptions" />
          </NFormItem>
          <NFormItem label="Sistema operacional">
            <NSelect v-model:value="form.targetOs" :options="targetOsOptions" />
          </NFormItem>
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <NFormItem label="Exige aprovação">
            <NSwitch v-model:value="form.requiresApproval" />
          </NFormItem>
          <NFormItem label="Habilitado">
            <NSwitch v-model:value="form.enabled" />
          </NFormItem>
        </div>

        <div class="mb-4 grid gap-3 rounded border border-neutral-800 bg-neutral-950/60 p-4 md:grid-cols-4">
          <div>
            <div class="text-xs uppercase tracking-wide text-neutral-500">Categoria</div>
            <div class="mt-1 text-sm text-white">{{ form.category }}</div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wide text-neutral-500">Risco</div>
            <div class="mt-1 text-sm text-white">{{ form.riskLevel }}</div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wide text-neutral-500">Steps</div>
            <div class="mt-1 text-sm text-white">{{ formSteps.length }}</div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wide text-neutral-500">Timeout estimado</div>
            <div class="mt-1 text-sm text-white">{{ estimatedTimeoutSeconds }}s</div>
          </div>
        </div>

        <div
          v-if="editingPlaybookMeta"
          class="mb-4 grid gap-3 rounded border border-neutral-800 bg-neutral-950/40 p-4 md:grid-cols-4"
        >
          <div>
            <div class="text-xs uppercase tracking-wide text-neutral-500">Versão</div>
            <div class="mt-1 text-sm text-white">v{{ editingPlaybookMeta.version }}</div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wide text-neutral-500">Criado em</div>
            <div class="mt-1 text-sm text-white">{{ formatPlaybookDate(editingPlaybookMeta.createdAt) }}</div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wide text-neutral-500">Atualizado em</div>
            <div class="mt-1 text-sm text-white">{{ formatPlaybookDate(editingPlaybookMeta.updatedAt) }}</div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wide text-neutral-500">Última alteração por</div>
            <div class="mt-1 text-sm text-white">{{ editingPlaybookMeta.lastUpdatedByName ?? 'Sem registro' }}</div>
          </div>
        </div>

        <div class="mb-3 mt-2 flex items-center justify-between gap-4">
          <div>
            <div class="text-sm font-medium text-white">Steps do playbook</div>
            <NText depth="3">Hoje o playbook aceita apenas steps do tipo command. A estrutura ja fica pronta para script governado em fase futura.</NText>
          </div>
        </div>

        <NDynamicInput v-model:value="formSteps" :on-create="createEmptyStep">
          <template #default="{ value }">
            <div class="grid w-full gap-3 rounded border border-neutral-800 bg-neutral-950/60 p-4">
              <div class="grid gap-3 md:grid-cols-4">
                <NFormItem label="Tipo">
                  <NSelect v-model:value="value.type" :options="stepTypeOptions" disabled />
                </NFormItem>
                <NFormItem label="ID">
                  <NInput v-model:value="value.id" placeholder="dns-status" />
                </NFormItem>
                <NFormItem label="Rótulo">
                  <NInput v-model:value="value.label" placeholder="DNS" />
                </NFormItem>
                <NFormItem label="Timeout (s)">
                  <NInputNumber v-model:value="value.timeoutSeconds" :min="1" :max="300" class="w-full" />
                </NFormItem>
              </div>
              <NFormItem label="Comando">
                <NInput v-model:value="value.command" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" placeholder="resolvectl status || cat /etc/resolv.conf" />
              </NFormItem>
            </div>
          </template>
        </NDynamicInput>
      </NForm>

      <template #footer>
        <NSpace justify="end">
          <NButton @click="showModal = false">Cancelar</NButton>
          <NButton type="primary" :loading="modalLoading" :disabled="!canSave" @click="save">
            {{ isEditing ? 'Salvar alterações' : 'Criar playbook' }}
          </NButton>
        </NSpace>
      </template>
    </NModal>

    <NModal
      v-model:show="showHelp"
      preset="card"
      class="max-w-3xl"
      title="Ajuda - Playbooks de diagnóstico"
      :bordered="false"
      :segmented="{ content: true }"
    >
      <div class="grid gap-3">
        <div v-for="item in helpQuickItems" :key="item.title" class="rounded border border-neutral-800 bg-neutral-950/60 p-4">
          <div class="text-sm font-medium text-white">{{ item.title }}</div>
          <div class="mt-1 text-sm text-neutral-300">{{ item.description }}</div>
        </div>
      </div>

      <div class="mt-5 grid gap-3">
        <div v-for="section in helpSections" :key="section.title" class="rounded border border-neutral-800 bg-neutral-950/40 p-4">
          <div class="text-sm font-medium text-white">{{ section.title }}</div>
          <div class="mt-1 text-sm text-neutral-300">{{ section.description }}</div>
        </div>
      </div>

      <div class="mt-5">
        <div class="mb-2 text-sm font-medium text-white">Fluxo recomendado</div>
        <ol class="list-decimal space-y-2 pl-5 text-sm text-neutral-300">
          <li v-for="step in helpSteps" :key="step">{{ step }}</li>
        </ol>
      </div>
    </NModal>

    <NModal
      v-model:show="showHistory"
      preset="card"
      class="max-w-3xl"
      :title="historyTarget ? `Histórico - ${historyTarget.name}` : 'Histórico do playbook'"
      :bordered="false"
      :segmented="{ content: true }"
    >
      <div v-if="historyLoading" class="py-6 text-sm text-neutral-300">
        Carregando histórico...
      </div>
      <div v-else-if="historyEntries.length" class="grid gap-3">
        <div
          v-for="item in historyEntries"
          :key="item.id"
          class="rounded border border-neutral-800 bg-neutral-950/50 p-4"
        >
          <div class="flex items-center justify-between gap-3">
            <div class="text-sm font-medium text-white">{{ historyActionLabel(item.action) }}</div>
            <div class="text-xs text-neutral-400">{{ formatHistoryDate(item.timestamp) }}</div>
          </div>
          <div class="mt-2 text-sm text-neutral-300">Por {{ item.adminName }}</div>
          <div v-if="item.details" class="mt-2 text-xs text-neutral-400">{{ item.details }}</div>
        </div>
      </div>
      <NEmpty v-else description="Nenhum evento administrativo encontrado para este playbook." class="py-6" />
    </NModal>
  </div>
</template>
