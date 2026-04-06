<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { NInput, NButton, NSelect, NEmpty, NSpin, NTooltip, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import {
  snippetService,
  deserializeSnippetCommand,
  serializeSnippetForm,
  toSnippetFormData,
  type Snippet,
  type SnippetExecution,
  type SnippetFormData,
} from '@/services/snippet.service'
import { useAuthStore } from '@/stores/auth'

const emit = defineEmits<{
  send: [payload: { execution: SnippetExecution; snippetId: number }]
}>()

const { t } = useI18n()
const auth    = useAuthStore()
const message = useMessage()

// ── State ────────────────────────────────────────────────────────────────────

const snippets  = ref<Snippet[]>([])
const loading   = ref(false)
const search    = ref('')
const showForm  = ref(false)
const editId    = ref<number | null>(null)
const saving    = ref(false)

const form = ref<SnippetFormData>(toSnippetFormData())

const scopeOptions = computed(() => [
  { label: t('snippets.scopePersonal'), value: 'PERSONAL' },
  { label: t('snippets.scopeTeam'),     value: 'TEAM' },
])

const kindOptions = computed(() => [
  { label: t('snippets.kind.command'), value: 'COMMAND' },
  { label: t('snippets.kind.sequence'), value: 'SEQUENCE' },
  { label: t('snippets.kind.expectSend'), value: 'EXPECT_SEND' },
])

// ── Data ──────────────────────────────────────────────────────────────────────

async function load() {
  loading.value = true
  try {
    const { data } = await snippetService.list()
    snippets.value = data
  } finally {
    loading.value = false
  }
}

onMounted(load)

// ── Filter ────────────────────────────────────────────────────────────────────

const filtered = computed(() => {
  const q = search.value.toLowerCase()
  if (!q) return snippets.value
  return snippets.value.filter(s =>
    s.name.toLowerCase().includes(q) ||
    snippetPreview(s).toLowerCase().includes(q) ||
    (s.description ?? '').toLowerCase().includes(q),
  )
})

// ── Form ──────────────────────────────────────────────────────────────────────

function openCreate() {
  editId.value = null
  form.value   = toSnippetFormData()
  showForm.value = true
}

function openEdit(s: Snippet) {
  editId.value = s.id
  form.value   = toSnippetFormData(s)
  showForm.value = true
}

function cancelForm() {
  showForm.value = false
}

async function saveForm() {
  const hasCommand = form.value.kind === 'COMMAND'
    ? form.value.command.trim().length > 0
    : form.value.kind === 'SEQUENCE'
      ? form.value.stepsText.trim().length > 0
      : form.value.expectSendText.trim().length > 0
  if (!form.value.name.trim() || !hasCommand) return
  saving.value = true
  try {
    const dto = serializeSnippetForm(form.value)
    if (editId.value !== null) {
      await snippetService.update(editId.value, dto)
    } else {
      await snippetService.create(dto)
    }
    showForm.value = false
    await load()
    message.success(editId.value !== null ? t('snippets.updated') : t('snippets.created'))
  } catch {
    message.error(t('snippets.saveError'))
  } finally {
    saving.value = false
  }
}

async function remove(s: Snippet) {
  if (!window.confirm(t('snippets.deleteConfirm', { name: s.name }))) return
  try {
    await snippetService.remove(s.id)
    await load()
    message.success(t('snippets.deleted'))
  } catch {
    message.error(t('snippets.deleteError'))
  }
}

// ── Send ──────────────────────────────────────────────────────────────────────

function send(s: Snippet) {
  emit('send', { execution: { ...deserializeSnippetCommand(s.command), name: s.name }, snippetId: s.id })
}

function isOwner(s: Snippet): boolean {
  return s.createdBy.id === Number(auth.user?.id ?? -1)
}

function snippetKind(s: Snippet) {
  return deserializeSnippetCommand(s.command).kind
}

function snippetPreview(s: Snippet): string {
  const parsed = deserializeSnippetCommand(s.command)
  if (parsed.kind === 'SEQUENCE') {
    return parsed.steps.join('\n')
  }
  if (parsed.kind === 'EXPECT_SEND') {
    return parsed.expectSteps.map((step) => `${step.expect} => ${step.send}`).join('\n')
  }
  return parsed.command
}

function snippetStepCount(s: Snippet): number {
  const parsed = deserializeSnippetCommand(s.command)
  if (parsed.kind === 'SEQUENCE') return parsed.steps.length
  if (parsed.kind === 'EXPECT_SEND') return parsed.expectSteps.length
  return 1
}
</script>

<template>
  <div class="flex flex-col h-full bg-[#18181c] border-l border-gray-800">

    <!-- Header -->
    <div class="flex items-center gap-2 px-3 py-2 border-b border-gray-800 shrink-0" style="height:36px;">
      <span class="text-xs font-semibold text-gray-300 flex-1">{{ $t('snippets.title') }}</span>
      <NButton size="tiny" type="primary" @click="openCreate">+ {{ $t('snippets.new') }}</NButton>
    </div>

    <!-- Form -->
    <div v-if="showForm" class="p-3 border-b border-gray-800 shrink-0 space-y-2 bg-[#111113]">
      <NInput v-model:value="form.name" :placeholder="$t('snippets.namePlaceholder')" size="small" />
      <NSelect v-model:value="form.kind" :options="kindOptions" size="small" />
      <NInput
        v-if="form.kind === 'COMMAND'"
        v-model:value="form.command"
        type="textarea"
        :placeholder="$t('snippets.commandPlaceholder')"
        size="small"
        :autosize="{ minRows: 2, maxRows: 5 }"
        style="font-family: monospace; font-size: 12px;"
      />
      <NInput
        v-else-if="form.kind === 'SEQUENCE'"
        v-model:value="form.stepsText"
        type="textarea"
        :placeholder="$t('snippets.sequencePlaceholder')"
        size="small"
        :autosize="{ minRows: 3, maxRows: 7 }"
        style="font-family: monospace; font-size: 12px;"
      />
      <NInput
        v-else
        v-model:value="form.expectSendText"
        type="textarea"
        :placeholder="$t('snippets.expectSendPlaceholder')"
        size="small"
        :autosize="{ minRows: 3, maxRows: 8 }"
        style="font-family: monospace; font-size: 12px;"
      />
      <NInput v-model:value="form.description" :placeholder="$t('snippets.descriptionPlaceholder')" size="small" />
      <NSelect v-model:value="form.scope" :options="scopeOptions" size="small" />
      <div class="flex gap-2 justify-end">
        <NButton size="small" @click="cancelForm">{{ $t('common.cancel') }}</NButton>
        <NButton size="small" type="primary" :loading="saving" @click="saveForm">{{ $t('common.save') }}</NButton>
      </div>
    </div>

    <!-- Search -->
    <div class="px-3 py-2 shrink-0 border-b border-gray-800">
      <NInput
        v-model:value="search"
        :placeholder="$t('snippets.search')"
        size="small" clearable
      />
    </div>

    <!-- List -->
    <div class="flex-1 overflow-y-auto">
      <NSpin v-if="loading" class="flex items-center justify-center py-8" />
      <NEmpty
        v-else-if="filtered.length === 0"
        :description="search ? $t('snippets.noResults') : $t('snippets.empty')"
        class="py-8"
      />
      <div v-else class="divide-y divide-gray-800">
        <div
          v-for="s in filtered"
          :key="s.id"
          class="px-3 py-2.5 hover:bg-[#1e1e22] group transition-colors"
        >
          <div class="flex items-start gap-2">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5 mb-0.5">
                <span class="text-xs font-medium text-white truncate">{{ s.name }}</span>
                <span
                  class="text-[10px] px-1 py-px rounded shrink-0"
                  :style="s.scope === 'TEAM'
                    ? 'background:rgba(99,102,241,0.15);color:#818cf8'
                    : 'background:rgba(107,114,128,0.15);color:#9ca3af'"
                >{{ s.scope === 'TEAM' ? $t('snippets.scopeTeam') : $t('snippets.scopePersonal') }}</span>
                <span
                  class="text-[10px] px-1 py-px rounded shrink-0"
                  :style="snippetKind(s) === 'SEQUENCE'
                    ? 'background:rgba(16,185,129,0.15);color:#34d399'
                    : snippetKind(s) === 'EXPECT_SEND'
                      ? 'background:rgba(245,158,11,0.15);color:#fbbf24'
                      : 'background:rgba(59,130,246,0.15);color:#60a5fa'"
                >{{
                  snippetKind(s) === 'SEQUENCE'
                    ? $t('snippets.kind.sequence')
                    : snippetKind(s) === 'EXPECT_SEND'
                      ? $t('snippets.kind.expectSend')
                      : $t('snippets.kind.command')
                }}</span>
                <span
                  v-if="snippetKind(s) !== 'COMMAND'"
                  class="text-[10px] text-gray-500 shrink-0"
                >{{ snippetStepCount(s) }} {{ $t('snippets.stepsShort') }}</span>
              </div>
              <pre class="text-[11px] text-green-400 font-mono truncate mb-0.5">{{ snippetPreview(s) }}</pre>
              <p v-if="s.description" class="text-[11px] text-gray-500 truncate">{{ s.description }}</p>
            </div>
            <!-- Actions -->
            <div class="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <NTooltip trigger="hover" placement="left">
                <template #trigger>
                  <NButton size="tiny" type="primary" @click="send(s)">▶</NButton>
                </template>
                {{ $t('snippets.send') }}
              </NTooltip>
              <template v-if="isOwner(s)">
                <NButton size="tiny" text style="color:#9ca3af;" @click="openEdit(s)">✏</NButton>
                <NButton size="tiny" text style="color:#ef4444;" @click="remove(s)">✕</NButton>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
