<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { NInput, NButton, NSelect, NEmpty, NSpin, NTooltip, useMessage, type SelectOption } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import {
  snippetService,
  snippetGroupService,
  deserializeSnippetCommand,
  groupSnippets,
  hasGroupScopeMismatch,
  getSnippetExecutionSecretAliases,
  getSnippetSensitivePatternKeys,
  getSnippetSecretAliases,
  maskSecretPlaceholders,
  serializeSnippetForm,
  toSnippetFormData,
  type Snippet,
  type SnippetGroup,
  type SnippetExecution,
  type SnippetFormData,
} from '@/services/snippet.service'
import { useAuthStore } from '@/stores/auth'
import { secretService } from '@/services/secret.service'
import { snippetPickerView, setSnippetPickerView } from '@/services/snippet-view-preferences.service'
import {
  getSnippetSecretAliasStatuses,
  hasMissingSecretAliases,
} from '@/services/snippet-secret-validation.service'
import type { SecretPublic } from '@nodeaccess/shared'

const emit = defineEmits<{
  send: [payload: { execution: SnippetExecution; snippetId: number }]
}>()

const { t } = useI18n()
const auth    = useAuthStore()
const message = useMessage()

// ── View mode ────────────────────────────────────────────────────────────────

const viewMode = snippetPickerView
function setViewMode(mode: 'flat' | 'grouped') { setSnippetPickerView(mode) }

// ── State ────────────────────────────────────────────────────────────────────

const snippets  = ref<Snippet[]>([])
const groups    = ref<SnippetGroup[]>([])
const secrets   = ref<SecretPublic[]>([])
const loading   = ref(false)
const search    = ref('')
const showForm  = ref(false)
const editId    = ref<number | null>(null)
const saving    = ref(false)

const form = ref<SnippetFormData>(toSnippetFormData())

// Collapsed group IDs in grouped view
const collapsedGroups = ref<Set<number | null>>(new Set())

function toggleCollapse(groupId: number | null) {
  if (collapsedGroups.value.has(groupId)) {
    collapsedGroups.value.delete(groupId)
  } else {
    collapsedGroups.value.add(groupId)
  }
  // Trigger reactivity
  collapsedGroups.value = new Set(collapsedGroups.value)
}

// ── Options ───────────────────────────────────────────────────────────────────

const scopeOptions = computed(() => [
  { label: t('snippets.scopePersonal'), value: 'PERSONAL' },
  { label: t('snippets.scopeTeam'),     value: 'TEAM' },
])

const kindOptions = computed(() => [
  { label: t('snippets.kind.command'),    value: 'COMMAND' },
  { label: t('snippets.kind.sequence'),   value: 'SEQUENCE' },
  { label: t('snippets.kind.expectSend'), value: 'EXPECT_SEND' },
])

const groupOptions = computed((): SelectOption[] => {
  const nullOption: SelectOption = { label: t('snippets.noGroup'), value: null as unknown as string }
  const opts: SelectOption[] = groups.value.map(g => ({
    label: g.scope === 'TEAM' ? `[Team] ${g.name}` : g.name,
    value: g.id,
  }))
  return [nullOption, ...opts]
})

// ── Data ──────────────────────────────────────────────────────────────────────

async function load() {
  loading.value = true
  try {
    const [{ data: snippetRows }, { data: secretRows }, { data: groupRows }] = await Promise.all([
      snippetService.list(),
      secretService.list(false),
      snippetGroupService.list(),
    ])
    snippets.value = snippetRows
    secrets.value  = secretRows
    groups.value   = groupRows
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

const groupedBuckets = computed(() => groupSnippets(filtered.value, groups.value))

// ── Form ──────────────────────────────────────────────────────────────────────

function openCreate() {
  editId.value   = null
  form.value     = toSnippetFormData()
  showForm.value = true
}

function openEdit(s: Snippet) {
  editId.value   = s.id
  form.value     = toSnippetFormData(s)
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

// ── Secret / sensitive helpers ────────────────────────────────────────────────

const formSecretAliases = computed(() => {
  const dto = serializeSnippetForm(form.value)
  return getSnippetExecutionSecretAliases(deserializeSnippetCommand(dto.command))
})
const formSecretAliasStatuses = computed(() =>
  getSnippetSecretAliasStatuses(formSecretAliases.value, secrets.value),
)
const formHasMissingSecretAliases = computed(() => hasMissingSecretAliases(formSecretAliasStatuses.value))
const formSensitivePatternKeys = computed(() => {
  const dto = serializeSnippetForm(form.value)
  return getSnippetSensitivePatternKeys(deserializeSnippetCommand(dto.command))
})

const showScopeMismatch = computed(() => {
  const selectedGroup = groups.value.find(g => g.id === form.value.groupId)
  return hasGroupScopeMismatch(form.value.scope, selectedGroup?.scope)
})

// ── Snippet display helpers ───────────────────────────────────────────────────

function isOwner(s: Snippet): boolean {
  return s.createdBy.id === Number(auth.user?.id ?? -1)
}

function snippetKind(s: Snippet) {
  return deserializeSnippetCommand(s.command).kind
}

function snippetPreview(s: Snippet): string {
  const parsed = deserializeSnippetCommand(s.command)
  if (parsed.kind === 'SEQUENCE') {
    return maskSecretPlaceholders(parsed.steps.join('\n'))
  }
  if (parsed.kind === 'EXPECT_SEND') {
    return maskSecretPlaceholders(parsed.expectSteps.map((step) => `${step.expect} => ${step.send}`).join('\n'))
  }
  return maskSecretPlaceholders(parsed.command)
}

function snippetSecretAliases(s: Snippet): string[] {
  return getSnippetSecretAliases(s)
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
    <div class="flex items-center gap-1 px-3 py-2 border-b border-gray-800 shrink-0" style="height:36px;">
      <span class="text-xs font-semibold text-gray-300 flex-1">{{ $t('snippets.title') }}</span>
      <!-- View mode toggle -->
      <NTooltip trigger="hover" placement="bottom">
        <template #trigger>
          <NButton
            size="tiny" text
            :style="viewMode === 'flat' ? 'color:#a5b4fc' : 'color:#6b7280'"
            @click="setViewMode('flat')"
          >≡</NButton>
        </template>
        {{ $t('snippets.viewFlat') }}
      </NTooltip>
      <NTooltip trigger="hover" placement="bottom">
        <template #trigger>
          <NButton
            size="tiny" text
            :style="viewMode === 'grouped' ? 'color:#a5b4fc' : 'color:#6b7280'"
            @click="setViewMode('grouped')"
          >⊞</NButton>
        </template>
        {{ $t('snippets.viewGrouped') }}
      </NTooltip>
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
      <!-- Scope + Group side by side -->
      <div class="flex gap-2">
        <NSelect v-model:value="form.scope" :options="scopeOptions" size="small" class="flex-1" />
        <NSelect
          v-model:value="form.groupId"
          :options="groupOptions"
          size="small"
          class="flex-1"
          :placeholder="$t('snippets.noGroup')"
          clearable
        />
      </div>
      <!-- Scope mismatch warning -->
      <div v-if="showScopeMismatch" class="rounded border border-amber-900/60 bg-amber-950/30 px-2 py-1.5 text-[11px] text-amber-200">
        {{ $t('snippets.scopeMismatchWarning') }}
      </div>
      <!-- Secret aliases -->
      <div v-if="formSecretAliases.length > 0" class="rounded border border-amber-900/60 bg-amber-950/30 px-2 py-1.5 text-[11px] text-amber-200">
        <p>{{ $t('snippets.usesSecretAliases', { aliases: formSecretAliases.join(', ') }) }}</p>
        <div class="mt-1.5 flex flex-wrap gap-1">
          <span
            v-for="status in formSecretAliasStatuses"
            :key="status.alias"
            class="rounded px-1 py-px"
            :style="status.state === 'available'
              ? 'background:rgba(16,185,129,0.15);color:#34d399'
              : 'background:rgba(239,68,68,0.18);color:#fca5a5'"
          >
            {{ status.alias }} · {{ status.state === 'available' ? $t('snippets.secretAliasAvailable') : $t('snippets.secretAliasMissing') }}
          </span>
        </div>
        <p v-if="formHasMissingSecretAliases" class="mt-1.5 text-amber-100">
          {{ $t('snippets.secretAliasMissingHint') }}
        </p>
      </div>
      <div v-if="formSensitivePatternKeys.length > 0" class="rounded border border-red-900/60 bg-red-950/30 px-2 py-1.5 text-[11px] text-red-100">
        <p class="font-medium">{{ $t('snippets.sensitivePatternWarning') }}</p>
        <p class="mt-1 text-red-200">{{ $t('snippets.sensitivePatternHint') }}</p>
      </div>
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

      <!-- ── Flat view ──────────────────────────────────────────────────────── -->
      <div v-else-if="viewMode === 'flat'" class="divide-y divide-gray-800">
        <div
          v-for="s in filtered"
          :key="s.id"
          class="px-3 py-2.5 hover:bg-[#1e1e22] group transition-colors"
        >
          <div class="flex items-start gap-2">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5 mb-0.5 flex-wrap">
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
                <!-- Group badge -->
                <span
                  v-if="s.group"
                  class="text-[10px] px-1 py-px rounded shrink-0"
                  style="background:rgba(168,85,247,0.15);color:#c084fc"
                >{{ s.group.name }}</span>
                <NTooltip v-if="snippetSecretAliases(s).length > 0" trigger="hover" placement="top">
                  <template #trigger>
                    <span class="text-[10px] px-1 py-px rounded shrink-0" style="background:rgba(245,158,11,0.15);color:#fbbf24">
                      {{ $t('snippets.usesSecret') }}
                    </span>
                  </template>
                  {{ $t('snippets.usesSecretAliases', { aliases: snippetSecretAliases(s).join(', ') }) }}
                </NTooltip>
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

      <!-- ── Grouped view ───────────────────────────────────────────────────── -->
      <div v-else class="divide-y divide-gray-800/50">
        <div v-for="bucket in groupedBuckets" :key="bucket.group?.id ?? 'ungrouped'">
          <!-- Group header -->
          <button
            class="w-full flex items-center gap-2 px-3 py-1.5 bg-[#111113] hover:bg-[#16161a] transition-colors text-left"
            @click="toggleCollapse(bucket.group?.id ?? null)"
          >
            <span class="text-[11px] transition-transform" :class="collapsedGroups.has(bucket.group?.id ?? null) ? 'rotate-[-90deg]' : ''">▾</span>
            <span class="text-[11px] font-semibold text-gray-200 flex-1 truncate">
              {{ bucket.group ? bucket.group.name : $t('snippets.ungrouped') }}
            </span>
            <span
              v-if="bucket.group"
              class="text-[10px] px-1 py-px rounded shrink-0"
              :style="bucket.group.scope === 'TEAM'
                ? 'background:rgba(99,102,241,0.15);color:#818cf8'
                : 'background:rgba(107,114,128,0.15);color:#9ca3af'"
            >{{ bucket.group.scope === 'TEAM' ? $t('snippets.scopeTeam') : $t('snippets.scopePersonal') }}</span>
            <span class="text-[10px] text-gray-500 shrink-0">{{ bucket.snippets.length }}</span>
          </button>

          <!-- Group snippets -->
          <div v-if="!collapsedGroups.has(bucket.group?.id ?? null)" class="divide-y divide-gray-800">
            <div
              v-for="s in bucket.snippets"
              :key="s.id"
              class="px-3 py-2.5 pl-5 hover:bg-[#1e1e22] group transition-colors"
            >
              <div class="flex items-start gap-2">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-1.5 mb-0.5 flex-wrap">
                    <span class="text-xs font-medium text-white truncate">{{ s.name }}</span>
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
                    <NTooltip v-if="snippetSecretAliases(s).length > 0" trigger="hover" placement="top">
                      <template #trigger>
                        <span class="text-[10px] px-1 py-px rounded shrink-0" style="background:rgba(245,158,11,0.15);color:#fbbf24">
                          {{ $t('snippets.usesSecret') }}
                        </span>
                      </template>
                      {{ $t('snippets.usesSecretAliases', { aliases: snippetSecretAliases(s).join(', ') }) }}
                    </NTooltip>
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

    </div>
  </div>
</template>
