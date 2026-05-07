<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  NAlert, NButton, NInput, NSelect, NEmpty, NSpin, NModal, NTag, NTooltip, useMessage,
  type SelectOption,
} from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import {
  snippetService,
  snippetGroupService,
  groupSnippets,
  hasGroupScopeMismatch,
  deserializeSnippetCommand,
  getSnippetExecutionSecretAliases,
  getSnippetSensitivePatternKeys,
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
import SnippetCard, { type SnippetCardMeta } from '@/components/snippets/SnippetCard.vue'

const { t, tm } = useI18n()
const auth    = useAuthStore()
const message = useMessage()
const router  = useRouter()

// ── View mode: synced with account preferences ────────────────────────────────

const viewMode = snippetPageView
function setViewMode(mode: 'flat' | 'grouped') { setSnippetPageView(mode) }

// ── State ─────────────────────────────────────────────────────────────────────

const snippets         = ref<Snippet[]>([])
const groups           = ref<SnippetGroup[]>([])
const secrets          = ref<SecretPublic[]>([])
const loading          = ref(false)
const secretsLoading   = ref(false)
const secretsLoaded    = ref(false)
const snippetsLicensed = ref(true)
const search           = ref('')
const scopeFilter      = ref<'ALL' | 'PERSONAL' | 'TEAM'>('ALL')
const kindFilter       = ref<'ALL' | 'COMMAND' | 'SEQUENCE' | 'EXPECT_SEND'>('ALL')
const groupFilter      = ref<number | 'ALL' | 'NONE'>('ALL')
const secretFilter     = ref<'ALL' | 'WITH_SECRET' | 'WITHOUT_SECRET'>('ALL')
const showHelp         = ref(false)

// Snippet modal
const showModal = ref(false)
const editId    = ref<number | null>(null)
const saving    = ref(false)
const form      = ref<SnippetFormData>(toSnippetFormData())
const showSnippetTemplates = ref(true)
const showSecretCatalog = ref(true)
const secretCatalogSearch = ref('')

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

const filterGroupOptions = computed((): SelectOption[] => [
  { label: t('common.all'), value: 'ALL' },
  { label: t('snippets.groups.noGroup'), value: 'NONE' },
  ...groups.value.map(g => ({
    label: g.scope === 'TEAM' ? `${g.name}  ·  ${t('snippets.scopeTeam')}` : g.name,
    value: g.id,
  })),
])

const kindFilterOptions = computed((): SelectOption[] => [
  { label: t('common.all'), value: 'ALL' },
  { label: t('snippets.kind.command'), value: 'COMMAND' },
  { label: t('snippets.kind.sequence'), value: 'SEQUENCE' },
  { label: t('snippets.kind.expectSend'), value: 'EXPECT_SEND' },
])

const secretFilterOptions = computed((): SelectOption[] => [
  { label: t('common.all'), value: 'ALL' },
  { label: t('snippetsPage.filters.withSecret'), value: 'WITH_SECRET' },
  { label: t('snippetsPage.filters.withoutSecret'), value: 'WITHOUT_SECRET' },
])

const snippetTemplates = computed(() => [
  {
    key: 'disk',
    label: t('snippetsPage.templates.disk.label'),
    description: t('snippetsPage.templates.disk.description'),
    kind: 'COMMAND' as const,
    name: t('snippetsPage.templates.disk.label'),
    command: 'df -h',
  },
  {
    key: 'memory',
    label: t('snippetsPage.templates.memory.label'),
    description: t('snippetsPage.templates.memory.description'),
    kind: 'COMMAND' as const,
    name: t('snippetsPage.templates.memory.label'),
    command: 'free -m',
  },
  {
    key: 'logs',
    label: t('snippetsPage.templates.logs.label'),
    description: t('snippetsPage.templates.logs.description'),
    kind: 'COMMAND' as const,
    name: t('snippetsPage.templates.logs.label'),
    command: 'journalctl -u nginx -n 100 --no-pager',
  },
  {
    key: 'diagnostic',
    label: t('snippetsPage.templates.diagnostic.label'),
    description: t('snippetsPage.templates.diagnostic.description'),
    kind: 'SEQUENCE' as const,
    name: t('snippetsPage.templates.diagnostic.label'),
    stepsText: 'hostname\nuptime\ndf -h\nfree -m',
  },
  {
    key: 'serviceCheck',
    label: t('snippetsPage.templates.serviceCheck.label'),
    description: t('snippetsPage.templates.serviceCheck.description'),
    kind: 'SEQUENCE' as const,
    name: t('snippetsPage.templates.serviceCheck.label'),
    stepsText: 'systemctl status nginx --no-pager\njournalctl -u nginx -n 50 --no-pager',
  },
  {
    key: 'password',
    label: t('snippetsPage.templates.password.label'),
    description: t('snippetsPage.templates.password.description'),
    kind: 'EXPECT_SEND' as const,
    name: t('snippetsPage.templates.password.label'),
    expectSendText: 'Password: => {{secret:ssh-password}}',
  },
  {
    key: 'otp',
    label: t('snippetsPage.templates.otp.label'),
    description: t('snippetsPage.templates.otp.description'),
    kind: 'EXPECT_SEND' as const,
    name: t('snippetsPage.templates.otp.label'),
    expectSendText: 'OTP: => {{secret:otp-code}}',
  },
  {
    key: 'confirmYes',
    label: t('snippetsPage.templates.confirmYes.label'),
    description: t('snippetsPage.templates.confirmYes.description'),
    kind: 'EXPECT_SEND' as const,
    name: t('snippetsPage.templates.confirmYes.label'),
    expectSendText: 'Are you sure you want to continue connecting => yes',
  },
])

const currentSnippetTemplates = computed(() =>
  snippetTemplates.value.filter(template => template.kind === form.value.kind),
)

const helpExamples = computed<Array<{ title: string; cmd: string; desc: string }>>(() =>
  tm('snippetsPage.help.examples') as Array<{ title: string; cmd: string; desc: string }>,
)

// ── Load ──────────────────────────────────────────────────────────────────────

async function load() {
  loading.value = true
  try {
    const [features, { data: sRows }, { data: gRows }] = await Promise.all([
      featuresService.get(),
      snippetService.list(),
      snippetGroupService.list(),
    ])
    snippetsLicensed.value = features.snippetsLicensed
    if (!snippetsLicensed.value) {
      snippets.value = []
      groups.value   = []
      secrets.value  = []
      return
    }
    snippets.value = sRows
    groups.value   = gRows
    void loadSecrets()
  } finally {
    loading.value = false
  }
}

async function loadSecrets(force = false) {
  if (!snippetsLicensed.value || secretsLoading.value || (secretsLoaded.value && !force)) return
  secretsLoading.value = true
  try {
    const { data } = await secretService.list(false)
    secrets.value = data
    secretsLoaded.value = true
  } catch {
    secrets.value = []
    secretsLoaded.value = true
  } finally {
    secretsLoading.value = false
  }
}

onMounted(load)

// ── Filter ────────────────────────────────────────────────────────────────────

const snippetMetaById = computed(() => {
  const map = new Map<number, SnippetCardMeta & { searchText: string }>()
  for (const snippet of snippets.value) {
    const parsed = deserializeSnippetCommand(snippet.command)
    const preview = parsed.kind === 'SEQUENCE'
      ? maskSecretPlaceholders(parsed.steps.join('\n'))
      : parsed.kind === 'EXPECT_SEND'
        ? maskSecretPlaceholders(parsed.expectSteps.map((step) => `${step.expect} => ${step.send}`).join('\n'))
        : maskSecretPlaceholders(parsed.command)
    const secretAliases = getSnippetExecutionSecretAliases(parsed)
    const stepCount = parsed.kind === 'SEQUENCE'
      ? parsed.steps.length
      : parsed.kind === 'EXPECT_SEND'
        ? parsed.expectSteps.length
        : 1
    map.set(snippet.id, {
      kind: parsed.kind,
      preview,
      secretAliases,
      stepCount,
      searchText: [
        snippet.name,
        preview,
        snippet.description ?? '',
        snippet.group?.name ?? '',
        ...secretAliases,
      ].join(' ').toLowerCase(),
    })
  }
  return map
})

function snippetMeta(snippet: Snippet) {
  return snippetMetaById.value.get(snippet.id)
}

const filtered = computed(() => {
  let list = snippets.value
  if (scopeFilter.value !== 'ALL') list = list.filter(s => s.scope === scopeFilter.value)
  if (kindFilter.value !== 'ALL') list = list.filter(s => snippetMeta(s)?.kind === kindFilter.value)
  if (groupFilter.value === 'NONE') list = list.filter(s => s.groupId == null)
  else if (groupFilter.value !== 'ALL') list = list.filter(s => s.groupId === groupFilter.value)
  if (secretFilter.value === 'WITH_SECRET') list = list.filter(s => (snippetMeta(s)?.secretAliases.length ?? 0) > 0)
  if (secretFilter.value === 'WITHOUT_SECRET') list = list.filter(s => (snippetMeta(s)?.secretAliases.length ?? 0) === 0)
  const q = search.value.toLowerCase()
  if (q) list = list.filter(s => snippetMeta(s)?.searchText.includes(q))
  return list
})

const groupedBuckets = computed(() => groupSnippets(filtered.value, groups.value))
const personalCount  = computed(() => snippets.value.filter(s => s.scope === 'PERSONAL').length)
const teamCount      = computed(() => snippets.value.filter(s => s.scope === 'TEAM').length)
const secretCount     = computed(() => snippets.value.filter(s => (snippetMeta(s)?.secretAliases.length ?? 0) > 0).length)
const sequenceCount   = computed(() => snippets.value.filter(s => snippetMeta(s)?.kind !== 'COMMAND').length)
const activeFilterCount = computed(() =>
  (scopeFilter.value !== 'ALL' ? 1 : 0) +
  (kindFilter.value !== 'ALL' ? 1 : 0) +
  (groupFilter.value !== 'ALL' ? 1 : 0) +
  (secretFilter.value !== 'ALL' ? 1 : 0) +
  (search.value.trim() ? 1 : 0),
)

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
const activeSecrets = computed(() => secrets.value.filter(secret => !secret.revokedAt))
const filteredActiveSecrets = computed(() => {
  const query = secretCatalogSearch.value.trim().toLowerCase()
  if (!query) return activeSecrets.value
  return activeSecrets.value.filter(secret =>
    secret.alias.toLowerCase().includes(query)
    || (secret.description ?? '').toLowerCase().includes(query)
    || secret.scope.toLowerCase().includes(query),
  )
})
const snippetFormPreview = computed(() => {
  const dto = serializeSnippetForm(form.value)
  const parsed = deserializeSnippetCommand(dto.command)
  if (parsed.kind === 'SEQUENCE') return maskSecretPlaceholders(parsed.steps.join('\n'))
  if (parsed.kind === 'EXPECT_SEND') {
    return maskSecretPlaceholders(parsed.expectSteps.map(step => `${step.expect} => ${step.send}`).join('\n'))
  }
  return maskSecretPlaceholders(parsed.command)
})
const hasSnippetFormPreview = computed(() => snippetFormPreview.value.trim().length > 0)
const selectedGroupScope = computed<'PERSONAL' | 'TEAM' | null>(() =>
  form.value.groupId == null ? null : (groups.value.find(g => g.id === form.value.groupId)?.scope ?? null),
)
const showScopeMismatch = computed(() => hasGroupScopeMismatch(form.value.scope, selectedGroupScope.value))

// ── Snippet CRUD ──────────────────────────────────────────────────────────────

function openCreate() {
  if (!snippetsLicensed.value) return
  void loadSecrets()
  editId.value = null; form.value = toSnippetFormData(); showSnippetTemplates.value = true; showSecretCatalog.value = true; secretCatalogSearch.value = ''; showModal.value = true
}
function openEdit(s: Snippet) {
  if (!snippetsLicensed.value) return
  void loadSecrets()
  editId.value = s.id; form.value = toSnippetFormData(s); showSnippetTemplates.value = false; showSecretCatalog.value = true; secretCatalogSearch.value = ''; showModal.value = true
}

function applyTemplate(template: (typeof snippetTemplates.value)[number]) {
  form.value.name = template.name
  form.value.kind = template.kind
  form.value.description = template.description
  if (template.kind === 'SEQUENCE') {
    form.value.command = ''
    form.value.expectSendText = ''
    form.value.stepsText = template.stepsText
  } else if (template.kind === 'EXPECT_SEND') {
    form.value.command = ''
    form.value.stepsText = ''
    form.value.expectSendText = template.expectSendText
  } else {
    form.value.command = template.command
    form.value.stepsText = ''
    form.value.expectSendText = ''
  }
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

async function copySnippet(s: Snippet) {
  await navigator.clipboard.writeText(snippetMeta(s)?.preview ?? snippetPreview(s))
  message.success(t('snippetsPage.copied'))
}

async function duplicateSnippet(s: Snippet) {
  if (!snippetsLicensed.value) return
  try {
    const dto = serializeSnippetForm(toSnippetFormData(s))
    await snippetService.create({
      ...dto,
      name: t('snippetsPage.copyName', { name: s.name }),
    })
    await load()
    message.success(t('snippetsPage.duplicated'))
  } catch {
    message.error(t('snippets.saveError'))
  }
}

function clearFilters() {
  search.value = ''
  scopeFilter.value = 'ALL'
  kindFilter.value = 'ALL'
  groupFilter.value = 'ALL'
  secretFilter.value = 'ALL'
}

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

function snippetPreview(s: Snippet): string {
  const p = deserializeSnippetCommand(s.command)
  if (p.kind === 'SEQUENCE')    return maskSecretPlaceholders(p.steps.join('\n'))
  if (p.kind === 'EXPECT_SEND') return maskSecretPlaceholders(p.expectSteps.map(x => `${x.expect} => ${x.send}`).join('\n'))
  return maskSecretPlaceholders(p.command)
}

function secretPlaceholder(alias: string) {
  return `{{secret:${alias}}}`
}

function appendWithSeparator(current: string, value: string, separator: string) {
  const trimmedRight = current.replace(/\s+$/, '')
  return trimmedRight ? `${trimmedRight}${separator}${value}` : value
}

function insertSecretPlaceholder(alias: string) {
  const placeholder = secretPlaceholder(alias)
  if (form.value.kind === 'COMMAND') {
    form.value.command = appendWithSeparator(form.value.command, placeholder, ' ')
    return
  }
  if (form.value.kind === 'SEQUENCE') {
    form.value.stepsText = appendWithSeparator(form.value.stepsText, placeholder, '\n')
    return
  }
  form.value.expectSendText = appendWithSeparator(form.value.expectSendText, `Password: => ${placeholder}`, '\n')
}

async function copySecretPlaceholder(alias: string) {
  await navigator.clipboard.writeText(secretPlaceholder(alias))
  message.success(t('snippets.secretVariableCopied'))
}
</script>

<template>
  <div>
  <div class="p-6">
    <div class="max-w-4xl mx-auto px-6 py-8 space-y-6">

      <!-- Header -->
      <div class="flex items-start justify-between gap-4">
        <div>
          <h1 class="text-xl font-semibold text-white">{{ $t('snippetsPage.title') }}</h1>
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

      <div v-if="snippetsLicensed" class="snippet-summary-grid">
        <div class="snippet-summary-card">
          <span>{{ $t('snippetsPage.summary.total') }}</span>
          <strong>{{ snippets.length }}</strong>
        </div>
        <div class="snippet-summary-card">
          <span>{{ $t('snippetsPage.summary.team') }}</span>
          <strong>{{ teamCount }}</strong>
        </div>
        <div class="snippet-summary-card">
          <span>{{ $t('snippetsPage.summary.secrets') }}</span>
          <strong>{{ secretCount }}</strong>
        </div>
        <div class="snippet-summary-card">
          <span>{{ $t('snippetsPage.summary.automations') }}</span>
          <strong>{{ sequenceCount }}</strong>
        </div>
      </div>

      <!-- Help -->
      <div v-if="snippetsLicensed" class="na-panel rounded-xl border overflow-hidden">
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
                <div v-for="(ex, i) in helpExamples" :key="i" class="na-code rounded-lg border p-3 space-y-1">
                  <p class="text-xs font-medium text-gray-300">{{ ex.title }}</p>
                  <pre class="text-[11px] text-green-400 font-mono whitespace-pre-wrap">{{ ex.cmd }}</pre>
                  <p class="text-[11px] text-gray-500 leading-relaxed">{{ ex.desc }}</p>
                </div>
              </div>
            </div>
            <div class="na-code rounded-lg p-4 space-y-2">
              <p class="text-xs font-semibold text-gray-300 mb-1">{{ $t('snippetsPage.help.flowTitle') }}</p>
              <div v-for="n in 3" :key="n" class="flex items-start gap-3 text-xs text-gray-400">
                <span class="shrink-0 w-5 h-5 rounded-full bg-blue-900 text-blue-300 flex items-center justify-center text-[10px] font-bold mt-0.5">{{ n }}</span>
                <p>{{ $t(`snippetsPage.help.flow${n}`) }}</p>
              </div>
            </div>
            <div class="na-code rounded-lg px-4 py-3 space-y-1 text-xs text-gray-500">
              <p class="font-medium text-gray-400">{{ $t('snippetsPage.help.scopeTitle') }}</p>
              <p><span class="text-indigo-400 font-medium">{{ $t('snippets.scopeTeam') }}</span> — {{ $t('snippetsPage.help.scopeTeam') }}</p>
              <p><span class="text-gray-400 font-medium">{{ $t('snippets.scopePersonal') }}</span> — {{ $t('snippetsPage.help.scopePersonal') }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Filters + view toggle -->
      <div v-if="snippetsLicensed" class="snippet-filter-panel">
        <!-- Scope filter -->
        <div class="snippet-filter-row">
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

          <NInput v-model:value="search" :placeholder="$t('snippets.search')" size="small" clearable style="flex:1;min-width:220px;" />

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

        <div class="snippet-filter-row">
          <label class="snippet-filter-field">
            <span>{{ $t('snippets.kind.label') }}</span>
            <NSelect v-model:value="kindFilter" :options="kindFilterOptions" size="small" />
          </label>
          <label class="snippet-filter-field">
            <span>{{ $t('snippets.groups.label') }}</span>
            <NSelect v-model:value="groupFilter" :options="filterGroupOptions" size="small" />
          </label>
          <label class="snippet-filter-field">
            <span>{{ $t('snippetsPage.filters.secrets') }}</span>
            <NSelect v-model:value="secretFilter" :options="secretFilterOptions" size="small" />
          </label>
          <NButton v-if="activeFilterCount > 0" size="small" secondary @click="clearFilters">
            {{ $t('snippetsPage.filters.clear') }}
          </NButton>
        </div>
      </div>

      <!-- List -->
      <div>
        <NSpin v-if="loading" class="flex justify-center py-12" />
        <NEmpty v-else-if="!snippetsLicensed" :description="$t('snippetsPage.license.description')" class="py-12" />
        <NEmpty v-else-if="filtered.length === 0" :description="activeFilterCount > 0 ? $t('snippets.noResults') : $t('snippets.empty')" class="py-12">
          <template #extra>
            <div class="flex items-center gap-2 justify-center">
              <NButton v-if="activeFilterCount > 0" size="small" @click="clearFilters">{{ $t('snippetsPage.filters.clear') }}</NButton>
              <NButton v-else type="primary" size="small" @click="openCreate">{{ $t('snippets.new') }}</NButton>
            </div>
          </template>
        </NEmpty>

        <!-- ── Flat view ── -->
        <div v-else-if="viewMode === 'flat'" class="space-y-2">
          <SnippetCard
            v-for="s in filtered" :key="s.id"
            :snippet="s"
            :meta="snippetMeta(s)"
            :owner="isOwner(s)"
            show-group
            @copy="copySnippet"
            @duplicate="duplicateSnippet"
            @edit="openEdit"
            @remove="remove"
          />
        </div>

        <!-- ── Grouped view ── -->
        <div v-else class="space-y-4">
          <div v-for="bucket in groupedBuckets" :key="bucket.group?.id ?? 'ungrouped'">
            <!-- Group header -->
            <div
              class="flex items-center gap-2 px-3 py-2 rounded-lg mb-2 group/header cursor-pointer select-none"
              :class="bucket.group ? 'na-panel border' : 'bg-transparent'"
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
              <SnippetCard
                v-for="s in bucket.snippets" :key="s.id"
                :snippet="s"
                :meta="snippetMeta(s)"
                :owner="isOwner(s)"
                @copy="copySnippet"
                @duplicate="duplicateSnippet"
                @edit="openEdit"
                @remove="remove"
              />
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
    style="width:min(720px, calc(100vw - 32px));"
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
      <div v-if="editId === null" class="snippet-template-strip">
        <button
          type="button"
          class="snippet-template-header"
          :aria-expanded="showSnippetTemplates"
          :aria-label="$t('snippetsPage.templates.title')"
          @click="showSnippetTemplates = !showSnippetTemplates"
        >
          <div>
            <p class="text-xs font-semibold text-gray-300">{{ $t('snippetsPage.templates.title') }}</p>
            <p class="text-[11px] text-gray-500">{{ $t('snippetsPage.templates.hint') }}</p>
          </div>
          <span class="text-xs text-gray-500">{{ showSnippetTemplates ? '▲' : '▼' }}</span>
        </button>
        <div v-if="showSnippetTemplates" class="snippet-template-list">
          <button
            v-for="template in currentSnippetTemplates"
            :key="template.key"
            type="button"
            class="snippet-template-button"
            @click="applyTemplate(template)"
          >
            <span>{{ template.label }}</span>
            <small>{{ template.description }}</small>
          </button>
        </div>
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

      <div class="snippet-secret-catalog">
        <button
          type="button"
          class="snippet-secret-catalog-header"
          :aria-expanded="showSecretCatalog"
          :aria-label="$t('snippets.secretVariablesTitle')"
          @click="showSecretCatalog = !showSecretCatalog"
        >
          <div>
            <p class="text-xs font-semibold text-gray-300">{{ $t('snippets.secretVariablesTitle') }}</p>
            <p class="text-[11px] text-gray-500">{{ $t('snippets.secretVariablesHint') }}</p>
          </div>
          <span class="text-xs text-gray-500">{{ showSecretCatalog ? '▲' : '▼' }}</span>
        </button>

        <template v-if="showSecretCatalog">
          <div class="snippet-secret-toolbar">
            <NInput
              v-model:value="secretCatalogSearch"
              size="small"
              clearable
              :placeholder="$t('snippets.secretVariableSearch')"
            />
            <NButton size="small" secondary @click="router.push({ name: 'secrets' })">
              {{ $t('snippets.openSecrets') }}
            </NButton>
          </div>

          <div v-if="secretsLoading" class="py-4 flex justify-center">
            <NSpin size="small" />
          </div>

          <div v-else-if="activeSecrets.length && filteredActiveSecrets.length" class="snippet-secret-list">
            <div v-for="secret in filteredActiveSecrets" :key="secret.id" class="snippet-secret-item">
              <div class="min-w-0">
                <div class="flex min-w-0 items-center gap-2">
                  <code class="snippet-secret-code">{{ secretPlaceholder(secret.alias) }}</code>
                  <NTag size="tiny" :type="secret.scope === 'TENANT' ? 'info' : secret.scope === 'GROUP' ? 'warning' : 'default'">
                    {{ $t(`secrets.scopes.${secret.scope}`) }}
                  </NTag>
                </div>
                <p v-if="secret.description" class="mt-1 truncate text-[11px] text-gray-500">{{ secret.description }}</p>
              </div>
              <div class="flex shrink-0 items-center gap-1">
                <NButton size="tiny" secondary @click="copySecretPlaceholder(secret.alias)">
                  {{ $t('snippets.copySecretVariable') }}
                </NButton>
                <NButton size="tiny" type="primary" secondary @click="insertSecretPlaceholder(secret.alias)">
                  {{ $t('snippets.insertSecretVariable') }}
                </NButton>
              </div>
            </div>
          </div>

          <div v-else class="snippet-secret-empty">
            <p>{{ activeSecrets.length ? $t('snippets.noSecretVariablesFound') : $t('snippets.noSecretVariables') }}</p>
            <NButton v-if="!activeSecrets.length" size="tiny" secondary @click="router.push({ name: 'secrets' })">
              {{ $t('secrets.new') }}
            </NButton>
          </div>
        </template>
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

      <div v-if="hasSnippetFormPreview" class="snippet-form-preview">
        <div class="snippet-form-preview__header">
          <p>{{ $t('snippets.previewTitle') }}</p>
          <span>{{ $t('snippets.previewMasked') }}</span>
        </div>
        <pre>{{ snippetFormPreview }}</pre>
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
  </div>
</template>

<style scoped>
.snippet-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.snippet-summary-card {
  display: grid;
  gap: 4px;
  padding: 14px 16px;
  border: 1px solid var(--na-border);
  border-radius: 8px;
  background: var(--na-surface-soft);
}

.snippet-summary-card span {
  color: var(--na-text-muted);
  font-size: 12px;
}

.snippet-summary-card strong {
  color: var(--na-text-strong);
  font-size: 22px;
  line-height: 1.1;
}

.snippet-filter-panel {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--na-border);
  border-radius: 8px;
  background: var(--na-surface-soft);
}

.snippet-filter-row {
  display: flex;
  align-items: end;
  gap: 12px;
  flex-wrap: wrap;
}

.snippet-filter-field {
  display: grid;
  gap: 4px;
  min-width: 180px;
  flex: 1;
}

.snippet-filter-field span {
  color: var(--na-text-muted);
  font-size: 11px;
}

.snippet-template-strip {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--na-border);
  border-radius: 8px;
  background: var(--na-surface-soft);
}

.snippet-template-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  text-align: left;
}

.snippet-template-header:focus-visible {
  border-radius: 6px;
  outline: 2px solid #60a5fa;
  outline-offset: 3px;
}

.snippet-template-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.snippet-template-button {
  display: grid;
  gap: 3px;
  min-height: 56px;
  padding: 9px 10px;
  border: 1px solid var(--na-border);
  border-radius: 6px;
  background: var(--na-surface);
  text-align: left;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.snippet-template-button:hover,
.snippet-template-button:focus-visible {
  border-color: #60a5fa;
  background: var(--na-sidebar-hover);
  outline: none;
}

.snippet-template-button span {
  color: var(--na-text-strong);
  font-size: 12px;
  font-weight: 600;
}

.snippet-template-button small {
  color: var(--na-text-muted);
  font-size: 11px;
  line-height: 1.25;
}

.snippet-secret-catalog {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--na-border);
  border-radius: 8px;
  background: var(--na-surface-soft);
}

.snippet-secret-catalog-header,
.snippet-secret-item,
.snippet-secret-empty {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.snippet-secret-catalog-header {
  width: 100%;
  text-align: left;
}

.snippet-secret-catalog-header:focus-visible {
  border-radius: 6px;
  outline: 2px solid #60a5fa;
  outline-offset: 3px;
}

.snippet-secret-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.snippet-secret-list {
  display: grid;
  gap: 8px;
  max-height: 180px;
  overflow: auto;
  padding-right: 2px;
}

.snippet-secret-item {
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid var(--na-border);
  border-radius: 6px;
  background: var(--na-surface);
}

.snippet-secret-code {
  min-width: 0;
  overflow: hidden;
  color: #86efac;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.snippet-secret-empty {
  padding: 9px 10px;
  border: 1px dashed var(--na-border-strong);
  border-radius: 6px;
  color: var(--na-text-muted);
  font-size: 12px;
}

.snippet-form-preview {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid #1f3b2c;
  border-radius: 8px;
  background: rgba(16, 185, 129, 0.08);
}

.snippet-form-preview__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.snippet-form-preview__header p {
  margin: 0;
  color: #d1fae5;
  font-size: 12px;
  font-weight: 600;
}

.snippet-form-preview__header span {
  color: #6ee7b7;
  font-size: 11px;
}

.snippet-form-preview pre {
  max-height: 160px;
  margin: 0;
  overflow: auto;
  padding: 8px;
  border-radius: 6px;
  background: var(--na-surface-code);
  color: #86efac;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 900px) {
  .snippet-summary-grid,
  .snippet-template-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .snippet-summary-grid,
  .snippet-template-list {
    grid-template-columns: 1fr;
  }

  .snippet-filter-field {
    min-width: 100%;
  }

  .snippet-secret-catalog-header,
  .snippet-secret-item,
  .snippet-secret-empty {
    align-items: stretch;
    flex-direction: column;
  }

  .snippet-secret-toolbar {
    grid-template-columns: 1fr;
  }
}
</style>
