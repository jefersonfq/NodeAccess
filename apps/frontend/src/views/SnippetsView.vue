<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  NAlert, NButton, NInput, NSelect, NEmpty, NSpin, NModal, NTag, NTooltip, useMessage,
  type SelectOption,
} from 'naive-ui'
import { useI18n } from 'vue-i18n'
import {
  snippetService,
  snippetGroupService,
  groupSnippets,
  hasGroupScopeMismatch,
  deserializeSnippetCommand,
  getSnippetExecutionSecretAliases,
  getSnippetSensitivePatternKeys,
  getSnippetSecretAliases,
  maskSecretPlaceholders,
  serializeSnippetForm,
  toSnippetFormData,
  type Snippet,
  type SnippetGroup,
  type SnippetFormData,
} from '@/services/snippet.service'
import { useAuthStore } from '@/stores/auth'
import { secretService } from '@/services/secret.service'
import {
  getSnippetSecretAliasStatuses,
  hasMissingSecretAliases,
} from '@/services/snippet-secret-validation.service'
import type { SecretPublic } from '@nodeaccess/shared'
import { featuresService } from '@/services/features.service'
import { snippetPageView, setSnippetPageView } from '@/services/snippet-view-preferences.service'

const { t, tm } = useI18n()
const auth    = useAuthStore()
const message = useMessage()

// ── View mode: synced with account preferences ────────────────────────────────

const viewMode = snippetPageView
function setViewMode(mode: 'flat' | 'grouped') { setSnippetPageView(mode) }

// ── State ─────────────────────────────────────────────────────────────────────

const snippets         = ref<Snippet[]>([])
const groups           = ref<SnippetGroup[]>([])
const secrets          = ref<SecretPublic[]>([])
const loading          = ref(false)
const snippetsLicensed = ref(true)
const search           = ref('')
const scopeFilter      = ref<'ALL' | 'PERSONAL' | 'TEAM'>('ALL')
const showHelp         = ref(false)

// Snippet modal
const showModal = ref(false)
const editId    = ref<number | null>(null)
const saving    = ref(false)
const form      = ref<SnippetFormData>(toSnippetFormData())

// Collapsed groups in grouped view
const collapsedGroups = ref<Set<number | null>>(new Set())
function toggleCollapse(groupId: number | null) {
  if (collapsedGroups.value.has(groupId)) {
    collapsedGroups.value.delete(groupId)
  } else {
    collapsedGroups.value.add(groupId)
  }
  collapsedGroups.value = new Set(collapsedGroups.value)
}

// Group modal
const showGroupModal = ref(false)
const editGroupId    = ref<number | null>(null)
const savingGroup    = ref(false)
const groupForm      = ref({ name: '', description: '', scope: 'PERSONAL' as 'PERSONAL' | 'TEAM' })

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

const groupOptions = computed((): SelectOption[] => [
  { label: t('snippets.groups.noGroup'), value: null as unknown as string },
  ...groups.value.map(g => ({
    label: g.scope === 'TEAM' ? `${g.name}  ·  ${t('snippets.scopeTeam')}` : g.name,
    value: g.id,
  })),
])

const helpExamples = computed<Array<{ title: string; cmd: string; desc: string }>>(() =>
  tm('snippetsPage.help.examples') as Array<{ title: string; cmd: string; desc: string }>,
)

// ── Load ──────────────────────────────────────────────────────────────────────

async function load() {
  const features = await featuresService.get()
  snippetsLicensed.value = features.snippetsLicensed
  if (!snippetsLicensed.value) { snippets.value = []; groups.value = []; secrets.value = []; return }

  loading.value = true
  try {
    const [{ data: sRows }, { data: gRows }, { data: secRows }] = await Promise.all([
      snippetService.list(),
      snippetGroupService.list(),
      secretService.list(false),
    ])
    snippets.value = sRows
    groups.value   = gRows
    secrets.value  = secRows
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
    (s.description ?? '').toLowerCase().includes(q) ||
    (s.group?.name ?? '').toLowerCase().includes(q),
  )
  return list
})

const groupedBuckets = computed(() => groupSnippets(filtered.value, groups.value))
const personalCount  = computed(() => snippets.value.filter(s => s.scope === 'PERSONAL').length)
const teamCount      = computed(() => snippets.value.filter(s => s.scope === 'TEAM').length)

// ── Form computed ─────────────────────────────────────────────────────────────

const formSecretAliases = computed(() => {
  const dto = serializeSnippetForm(form.value)
  return getSnippetExecutionSecretAliases(deserializeSnippetCommand(dto.command))
})
const formSecretAliasStatuses     = computed(() => getSnippetSecretAliasStatuses(formSecretAliases.value, secrets.value))
const formHasMissingSecretAliases = computed(() => hasMissingSecretAliases(formSecretAliasStatuses.value))
const formSensitivePatternKeys    = computed(() => {
  const dto = serializeSnippetForm(form.value)
  return getSnippetSensitivePatternKeys(deserializeSnippetCommand(dto.command))
})
const selectedGroupScope = computed<'PERSONAL' | 'TEAM' | null>(() =>
  form.value.groupId == null ? null : (groups.value.find(g => g.id === form.value.groupId)?.scope ?? null),
)
const showScopeMismatch = computed(() => hasGroupScopeMismatch(form.value.scope, selectedGroupScope.value))

// ── Snippet CRUD ──────────────────────────────────────────────────────────────

function openCreate() {
  if (!snippetsLicensed.value) return
  editId.value = null; form.value = toSnippetFormData(); showModal.value = true
}
function openEdit(s: Snippet) {
  if (!snippetsLicensed.value) return
  editId.value = s.id; form.value = toSnippetFormData(s); showModal.value = true
}

async function save() {
  if (!snippetsLicensed.value) return
  const hasCmd = form.value.kind === 'COMMAND' ? form.value.command.trim().length > 0
    : form.value.kind === 'SEQUENCE' ? form.value.stepsText.trim().length > 0
    : form.value.expectSendText.trim().length > 0
  if (!form.value.name.trim() || !hasCmd) return
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
  } catch { message.error(t('snippets.saveError')) }
  finally { saving.value = false }
}

async function remove(s: Snippet) {
  if (!snippetsLicensed.value) return
  if (!window.confirm(t('snippets.deleteConfirm', { name: s.name }))) return
  try { await snippetService.remove(s.id); await load(); message.success(t('snippets.deleted')) }
  catch { message.error(t('snippets.deleteError')) }
}

function isOwner(s: Snippet) { return s.createdBy.id === Number(auth.user?.id ?? -1) }

// ── Group CRUD ────────────────────────────────────────────────────────────────

function openCreateGroup() {
  editGroupId.value = null
  groupForm.value   = { name: '', description: '', scope: 'PERSONAL' }
  showGroupModal.value = true
}
function openEditGroup(g: SnippetGroup) {
  editGroupId.value = g.id
  groupForm.value   = { name: g.name, description: g.description ?? '', scope: g.scope }
  showGroupModal.value = true
}

async function saveGroup() {
  if (!groupForm.value.name.trim()) return
  savingGroup.value = true
  try {
    const dto = { name: groupForm.value.name.trim(), description: groupForm.value.description.trim() || null, scope: groupForm.value.scope }
    if (editGroupId.value !== null) {
      await snippetGroupService.update(editGroupId.value, dto); message.success(t('snippets.groups.updated'))
    } else {
      await snippetGroupService.create(dto); message.success(t('snippets.groups.created'))
    }
    showGroupModal.value = false; await load()
  } catch (err: any) {
    message.error(err?.response?.data?.code === 'SNIPPET_GROUP_DUPLICATE'
      ? t('snippets.groups.duplicateError') : t('snippets.groups.saveError'))
  } finally { savingGroup.value = false }
}

async function removeGroup(g: SnippetGroup) {
  if (!window.confirm(t('snippets.groups.deleteConfirm', { name: g.name }))) return
  try { await snippetGroupService.remove(g.id); await load(); message.success(t('snippets.groups.deleted')) }
  catch { message.error(t('snippets.groups.deleteError')) }
}

function isGroupOwner(g: SnippetGroup) { return g.createdById === Number(auth.user?.id ?? -1) }

// ── Helpers ───────────────────────────────────────────────────────────────────

function snippetKind(s: Snippet) { return deserializeSnippetCommand(s.command).kind }
function snippetPreview(s: Snippet): string {
  const p = deserializeSnippetCommand(s.command)
  if (p.kind === 'SEQUENCE')    return maskSecretPlaceholders(p.steps.join('\n'))
  if (p.kind === 'EXPECT_SEND') return maskSecretPlaceholders(p.expectSteps.map(x => `${x.expect} => ${x.send}`).join('\n'))
  return maskSecretPlaceholders(p.command)
}
function snippetSecretAliases(s: Snippet) { return getSnippetSecretAliases(s) }
function snippetStepCount(s: Snippet): number {
  const p = deserializeSnippetCommand(s.command)
  return p.kind === 'SEQUENCE' ? p.steps.length : p.kind === 'EXPECT_SEND' ? p.expectSteps.length : 1
}
</script>

<template>
  <div style="height: 100vh; overflow-y: auto; background: #101014;">
    <div class="max-w-4xl mx-auto px-6 py-8 space-y-6">

      <!-- Header -->
      <div class="flex items-start justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold text-white">{{ $t('snippetsPage.title') }}</h1>
          <p class="text-gray-400 mt-1 text-sm">{{ $t('snippetsPage.subtitle') }}</p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <NButton size="small" :disabled="!snippetsLicensed" @click="openCreateGroup">
            + {{ $t('snippets.groups.new') }}
          </NButton>
          <NButton type="primary" :disabled="!snippetsLicensed" @click="openCreate">
            + {{ $t('snippets.new') }}
          </NButton>
        </div>
      </div>

      <NAlert v-if="!snippetsLicensed" type="warning" :show-icon="true" style="border-radius:12px;">
        <template #header>{{ $t('snippetsPage.license.title') }}</template>
        {{ $t('snippetsPage.license.description') }}
      </NAlert>

      <!-- Help -->
      <div v-if="snippetsLicensed" class="rounded-xl border border-gray-800 bg-[#111113] overflow-hidden">
        <button class="w-full flex items-center justify-between px-5 py-3.5 text-left" @click="showHelp = !showHelp">
          <span class="text-sm font-semibold text-gray-200">{{ $t('snippetsPage.help.title') }}</span>
          <span class="text-gray-500 text-xs">{{ showHelp ? '▲' : '▼' }}</span>
        </button>
        <div v-if="showHelp" class="border-t border-gray-800">
          <div class="px-5 py-4 space-y-4">
            <p class="text-sm text-gray-400">{{ $t('snippetsPage.help.desc') }}</p>
            <div>
              <p class="text-xs font-semibold text-gray-300 mb-2">{{ $t('snippetsPage.help.examplesTitle') }}</p>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div v-for="(ex, i) in helpExamples" :key="i" class="rounded-lg border border-gray-700 bg-[#0d0d0f] p-3 space-y-1">
                  <p class="text-xs font-medium text-gray-300">{{ ex.title }}</p>
                  <pre class="text-[11px] text-green-400 font-mono whitespace-pre-wrap">{{ ex.cmd }}</pre>
                  <p class="text-[11px] text-gray-500 leading-relaxed">{{ ex.desc }}</p>
                </div>
              </div>
            </div>
            <div class="rounded-lg bg-[#0d0d0f] p-4 space-y-2">
              <p class="text-xs font-semibold text-gray-300 mb-1">{{ $t('snippetsPage.help.flowTitle') }}</p>
              <div v-for="n in 3" :key="n" class="flex items-start gap-3 text-xs text-gray-400">
                <span class="shrink-0 w-5 h-5 rounded-full bg-blue-900 text-blue-300 flex items-center justify-center text-[10px] font-bold mt-0.5">{{ n }}</span>
                <p>{{ $t(`snippetsPage.help.flow${n}`) }}</p>
              </div>
            </div>
            <div class="rounded-lg bg-[#0d0d0f] px-4 py-3 space-y-1 text-xs text-gray-500">
              <p class="font-medium text-gray-400">{{ $t('snippetsPage.help.scopeTitle') }}</p>
              <p><span class="text-indigo-400 font-medium">{{ $t('snippets.scopeTeam') }}</span> — {{ $t('snippetsPage.help.scopeTeam') }}</p>
              <p><span class="text-gray-400 font-medium">{{ $t('snippets.scopePersonal') }}</span> — {{ $t('snippetsPage.help.scopePersonal') }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Filters + view toggle -->
      <div v-if="snippetsLicensed" class="flex items-center gap-3 flex-wrap">
        <!-- Scope filter -->
        <div class="flex rounded-lg border border-gray-700 overflow-hidden shrink-0">
          <button
            v-for="opt in [['ALL', $t('common.all'), snippets.length], ['PERSONAL', $t('snippets.scopePersonal'), personalCount], ['TEAM', $t('snippets.scopeTeam'), teamCount]] as const"
            :key="opt[0]"
            class="px-3 py-1.5 text-xs font-medium transition-colors"
            :class="[
              opt[0] !== 'ALL' && 'border-l border-gray-700',
              scopeFilter === opt[0] ? 'bg-blue-600 text-white' : 'bg-transparent text-gray-400 hover:text-gray-200',
            ]"
            @click="scopeFilter = opt[0] as any"
          >{{ opt[1] }} ({{ opt[2] }})</button>
        </div>

        <NInput v-model:value="search" :placeholder="$t('snippets.search')" size="small" clearable style="flex:1;min-width:180px;" />

        <!-- View mode toggle -->
        <NTooltip trigger="hover">
          <template #trigger>
            <div class="flex rounded-lg border border-gray-700 overflow-hidden shrink-0">
              <button
                class="px-2.5 py-1.5 text-xs transition-colors"
                :class="viewMode === 'flat' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'"
                :title="$t('snippets.groups.viewFlat')"
                @click="setViewMode('flat')"
              >≡</button>
              <button
                class="px-2.5 py-1.5 text-xs border-l border-gray-700 transition-colors"
                :class="viewMode === 'grouped' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'"
                :title="$t('snippets.groups.viewGrouped')"
                @click="setViewMode('grouped')"
              >⊞</button>
            </div>
          </template>
          {{ viewMode === 'flat' ? $t('snippets.groups.viewFlat') : $t('snippets.groups.viewGrouped') }}
        </NTooltip>
      </div>

      <!-- List -->
      <div>
        <NSpin v-if="loading" class="flex justify-center py-12" />
        <NEmpty v-else-if="!snippetsLicensed" :description="$t('snippetsPage.license.description')" class="py-12" />
        <NEmpty v-else-if="filtered.length === 0" :description="search || scopeFilter !== 'ALL' ? $t('snippets.noResults') : $t('snippets.empty')" class="py-12" />

        <!-- ── Flat view ── -->
        <div v-else-if="viewMode === 'flat'" class="space-y-2">
          <div
            v-for="s in filtered" :key="s.id"
            class="rounded-xl border border-gray-800 bg-[#111113] px-4 py-3 group hover:border-gray-700 transition-colors"
          >
            <div class="flex items-start gap-3">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap mb-1.5">
                  <span class="text-sm font-semibold text-white">{{ s.name }}</span>
                  <NTag size="tiny" :type="s.scope === 'TEAM' ? 'info' : 'default'">
                    {{ s.scope === 'TEAM' ? $t('snippets.scopeTeam') : $t('snippets.scopePersonal') }}
                  </NTag>
                  <NTag v-if="s.group" size="tiny" type="primary">
                    {{ s.group.name }}
                  </NTag>
                  <NTag size="tiny" :type="snippetKind(s) === 'SEQUENCE' ? 'success' : snippetKind(s) === 'EXPECT_SEND' ? 'warning' : 'primary'">
                    {{ snippetKind(s) === 'SEQUENCE' ? $t('snippets.kind.sequence') : snippetKind(s) === 'EXPECT_SEND' ? $t('snippets.kind.expectSend') : $t('snippets.kind.command') }}
                  </NTag>
                  <span v-if="snippetKind(s) !== 'COMMAND'" class="text-[11px] text-gray-500">{{ snippetStepCount(s) }} {{ $t('snippets.stepsShort') }}</span>
                  <NTooltip v-if="snippetSecretAliases(s).length > 0" trigger="hover">
                    <template #trigger><NTag size="tiny" type="warning">{{ $t('snippets.usesSecret') }}</NTag></template>
                    {{ $t('snippets.usesSecretAliases', { aliases: snippetSecretAliases(s).join(', ') }) }}
                  </NTooltip>
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

        <!-- ── Grouped view ── -->
        <div v-else class="space-y-4">
          <div v-for="bucket in groupedBuckets" :key="bucket.group?.id ?? 'ungrouped'">
            <!-- Group header -->
            <div
              class="flex items-center gap-2 px-3 py-2 rounded-lg mb-2 group/header cursor-pointer select-none"
              :class="bucket.group ? 'bg-[#111113] border border-gray-800' : 'bg-transparent'"
              @click="toggleCollapse(bucket.group?.id ?? null)"
            >
              <span
                class="text-xs transition-transform shrink-0"
                :class="collapsedGroups.has(bucket.group?.id ?? null) ? '-rotate-90' : ''"
              >▾</span>
              <span
                class="text-xs font-semibold flex-1"
                :class="bucket.group ? 'text-gray-200' : 'text-gray-500'"
              >
                {{ bucket.group ? bucket.group.name : $t('snippets.groups.noGroup') }}
              </span>
              <template v-if="bucket.group">
                <NTag size="tiny" :type="bucket.group.scope === 'TEAM' ? 'info' : 'default'">
                  {{ bucket.group.scope === 'TEAM' ? $t('snippets.scopeTeam') : $t('snippets.scopePersonal') }}
                </NTag>
                <span class="text-[11px] text-gray-500">{{ bucket.snippets.length }}</span>
                <template v-if="isGroupOwner(bucket.group)">
                  <NButton
                    size="tiny" text
                    class="opacity-0 group-hover/header:opacity-100 transition-opacity"
                    style="color:#9ca3af;"
                    @click.stop="openEditGroup(bucket.group!)"
                  >✏</NButton>
                  <NButton
                    size="tiny" text
                    class="opacity-0 group-hover/header:opacity-100 transition-opacity"
                    style="color:#ef4444;"
                    @click.stop="removeGroup(bucket.group!)"
                  >✕</NButton>
                </template>
              </template>
              <span v-else class="text-[11px] text-gray-600">{{ bucket.snippets.length }}</span>
            </div>

            <!-- Snippets in bucket -->
            <div v-if="!collapsedGroups.has(bucket.group?.id ?? null)" class="space-y-2 pl-3">
              <div
                v-for="s in bucket.snippets" :key="s.id"
                class="rounded-xl border border-gray-800 bg-[#111113] px-4 py-3 group hover:border-gray-700 transition-colors"
              >
                <div class="flex items-start gap-3">
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 flex-wrap mb-1.5">
                      <span class="text-sm font-semibold text-white">{{ s.name }}</span>
                      <NTag size="tiny" :type="s.scope === 'TEAM' ? 'info' : 'default'">
                        {{ s.scope === 'TEAM' ? $t('snippets.scopeTeam') : $t('snippets.scopePersonal') }}
                      </NTag>
                      <NTag size="tiny" :type="snippetKind(s) === 'SEQUENCE' ? 'success' : snippetKind(s) === 'EXPECT_SEND' ? 'warning' : 'primary'">
                        {{ snippetKind(s) === 'SEQUENCE' ? $t('snippets.kind.sequence') : snippetKind(s) === 'EXPECT_SEND' ? $t('snippets.kind.expectSend') : $t('snippets.kind.command') }}
                      </NTag>
                      <span v-if="snippetKind(s) !== 'COMMAND'" class="text-[11px] text-gray-500">{{ snippetStepCount(s) }} {{ $t('snippets.stepsShort') }}</span>
                      <NTooltip v-if="snippetSecretAliases(s).length > 0" trigger="hover">
                        <template #trigger><NTag size="tiny" type="warning">{{ $t('snippets.usesSecret') }}</NTag></template>
                        {{ $t('snippets.usesSecretAliases', { aliases: snippetSecretAliases(s).join(', ') }) }}
                      </NTooltip>
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

    </div>
  </div>

  <!-- ── Modal snippet ─────────────────────────────────────────────────────────── -->
  <NModal
    v-if="snippetsLicensed"
    v-model:show="showModal"
    preset="card"
    style="max-width:520px;"
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
        <NInput v-model:value="form.command" type="textarea" :placeholder="$t('snippets.commandPlaceholder')" :autosize="{ minRows: 3, maxRows: 8 }" style="font-family:monospace;font-size:13px;" />
      </div>
      <div v-else-if="form.kind === 'SEQUENCE'">
        <p class="text-xs text-gray-400 mb-1">{{ $t('snippets.sequenceLabel') }}</p>
        <NInput v-model:value="form.stepsText" type="textarea" :placeholder="$t('snippets.sequencePlaceholder')" :autosize="{ minRows: 4, maxRows: 10 }" style="font-family:monospace;font-size:13px;" />
      </div>
      <div v-else>
        <p class="text-xs text-gray-400 mb-1">{{ $t('snippets.expectSendLabel') }}</p>
        <NInput v-model:value="form.expectSendText" type="textarea" :placeholder="$t('snippets.expectSendPlaceholder')" :autosize="{ minRows: 4, maxRows: 10 }" style="font-family:monospace;font-size:13px;" />
      </div>
      <div>
        <p class="text-xs text-gray-400 mb-1">{{ $t('common.description') }} ({{ $t('snippetsPage.optional') }})</p>
        <NInput v-model:value="form.description" :placeholder="$t('snippets.descriptionPlaceholder')" />
      </div>
      <div class="flex gap-3">
        <div class="flex-1">
          <p class="text-xs text-gray-400 mb-1">{{ $t('snippetsPage.scope') }}</p>
          <NSelect v-model:value="form.scope" :options="scopeOptions" />
        </div>
        <div class="flex-1">
          <p class="text-xs text-gray-400 mb-1">{{ $t('snippets.groups.label') }}</p>
          <NSelect v-model:value="(form as any).groupId" :options="groupOptions" clearable :placeholder="$t('snippets.groups.selectPlaceholder')" />
        </div>
      </div>

      <!-- Scope mismatch warning -->
      <div v-if="showScopeMismatch" class="rounded-lg border border-amber-700/50 bg-amber-950/40 px-3 py-2.5 text-xs text-amber-200 space-y-1">
        <p class="font-medium">⚠ {{ $t('snippets.groups.scopeMismatchTitle') }}</p>
        <p>{{ $t('snippets.groups.scopeMismatchHint') }}</p>
      </div>

      <div v-if="formSecretAliases.length > 0" class="rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
        <p>{{ $t('snippets.usesSecretAliases', { aliases: formSecretAliases.join(', ') }) }}</p>
        <div class="mt-2 flex flex-wrap gap-1.5">
          <NTag v-for="status in formSecretAliasStatuses" :key="status.alias" size="tiny" :type="status.state === 'available' ? 'success' : 'error'">
            {{ status.alias }} · {{ status.state === 'available' ? $t('snippets.secretAliasAvailable') : $t('snippets.secretAliasMissing') }}
          </NTag>
        </div>
        <p v-if="formHasMissingSecretAliases" class="mt-2 text-amber-100">{{ $t('snippets.secretAliasMissingHint') }}</p>
      </div>
      <div v-if="formSensitivePatternKeys.length > 0" class="rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-100">
        <p class="font-medium">{{ $t('snippets.sensitivePatternWarning') }}</p>
        <p class="mt-1 text-red-200">{{ $t('snippets.sensitivePatternHint') }}</p>
      </div>
      <div class="flex justify-end gap-2 pt-2">
        <NButton @click="showModal = false">{{ $t('common.cancel') }}</NButton>
        <NButton type="primary" :loading="saving" @click="save">{{ $t('common.save') }}</NButton>
      </div>
    </div>
  </NModal>

  <!-- ── Modal grupo ───────────────────────────────────────────────────────────── -->
  <NModal
    v-if="snippetsLicensed"
    v-model:show="showGroupModal"
    preset="card"
    style="max-width:400px;"
    :title="editGroupId !== null ? $t('snippets.groups.editTitle') : $t('snippets.groups.createTitle')"
  >
    <div class="space-y-3">
      <div>
        <p class="text-xs text-gray-400 mb-1">{{ $t('common.name') }}</p>
        <NInput v-model:value="groupForm.name" :placeholder="$t('snippets.groups.namePlaceholder')" />
      </div>
      <div>
        <p class="text-xs text-gray-400 mb-1">{{ $t('snippetsPage.scope') }}</p>
        <NSelect v-model:value="groupForm.scope" :options="scopeOptions" />
        <p class="text-[11px] text-gray-500 mt-1">
          {{ groupForm.scope === 'TEAM' ? $t('snippets.groups.scopeTeamHint') : $t('snippets.groups.scopePersonalHint') }}
        </p>
      </div>
      <div>
        <p class="text-xs text-gray-400 mb-1">{{ $t('common.description') }} ({{ $t('snippetsPage.optional') }})</p>
        <NInput v-model:value="groupForm.description" :placeholder="$t('snippets.groups.descriptionPlaceholder')" />
      </div>
      <div class="flex justify-end gap-2 pt-2">
        <NButton @click="showGroupModal = false">{{ $t('common.cancel') }}</NButton>
        <NButton type="primary" :loading="savingGroup" @click="saveGroup">{{ $t('common.save') }}</NButton>
      </div>
    </div>
  </NModal>
</template>
