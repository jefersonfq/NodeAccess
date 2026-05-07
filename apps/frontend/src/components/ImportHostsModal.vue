<script setup lang="ts">
import { ref, computed, watch, h } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NModal, NCard, NTabs, NTab, NTabPane, NButton, NSpace, NInput,
  NSelect, NDataTable, NAlert, NText, NSpin, NTooltip, NCheckbox,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { hostService } from '@/services/host.service'
import { groupService } from '@/services/group.service'
import { pemKeyService } from '@/services/pem-key.service'
import { settingsService } from '@/services/settings.service'
import { useAuthStore } from '@/stores/auth'
import type { CreateHostDto, HostPublic, PemKeyPublic } from '@nodeaccess/shared'

const emit = defineEmits<{ close: []; imported: [] }>()

const { t } = useI18n()
const auth = useAuthStore()

// ── Groups ────────────────────────────────────────────────────────────────

const groupOptions = ref<{ label: string; value: number }[]>([])
groupService.list().then(({ data }) => {
  groupOptions.value = data.map(g => ({ label: g.name, value: g.id }))
})

const existingHosts = ref<HostPublic[]>([])
const existingHostsLoaded = ref(false)
const pemKeys = ref<PemKeyPublic[]>([])
const pemKeysLoaded = ref(false)
const licenseLoaded = ref(false)
const maxHostsLicensed = ref<number | null>(null)
const registeredHosts = ref<number>(0)

async function loadExistingHosts() {
  if (existingHostsLoaded.value) return
  existingHostsLoaded.value = true
  try {
    const { data } = await hostService.list({ page: 1, limit: 500 })
    existingHosts.value = data.data
  } catch {
    existingHosts.value = []
  }
}

async function loadPemKeys() {
  if (pemKeysLoaded.value) return
  pemKeysLoaded.value = true
  try {
    const { data } = await pemKeyService.list()
    pemKeys.value = data
  } catch {
    pemKeys.value = []
  }
}

async function loadLicenseSettings() {
  if (licenseLoaded.value) return
  licenseLoaded.value = true
  try {
    const { data } = await settingsService.get()
    maxHostsLicensed.value = data.license.maxHosts
    registeredHosts.value = data.license.registeredHosts
  } catch {
    maxHostsLicensed.value = null
    registeredHosts.value = 0
  }
}

// ── Parsed host row ────────────────────────────────────────────────────────

interface ParsedHost {
  key:         string   // uuid for table row key
  name:        string
  ip:          string
  port:        number
  sshUser:     string
  authType:    'password' | 'pem'
  groupName:   string
  pemKeyName:  string
  proxyJump:   string   // informational only — no auto-bastion mapping
  warnings:    string[]
  selected:    boolean
}

// ── Default scope / group for import ─────────────────────────────────────

const defaultScope = ref<'personal' | 'team' | 'global'>('personal')
const defaultGroup = ref<number | null>(null)
const createMissingGroups = ref(false)

const scopeOptions = computed(() => [
  { label: t('hosts.scopes.personal'), value: 'personal' },
  { label: t('hosts.scopes.team'),     value: 'team'     },
  { label: t('hosts.scopes.global'),   value: 'global'   },
])

const groupIdByNormalizedName = computed(() => {
  const map = new Map<string, number>()
  for (const group of groupOptions.value) {
    map.set(group.label.trim().toLowerCase(), group.value)
  }
  return map
})

const missingGroupNames = computed(() => {
  const missing = new Set<string>()
  for (const host of selected.value) {
    const groupName = host.groupName.trim()
    if (groupName && !groupIdByNormalizedName.value.has(groupName.toLowerCase())) {
      missing.add(groupName)
    }
  }
  return [...missing].sort((a, b) => a.localeCompare(b))
})

// Reset group when scope changes to personal
watch(defaultScope, (v) => { if (v === 'personal') defaultGroup.value = null })

// ── Tab: SSH Config ───────────────────────────────────────────────────────

const sshConfigText   = ref('')
const sshFileRef      = ref<HTMLInputElement | null>(null)

function parseSshConfig(content: string): ParsedHost[] {
  const hosts: ParsedHost[] = []
  let current: ParsedHost | null = null

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const spaceIdx = line.search(/\s/)
    if (spaceIdx === -1) continue
    const key   = line.slice(0, spaceIdx).toLowerCase()
    const value = line.slice(spaceIdx).trim().replace(/^["']|["']$/g, '')

    if (key === 'host') {
      if (current && !current.name.includes('*') && !current.name.includes('?') && current.ip) {
        hosts.push(current)
      }
      current = {
        key:       crypto.randomUUID(),
        name:      value,
        ip:        value,   // default; overridden by HostName
        port:      22,
        sshUser:   'root',
        authType:  'password',
        groupName: '',
        pemKeyName: '',
        proxyJump: '',
        warnings: [],
        selected:  true,
      }
    } else if (current) {
      switch (key) {
        case 'hostname':     current.ip       = value;                            break
        case 'port':         current.port     = parseInt(value) || 22;            break
        case 'user':         current.sshUser  = value;                            break
        case 'identityfile': current.authType = 'pem';                            break
        case 'proxyjump':    current.proxyJump = value.split(',')[0].trim();      break
      }
    }
  }
  if (current && !current.name.includes('*') && !current.name.includes('?') && current.ip) {
    hosts.push(current)
  }
  return hosts
}

function onSshFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (ev) => { sshConfigText.value = ev.target?.result as string ?? '' }
  reader.readAsText(file)
}

const sshParsed = computed(() => parseSshConfig(sshConfigText.value))

// ── Tab: CSV ──────────────────────────────────────────────────────────────

const csvText    = ref('')
const csvFileRef = ref<HTMLInputElement | null>(null)

const CSV_TEMPLATE = `name,ip,port,sshUser,authType,group,pemKeyName
web-prod,192.168.1.1,22,ubuntu,password,Production,
db-staging,10.0.0.5,2222,admin,pem,Database,prod-key
`

function downloadTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' })
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'nodeaccess-hosts-template.csv' })
  a.click()
  URL.revokeObjectURL(a.href)
}

function parseCsv(content: string): ParsedHost[] {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return []
  const delimiter = detectCsvDelimiter(lines[0])
  const header = parseCsvLine(lines[0], delimiter).map(h => h.trim().toLowerCase().replace(/^\uFEFF/, ''))
  const idx = (name: string) => header.indexOf(name)

  return lines.slice(1).map(line => {
    const cols = parseCsvLine(line, delimiter).map(c => c.trim())
    const get  = (name: string) => {
      const index = idx(name)
      return index >= 0 ? cols[index] ?? '' : ''
    }
    const port = parseInt(get('port')) || 22
    const rawAuth = get('authtype').toLowerCase()
    const auth = rawAuth === 'pem' ? 'pem' : 'password'
    return {
      key:       crypto.randomUUID(),
      name:      get('name') || get('ip'),
      ip:        get('ip'),
      port,
      sshUser:   get('sshuser') || get('user') || 'root',
      authType:  auth as 'password' | 'pem',
      groupName: get('group') || get('groupname') || get('team') || '',
      pemKeyName: get('pemkeyname') || get('pemkey') || '',
      proxyJump: '',
      warnings: [],
      selected:  true,
    } satisfies ParsedHost
  }).filter(h => h.ip)
}

function detectCsvDelimiter(line: string): ',' | ';' {
  let quoted = false
  let commaCount = 0
  let semicolonCount = 0

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const next = line[i + 1]
    if (char === '"' && quoted && next === '"') {
      i++
      continue
    }
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (quoted) continue
    if (char === ',') commaCount++
    if (char === ';') semicolonCount++
  }

  return semicolonCount > commaCount ? ';' : ','
}

function parseCsvLine(line: string, delimiter: ',' | ';' = ','): string[] {
  const cols: string[] = []
  let current = ''
  let quoted = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const next = line[i + 1]
    if (char === '"' && quoted && next === '"') {
      current += '"'
      i++
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === delimiter && !quoted) {
      cols.push(current)
      current = ''
    } else {
      current += char
    }
  }
  cols.push(current)
  return cols
}

function onCsvFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (ev) => { csvText.value = ev.target?.result as string ?? '' }
  reader.readAsText(file)
}

const csvParsed = computed(() => parseCsv(csvText.value))

// ── Tab: Apache Guacamole ────────────────────────────────────────────────

const guacamoleText = ref('')
const guacamoleFileRef = ref<HTMLInputElement | null>(null)
const guacamoleParseError = ref('')

function directChildText(element: Element, tagName: string): string {
  const child = Array.from(element.children).find(item => item.tagName.toLowerCase() === tagName.toLowerCase())
  return child?.textContent?.trim() ?? ''
}

function guacamoleParam(connection: Element, name: string): string {
  const normalized = name.toLowerCase()
  const param = Array.from(connection.children).find(item =>
    item.tagName.toLowerCase() === 'param'
    && (item.getAttribute('name') ?? '').trim().toLowerCase() === normalized,
  )
  return param?.textContent?.trim() ?? ''
}

function parseGuacamoleUserMapping(content: string): ParsedHost[] {
  guacamoleParseError.value = ''
  const normalizedContent = content.trim()
  if (!normalizedContent) return []

  const doc = new DOMParser().parseFromString(normalizedContent, 'application/xml')
  const parserError = doc.querySelector('parsererror')
  if (parserError) {
    guacamoleParseError.value = t('import.guacamoleParseError')
    return []
  }

  const hosts: ParsedHost[] = []
  for (const authorize of Array.from(doc.querySelectorAll('authorize'))) {
    const authorizeUser = authorize.getAttribute('username')?.trim() ?? ''
    const connections = Array.from(authorize.children).filter(item => item.tagName.toLowerCase() === 'connection')
    for (const connection of connections) {
      const protocol = directChildText(connection, 'protocol').toLowerCase()
      if (protocol !== 'ssh') continue

      const name = connection.getAttribute('name')?.trim()
        || guacamoleParam(connection, 'name')
        || guacamoleParam(connection, 'hostname')
      const ip = guacamoleParam(connection, 'hostname') || guacamoleParam(connection, 'host')
      const port = parseInt(guacamoleParam(connection, 'port')) || 22
      const sshUser = guacamoleParam(connection, 'username') || authorizeUser || 'root'
      const warnings: string[] = []

      if (guacamoleParam(connection, 'password') || guacamoleParam(connection, 'private-key') || guacamoleParam(connection, 'passphrase')) {
        warnings.push(t('import.validation.secretIgnored'))
      }

      hosts.push({
        key: crypto.randomUUID(),
        name: name || ip || t('import.guacamoleUnnamedHost'),
        ip,
        port,
        sshUser,
        authType: 'password',
        groupName: '',
        pemKeyName: '',
        proxyJump: '',
        warnings,
        selected: true,
      })
    }
  }

  return hosts
}

function onGuacamoleFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (ev) => { guacamoleText.value = ev.target?.result as string ?? '' }
  reader.readAsText(file)
}

const guacamoleParsed = computed(() => parseGuacamoleUserMapping(guacamoleText.value))

// ── Active tab → active parsed list ──────────────────────────────────────

const activeTab   = ref('ssh')
const parsedHosts = computed(() => {
  if (activeTab.value === 'ssh') return sshParsed.value
  if (activeTab.value === 'csv') return csvParsed.value
  return guacamoleParsed.value
})
const selected    = computed(() => parsedHosts.value.filter(h => h.selected))

watch(() => parsedHosts.value.length, (count) => {
  if (count > 0) {
    void loadExistingHosts()
    void loadLicenseSettings()
  }
  if (parsedHosts.value.some(host => host.authType === 'pem')) void loadPemKeys()
})

// ── Validation preview ───────────────────────────────────────────────────

type ValidationSeverity = 'error' | 'warning'
type ImportRowStatus = 'success' | 'failed' | 'skipped'

interface ValidationIssue {
  severity: ValidationSeverity
  message: string
}

interface ImportRowResult {
  key: string
  name: string
  status: ImportRowStatus
  message: string
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase()
}

function hostEndpointKey(host: Pick<ParsedHost, 'ip' | 'port'>): string {
  return `${normalizeText(host.ip)}:${host.port}`
}

const selectedNameCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const host of selected.value) {
    const key = normalizeText(host.name)
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
})

const selectedEndpointCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const host of selected.value) {
    const key = hostEndpointKey(host)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
})

const existingHostNames = computed(() => new Set(existingHosts.value.map(host => normalizeText(host.name))))
const existingHostEndpoints = computed(() => new Set(existingHosts.value.map(host => `${normalizeText(host.ip)}:${host.port}`)))
const pemKeyIdByNormalizedName = computed(() => {
  const map = new Map<string, number>()
  for (const key of pemKeys.value) {
    map.set(normalizeText(key.name), key.id)
  }
  return map
})

function getHostIssues(host: ParsedHost): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const groupName = host.groupName.trim()
  const groupExists = !groupName || groupIdByNormalizedName.value.has(groupName.toLowerCase())
  const canCreateGroup = auth.isAdmin && createMissingGroups.value

  if (!host.name.trim()) {
    issues.push({ severity: 'error', message: t('import.validation.missingName') })
  }
  if (!host.ip.trim()) {
    issues.push({ severity: 'error', message: t('import.validation.missingIp') })
  }
  for (const warning of host.warnings) {
    issues.push({ severity: 'warning', message: warning })
  }
  if (host.authType === 'pem' && !host.pemKeyName.trim()) {
    issues.push({ severity: 'error', message: t('import.validation.pemRequiresKey') })
  }
  if (host.authType === 'pem' && host.pemKeyName.trim() && !pemKeyIdByNormalizedName.value.has(normalizeText(host.pemKeyName))) {
    issues.push({ severity: 'error', message: t('import.validation.pemKeyMissing', { key: host.pemKeyName.trim() }) })
  }
  if (groupName && !groupExists && !canCreateGroup) {
    issues.push({ severity: 'error', message: t('import.validation.groupMissing', { group: groupName }) })
  }
  if ((selectedNameCounts.value.get(normalizeText(host.name)) ?? 0) > 1) {
    issues.push({ severity: 'error', message: t('import.validation.duplicateInFile') })
  }
  if ((selectedEndpointCounts.value.get(hostEndpointKey(host)) ?? 0) > 1) {
    issues.push({ severity: 'error', message: t('import.validation.duplicateEndpointInFile') })
  }
  if (existingHostNames.value.has(normalizeText(host.name))) {
    issues.push({ severity: 'warning', message: t('import.validation.duplicateExistingName') })
  }
  if (existingHostEndpoints.value.has(hostEndpointKey(host))) {
    issues.push({ severity: 'warning', message: t('import.validation.duplicateExistingEndpoint') })
  }

  return issues
}

const validationSummary = computed(() => {
  let ready = 0
  let blocked = 0
  let warnings = 0
  let pem = 0

  for (const host of selected.value) {
    const issues = getHostIssues(host)
    if (host.authType === 'pem') pem++
    if (issues.some(issue => issue.severity === 'error')) blocked++
    else ready++
    if (issues.some(issue => issue.severity === 'warning')) warnings++
  }

  return {
    selected: selected.value.length,
    ready,
    blocked,
    warnings,
    pem,
  }
})

const remainingLicenseSlots = computed(() => {
  if (maxHostsLicensed.value === null) return null
  return Math.max(0, maxHostsLicensed.value - registeredHosts.value)
})

const selectedReadyOverLicense = computed(() => {
  if (remainingLicenseSlots.value === null) return 0
  return Math.max(0, validationSummary.value.ready - remainingLicenseSlots.value)
})

// ── Table columns ─────────────────────────────────────────────────────────

const columns = computed<DataTableColumns<ParsedHost>>(() => [
  {
    key: 'selected', title: '',  width: 40,
    render: (row) => h(NCheckbox, {
      checked: row.selected,
      'onUpdate:checked': (v: boolean) => { row.selected = v },
    }),
  },
  { key: 'name',      title: t('import.columns.name'),     ellipsis: { tooltip: true } },
  { key: 'ip',        title: t('import.columns.ip'),       ellipsis: { tooltip: true } },
  { key: 'port',      title: t('import.columns.port'),     width: 70 },
  { key: 'sshUser',   title: t('import.columns.user'),     width: 100 },
  { key: 'authType',  title: t('import.columns.authType'), width: 90,
    render: (row) => h(NText, { class: row.authType === 'pem' ? 'text-yellow-400' : 'text-gray-300', style: 'font-size:12px' }, () => row.authType.toUpperCase()),
  },
  { key: 'groupName', title: t('import.columns.group'), width: 130,
    render: (row) => {
      if (!row.groupName) return h('span', '—')
      const exists = groupIdByNormalizedName.value.has(row.groupName.trim().toLowerCase())
      return h(NText, { class: exists ? 'text-emerald-300' : 'text-amber-300', style: 'font-size:12px' }, () => row.groupName)
    },
  },
  { key: 'pemKeyName', title: t('import.columns.pemKey'), width: 130,
    render: (row) => {
      if (row.authType !== 'pem') return h('span', '—')
      if (!row.pemKeyName) return h(NText, { class: 'text-red-300', style: 'font-size:12px' }, () => t('import.validation.blocked'))
      const exists = pemKeyIdByNormalizedName.value.has(normalizeText(row.pemKeyName))
      return h(NText, { class: exists ? 'text-emerald-300' : 'text-red-300', style: 'font-size:12px' }, () => row.pemKeyName)
    },
  },
  { key: 'proxyJump', title: t('import.columns.proxyJump'), width: 120,
    render: (row) => row.proxyJump
      ? h(NTooltip, { trigger: 'hover' }, {
          trigger: () => h(NText, { depth: 3, style: 'font-size:11px' }, () => `→ ${row.proxyJump}`),
          default: () => t('import.proxyJumpHint'),
        })
      : h('span', '—'),
  },
  { key: 'validation', title: t('import.columns.validation'), width: 150,
    render: (row) => {
      const issues = getHostIssues(row)
      const error = issues.find(issue => issue.severity === 'error')
      const warning = issues.find(issue => issue.severity === 'warning')
      if (error) {
        return h(NTooltip, { trigger: 'hover' }, {
          trigger: () => h(NText, { class: 'text-red-300', style: 'font-size:12px' }, () => t('import.validation.blocked')),
          default: () => issues.map(issue => issue.message).join(' • '),
        })
      }
      if (warning) {
        return h(NTooltip, { trigger: 'hover' }, {
          trigger: () => h(NText, { class: 'text-amber-300', style: 'font-size:12px' }, () => t('import.validation.warning')),
          default: () => issues.map(issue => issue.message).join(' • '),
        })
      }
      return h(NText, { class: 'text-emerald-300', style: 'font-size:12px' }, () => t('import.validation.ready'))
    },
  },
])

// ── Import ────────────────────────────────────────────────────────────────

const importing  = ref(false)
const importResult = ref<{ success: number; failed: number; skipped: number; createdGroups: number; rows: ImportRowResult[] } | null>(null)

async function ensureMissingGroups(): Promise<{ groupMap: Map<string, number>; createdGroups: number }> {
  const groupMap = new Map(groupIdByNormalizedName.value)
  let createdGroups = 0
  if (!auth.isAdmin || !createMissingGroups.value || missingGroupNames.value.length === 0) {
    return { groupMap, createdGroups }
  }

  for (const name of missingGroupNames.value) {
    try {
      const { data } = await groupService.create({ name })
      groupOptions.value = [...groupOptions.value, { label: data.name, value: data.id }]
      groupMap.set(data.name.trim().toLowerCase(), data.id)
      createdGroups++
    } catch {
      // O host que depende deste grupo sera contabilizado como falha.
    }
  }
  return { groupMap, createdGroups }
}

async function doImport() {
  if (!selected.value.length) return
  importing.value  = true
  importResult.value = null
  let success = 0, failed = 0, skipped = 0
  const rows: ImportRowResult[] = []
  const { groupMap, createdGroups } = await ensureMissingGroups()
  let remainingSlots = remainingLicenseSlots.value

  for (const h of selected.value) {
    const blockingIssues = getHostIssues(h).filter(issue => issue.severity === 'error')
    if (blockingIssues.length) {
      skipped++
      rows.push({
        key: h.key,
        name: h.name,
        status: 'skipped',
        message: blockingIssues.map(issue => issue.message).join(' • '),
      })
      continue
    }

    if (remainingSlots !== null && remainingSlots <= 0) {
      skipped++
      rows.push({
        key: h.key,
        name: h.name,
        status: 'skipped',
        message: t('import.validation.licenseLimitReachedRow'),
      })
      continue
    }

    const rowGroupName = h.groupName.trim()
    const rowGroupId = rowGroupName ? groupMap.get(rowGroupName.toLowerCase()) : undefined
    if (rowGroupName && !rowGroupId) {
      failed++
      rows.push({
        key: h.key,
        name: h.name,
        status: 'failed',
        message: t('import.validation.groupMissing', { group: rowGroupName }),
      })
      continue
    }
    const dto: CreateHostDto = {
      name:    h.name,
      ip:      h.ip,
      port:    h.port,
      accessProtocol: 'ssh',
      sshUser: h.sshUser,
      authType: h.authType,
      connectionMode: 'direct',
      scope:   rowGroupId ? 'team' : defaultScope.value,
      groupId: rowGroupId ?? defaultGroup.value ?? undefined,
      pemKeyId: h.authType === 'pem' ? pemKeyIdByNormalizedName.value.get(normalizeText(h.pemKeyName)) : undefined,
    }
    try {
      await hostService.create(dto)
      success++
      if (remainingSlots !== null) remainingSlots--
      rows.push({
        key: h.key,
        name: h.name,
        status: 'success',
        message: t('import.result.imported'),
      })
    } catch (error) {
      failed++
      const e = error as { response?: { data?: { message?: string } }; message?: string }
      rows.push({
        key: h.key,
        name: h.name,
        status: 'failed',
        message: e.response?.data?.message ?? e.message ?? t('import.result.failed'),
      })
    }
  }

  importing.value   = false
  if (maxHostsLicensed.value !== null) {
    registeredHosts.value += success
  }
  importResult.value = { success, failed, skipped, createdGroups, rows }
  emit('imported')
}
</script>

<template>
  <NModal :show="true" preset="card" :title="$t('import.title')" style="width:780px;max-height:90vh" :mask-closable="false" @close="emit('close')">
    <NTabs v-model:value="activeTab" type="line" animated>

      <!-- ── SSH Config tab ───────────────────────────────────────────── -->
      <NTabPane name="ssh" :tab="$t('import.tabSshConfig')">
        <p class="text-xs text-gray-400 mb-3">{{ $t('import.sshConfigHint') }}</p>
        <NInput
          v-model:value="sshConfigText"
          type="textarea"
          :rows="8"
          :placeholder="$t('import.sshPlaceholder')"
          class="font-mono text-xs mb-2"
        />
        <div class="flex items-center gap-2 mt-1">
          <NButton size="small" ghost @click="sshFileRef?.click()">📂 {{ $t('import.uploadFile') }}</NButton>
          <input ref="sshFileRef" type="file" accept=".conf,.config,text/plain" class="hidden" @change="onSshFileChange" />
        </div>
      </NTabPane>

      <!-- ── CSV tab ──────────────────────────────────────────────────── -->
      <NTabPane name="csv" :tab="$t('import.tabCsv')">
        <p class="text-xs text-gray-400 mb-3">{{ $t('import.csvHint') }}</p>
        <div class="flex items-center gap-2 mb-3">
          <NButton size="small" ghost @click="downloadTemplate">⬇ {{ $t('import.csvTemplate') }}</NButton>
          <NButton size="small" ghost @click="csvFileRef?.click()">📂 {{ $t('import.uploadFile') }}</NButton>
          <input ref="csvFileRef" type="file" accept=".csv,text/csv" class="hidden" @change="onCsvFileChange" />
        </div>
        <NInput
          v-model:value="csvText"
          type="textarea"
          :rows="8"
          :placeholder="$t('import.csvPlaceholder')"
          class="font-mono text-xs"
        />
      </NTabPane>

      <!-- ── Apache Guacamole tab ──────────────────────────────────────── -->
      <NTabPane name="guacamole" :tab="$t('import.tabGuacamole')">
        <p class="text-xs text-gray-400 mb-3">{{ $t('import.guacamoleHint') }}</p>
        <div class="flex items-center gap-2 mb-3">
          <NButton size="small" ghost @click="guacamoleFileRef?.click()">📂 {{ $t('import.uploadFile') }}</NButton>
          <input ref="guacamoleFileRef" type="file" accept=".xml,text/xml,application/xml" class="hidden" @change="onGuacamoleFileChange" />
        </div>
        <NInput
          v-model:value="guacamoleText"
          type="textarea"
          :rows="8"
          :placeholder="$t('import.guacamolePlaceholder')"
          class="font-mono text-xs"
        />
        <NAlert
          v-if="guacamoleParseError"
          type="error"
          class="mt-3"
          :title="guacamoleParseError"
        />
      </NTabPane>

    </NTabs>

    <!-- ── Preview ──────────────────────────────────────────────────────── -->
    <template v-if="parsedHosts.length">
      <div class="mt-5">
        <div class="flex items-center justify-between mb-2">
          <NText class="text-sm font-medium">
            {{ $t('import.parsedTitle') }}
            <span class="text-gray-500 ml-1">({{ parsedHosts.length }})</span>
          </NText>
          <NSpace size="small">
            <NButton size="tiny" text @click="parsedHosts.forEach(h => h.selected = true)">{{ $t('import.selectAll') }}</NButton>
            <NButton size="tiny" text @click="parsedHosts.forEach(h => h.selected = false)">{{ $t('import.deselectAll') }}</NButton>
          </NSpace>
        </div>
        <NDataTable
          :columns="columns"
          :data="parsedHosts"
          :row-key="(r) => r.key"
          size="small"
          :max-height="240"
          :bordered="false"
          style="font-size:12px"
        />
      </div>

      <NAlert
        :type="validationSummary.blocked > 0 ? 'warning' : 'success'"
        class="mt-3"
        :title="$t('import.validation.title')"
      >
        <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span>{{ $t('import.validation.selectedCount', { count: validationSummary.selected }) }}</span>
          <span class="text-emerald-300">{{ $t('import.validation.readyCount', { count: validationSummary.ready }) }}</span>
          <span v-if="validationSummary.blocked > 0" class="text-red-300">
            {{ $t('import.validation.blockedCount', { count: validationSummary.blocked }) }}
          </span>
          <span v-if="validationSummary.warnings > 0" class="text-amber-300">
            {{ $t('import.validation.warningCount', { count: validationSummary.warnings }) }}
          </span>
          <span v-if="validationSummary.pem > 0" class="text-yellow-300">
            {{ $t('import.validation.pemCount', { count: validationSummary.pem }) }}
          </span>
        </div>
      </NAlert>

      <NAlert
        v-if="remainingLicenseSlots !== null"
        :type="selectedReadyOverLicense > 0 ? 'warning' : 'info'"
        class="mt-3"
        :title="$t('import.license.title')"
      >
        <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span>{{ $t('import.license.registered', { count: registeredHosts }) }}</span>
          <span>{{ $t('import.license.limit', { count: maxHostsLicensed }) }}</span>
          <span class="text-cyan-300">{{ $t('import.license.remaining', { count: remainingLicenseSlots }) }}</span>
          <span v-if="selectedReadyOverLicense > 0" class="text-amber-300">
            {{ $t('import.license.overLimit', { count: selectedReadyOverLicense }) }}
          </span>
        </div>
      </NAlert>

      <!-- ── Scope / Group defaults ─────────────────────────────────────── -->
      <div class="mt-4 flex items-center gap-4 flex-wrap">
        <div class="flex items-center gap-2 min-w-0">
          <NText class="text-xs text-gray-400 shrink-0">{{ $t('import.defaultScope') }}</NText>
          <NSelect v-model:value="defaultScope" :options="scopeOptions" size="small" style="width:140px" />
        </div>
        <div v-if="defaultScope !== 'personal'" class="flex items-center gap-2 min-w-0">
          <NText class="text-xs text-gray-400 shrink-0">{{ $t('import.defaultGroup') }}</NText>
          <NSelect
            v-model:value="defaultGroup"
            :options="groupOptions"
            :placeholder="$t('import.groupOptional')"
            size="small"
            clearable
            style="width:180px"
          />
        </div>
      </div>

      <NAlert
        v-if="missingGroupNames.length"
        type="warning"
        class="mt-3"
        :title="$t('import.missingGroupsTitle', { count: missingGroupNames.length })"
      >
        <div class="text-xs leading-5">
          <div>{{ $t('import.missingGroupsHint') }}</div>
          <div class="mt-1 font-mono text-amber-200">{{ missingGroupNames.join(', ') }}</div>
          <NCheckbox v-if="auth.isAdmin" v-model:checked="createMissingGroups" class="mt-2">
            {{ $t('import.createMissingGroups') }}
          </NCheckbox>
          <div v-else class="mt-2 text-amber-200">{{ $t('import.missingGroupsNoPermission') }}</div>
        </div>
      </NAlert>
    </template>

    <NAlert v-else-if="sshConfigText || csvText || guacamoleText" type="warning" class="mt-4" :title="$t('import.noHosts')" />

    <!-- ── Import result ──────────────────────────────────────────────────── -->
    <NAlert
      v-if="importResult"
      :type="importResult.failed === 0 && importResult.skipped === 0 ? 'success' : 'warning'"
      class="mt-4"
      :title="importResult.failed === 0 && importResult.skipped === 0
        ? $t('import.successAll', { count: importResult.success })
        : $t('import.successPartial', { success: importResult.success, failed: importResult.failed + importResult.skipped })"
    >
      <NText v-if="importResult.createdGroups > 0" depth="3" class="block mt-1 text-xs">
        {{ $t('import.createdGroups', { count: importResult.createdGroups }) }}
      </NText>
      <div v-if="importResult.rows.some(row => row.status !== 'success')" class="mt-2 space-y-1 text-xs">
        <div
          v-for="row in importResult.rows.filter(row => row.status !== 'success').slice(0, 8)"
          :key="row.key"
          class="flex gap-2"
        >
          <span class="font-mono text-gray-300">{{ row.name }}</span>
          <span class="text-gray-500">-</span>
          <span :class="row.status === 'skipped' ? 'text-amber-300' : 'text-red-300'">{{ row.message }}</span>
        </div>
        <NText v-if="importResult.rows.filter(row => row.status !== 'success').length > 8" depth="3" class="block text-xs">
          {{ $t('import.result.moreRows', { count: importResult.rows.filter(row => row.status !== 'success').length - 8 }) }}
        </NText>
      </div>
    </NAlert>

    <!-- ── PPK notice ─────────────────────────────────────────────────────── -->
    <NAlert
      v-if="parsedHosts.some(h => h.authType === 'pem')"
      type="info"
      class="mt-3"
      :title="$t('import.pemNotice')"
      style="font-size:12px"
    />

    <!-- ── Footer buttons ─────────────────────────────────────────────────── -->
    <template #footer>
      <NSpace justify="end">
        <NButton @click="emit('close')">{{ $t('common.cancel') }}</NButton>
        <NButton
          type="primary"
          :loading="importing"
          :disabled="!selected.length || validationSummary.ready === 0 || importing"
          @click="doImport"
        >
          {{ importing ? $t('import.importing') : $t('import.importBtn', { count: validationSummary.ready }) }}
        </NButton>
      </NSpace>
    </template>
  </NModal>
</template>
