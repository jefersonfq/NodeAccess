<script setup lang="ts">
import { ref, computed, watch, h } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NModal, NCard, NTabs, NTab, NTabPane, NButton, NSpace, NInput,
  NSelect, NDataTable, NAlert, NText, NSpin, NTooltip, NCheckbox,
  NTag,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { hostService } from '@/services/host.service'
import { hostImportService } from '@/services/host-import.service'
import { groupService } from '@/services/group.service'
import { pemKeyService } from '@/services/pem-key.service'
import { settingsService } from '@/services/settings.service'
import { inventoryService } from '@/services/inventory.service'
import { inventoryAclService } from '@/services/inventory-acl.service'
import { anonymizeGuacamoleImport, parseGuacamoleExport } from '@/services/guacamole-import.service'
import { useAuthStore } from '@/stores/auth'
import InventoryAclDrawer from '@/components/InventoryAclDrawer.vue'
import type {
  CreateHostDto,
  GuacamoleImportPreviewResponse,
  HostAccessProtocol,
  HostPublic,
  InventoryAclEntryPublic,
  InventoryNodePublic,
  PemKeyPublic,
} from '@nodeaccess/shared'

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
  accessProtocol: HostAccessProtocol
  sshUser:     string
  authType:    'password' | 'pem'
  groupName:   string
  pemKeyName:  string
  proxyJump:   string   // informational only — no auto-bastion mapping
  folderPath:  string[]
  warnings:    string[]
  selected:    boolean
}

// ── Corporate inventory destination / ACL for import ─────────────────────

const createMissingGroups = ref(false)
const inventoryNodes = ref<InventoryNodePublic[]>([])
const inventoryDestinationId = ref<number | null>(null)
const inventoryLoading = ref(true)
const inventoryError = ref('')
const destinationAclEntries = ref<InventoryAclEntryPublic[]>([])
const destinationAclLoading = ref(false)
const showDestinationAcl = ref(false)

const inventoryDestination = computed(() =>
  inventoryNodes.value.find(node => node.id === inventoryDestinationId.value) ?? null,
)
const destinationLocalAclEntries = computed(() => destinationAclEntries.value.filter(entry => entry.local))
const destinationInheritedAclEntries = computed(() => destinationAclEntries.value.filter(entry => !entry.local))
const destinationAclPreviewEntries = computed(() => [
  ...destinationLocalAclEntries.value,
  ...destinationInheritedAclEntries.value,
])
const inventoryOptions = computed(() =>
  inventoryNodes.value
    .filter(node => node.type === 'ROOT' || node.type === 'FOLDER')
    .map(node => ({
      label: `${'  '.repeat(Math.max(0, node.depth))}${node.type === 'ROOT' ? t('import.inventoryRoot') : node.name}`,
      value: node.id,
    })),
)

function aclEntrySummary(entry: InventoryAclEntryPublic): string {
  const permissions = [
    entry.permissions.view && t('hosts.inventoryAcl.view'),
    entry.permissions.connect && t('hosts.inventoryAcl.connect'),
    entry.permissions.edit && t('hosts.inventoryAcl.edit'),
    entry.permissions.admin && t('hosts.inventoryAcl.admin'),
  ].filter(Boolean).join(', ')
  return `${entry.principalName}: ${permissions}`
}

function aclOriginLabel(entry: InventoryAclEntryPublic): string {
  if (entry.local) return t('import.aclLocal')
  return t('import.aclInheritedFrom', { name: entry.inventoryNodeName })
}

async function loadDestinationAcl() {
  if (inventoryDestinationId.value === null) {
    destinationAclEntries.value = []
    return
  }
  destinationAclLoading.value = true
  try {
    destinationAclEntries.value = (await inventoryAclService.list(inventoryDestinationId.value)).data
  } catch {
    destinationAclEntries.value = []
  } finally {
    destinationAclLoading.value = false
  }
}

async function loadInventory() {
  inventoryLoading.value = true
  inventoryError.value = ''
  try {
    inventoryNodes.value = (await inventoryService.list()).data
    const root = inventoryNodes.value.find(node => node.type === 'ROOT')
    inventoryDestinationId.value = root?.id ?? null
  } catch {
    inventoryError.value = t('import.inventoryLoadError')
  } finally {
    inventoryLoading.value = false
  }
}

void loadInventory()
watch(inventoryDestinationId, () => { void loadDestinationAcl() })

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
        accessProtocol: 'ssh',
        sshUser:   'root',
        authType:  'password',
        groupName: '',
        pemKeyName: '',
        proxyJump: '',
        folderPath: [],
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

const CSV_TEMPLATE = `name,ip,port,sshUser,authType,pemKeyName
web-prod,192.168.1.1,22,ubuntu,password,
db-staging,10.0.0.5,2222,admin,pem,prod-key
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
      accessProtocol: 'ssh',
      sshUser:   get('sshuser') || get('user') || 'root',
      authType:  auth as 'password' | 'pem',
      groupName: get('group') || get('groupname') || get('team') || '',
      pemKeyName: get('pemkeyname') || get('pemkey') || '',
      proxyJump: '',
      folderPath: [],
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
const importGuacamoleCredentials = ref(false)
const guacamoleFileRef = ref<HTMLInputElement | null>(null)
const GUACAMOLE_JDBC_TEMPLATE = {
  connectionGroups: [
    { id: 1, parentId: null, name: 'Datacenter', type: 'ORGANIZATIONAL' },
    { id: 2, parentId: 1, name: 'Produção', type: 'ORGANIZATIONAL' },
  ],
  connections: [
    { id: 10, parentId: 2, name: 'Servidor Linux', protocol: 'ssh' },
  ],
  connectionParameters: [
    { connectionId: 10, name: 'hostname', value: '192.168.1.10' },
    { connectionId: 10, name: 'port', value: '22' },
    { connectionId: 10, name: 'username', value: 'ubuntu' },
  ],
}

function downloadGuacamoleJdbcTemplate() {
  const blob = new Blob([JSON.stringify(GUACAMOLE_JDBC_TEMPLATE, null, 2)], { type: 'application/json' })
  const link = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: 'nodeaccess-guacamole-jdbc-template.json',
  })
  link.click()
  URL.revokeObjectURL(link.href)
}

function downloadAnonymizedGuacamoleSample() {
  if (!guacamoleResult.value) return
  const content = anonymizeGuacamoleImport(guacamoleResult.value)
  const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' })
  const link = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: 'nodeaccess-guacamole-anonymized-sample.json',
  })
  link.click()
  URL.revokeObjectURL(link.href)
}
const guacamoleResult = computed(() => {
  try {
    return parseGuacamoleExport(guacamoleText.value)
  } catch {
    return null
  }
})
const guacamoleParseError = computed(() =>
  guacamoleText.value.trim() && !guacamoleResult.value ? t('import.guacamoleParseError') : '',
)

const guacamoleWarningLabels: Record<string, string> = {
  'secret-ignored': 'import.validation.secretIgnored',
  'duplicate-merged': 'import.validation.guacamoleDuplicateMerged',
  'username-not-imported': 'import.validation.guacamoleAuthorizeUserIgnored',
  'parameters-not-supported': 'import.validation.guacamoleParametersIgnored',
  'balancing-group-flattened': 'import.validation.guacamoleBalancingFlattened',
  'hierarchy-unresolved': 'import.validation.guacamoleHierarchyUnresolved',
}

function onGuacamoleFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (ev) => { guacamoleText.value = ev.target?.result as string ?? '' }
  reader.readAsText(file)
}

const guacamoleParsed = computed<ParsedHost[]>(() => (guacamoleResult.value?.hosts ?? []).map(host => ({
  key: host.sourceId,
  name: host.name,
  ip: host.ip,
  port: host.port,
  accessProtocol: host.accessProtocol,
  sshUser: host.sshUser,
  authType: 'password',
  groupName: '',
  pemKeyName: '',
  proxyJump: '',
  folderPath: host.folderPath,
  warnings: host.warnings.map(warning => t(guacamoleWarningLabels[warning])),
  selected: true,
})))

const guacamoleCredentialsDetected = computed(() =>
  guacamoleResult.value?.hosts.filter(host => Boolean(host.password)).length ?? 0,
)

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

function hostEndpointKey(host: Pick<ParsedHost, 'ip' | 'port' | 'accessProtocol'>): string {
  return `${host.accessProtocol}:${normalizeText(host.ip)}:${host.port}`
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
const existingHostEndpoints = computed(() => new Set(existingHosts.value.map(host => `${host.accessProtocol}:${normalizeText(host.ip)}:${host.port}`)))
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

const hasImportedGroupColumn = computed(() =>
  parsedHosts.value.some(host => host.groupName.trim()),
)
const hasImportedHierarchy = computed(() => parsedHosts.value.some(host => host.folderPath.length))
const preserveGuacamoleHierarchy = ref(true)
const guacamoleAclTargetBySource = ref<Record<string, number | null>>({})
const serverPreview = ref<GuacamoleImportPreviewResponse | null>(null)

watch([guacamoleText, inventoryDestinationId, preserveGuacamoleHierarchy], () => {
  serverPreview.value = null
})

function folderPathKey(path: string[]): string {
  return path.map(normalizeText).join('/')
}

function findInventoryChild(parentId: number, name: string): InventoryNodePublic | undefined {
  const normalizedName = normalizeText(name)
  return inventoryNodes.value.find(node =>
    node.type === 'FOLDER' && node.parentId === parentId && normalizeText(node.name) === normalizedName,
  )
}

const missingHierarchyPaths = computed(() => {
  if (!preserveGuacamoleHierarchy.value || inventoryDestinationId.value === null) return []
  const missing = new Set<string>()
  for (const host of selected.value) {
    let parentId = inventoryDestinationId.value
    const path: string[] = []
    for (const segment of host.folderPath) {
      path.push(segment)
      const existing = findInventoryChild(parentId, segment)
      if (existing) parentId = existing.id
      else missing.add(folderPathKey(path))
    }
  }
  return [...missing]
})

// ── Table columns ─────────────────────────────────────────────────────────

const columns = computed<DataTableColumns<ParsedHost>>(() => {
  const tableColumns: DataTableColumns<ParsedHost> = [
    {
      key: 'selected', title: '',  width: 40,
      render: (row) => h(NCheckbox, {
        checked: row.selected,
        'onUpdate:checked': (v: boolean) => { row.selected = v; serverPreview.value = null },
      }),
    },
    { key: 'name',      title: t('import.columns.name'),     ellipsis: { tooltip: true } },
    { key: 'accessProtocol', title: t('import.columns.protocol'), width: 82,
      render: (row) => h(NTag, { size: 'small', round: true }, () => row.accessProtocol.toUpperCase()),
    },
    { key: 'ip',        title: t('import.columns.ip'),       ellipsis: { tooltip: true } },
    { key: 'port',      title: t('import.columns.port'),     width: 70 },
    { key: 'sshUser',   title: t('import.columns.user'),     width: 100 },
    { key: 'authType',  title: t('import.columns.authType'), width: 90,
      render: (row) => h(NText, { class: row.authType === 'pem' ? 'text-yellow-400' : 'text-gray-300', style: 'font-size:12px' }, () => row.authType.toUpperCase()),
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
  ]

  if (hasImportedGroupColumn.value) {
    tableColumns.splice(6, 0, {
      key: 'groupName',
      title: t('import.columns.legacyGroup'),
      width: 150,
      render: (row) => {
        if (!row.groupName) return h('span', '—')
        const exists = groupIdByNormalizedName.value.has(row.groupName.trim().toLowerCase())
        return h(NTooltip, { trigger: 'hover' }, {
          trigger: () => h(NText, { class: exists ? 'text-emerald-300' : 'text-amber-300', style: 'font-size:12px' }, () => row.groupName),
          default: () => t('import.legacyGroupHint'),
        })
      },
    })
  }

  if (hasImportedHierarchy.value) {
    tableColumns.splice(3, 0, {
      key: 'folderPath',
      title: t('import.columns.folderPath'),
      width: 190,
      ellipsis: { tooltip: true },
      render: row => row.folderPath.length ? row.folderPath.join(' / ') : '—',
    })
  }

  return tableColumns
})

// ── Import ────────────────────────────────────────────────────────────────

const importing  = ref(false)
const importResult = ref<{ success: number; failed: number; skipped: number; createdGroups: number; createdFolders: number; rows: ImportRowResult[] } | null>(null)

function guacamolePreviewPayload() {
  if (!guacamoleResult.value || inventoryDestinationId.value === null) return null
  return {
    destinationId: inventoryDestinationId.value,
    preserveHierarchy: preserveGuacamoleHierarchy.value,
    importCredentials: auth.isAdmin && importGuacamoleCredentials.value,
    hosts: selected.value.map(host => ({
      sourceId: host.key,
      name: host.name,
      ip: host.ip,
      port: host.port,
      accessProtocol: host.accessProtocol,
      sshUser: host.sshUser,
      ...(importGuacamoleCredentials.value
        ? { password: guacamoleResult.value?.hosts.find(item => item.sourceId === host.key)?.password }
        : {}),
      folderPath: host.folderPath,
      warnings: host.warnings,
    })),
    aclMappings: guacamoleResult.value.sourcePrincipals.flatMap(sourcePrincipal => {
      const principalId = guacamoleAclTargetBySource.value[sourcePrincipal]
      return principalId ? [{
        sourcePrincipal,
        principalType: 'GROUP' as const,
        principalId,
        folderPath: [],
        permissions: { view: true, connect: true, edit: false, admin: false },
      }] : []
    }),
    sourceStats: {
      invalidConnections: guacamoleResult.value.invalidConnections,
      unsupportedProtocols: guacamoleResult.value.unsupportedProtocols,
      unmappedPermissions: guacamoleResult.value.unmappedPermissions,
    },
  }
}

async function doGuacamoleImport() {
  const payload = guacamolePreviewPayload()
  if (!payload) return
  importing.value = true
  try {
    if (!serverPreview.value) {
      serverPreview.value = (await hostImportService.previewGuacamole(payload)).data
      return
    }
    const result = (await hostImportService.commitGuacamole({ previewId: serverPreview.value.previewId, confirm: true })).data
    importResult.value = {
      success: result.createdHosts,
      failed: result.status === 'rolled_back' ? 1 : 0,
      skipped: serverPreview.value.summary.blocked,
      createdGroups: 0,
      createdFolders: result.createdFolders,
      rows: result.rows.map(row => ({
        key: row.sourceId,
        name: row.name,
        status: row.status === 'created' ? 'success' : row.status === 'failed' ? 'failed' : 'skipped',
        message: row.message,
      })),
    }
    if (result.status === 'committed') {
      emit('imported')
      serverPreview.value = null
    }
  } catch (error) {
    const e = error as { response?: { data?: { message?: string } }; message?: string }
    const message = e.response?.data?.message ?? e.message ?? t('import.serverPreview.failed')
    importResult.value = {
      success: 0,
      failed: 1,
      skipped: 0,
      createdGroups: 0,
      createdFolders: 0,
      rows: [{ key: 'server-preview', name: t('import.title'), status: 'failed', message }],
    }
    serverPreview.value = null
  } finally {
    importing.value = false
  }
}

function downloadGuacamoleReport() {
  if (!serverPreview.value) return
  const blob = new Blob([JSON.stringify(serverPreview.value, null, 2)], { type: 'application/json' })
  const link = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `nodeaccess-guacamole-preview-${serverPreview.value.previewId}.json`,
  })
  link.click()
  URL.revokeObjectURL(link.href)
}

async function ensureHierarchyPaths(baseId: number): Promise<{ destinationByPath: Map<string, number>; createdFolders: number }> {
  const destinationByPath = new Map<string, number>()
  let createdFolders = 0
  if (!preserveGuacamoleHierarchy.value) return { destinationByPath, createdFolders }

  const paths = selected.value.map(host => host.folderPath).filter(path => path.length)
  for (const targetPath of paths) {
    let parentId = baseId
    const traversed: string[] = []
    for (const segment of targetPath) {
      traversed.push(segment)
      const key = folderPathKey(traversed)
      const knownId = destinationByPath.get(key)
      if (knownId) {
        parentId = knownId
        continue
      }
      const existing = findInventoryChild(parentId, segment)
      if (existing) {
        parentId = existing.id
      } else {
        const { data } = await inventoryService.createFolder(parentId, segment)
        inventoryNodes.value.push(data)
        parentId = data.id
        createdFolders++
      }
      destinationByPath.set(key, parentId)
    }
  }
  return { destinationByPath, createdFolders }
}

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
  if (activeTab.value === 'guacamole') return doGuacamoleImport()
  if (!selected.value.length) return
  if (inventoryDestinationId.value === null) return
  importing.value  = true
  importResult.value = null
  let success = 0, failed = 0, skipped = 0
  const rows: ImportRowResult[] = []
  const { groupMap, createdGroups } = await ensureMissingGroups()
  let remainingSlots = remainingLicenseSlots.value
  const inventoryParentId = inventoryDestinationId.value
  let destinationByPath = new Map<string, number>()
  let createdFolders = 0
  try {
    const hierarchyResult = await ensureHierarchyPaths(inventoryParentId)
    destinationByPath = hierarchyResult.destinationByPath
    createdFolders = hierarchyResult.createdFolders
  } catch (error) {
    importing.value = false
    const e = error as { response?: { data?: { message?: string } }; message?: string }
    importResult.value = {
      success: 0, failed: selected.value.length, skipped: 0, createdGroups, createdFolders,
      rows: selected.value.map(host => ({
        key: host.key,
        name: host.name,
        status: 'failed',
        message: e.response?.data?.message ?? e.message ?? t('import.hierarchyCreateError'),
      })),
    }
    return
  }

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
      accessProtocol: h.accessProtocol,
      operatingSystem: 'unknown',
      sshUser: h.sshUser,
      authType: h.authType,
      connectionMode: 'direct',
      scope: 'global',
      groupId: rowGroupId ?? undefined,
      inventoryParentId: preserveGuacamoleHierarchy.value && h.folderPath.length
        ? destinationByPath.get(folderPathKey(h.folderPath)) ?? inventoryParentId
        : inventoryParentId,
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
  importResult.value = { success, failed, skipped, createdGroups, createdFolders, rows }
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
          <NButton size="small" text @click="downloadGuacamoleJdbcTemplate">⬇ {{ $t('import.guacamoleJdbcTemplate') }}</NButton>
          <NButton v-if="guacamoleResult?.hosts.length" size="small" text @click="downloadAnonymizedGuacamoleSample">
            {{ $t('import.guacamoleAnonymizedSample') }}
          </NButton>
          <input ref="guacamoleFileRef" type="file" accept=".xml,.json,text/xml,application/xml,application/json" class="hidden" @change="onGuacamoleFileChange" />
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
        <NAlert
          v-else-if="guacamoleCredentialsDetected"
          type="warning"
          class="mt-3"
          :title="$t('import.credentials.title')"
        >
          <div class="space-y-2 text-xs leading-5">
            <p>{{ $t('import.credentials.notice', { count: guacamoleCredentialsDetected }) }}</p>
            <NCheckbox
              v-model:checked="importGuacamoleCredentials"
              :disabled="!auth.isAdmin"
              @update:checked="serverPreview = null"
            >
              {{ $t('import.credentials.optIn') }}
            </NCheckbox>
            <p v-if="!auth.isAdmin" class="text-amber-300">{{ $t('import.credentials.adminOnly') }}</p>
          </div>
        </NAlert>
        <NAlert
          v-if="guacamoleResult && (guacamoleResult.invalidConnections || guacamoleResult.unsupportedProtocols.length || guacamoleResult.unmappedPermissions)"
          type="warning"
          class="mt-3"
          :title="$t('import.guacamoleSkippedTitle')"
        >
          <div class="text-xs">
            <span v-if="guacamoleResult.invalidConnections">
              {{ $t('import.guacamoleSkippedCount', { count: guacamoleResult.invalidConnections }) }}
            </span>
            <span v-if="guacamoleResult.unsupportedProtocols.length">
              {{ $t('import.guacamoleUnsupportedProtocols', { protocols: guacamoleResult.unsupportedProtocols.join(', ') }) }}
            </span>
            <span v-if="guacamoleResult.unmappedPermissions" class="block mt-1">
              {{ $t('import.guacamolePermissionsNotice', { count: guacamoleResult.unmappedPermissions }) }}
            </span>
          </div>
        </NAlert>
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
            <NButton size="tiny" text @click="parsedHosts.forEach(h => h.selected = true); serverPreview = null">{{ $t('import.selectAll') }}</NButton>
            <NButton size="tiny" text @click="parsedHosts.forEach(h => h.selected = false); serverPreview = null">{{ $t('import.deselectAll') }}</NButton>
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

      <NAlert v-if="hasImportedHierarchy" type="info" class="mt-3" :title="$t('import.hierarchy.title')">
        <div class="text-xs leading-5">
          <NCheckbox v-model:checked="preserveGuacamoleHierarchy">
            {{ $t('import.hierarchy.preserve') }}
          </NCheckbox>
          <div class="mt-1 text-gray-400">
            {{ preserveGuacamoleHierarchy
              ? $t('import.hierarchy.preview', { count: missingHierarchyPaths.length })
              : $t('import.hierarchy.flattened') }}
          </div>
        </div>
      </NAlert>

      <NAlert
        v-if="activeTab === 'guacamole' && guacamoleResult?.sourcePrincipals.length"
        type="info"
        class="mt-3"
        :title="$t('import.aclMapping.title')"
      >
        <div class="space-y-2 text-xs">
          <div class="text-gray-400">{{ $t('import.aclMapping.hint') }}</div>
          <div v-for="principal in guacamoleResult.sourcePrincipals" :key="principal" class="grid grid-cols-2 items-center gap-2">
            <span class="truncate font-mono">{{ principal }}</span>
            <NSelect
              v-model:value="guacamoleAclTargetBySource[principal]"
              :options="groupOptions"
              clearable
              size="small"
              :placeholder="$t('import.aclMapping.none')"
              @update:value="serverPreview = null"
            />
          </div>
        </div>
      </NAlert>

      <NAlert v-if="serverPreview" type="success" class="mt-3" :title="$t('import.serverPreview.title')">
        <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span>{{ $t('import.serverPreview.ready', { count: serverPreview.summary.ready }) }}</span>
          <span>{{ $t('import.serverPreview.blocked', { count: serverPreview.summary.blocked }) }}</span>
          <span>{{ $t('import.serverPreview.folders', { count: serverPreview.summary.foldersToCreate }) }}</span>
          <span>{{ $t('import.serverPreview.acls', { count: serverPreview.summary.aclMappings }) }}</span>
          <span>{{ $t('import.serverPreview.credentials', { count: serverPreview.summary.credentialsToImport }) }}</span>
          <span>{{ $t('import.serverPreview.expires', { at: new Date(serverPreview.expiresAt).toLocaleTimeString() }) }}</span>
        </div>
        <NButton size="tiny" text class="mt-2" @click="downloadGuacamoleReport">
          {{ $t('import.serverPreview.download') }}
        </NButton>
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

      <div class="mt-4 rounded border border-gray-800 bg-[#111113] p-3">
        <NAlert type="info" :show-icon="false" class="mb-3">
          {{ $t('import.inventoryGovernanceNotice') }}
        </NAlert>
        <div class="flex flex-wrap items-end gap-3">
          <div class="min-w-[240px] flex-1">
            <NText class="mb-1 block text-xs text-gray-400">{{ $t('import.inventoryDestination') }}</NText>
            <NSelect
              v-model:value="inventoryDestinationId"
              :options="inventoryOptions"
              :loading="inventoryLoading"
              :disabled="inventoryLoading || !!inventoryError"
              filterable
              size="small"
              :placeholder="$t('import.inventoryDestinationPlaceholder')"
            />
            <NText depth="3" class="mt-1 block text-xs">
              {{ $t('import.inventoryDestinationHint') }}
            </NText>
          </div>
          <NButton
            size="small"
            secondary
            :disabled="inventoryDestinationId === null"
            @click="showDestinationAcl = true"
          >
            {{ $t('import.manageDestinationPermissions') }}
          </NButton>
        </div>
        <NAlert v-if="inventoryError" type="error" class="mt-3">
          {{ inventoryError }}
          <NButton text class="ml-2" @click="loadInventory">{{ $t('hosts.inventoryAcl.retry') }}</NButton>
        </NAlert>
        <div v-else-if="destinationAclLoading" class="mt-3 flex items-center gap-2 text-xs text-gray-400">
          <NSpin size="small" /> {{ $t('import.loadingPermissions') }}
        </div>
        <NAlert
          v-else-if="inventoryDestinationId !== null && destinationAclEntries.length === 0"
          type="warning"
          class="mt-3"
          :title="$t('import.noDestinationPermissions')"
        />
        <div v-else-if="destinationAclEntries.length" class="mt-3 space-y-3">
          <NAlert type="info" :show-icon="false">
            <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <span>{{ $t('import.aclImpactHosts', { count: validationSummary.ready }) }}</span>
              <span>{{ $t('import.aclLocalCount', { count: destinationLocalAclEntries.length }) }}</span>
              <span>{{ $t('import.aclInheritedCount', { count: destinationInheritedAclEntries.length }) }}</span>
            </div>
          </NAlert>
          <div>
            <NText class="text-xs text-gray-400">
              {{ $t('import.inheritedPermissionsPreview', { count: validationSummary.ready }) }}
            </NText>
            <div class="mt-1 space-y-1 text-xs text-gray-300">
              <div
                v-for="entry in destinationAclPreviewEntries.slice(0, 5)"
                :key="entry.id"
                class="flex flex-wrap items-center gap-2"
              >
                <NTag size="small" :type="entry.local ? 'success' : 'info'" round>
                  {{ aclOriginLabel(entry) }}
                </NTag>
                <span>{{ aclEntrySummary(entry) }}</span>
              </div>
              <div v-if="destinationAclPreviewEntries.length > 5" class="text-gray-500">
                {{ $t('import.morePermissions', { count: destinationAclPreviewEntries.length - 5 }) }}
              </div>
            </div>
          </div>
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
      <NText v-if="importResult.createdFolders > 0" depth="3" class="block mt-1 text-xs">
        {{ $t('import.hierarchy.created', { count: importResult.createdFolders }) }}
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
          :disabled="!selected.length
            || validationSummary.ready === 0
            || importing
            || inventoryDestinationId === null
            || destinationAclLoading
            || destinationAclEntries.length === 0"
          @click="doImport"
        >
          {{ importing
            ? $t('import.importing')
            : activeTab === 'guacamole' && !serverPreview
              ? $t('import.serverPreview.validate')
              : activeTab === 'guacamole'
                ? $t('import.serverPreview.confirm')
                : $t('import.importBtn', { count: validationSummary.ready }) }}
        </NButton>
      </NSpace>
    </template>

    <InventoryAclDrawer
      :show="showDestinationAcl"
      :inventory-node-id="inventoryDestinationId"
      :item-name="inventoryDestination?.type === 'ROOT' ? $t('import.inventoryRoot') : (inventoryDestination?.name ?? '')"
      @close="showDestinationAcl = false; loadDestinationAcl()"
    />
  </NModal>
</template>
