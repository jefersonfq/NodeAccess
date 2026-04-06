<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  NButton, NInput, NSelect, NEmpty, NSpin, NModal, NTag, useMessage,
} from 'naive-ui'
import { useI18n } from 'vue-i18n'
import {
  snippetService,
  deserializeSnippetCommand,
  serializeSnippetForm,
  toSnippetFormData,
  type Snippet,
  type SnippetFormData,
} from '@/services/snippet.service'
import { useAuthStore } from '@/stores/auth'

const { t, tm } = useI18n()
const auth       = useAuthStore()
const message    = useMessage()

// ── State ─────────────────────────────────────────────────────────────────────

const snippets    = ref<Snippet[]>([])
const loading     = ref(false)
const search      = ref('')
const scopeFilter = ref<'ALL' | 'PERSONAL' | 'TEAM'>('ALL')
const showHelp    = ref(false)

const showModal = ref(false)
const editId    = ref<number | null>(null)
const saving    = ref(false)
const form      = ref<SnippetFormData>(toSnippetFormData())

const scopeOptions = computed(() => [
  { label: t('snippets.scopePersonal'), value: 'PERSONAL' },
  { label: t('snippets.scopeTeam'),     value: 'TEAM' },
])

const kindOptions = computed(() => [
  { label: t('snippets.kind.command'), value: 'COMMAND' },
  { label: t('snippets.kind.sequence'), value: 'SEQUENCE' },
  { label: t('snippets.kind.expectSend'), value: 'EXPECT_SEND' },
])

// Examples extraídos via tm() para evitar serialização de arrays pelo $t()
const helpExamples = computed<Array<{ title: string; cmd: string; desc: string }>>(() =>
  tm('snippetsPage.help.examples') as Array<{ title: string; cmd: string; desc: string }>,
)

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
  let list = snippets.value
  if (scopeFilter.value !== 'ALL') list = list.filter(s => s.scope === scopeFilter.value)
  const q = search.value.toLowerCase()
  if (q) list = list.filter(s =>
    s.name.toLowerCase().includes(q) ||
    snippetPreview(s).toLowerCase().includes(q) ||
    (s.description ?? '').toLowerCase().includes(q),
  )
  return list
})

const personalCount = computed(() => snippets.value.filter(s => s.scope === 'PERSONAL').length)
const teamCount     = computed(() => snippets.value.filter(s => s.scope === 'TEAM').length)

// ── CRUD ──────────────────────────────────────────────────────────────────────

function openCreate() {
  editId.value    = null
  form.value      = toSnippetFormData()
  showModal.value = true
}

function openEdit(s: Snippet) {
  editId.value    = s.id
  form.value      = toSnippetFormData(s)
  showModal.value = true
}

async function save() {
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
      message.success(t('snippets.updated'))
    } else {
      await snippetService.create(dto)
      message.success(t('snippets.created'))
    }
    showModal.value = false
    await load()
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

function isOwner(s: Snippet) {
  return s.createdBy.id === Number(auth.user?.id ?? -1)
}

function snippetKind(s: Snippet) {
  return deserializeSnippetCommand(s.command).kind
}

function snippetPreview(s: Snippet): string {
  const parsed = deserializeSnippetCommand(s.command)
  if (parsed.kind === 'SEQUENCE') return parsed.steps.join('\n')
  if (parsed.kind === 'EXPECT_SEND') return parsed.expectSteps.map((step) => `${step.expect} => ${step.send}`).join('\n')
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
  <div style="height: 100vh; overflow-y: auto; background: #101014;">
    <div class="max-w-4xl mx-auto px-6 py-8 space-y-6">

      <!-- ── Header ──────────────────────────────────────────────────────────── -->
      <div class="flex items-start justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold text-white">{{ $t('snippetsPage.title') }}</h1>
          <p class="text-gray-400 mt-1 text-sm">{{ $t('snippetsPage.subtitle') }}</p>
        </div>
        <NButton type="primary" @click="openCreate">+ {{ $t('snippets.new') }}</NButton>
      </div>

      <!-- ── Help card (retrátil) ────────────────────────────────────────────── -->
      <div class="rounded-xl border border-gray-800 bg-[#111113] overflow-hidden">
        <button
          class="w-full flex items-center justify-between px-5 py-3.5 text-left"
          @click="showHelp = !showHelp"
        >
          <span class="text-sm font-semibold text-gray-200">{{ $t('snippetsPage.help.title') }}</span>
          <span class="text-gray-500 text-xs">{{ showHelp ? '▲' : '▼' }}</span>
        </button>

        <div v-if="showHelp" class="border-t border-gray-800">
          <div class="px-5 py-4 space-y-4">

            <p class="text-sm text-gray-400">{{ $t('snippetsPage.help.desc') }}</p>

            <!-- Exemplos práticos -->
            <div>
              <p class="text-xs font-semibold text-gray-300 mb-2">{{ $t('snippetsPage.help.examplesTitle') }}</p>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div
                  v-for="(ex, i) in helpExamples"
                  :key="i"
                  class="rounded-lg border border-gray-700 bg-[#0d0d0f] p-3 space-y-1"
                >
                  <p class="text-xs font-medium text-gray-300">{{ ex.title }}</p>
                  <pre class="text-[11px] text-green-400 font-mono whitespace-pre-wrap">{{ ex.cmd }}</pre>
                  <p class="text-[11px] text-gray-500 leading-relaxed">{{ ex.desc }}</p>
                </div>
              </div>
            </div>

            <!-- Fluxo de uso -->
            <div class="rounded-lg bg-[#0d0d0f] p-4 space-y-2">
              <p class="text-xs font-semibold text-gray-300 mb-1">{{ $t('snippetsPage.help.flowTitle') }}</p>
              <div class="flex items-start gap-3 text-xs text-gray-400">
                <span class="shrink-0 w-5 h-5 rounded-full bg-blue-900 text-blue-300 flex items-center justify-center text-[10px] font-bold mt-0.5">1</span>
                <p>{{ $t('snippetsPage.help.flow1') }}</p>
              </div>
              <div class="flex items-start gap-3 text-xs text-gray-400">
                <span class="shrink-0 w-5 h-5 rounded-full bg-blue-900 text-blue-300 flex items-center justify-center text-[10px] font-bold mt-0.5">2</span>
                <p>{{ $t('snippetsPage.help.flow2') }}</p>
              </div>
              <div class="flex items-start gap-3 text-xs text-gray-400">
                <span class="shrink-0 w-5 h-5 rounded-full bg-blue-900 text-blue-300 flex items-center justify-center text-[10px] font-bold mt-0.5">3</span>
                <p>{{ $t('snippetsPage.help.flow3') }}</p>
              </div>
            </div>

            <!-- Escopo -->
            <div class="rounded-lg bg-[#0d0d0f] px-4 py-3 space-y-1 text-xs text-gray-500">
              <p class="font-medium text-gray-400">{{ $t('snippetsPage.help.scopeTitle') }}</p>
              <p>
                <span class="text-indigo-400 font-medium">{{ $t('snippets.scopeTeam') }}</span>
                — {{ $t('snippetsPage.help.scopeTeam') }}
              </p>
              <p>
                <span class="text-gray-400 font-medium">{{ $t('snippets.scopePersonal') }}</span>
                — {{ $t('snippetsPage.help.scopePersonal') }}
              </p>
            </div>

          </div>
        </div>
      </div>

      <!-- ── Filtros + busca ─────────────────────────────────────────────────── -->
      <div class="flex items-center gap-3 flex-wrap">
        <div class="flex rounded-lg border border-gray-700 overflow-hidden shrink-0">
          <button
            class="px-3 py-1.5 text-xs font-medium transition-colors"
            :class="scopeFilter === 'ALL' ? 'bg-blue-600 text-white' : 'bg-transparent text-gray-400 hover:text-gray-200'"
            @click="scopeFilter = 'ALL'"
          >{{ $t('common.all') }} ({{ snippets.length }})</button>
          <button
            class="px-3 py-1.5 text-xs font-medium transition-colors border-l border-gray-700"
            :class="scopeFilter === 'PERSONAL' ? 'bg-blue-600 text-white' : 'bg-transparent text-gray-400 hover:text-gray-200'"
            @click="scopeFilter = 'PERSONAL'"
          >{{ $t('snippets.scopePersonal') }} ({{ personalCount }})</button>
          <button
            class="px-3 py-1.5 text-xs font-medium transition-colors border-l border-gray-700"
            :class="scopeFilter === 'TEAM' ? 'bg-blue-600 text-white' : 'bg-transparent text-gray-400 hover:text-gray-200'"
            @click="scopeFilter = 'TEAM'"
          >{{ $t('snippets.scopeTeam') }} ({{ teamCount }})</button>
        </div>
        <NInput
          v-model:value="search"
          :placeholder="$t('snippets.search')"
          size="small"
          clearable
          style="flex:1; min-width:180px;"
        />
      </div>

      <!-- ── Lista ───────────────────────────────────────────────────────────── -->
      <div>
        <NSpin v-if="loading" class="flex justify-center py-12" />
        <NEmpty
          v-else-if="filtered.length === 0"
          :description="search || scopeFilter !== 'ALL' ? $t('snippets.noResults') : $t('snippets.empty')"
          class="py-12"
        />
        <div v-else class="space-y-2">
          <div
            v-for="s in filtered"
            :key="s.id"
            class="rounded-xl border border-gray-800 bg-[#111113] px-4 py-3 group hover:border-gray-700 transition-colors"
          >
            <div class="flex items-start gap-3">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1.5">
                  <span class="text-sm font-semibold text-white">{{ s.name }}</span>
                  <NTag size="tiny" :type="s.scope === 'TEAM' ? 'info' : 'default'">
                    {{ s.scope === 'TEAM' ? $t('snippets.scopeTeam') : $t('snippets.scopePersonal') }}
                  </NTag>
                  <NTag size="tiny" :type="snippetKind(s) === 'SEQUENCE' ? 'success' : snippetKind(s) === 'EXPECT_SEND' ? 'warning' : 'primary'">
                    {{
                      snippetKind(s) === 'SEQUENCE'
                        ? $t('snippets.kind.sequence')
                        : snippetKind(s) === 'EXPECT_SEND'
                          ? $t('snippets.kind.expectSend')
                          : $t('snippets.kind.command')
                    }}
                  </NTag>
                  <span v-if="snippetKind(s) !== 'COMMAND'" class="text-[11px] text-gray-500">
                    {{ snippetStepCount(s) }} {{ $t('snippets.stepsShort') }}
                  </span>
                </div>
                <pre class="text-[12px] text-green-400 font-mono bg-[#0d0d0f] rounded px-2 py-1.5 mb-1.5 whitespace-pre-wrap break-all">{{ snippetPreview(s) }}</pre>
                <p v-if="s.description" class="text-xs text-gray-400 mb-1">{{ s.description }}</p>
                <p class="text-[11px] text-gray-600">{{ $t('snippetsPage.by') }} {{ s.createdBy.name }}</p>
              </div>
              <div class="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity pt-0.5">
                <template v-if="isOwner(s)">
                  <NButton size="small" @click="openEdit(s)">{{ $t('common.edit') }}</NButton>
                  <NButton size="small" text style="color:#ef4444;" @click="remove(s)">{{ $t('common.delete') }}</NButton>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  </div>

  <!-- ── Modal criar / editar ──────────────────────────────────────────────────── -->
  <NModal
    v-model:show="showModal"
    preset="card"
    style="max-width: 520px;"
    :title="editId !== null ? $t('snippetsPage.editTitle') : $t('snippetsPage.createTitle')"
  >
    <div class="space-y-3">
      <div>
        <p class="text-xs text-gray-400 mb-1">{{ $t('common.name') }}</p>
        <NInput v-model:value="form.name" :placeholder="$t('snippets.namePlaceholder')" />
      </div>
      <div>
        <p class="text-xs text-gray-400 mb-1">{{ $t('snippets.kind.label') }}</p>
        <NSelect v-model:value="form.kind" :options="kindOptions" />
      </div>
      <div v-if="form.kind === 'COMMAND'">
        <p class="text-xs text-gray-400 mb-1">{{ $t('snippetsPage.commandLabel') }}</p>
        <NInput
          v-model:value="form.command"
          type="textarea"
          :placeholder="$t('snippets.commandPlaceholder')"
          :autosize="{ minRows: 3, maxRows: 8 }"
          style="font-family: monospace; font-size: 13px;"
        />
      </div>
      <div v-else-if="form.kind === 'SEQUENCE'">
        <p class="text-xs text-gray-400 mb-1">{{ $t('snippets.sequenceLabel') }}</p>
        <NInput
          v-model:value="form.stepsText"
          type="textarea"
          :placeholder="$t('snippets.sequencePlaceholder')"
          :autosize="{ minRows: 4, maxRows: 10 }"
          style="font-family: monospace; font-size: 13px;"
        />
      </div>
      <div v-else>
        <p class="text-xs text-gray-400 mb-1">{{ $t('snippets.expectSendLabel') }}</p>
        <NInput
          v-model:value="form.expectSendText"
          type="textarea"
          :placeholder="$t('snippets.expectSendPlaceholder')"
          :autosize="{ minRows: 4, maxRows: 10 }"
          style="font-family: monospace; font-size: 13px;"
        />
      </div>
      <div>
        <p class="text-xs text-gray-400 mb-1">{{ $t('common.description') }} ({{ $t('snippetsPage.optional') }})</p>
        <NInput v-model:value="form.description" :placeholder="$t('snippets.descriptionPlaceholder')" />
      </div>
      <div>
        <p class="text-xs text-gray-400 mb-1">{{ $t('snippetsPage.scope') }}</p>
        <NSelect v-model:value="form.scope" :options="scopeOptions" />
      </div>
      <div class="flex justify-end gap-2 pt-2">
        <NButton @click="showModal = false">{{ $t('common.cancel') }}</NButton>
        <NButton type="primary" :loading="saving" @click="save">{{ $t('common.save') }}</NButton>
      </div>
    </div>
  </NModal>
</template>
