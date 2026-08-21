<script setup lang="ts">
import { ref, computed, watch, h, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NModal, NCard, NTabs, NTab, NTabPane, NButton, NSpace, NInput,
  NSelect, NDataTable, NAlert, NText, NSpin, NTooltip, NCheckbox, NInputNumber,
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
import { bastionService } from '@/services/bastion.service'
import { secretService } from '@/services/secret.service'
import { anonymizeGuacamoleImport, parseGuacamoleExport } from '@/services/guacamole-import.service'
import { parseMobaXtermSessions } from '@/services/mobaxterm-import.service'
import { buildImportSessionsPreview } from '@/services/import-sessions-preview.service'
import { detectSessionImportSource, type SessionImportSource } from '@/services/session-import-detection.service'
import { importConnectionMode, isPrivateNetworkAddress, type PrivateImportConnectionMode } from '@/services/import-network-policy.service'
import { useAuthStore } from '@/stores/auth'
import InventoryAclDrawer from '@/components/InventoryAclDrawer.vue'
import ImportSessionsTreePreview from '@/components/ImportSessionsTreePreview.vue'
import type {
  CreateHostDto,
  HostImportPreviewResponse,
  HostImportHistoryItem,
  HostAccessProtocol,
  HostPublic,
  InventoryAclEntryPublic,
  InventoryNodePublic,
  PemKeyPublic,
  BastionPublic,
  CreateBastionDto,
  SecretPublic,
} from '@nodeaccess/shared'

const emit = defineEmits<{ close: []; imported: [] }>()

const { t } = useI18n()
const auth = useAuthStore()
const universalFileRef = ref<HTMLInputElement | null>(null)
const universalDropActive = ref(false)
const detectedSourceReason = ref('')
const importFileName = ref('')
const recentImportFiles = ref<Array<{ name: string; source: SessionImportSource; importedAt: string }>>([])
const pendingPemFiles = ref<File[]>([])
const pendingPemPassphrase = ref('')
const pendingPemLoading = ref(false)
const pendingPemError = ref('')
const pemReferenceMappings = ref<Record<string, string>>({})
const bastionReferenceMappings = ref<Record<string, number>>({})
const credentialReferenceMappings = ref<Record<string, string>>({})
const secrets = ref<SecretPublic[]>([])

try {
  recentImportFiles.value = JSON.parse(localStorage.getItem('nodeaccess:recent-import-files') ?? '[]') as typeof recentImportFiles.value
} catch { recentImportFiles.value = [] }

async function processDetectedFile(file: File, contentOverride?: string): Promise<void> {
  if (file.size > 5 * 1024 * 1024 && contentOverride === undefined) {
    importResult.value = { success: 0, failed: 1, skipped: 0, createdGroups: 0, createdFolders: 0, rows: [{ key: 'file-size', name: file.name, status: 'failed', message: t('import.unified.tooLarge') }] }
    return
  }
  const content = contentOverride ?? await file.text()
  const detection = detectSessionImportSource(file.name, content)
  activeTab.value = detection.source
  detectedSourceReason.value = detection.reason
  importFileName.value = file.name
  if (detection.source === 'ssh') sshConfigText.value = content
  else if (detection.source === 'csv') csvText.value = content
  else if (detection.source === 'guacamole') guacamoleText.value = content
  else { mobaxtermText.value = content; mobaxtermFileName.value = file.name }
  const recent = [{ name: file.name.slice(0, 180), source: detection.source, importedAt: new Date().toISOString() }, ...recentImportFiles.value.filter(item => item.name !== file.name)].slice(0, 5)
  recentImportFiles.value = recent
  localStorage.setItem('nodeaccess:recent-import-files', JSON.stringify(recent))
}

async function processDetectedFiles(files: File[]): Promise<void> {
  const primary = files[0]
  if (!primary) return
  const totalSize = files.reduce((sum, file) => sum + file.size, 0)
  if (totalSize > 5 * 1024 * 1024) {
    importResult.value = { success: 0, failed: 1, skipped: 0, createdGroups: 0, createdFolders: 0, rows: [{ key: 'file-size', name: primary.name, status: 'failed', message: t('import.unified.tooLarge') }] }
    return
  }
  let content = await primary.text()
  pendingPemFiles.value = files.filter((file, index) => index > 0 && /\.(?:pem|key|ppk|openssh)$/i.test(file.name))
  const detection = detectSessionImportSource(primary.name, content)
  if (detection.source === 'ssh' && files.length > 1) {
    const included = new Map(await Promise.all(files.slice(1).map(async file => [file.name.toLowerCase(), await file.text()] as const)))
    content = content.replace(/^\s*Include\s+(.+)$/gim, (line, rawPath: string) => {
      const path = rawPath.trim().replace(/^["']|["']$/g, '')
      const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? ''
      return included.get(name) ?? line
    })
  }
  await processDetectedFile(primary, content)
}

async function registerPendingPemKeys(): Promise<void> {
  pendingPemLoading.value = true
  pendingPemError.value = ''
  try {
    for (const file of pendingPemFiles.value) {
      const name = file.name.replace(/\.(?:pem|key|ppk|openssh)$/i, '').slice(0, 100)
      if (pemKeys.value.some(key => normalizeText(key.name) === normalizeText(name))) continue
      const created = await pemKeyService.create({
        name,
        key: await file.text(),
        ...(pendingPemPassphrase.value ? { passphrase: pendingPemPassphrase.value } : {}),
      })
      pemKeys.value = [...pemKeys.value, created.data]
      const nextOverrides = { ...parsedHostOverrides.value }
      for (const host of parsedHosts.value) {
        if (host.pemKeyName && normalizeText(host.pemKeyName) === normalizeText(name)) {
          nextOverrides[host.key] = { ...nextOverrides[host.key], authType: 'pem', pemKeyName: name }
        }
      }
      parsedHostOverrides.value = nextOverrides
    }
    pendingPemFiles.value = []
    pendingPemPassphrase.value = ''
  } catch (error) {
    const e = error as { response?: { data?: { message?: string } }; message?: string }
    pendingPemError.value = e.response?.data?.message ?? e.message ?? t('import.pemAssist.failed')
  } finally { pendingPemLoading.value = false }
}

function onUniversalFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  if (files.length) void processDetectedFiles(files)
  input.value = ''
}

function onUniversalDrop(event: DragEvent): void {
  universalDropActive.value = false
  const files = [...(event.dataTransfer?.files ?? [])]
  if (files.length) void processDetectedFiles(files)
}

// ── Groups ────────────────────────────────────────────────────────────────

const groupOptions = ref<{ label: string; value: number }[]>([])
groupService.list().then(({ data }) => {
  groupOptions.value = data.map(g => ({ label: g.name, value: g.id }))
})

const existingHosts = ref<HostPublic[]>([])
const existingHostsLoaded = ref(false)
const pemKeys = ref<PemKeyPublic[]>([])
const bastions = ref<BastionPublic[]>([])
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

async function loadBastions(): Promise<void> {
  try { bastions.value = (await bastionService.list()).data } catch { bastions.value = [] }
}

async function loadSecrets(): Promise<void> {
  try { secrets.value = (await secretService.list()).data } catch { secrets.value = [] }
}

function suggestedBastionId(proxyJump: string): number | undefined {
  const target = proxyJump.replace(/^[^@]+@/, '').replace(/:\d+$/, '').trim().toLowerCase()
  if (!target) return undefined
  return bastions.value.find(item => [item.name, item.ip, item.sourceHost?.name ?? '', item.sourceHost?.ip ?? '']
    .some(value => value.trim().toLowerCase() === target))?.id
}

function resolvedBastionId(proxyJump: string): number | undefined {
  return bastionReferenceMappings.value[normalizeText(proxyJump)] ?? suggestedBastionId(proxyJump)
}

function resolvedPemKeyName(reference: string): string {
  return pemReferenceMappings.value[normalizeText(reference)] ?? reference
}

function mapPemReference(reference: string, name: string | null): void {
  const normalized = normalizeText(reference)
  const next = { ...pemReferenceMappings.value }
  if (name) next[normalized] = name
  else delete next[normalized]
  pemReferenceMappings.value = next
  markParsedHostsChanged()
}

function mapBastionReference(reference: string, id: number | null): void {
  const normalized = normalizeText(reference)
  const next = { ...bastionReferenceMappings.value }
  if (id) next[normalized] = id
  else delete next[normalized]
  bastionReferenceMappings.value = next
  markParsedHostsChanged()
}

function mapCredentialReference(reference: string, alias: string | null): void {
  const normalized = normalizeText(reference)
  const next = { ...credentialReferenceMappings.value }
  if (alias) next[normalized] = alias
  else delete next[normalized]
  credentialReferenceMappings.value = next
  markParsedHostsChanged()
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
  password?:   string
  onePasswordRef?: string
  credentialReference?: string
  bastionId?:  number
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
  const globalWarnings: string[] = []

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const spaceIdx = line.search(/\s/)
    if (spaceIdx === -1) continue
    const key   = line.slice(0, spaceIdx).toLowerCase()
    const value = line.slice(spaceIdx).trim().replace(/^["']|["']$/g, '')

    if (key === 'include') {
      globalWarnings.push(t('import.validation.opensshIncludeRequiresUpload', { path: value }))
      continue
    }
    if (key === 'match') {
      if (current && !current.name.includes('*') && !current.name.includes('?') && current.ip) hosts.push(current)
      current = null
      globalWarnings.push(t('import.validation.opensshMatchIgnored'))
      continue
    }
    if (key === 'host') {
      if (current && !current.name.includes('*') && !current.name.includes('?') && current.ip) {
        hosts.push(current)
      }
      const aliases = value.split(/\s+/).filter(Boolean)
      current = {
        key:       crypto.randomUUID(),
        name:      aliases[0] ?? value,
        ip:        aliases[0] ?? value,   // default; overridden by HostName
        port:      22,
        accessProtocol: 'ssh',
        sshUser:   'root',
        authType:  'password',
        groupName: '',
        pemKeyName: '',
        proxyJump: '',
        folderPath: [],
        warnings: [...globalWarnings, ...(aliases.length > 1 ? [t('import.validation.opensshAliasesCollapsed', { count: aliases.length })] : [])],
        selected:  true,
      }
    } else if (current) {
      switch (key) {
        case 'hostname':     current.ip       = value;                            break
        case 'port':         current.port     = parseInt(value) || 22;            break
        case 'user':         current.sshUser  = value;                            break
        case 'identityfile': {
          current.authType = 'pem'
          current.pemKeyName = value.split(/[\\/]/).pop()?.replace(/\.(?:pem|key|ppk|openssh)$/i, '') ?? ''
          current.warnings.push(t('import.validation.opensshKeyAssociationRequired'))
          break
        }
        case 'proxyjump':    current.proxyJump = value.split(',')[0].trim();      break
        case 'proxycommand': current.warnings.push(t('import.validation.opensshProxyCommandReview')); break
        case 'localforward':
        case 'remoteforward':
        case 'dynamicforward': current.warnings.push(t('import.validation.opensshForwardReview', { directive: key })); break
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

const CSV_TEMPLATE = `# nodeaccess-import-version=1
name,ip,port,sshUser,authType,pemKeyName,password,folderPath,proxyJump
web-prod,192.168.1.1,22,ubuntu,password,,,,
db-staging,10.0.0.5,2222,admin,pem,prod-key,,Produção/Bancos,bastion-prod
`

function downloadTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' })
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'nodeaccess-hosts-template.csv' })
  a.click()
  URL.revokeObjectURL(a.href)
}

function parseCsv(content: string): ParsedHost[] {
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(line => line && !line.startsWith('#'))
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
      folderPath: get('folderpath').split(/[\\/]+/).map(item => item.trim()).filter(Boolean),
      proxyJump: get('proxyjump'),
      ...(get('password') ? { password: get('password') } : {}),
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
const importDetectedCredentials = ref(false)
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
  'credential-reference-not-imported': 'import.validation.guacamoleCredentialReference',
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
  ...(host.password ? { password: host.password } : {}),
  ...(host.onePasswordRef ? { onePasswordRef: host.onePasswordRef } : {}),
  ...(host.credentialReferenceHint ? { credentialReference: host.credentialReferenceHint } : {}),
  selected: true,
})))

const guacamoleCredentialsDetected = computed(() =>
  guacamoleResult.value?.hosts.filter(host => Boolean(host.password)).length ?? 0,
)

// ── Tab: MobaXterm ───────────────────────────────────────────────────────

const mobaxtermText = ref('')
const mobaxtermFileName = ref('')
const mobaxtermFileRef = ref<HTMLInputElement | null>(null)
const mobaxtermResult = computed(() => {
  try {
    return parseMobaXtermSessions(mobaxtermText.value)
  } catch {
    return null
  }
})
const mobaxtermParseError = computed(() =>
  mobaxtermText.value.trim() && !mobaxtermResult.value ? t('import.mobaxtermParseError') : '',
)

const mobaxtermWarningLabels: Record<string, string> = {
  'invalid-port-defaulted': 'import.validation.mobaxtermInvalidPort',
  'private-key-reference-ignored': 'import.validation.mobaxtermPrivateKeyIgnored',
  'extra-fields-ignored': 'import.validation.mobaxtermExtraFields',
  'field-layout-variation': 'import.validation.mobaxtermFieldVariation',
}

function onMobaXtermFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  mobaxtermFileName.value = file.name
  const reader = new FileReader()
  reader.onload = (ev) => { mobaxtermText.value = ev.target?.result as string ?? '' }
  reader.readAsText(file)
}

const mobaxtermParsed = computed<ParsedHost[]>(() => (mobaxtermResult.value?.hosts ?? []).map(host => ({
  key: host.sourceId,
  name: host.name,
  ip: host.ip,
  port: host.port,
  accessProtocol: 'ssh',
  sshUser: host.sshUser,
  // A MobaXterm key path points to the source workstation and is not a usable
  // credential in NodeAccess. Keep the host importable and surface the basename
  // as a matching hint; a key explicitly attached by the user is promoted to PEM.
  authType: 'password',
  groupName: '',
  pemKeyName: host.pemKeyNameHint ?? '',
  proxyJump: host.proxyJump ?? '',
  folderPath: host.folderPath,
  warnings: host.warnings.map(warning => t(mobaxtermWarningLabels[warning])),
  selected: true,
})))
const mobaxtermPrivateKeyReferences = computed(() => mobaxtermResult.value?.hosts.filter(host =>
  host.warnings.includes('private-key-reference-ignored')).length ?? 0)

// ── Active tab → active parsed list ──────────────────────────────────────

const activeTab   = ref('ssh')
const parsedHostsRevision = ref(0)
type ParsedHostOverride = Partial<Pick<ParsedHost, 'name' | 'ip' | 'port' | 'sshUser' | 'authType' | 'pemKeyName' | 'folderPath' | 'selected'>>
const parsedHostOverrides = ref<Record<string, ParsedHostOverride>>({})
const parsedHosts = computed(() => {
  let source: ParsedHost[]
  if (activeTab.value === 'ssh') source = sshParsed.value
  else if (activeTab.value === 'csv') source = csvParsed.value
  else if (activeTab.value === 'mobaxterm') source = mobaxtermParsed.value
  else source = guacamoleParsed.value
  return source.map(host => {
    const override = parsedHostOverrides.value[host.key]
    const pemKeyName = override?.pemKeyName ?? host.pemKeyName
    const resolvedPemName = pemKeyName ? resolvedPemKeyName(pemKeyName) : ''
    const hasResolvedPem = Boolean(resolvedPemName && pemKeys.value.some(key => normalizeText(key.name) === normalizeText(resolvedPemName)))
    return {
      ...host,
      ...(pemKeyName ? { pemKeyName: resolvedPemName } : {}),
      ...(hasResolvedPem ? { authType: 'pem' as const } : {}),
      ...(host.proxyJump && resolvedBastionId(host.proxyJump) ? { bastionId: resolvedBastionId(host.proxyJump) } : {}),
      ...(host.credentialReference && credentialReferenceMappings.value[normalizeText(host.credentialReference)]
        ? { onePasswordRef: `secret://${credentialReferenceMappings.value[normalizeText(host.credentialReference)]}` }
        : {}),
      ...override,
    }
  })
})
const sourceDependencyHosts = computed(() => activeTab.value === 'ssh' ? sshParsed.value
  : activeTab.value === 'csv' ? csvParsed.value
    : activeTab.value === 'mobaxterm' ? mobaxtermParsed.value
      : guacamoleParsed.value)
const pemReferences = computed(() => [...new Set(sourceDependencyHosts.value
  .filter(host => host.pemKeyName)
  .map(host => host.pemKeyName))])
const bastionReferences = computed(() => [...new Set(sourceDependencyHosts.value
  .filter(host => host.proxyJump)
  .map(host => host.proxyJump))])
const credentialReferences = computed(() => [...new Set(sourceDependencyHosts.value
  .filter(host => host.credentialReference)
  .map(host => host.credentialReference!))])
const pemKeyOptions = computed(() => pemKeys.value.map(key => ({ label: key.name, value: key.name })))
const bastionOptions = computed(() => bastions.value.map(item => ({ label: `${item.name} · ${item.ip}:${item.port}`, value: item.id })))
const secretOptions = computed(() => secrets.value.map(secret => ({ label: `${secret.alias} · ${secret.scope}`, value: secret.alias })))
const privateConnectionMode = ref<PrivateImportConnectionMode | null>(null)
const unresolvedBastionPolicy = ref<'block' | 'allow'>('block')
const privateHostsWithoutBastion = computed(() => parsedHosts.value.filter(host => isPrivateNetworkAddress(host.ip) && !host.bastionId))
const unresolvedBastionHosts = computed(() => parsedHosts.value.filter(host => host.proxyJump && !host.bastionId))

function effectiveImportConnectionMode(host: ParsedHost): PrivateImportConnectionMode | 'direct' {
  return importConnectionMode(host.ip, privateConnectionMode.value ?? 'direct', Boolean(host.bastionId))
}
const creatingBastionReference = ref('')
const newBastion = ref({ name: '', ip: '', port: 22, sshUser: '', authType: 'pem' as 'pem' | 'password', systemPemKeyId: null as number | null, password: '' })
const creatingBastion = ref(false)
const createBastionError = ref('')

function beginCreateBastion(reference: string): void {
  const match = reference.trim().match(/^(?:([^@]+)@)?(\[[^\]]+]|[^:]+)(?::(\d+))?$/)
  newBastion.value = {
    name: match?.[2]?.replace(/^\[|]$/g, '') ?? reference,
    ip: match?.[2]?.replace(/^\[|]$/g, '') ?? '',
    port: Number(match?.[3] ?? 22),
    sshUser: match?.[1] ?? '',
    authType: 'pem',
    systemPemKeyId: null,
    password: '',
  }
  creatingBastionReference.value = reference
  createBastionError.value = ''
}

async function createAndMapBastion(): Promise<void> {
  const value = newBastion.value
  if (!creatingBastionReference.value || !value.name.trim() || !value.ip.trim() || !value.sshUser.trim()) return
  if (value.authType === 'pem' && !value.systemPemKeyId) return
  if (value.authType === 'password' && !value.password) return
  creatingBastion.value = true
  createBastionError.value = ''
  try {
    const dto: CreateBastionDto = {
      name: value.name.trim(), ip: value.ip.trim(), port: value.port, sshUser: value.sshUser.trim(), authType: value.authType,
      ...(value.authType === 'pem' && value.systemPemKeyId ? { systemPemKeyId: value.systemPemKeyId } : {}),
      ...(value.authType === 'password' ? { password: value.password } : {}),
    }
    const created = (await bastionService.create(dto)).data
    bastions.value = [...bastions.value.filter(item => item.id !== created.id), created]
    mapBastionReference(creatingBastionReference.value, created.id)
    creatingBastionReference.value = ''
  } catch (error) {
    const e = error as { response?: { data?: { message?: string } }; message?: string }
    createBastionError.value = e.response?.data?.message ?? e.message ?? t('import.dependencies.createBastionFailed')
  } finally {
    creatingBastion.value = false
  }
}
const selected = computed(() => {
  void parsedHostsRevision.value
  return parsedHosts.value.filter(h => h.selected)
})
const previewFilter = ref<'all' | 'ready' | 'blocked' | 'warning' | 'duplicate'>('all')
const bulkSshUser = ref('')
const bulkPort = ref('')
const bulkFolderPath = ref('')
const duplicateStrategy = ref<'skip' | 'create' | 'update'>('skip')
const connectivityTesting = ref(false)
const connectivityByHost = ref<Record<string, { success: boolean; message: string; latencyMs: number | null; phase: 'tcp' | 'auth' }>>({})
const importHistory = ref<HostImportHistoryItem[]>([])
const historyLoading = ref(false)
const lastImportId = ref<number | null>(null)
const revertLoading = ref(false)
const revertFeedback = ref<{ type: 'success' | 'warning' | 'error'; message: string } | null>(null)

const filteredParsedHosts = computed(() => parsedHosts.value.filter(host => {
  if (previewFilter.value === 'all') return true
  const issues = getHostIssues(host)
  if (previewFilter.value === 'blocked') return issues.some(issue => issue.severity === 'error')
  if (previewFilter.value === 'warning') return !issues.some(issue => issue.severity === 'error') && issues.some(issue => issue.severity === 'warning')
  if (previewFilter.value === 'duplicate') return existingHostEndpoints.value.has(hostEndpointKey(host))
  return !issues.some(issue => issue.severity === 'error')
}))

function applyBulkChanges(): void {
  const patch: ParsedHostOverride = {}
  if (bulkSshUser.value.trim()) patch.sshUser = bulkSshUser.value.trim()
  const port = Number(bulkPort.value)
  if (Number.isInteger(port) && port >= 1 && port <= 65535) patch.port = port
  if (bulkFolderPath.value.trim()) patch.folderPath = bulkFolderPath.value.split('/').map(item => item.trim()).filter(Boolean)
  if (!Object.keys(patch).length) return
  const next = { ...parsedHostOverrides.value }
  for (const host of selected.value) next[host.key] = { ...next[host.key], ...patch }
  parsedHostOverrides.value = next
  markParsedHostsChanged()
}

async function testSelectedConnectivity(): Promise<void> {
  connectivityTesting.value = true
  connectivityByHost.value = {}
  const queue = selected.value.filter(host => !getHostIssues(host).some(issue => issue.severity === 'error'))
  for (let offset = 0; offset < queue.length; offset += 5) {
    await Promise.all(queue.slice(offset, offset + 5).map(async host => {
      try {
        const tcp = (await hostService.testConnection({
          ip: host.ip, port: host.port, accessProtocol: host.accessProtocol,
          sshUser: host.sshUser, authType: 'password', connectionMode: effectiveImportConnectionMode(host), testMode: 'tcp',
          ...(host.bastionId ? { bastionId: host.bastionId } : {}),
        })).data
        if (!tcp.success) {
          connectivityByHost.value = { ...connectivityByHost.value, [host.key]: { ...tcp, phase: 'tcp' } }
          return
        }
        const pemKeyId = host.authType === 'pem' ? pemKeyIdByNormalizedName.value.get(normalizeText(host.pemKeyName)) : undefined
        const canTestAuth = Boolean((host.password && importDetectedCredentials.value) || pemKeyId)
        if (!canTestAuth) {
          connectivityByHost.value = { ...connectivityByHost.value, [host.key]: { ...tcp, phase: 'tcp', message: t('import.connectivity.tcpReadyAuthPending') } }
          return
        }
        const authResult = (await hostService.testConnection({
          ip: host.ip, port: host.port, accessProtocol: host.accessProtocol, sshUser: host.sshUser,
          authType: pemKeyId ? 'pem' : 'password', connectionMode: effectiveImportConnectionMode(host), testMode: 'auth',
          ...(host.bastionId ? { bastionId: host.bastionId } : {}),
          ...(pemKeyId ? { pemKeyId } : {}),
          ...(host.password && importDetectedCredentials.value ? { password: host.password } : {}),
        })).data
        connectivityByHost.value = { ...connectivityByHost.value, [host.key]: { ...authResult, phase: 'auth' } }
      } catch (error) {
        const e = error as { response?: { data?: { message?: string } }; message?: string }
        connectivityByHost.value = { ...connectivityByHost.value, [host.key]: { success: false, latencyMs: null, message: e.response?.data?.message ?? e.message ?? t('import.connectivity.failed'), phase: 'tcp' } }
      }
    }))
  }
  connectivityTesting.value = false
}

function downloadImportReport(format: 'json' | 'csv'): void {
  const rows = importResult.value?.rows ?? serverPreview.value?.report.map(row => ({ key: row.sourceId, name: row.name, status: row.status, message: row.warnings.join('; ') })) ?? []
  const csvCell = (value: unknown) => {
    const raw = String(value ?? '')
    const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw
    return `"${safe.replace(/"/g, '""')}"`
  }
  const content = format === 'json'
    ? JSON.stringify({ generatedAt: new Date().toISOString(), source: activeTab.value, rows }, null, 2)
    : ['sourceId,name,status,message', ...rows.map(row => [row.key, row.name, row.status, row.message].map(csvCell).join(','))].join('\n')
  const link = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8' })),
    download: `nodeaccess-import-${new Date().toISOString().slice(0, 10)}.${format}`,
  })
  link.click()
  URL.revokeObjectURL(link.href)
}

async function loadImportHistory(): Promise<void> {
  if (!auth.isAdmin) return
  historyLoading.value = true
  try { importHistory.value = (await hostImportService.history()).data.items } finally { historyLoading.value = false }
}

async function revertImport(item: HostImportHistoryItem): Promise<void> {
  if (!item.canRevert || !window.confirm(t('import.history.confirmRevert'))) return
  revertLoading.value = true
  revertFeedback.value = null
  try {
    const { data } = await hostImportService.revert(item.id)
    revertFeedback.value = {
      type: data.failures.length ? 'warning' : 'success',
      message: data.failures.length
        ? t('import.history.partialResult', { hosts: data.revertedHosts, folders: data.revertedFolders, failures: data.failures.join(' • ') })
        : t('import.history.successResult', { hosts: data.revertedHosts, folders: data.revertedFolders }),
    }
    lastImportId.value = null
    await loadImportHistory()
    emit('imported')
  } catch (error) {
    const e = error as { response?: { data?: { message?: string } }; message?: string }
    revertFeedback.value = { type: 'error', message: e.response?.data?.message ?? e.message ?? t('import.history.failed') }
  } finally {
    revertLoading.value = false
  }
}

async function revertLastImport(): Promise<void> {
  const item = importHistory.value.find(entry => entry.id === lastImportId.value)
  if (item) await revertImport(item)
}

onMounted(() => {
  if (auth.isAdmin) void loadImportHistory()
})

function markParsedHostsChanged(): void {
  parsedHostsRevision.value += 1
  serverPreview.value = null
}

function updateParsedHostOverride(row: ParsedHost, patch: ParsedHostOverride): void {
  parsedHostOverrides.value = {
    ...parsedHostOverrides.value,
    [row.key]: { ...parsedHostOverrides.value[row.key], ...patch },
  }
  markParsedHostsChanged()
}

function setAllParsedHostsSelected(selectedValue: boolean): void {
  const next = { ...parsedHostOverrides.value }
  for (const host of parsedHosts.value) next[host.key] = { ...next[host.key], selected: selectedValue }
  parsedHostOverrides.value = next
  markParsedHostsChanged()
}

watch(() => parsedHosts.value.length, (count) => {
  if (count > 0) {
    void loadExistingHosts()
    void loadLicenseSettings()
    void loadBastions()
    if (sourceDependencyHosts.value.some(host => host.credentialReference)) void loadSecrets()
  }
  if (parsedHosts.value.some(host => host.authType === 'pem' || Boolean(host.pemKeyName))) void loadPemKeys()
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
  void parsedHostsRevision.value
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
  if (host.accessProtocol === 'ssh' && !host.sshUser.trim()) {
    issues.push({ severity: 'error', message: t('import.validation.missingSshUser') })
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
  if (host.proxyJump && !host.bastionId) {
    issues.push({ severity: unresolvedBastionPolicy.value === 'block' ? 'error' : 'warning', message: t('import.validation.bastionMatchMissing', { value: host.proxyJump }) })
  }
  if (isPrivateNetworkAddress(host.ip) && !host.bastionId && privateConnectionMode.value === null) {
    issues.push({ severity: 'error', message: t('import.validation.privateRouteRequired') })
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

const sessionsPreviewHosts = computed(() => selected.value
  .filter(host => !getHostIssues(host).some(issue => issue.severity === 'error'))
  .map(host => ({
    key: host.key,
    name: host.name,
    ip: host.ip,
    port: host.port,
    folderPath: host.folderPath,
  })))
const sessionsPreviewAllHostsOnly = computed(() => inventoryDestination.value?.type === 'ROOT'
  ? sessionsPreviewHosts.value.filter(host => !preserveImportedHierarchy.value || !host.folderPath.length).length
  : 0)
const sessionsPreviewTreeHosts = computed(() => inventoryDestination.value?.type === 'ROOT'
  ? sessionsPreviewHosts.value.filter(host => preserveImportedHierarchy.value && host.folderPath.length)
  : sessionsPreviewHosts.value)
const sessionsPreviewRows = computed(() => buildImportSessionsPreview(
  inventoryDestination.value?.type === 'ROOT'
    ? t('import.inventoryRoot')
    : inventoryDestination.value?.name ?? t('import.inventoryDestinationPending'),
  sessionsPreviewTreeHosts.value,
  preserveImportedHierarchy.value,
  inventoryDestination.value?.type !== 'ROOT',
))

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
const preserveImportedHierarchy = ref(true)
const guacamoleAclTargetBySource = ref<Record<string, number | null>>({})
const serverPreview = ref<HostImportPreviewResponse | null>(null)
const usesServerImport = computed(() => true)
const detectedCredentialCount = computed(() => parsedHosts.value.filter(host => Boolean(host.password)).length)

watch([guacamoleText, mobaxtermText, inventoryDestinationId, preserveImportedHierarchy, activeTab], () => {
  serverPreview.value = null
})
watch([sshConfigText, csvText, guacamoleText, mobaxtermText, activeTab], () => {
  parsedHostOverrides.value = {}
  editingHostKey.value = null
  importDetectedCredentials.value = false
  markParsedHostsChanged()
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
  if (!preserveImportedHierarchy.value || inventoryDestinationId.value === null) return []
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

const editingHostKey = ref<string | null>(null)

function updateParsedHost<K extends 'name' | 'ip' | 'port' | 'sshUser'>(row: ParsedHost, field: K, value: ParsedHost[K]): void {
  updateParsedHostOverride(row, { [field]: value })
}

const columns = computed<DataTableColumns<ParsedHost>>(() => {
  void parsedHostsRevision.value
  const tableColumns: DataTableColumns<ParsedHost> = [
    {
      key: 'selected', title: '',  width: 40,
      render: (row) => h(NCheckbox, {
        checked: row.selected,
        onUpdateChecked: (v: boolean) => updateParsedHostOverride(row, { selected: v }),
      }),
    },
    { key: 'name', title: t('import.columns.name'), width: 170,
      render: (row) => editingHostKey.value === row.key
        ? h('input', {
            value: row.name,
            maxlength: 100,
            class: 'w-full rounded border border-gray-700 bg-[#18181c] px-2 py-1 text-xs text-gray-100 outline-none focus:border-blue-500',
            'aria-label': t('import.edit.nameLabel', { name: row.name }),
            'data-import-name-input': row.key,
            onInput: (event: Event) => updateParsedHost(row, 'name', (event.target as HTMLInputElement).value),
          })
        : h(NText, { ellipsis: { tooltip: true } }, () => row.name),
    },
    { key: 'accessProtocol', title: t('import.columns.protocol'), width: 82,
      render: (row) => h(NTag, { size: 'small', round: true }, () => row.accessProtocol.toUpperCase()),
    },
    { key: 'ip', title: t('import.columns.ip'), width: 170,
      render: (row) => editingHostKey.value === row.key
        ? h('input', {
            value: row.ip,
            maxlength: 255,
            class: 'w-full rounded border border-gray-700 bg-[#18181c] px-2 py-1 font-mono text-xs text-gray-100 outline-none focus:border-blue-500',
            'aria-label': t('import.edit.ipLabel', { name: row.name }),
            'data-import-ip-input': row.key,
            onInput: (event: Event) => updateParsedHost(row, 'ip', (event.target as HTMLInputElement).value),
          })
        : h(NText, { ellipsis: { tooltip: true } }, () => row.ip),
    },
    { key: 'port', title: t('import.columns.port'), width: 105,
      render: (row) => editingHostKey.value === row.key
        ? h('input', {
            type: 'number',
            value: row.port,
            min: 1,
            max: 65535,
            class: 'w-full rounded border border-gray-700 bg-[#18181c] px-2 py-1 font-mono text-xs text-gray-100 outline-none focus:border-blue-500',
            'aria-label': t('import.edit.portLabel', { name: row.name }),
            'data-import-port-input': row.key,
            onInput: (event: Event) => {
              const value = Number((event.target as HTMLInputElement).value)
              updateParsedHost(row, 'port', Number.isInteger(value) && value >= 1 && value <= 65535 ? value : 22)
            },
          })
        : h('span', String(row.port)),
    },
    { key: 'sshUser', title: t('import.columns.user'), width: 135,
      render: (row) => editingHostKey.value === row.key
        ? h('input', {
            value: row.sshUser,
            maxlength: 64,
            class: 'w-full rounded border border-gray-700 bg-[#18181c] px-2 py-1 text-xs text-gray-100 outline-none focus:border-blue-500',
            'aria-label': t('import.edit.userLabel', { name: row.name }),
            'data-import-user-input': row.key,
            onInput: (event: Event) => updateParsedHost(row, 'sshUser', (event.target as HTMLInputElement).value),
          })
        : h(NText, { class: row.sshUser ? '' : 'text-red-300' }, () => row.sshUser || '—'),
    },
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
            trigger: () => h(NText, { class: row.bastionId ? 'text-emerald-300' : 'text-amber-300', style: 'font-size:11px' }, () => `→ ${row.proxyJump}`),
            default: () => row.bastionId
              ? t('import.bastionMatched', { name: bastions.value.find(item => item.id === row.bastionId)?.name ?? row.proxyJump })
              : t('import.proxyJumpHint'),
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
    { key: 'connectivity', title: t('import.columns.connectivity'), width: 150,
      render: (row) => {
        const result = connectivityByHost.value[row.key]
        if (!result) return h(NText, { depth: 3 }, () => t('import.connectivity.notTested'))
        return h(NTooltip, { trigger: 'hover' }, {
          trigger: () => h(NText, { class: result.success ? 'text-emerald-300' : 'text-amber-300' }, () => result.success
            ? result.phase === 'auth'
              ? t('import.connectivity.authenticated', { latency: result.latencyMs ?? 0 })
              : t('import.connectivity.reachable', { latency: result.latencyMs ?? 0 })
            : t('import.connectivity.failedShort')),
          default: () => result.message,
        })
      },
    },
    { key: 'edit', title: t('import.columns.actions'), width: 85, fixed: 'right',
      render: (row) => h(NButton, {
        size: 'tiny',
        text: true,
        type: editingHostKey.value === row.key ? 'primary' : 'default',
        'data-import-edit-host': row.key,
        onClick: () => { editingHostKey.value = editingHostKey.value === row.key ? null : row.key },
      }, () => editingHostKey.value === row.key ? t('import.edit.done') : t('import.edit.action')),
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
const importCompleted = computed(() => (importResult.value?.success ?? 0) > 0)
const currentImportStep = computed(() => importResult.value ? 4 : serverPreview.value ? 3 : parsedHosts.value.length ? 2 : 1)

function serverPreviewPayload() {
  if (!usesServerImport.value || inventoryDestinationId.value === null) return null
  const isGuacamole = activeTab.value === 'guacamole'
  if (isGuacamole && !guacamoleResult.value) return null
  if (activeTab.value === 'mobaxterm' && !mobaxtermResult.value) return null
  const source = activeTab.value === 'ssh' ? 'openssh' as const
    : activeTab.value === 'csv' ? 'csv' as const
    : activeTab.value === 'guacamole' ? 'guacamole' as const
    : 'mobaxterm' as const
  return {
    source,
    destinationId: inventoryDestinationId.value,
    preserveHierarchy: preserveImportedHierarchy.value,
    importCredentials: auth.isAdmin && importDetectedCredentials.value,
    duplicateStrategy: duplicateStrategy.value,
    unresolvedBastionPolicy: unresolvedBastionPolicy.value,
    hosts: selected.value.map(host => ({
      sourceId: host.key,
      name: host.name,
      ip: host.ip,
      port: host.port,
      accessProtocol: host.accessProtocol,
      sshUser: host.sshUser,
      ...(host.bastionId ? { bastionId: host.bastionId } : {}),
      connectionMode: effectiveImportConnectionMode(host),
      requiresBastion: Boolean(host.proxyJump && !host.bastionId),
      authType: host.authType,
      ...(host.authType === 'pem' && pemKeyIdByNormalizedName.value.get(normalizeText(host.pemKeyName))
        ? { pemKeyId: pemKeyIdByNormalizedName.value.get(normalizeText(host.pemKeyName)) }
        : {}),
      ...(importDetectedCredentials.value && host.password
        ? { password: host.password }
        : {}),
      ...(host.onePasswordRef ? { onePasswordRef: host.onePasswordRef } : {}),
      folderPath: host.folderPath,
      warnings: host.warnings,
    })),
    aclMappings: (isGuacamole ? guacamoleResult.value?.sourcePrincipals ?? [] : []).flatMap(sourcePrincipal => {
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
      invalidConnections: isGuacamole
        ? guacamoleResult.value?.invalidConnections ?? 0
        : activeTab.value === 'mobaxterm'
          ? (mobaxtermResult.value?.invalidSessions ?? 0) + (mobaxtermResult.value?.unsupportedSessions ?? 0)
          : 0,
      unsupportedProtocols: isGuacamole
        ? guacamoleResult.value?.unsupportedProtocols ?? []
        : activeTab.value === 'mobaxterm' ? mobaxtermResult.value?.unsupportedSessionTypes ?? [] : [],
      unmappedPermissions: isGuacamole ? guacamoleResult.value?.unmappedPermissions ?? 0 : 0,
    },
  }
}

async function doServerImport() {
  const payload = serverPreviewPayload()
  if (!payload) return
  importing.value = true
  importResult.value = null
  try {
    if (!serverPreview.value) {
      serverPreview.value = (await hostImportService.preview(payload)).data
      return
    }
    const result = (await hostImportService.commit({ previewId: serverPreview.value.previewId, confirm: true })).data
    importResult.value = {
      success: result.createdHosts,
      failed: result.status === 'rolled_back' ? 1 : 0,
      skipped: serverPreview.value.summary.blocked,
      createdGroups: 0,
      createdFolders: result.createdFolders,
      rows: result.rows.map(row => ({
        key: row.sourceId,
        name: row.name,
        status: row.status === 'created' || row.status === 'updated' ? 'success' : row.status === 'failed' ? 'failed' : 'skipped',
        message: row.message,
      })),
    }
    if (result.status === 'committed') {
      lastImportId.value = result.importId ?? null
      emit('imported')
      if (auth.isAdmin) await loadImportHistory()
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
    download: `nodeaccess-${activeTab.value}-preview-${serverPreview.value.previewId}.json`,
  })
  link.click()
  URL.revokeObjectURL(link.href)
}

async function ensureHierarchyPaths(baseId: number): Promise<{ destinationByPath: Map<string, number>; createdFolders: number }> {
  const destinationByPath = new Map<string, number>()
  let createdFolders = 0
  if (!preserveImportedHierarchy.value) return { destinationByPath, createdFolders }

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
  if (usesServerImport.value) return doServerImport()
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
      connectionMode: effectiveImportConnectionMode(h),
      scope: 'global',
      groupId: rowGroupId ?? undefined,
      inventoryParentId: preserveImportedHierarchy.value && h.folderPath.length
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
  <NModal
    :show="true"
    preset="card"
    :title="$t('import.title')"
    style="width:min(960px,94vw);max-height:92vh;overflow-y:auto"
    content-style="max-height:calc(92vh - 132px);overflow-y:auto;padding-bottom:72px"
    :mask-closable="false"
    data-import-hosts-modal="true"
    @close="emit('close')"
  >
    <ol class="mb-4 grid grid-cols-4 gap-1 text-center text-xs" :aria-label="$t('import.flow.label')">
      <li
        v-for="step in 4"
        :key="step"
        class="rounded px-2 py-1.5"
        :class="step <= currentImportStep ? 'na-flow-step--complete' : 'na-flow-step--pending'"
        :aria-current="step === currentImportStep ? 'step' : undefined"
        data-import-flow-step="true"
      >
        {{ $t(`import.flow.step${step}`) }}
      </li>
    </ol>
    <div
      class="mb-4 rounded-lg border-2 border-dashed p-4 text-center transition-colors"
      :class="universalDropActive ? 'border-emerald-400 bg-emerald-500/10' : 'border-gray-700 bg-[#18181c]'"
      role="button"
      tabindex="0"
      :aria-label="$t('import.unified.dropLabel')"
      data-import-universal-drop="true"
      @click="universalFileRef?.click()"
      @keydown.enter.prevent="universalFileRef?.click()"
      @keydown.space.prevent="universalFileRef?.click()"
      @dragenter.prevent="universalDropActive = true"
      @dragover.prevent="universalDropActive = true"
      @dragleave.prevent="universalDropActive = false"
      @drop.prevent="onUniversalDrop"
    >
      <input
        ref="universalFileRef"
        type="file"
        multiple
        class="hidden"
        accept=".mxtsessions,.ini,.xml,.json,.csv,.conf,.config,.pem,.key,.ppk,.openssh,text/plain,text/csv,application/json,application/xml"
        @change="onUniversalFileChange"
      />
      <NText class="block text-sm font-medium">{{ $t('import.unified.title') }}</NText>
      <NText depth="3" class="block text-xs">{{ $t('import.unified.hint') }}</NText>
      <NTag v-if="importFileName" size="small" type="success" class="mt-2" :title="detectedSourceReason">
        {{ importFileName }} · {{ $t(`import.unified.sources.${activeTab}`) }}
      </NTag>
    </div>
    <div v-if="recentImportFiles.length" class="mb-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
      <span>{{ $t('import.unified.recent') }}</span>
      <NTag v-for="item in recentImportFiles" :key="`${item.name}:${item.importedAt}`" size="tiny" :bordered="false">
        {{ item.name }} · {{ $t(`import.unified.sources.${item.source}`) }}
      </NTag>
    </div>
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

      <!-- ── MobaXterm tab ────────────────────────────────────────────── -->
      <NTabPane name="mobaxterm" :tab="$t('import.tabMobaXterm')">
        <p class="text-xs text-gray-400 mb-3">{{ $t('import.mobaxtermHint') }}</p>
        <div class="flex flex-wrap items-center gap-2">
          <NButton size="small" ghost @click="mobaxtermFileRef?.click()">📂 {{ $t('import.uploadFile') }}</NButton>
          <NText v-if="mobaxtermFileName" depth="3" class="text-xs">{{ mobaxtermFileName }}</NText>
          <input
            ref="mobaxtermFileRef"
            type="file"
            accept=".mxtsessions,.ini,text/plain"
            class="hidden"
            :aria-label="$t('import.mobaxtermFileLabel')"
            @change="onMobaXtermFileChange"
          />
        </div>
        <details class="mt-3 rounded border border-gray-800 bg-black/10 px-3 py-2 text-xs text-gray-400">
          <summary class="cursor-pointer font-medium text-gray-300">{{ $t('import.mobaxtermExportHelpTitle') }}</summary>
          <ol class="mt-2 list-decimal space-y-1 pl-4">
            <li>{{ $t('import.mobaxtermExportHelpStep1') }}</li>
            <li>{{ $t('import.mobaxtermExportHelpStep2') }}</li>
            <li>{{ $t('import.mobaxtermExportHelpStep3') }}</li>
          </ol>
        </details>
        <NAlert type="info" class="mt-3" :title="$t('import.mobaxtermSecurityTitle')">
          <p class="text-xs">{{ $t('import.mobaxtermSecurityNotice') }}</p>
        </NAlert>
        <NAlert v-if="mobaxtermParseError" type="error" class="mt-3" :title="mobaxtermParseError" />
        <NAlert
          v-if="mobaxtermResult?.encryptedCredentialsDetected"
          type="warning"
          class="mt-3"
          :title="$t('import.mobaxtermEncryptedCredentialsTitle')"
        >
          <p class="text-xs">
            {{ $t('import.mobaxtermEncryptedCredentialsNotice', {
              count: mobaxtermResult.encryptedCredentialsDetected,
              master: mobaxtermResult.masterPasswordConfigured ? $t('import.yes') : $t('import.no'),
            }) }}
          </p>
        </NAlert>
        <NAlert
          v-else-if="mobaxtermResult?.hosts.length"
          type="success"
          class="mt-3"
          :title="$t('import.mobaxtermReadSummaryTitle')"
        >
          <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span>{{ $t('import.mobaxtermReadHosts', { count: mobaxtermResult.hosts.length }) }}</span>
            <span>{{ $t('import.mobaxtermReadFolders', { count: mobaxtermResult.folders.length }) }}</span>
            <span>{{ $t('import.mobaxtermReadKeys', { count: mobaxtermPrivateKeyReferences }) }}</span>
            <span>{{ $t('import.mobaxtermReadLayout', { fields: mobaxtermResult.fieldCounts.join(', ') }) }}</span>
            <span>{{ $t(`import.mobaxtermFormat.${mobaxtermResult.format}`) }}</span>
          </div>
        </NAlert>
        <NAlert
          v-if="mobaxtermResult && (mobaxtermResult.invalidSessions || mobaxtermResult.unsupportedSessions)"
          type="warning"
          class="mt-3"
          :title="$t('import.mobaxtermSkippedTitle')"
        >
          <div class="text-xs space-y-1">
            <p v-if="mobaxtermResult.invalidSessions">
              {{ $t('import.mobaxtermInvalidCount', { count: mobaxtermResult.invalidSessions }) }}
            </p>
            <p v-if="mobaxtermResult.unsupportedSessions">
              {{ $t('import.mobaxtermUnsupportedCount', { count: mobaxtermResult.unsupportedSessions }) }}
            </p>
          </div>
        </NAlert>
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
              v-model:checked="importDetectedCredentials"
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

    <NAlert v-if="pendingPemFiles.length" type="info" class="mt-3" :title="$t('import.pemAssist.title', { count: pendingPemFiles.length })">
      <div class="grid gap-2 text-xs md:grid-cols-[1fr_220px_auto] md:items-end">
        <div>
          <div>{{ pendingPemFiles.map(file => file.name).join(', ') }}</div>
          <NText depth="3">{{ $t('import.pemAssist.hint') }}</NText>
        </div>
        <NInput v-model:value="pendingPemPassphrase" type="password" show-password-on="click" :placeholder="$t('import.pemAssist.passphrase')" />
        <NButton type="primary" secondary :loading="pendingPemLoading" @click="registerPendingPemKeys">
          {{ $t('import.pemAssist.register') }}
        </NButton>
      </div>
      <NText v-if="pendingPemError" class="mt-2 block text-red-300">{{ pendingPemError }}</NText>
    </NAlert>

    <NAlert
      v-if="activeTab !== 'guacamole' && detectedCredentialCount"
      type="warning"
      class="mt-3"
      :title="$t('import.credentials.title')"
    >
      <div class="space-y-2 text-xs leading-5">
        <p>{{ $t('import.credentials.notice', { count: detectedCredentialCount }) }}</p>
        <NCheckbox
          v-model:checked="importDetectedCredentials"
          :disabled="!auth.isAdmin"
          @update:checked="serverPreview = null"
        >
          {{ $t('import.credentials.optIn') }}
        </NCheckbox>
        <p v-if="!auth.isAdmin" class="text-amber-300">{{ $t('import.credentials.adminOnly') }}</p>
      </div>
    </NAlert>

    <NCard
      v-if="pemReferences.length || bastionReferences.length || credentialReferences.length"
      size="small"
      class="mt-3"
      :title="$t('import.dependencies.title')"
      data-import-dependencies="true"
    >
      <NText depth="3" class="block text-xs">{{ $t('import.dependencies.hint') }}</NText>
      <div class="mt-3 space-y-3">
        <div v-for="reference in pemReferences" :key="`pem:${reference}`" class="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(220px,1fr)] md:items-center">
          <div class="min-w-0 text-xs">
            <NTag size="tiny" type="warning">PEM</NTag>
            <span class="ml-2 break-all font-mono">{{ reference }}</span>
          </div>
          <NSelect
            size="small"
            clearable
            :value="pemReferenceMappings[normalizeText(reference)] ?? (pemKeys.some(key => normalizeText(key.name) === normalizeText(reference)) ? reference : null)"
            :options="pemKeyOptions"
            :placeholder="$t('import.dependencies.selectPem')"
            :aria-label="$t('import.dependencies.pemLabel', { reference })"
            @update:value="value => mapPemReference(reference, value)"
          />
        </div>
        <div v-for="reference in credentialReferences" :key="`credential:${reference}`" class="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(220px,1fr)] md:items-center">
          <div class="min-w-0 text-xs">
            <NTag size="tiny" type="warning">Secret</NTag>
            <span class="ml-2 break-all font-mono">{{ reference }}</span>
          </div>
          <NSelect
            size="small"
            clearable
            :value="credentialReferenceMappings[normalizeText(reference)] ?? null"
            :options="secretOptions"
            :placeholder="$t('import.dependencies.selectSecret')"
            :aria-label="$t('import.dependencies.secretLabel', { reference })"
            @update:value="value => mapCredentialReference(reference, value)"
          />
        </div>
        <div v-for="reference in bastionReferences" :key="`bastion:${reference}`" class="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(220px,1fr)_auto] md:items-center">
          <div class="min-w-0 text-xs">
            <NTag size="tiny" type="info">Jump</NTag>
            <span class="ml-2 break-all font-mono">{{ reference }}</span>
          </div>
          <NSelect
            size="small"
            clearable
            :value="bastionReferenceMappings[normalizeText(reference)] ?? suggestedBastionId(reference) ?? null"
            :options="bastionOptions"
            :placeholder="$t('import.dependencies.selectBastion')"
            :aria-label="$t('import.dependencies.bastionLabel', { reference })"
            @update:value="value => mapBastionReference(reference, value)"
          />
          <NButton v-if="auth.isAdmin" size="small" secondary @click="beginCreateBastion(reference)">
            {{ $t('import.dependencies.createBastion') }}
          </NButton>
        </div>
      </div>
      <div v-if="creatingBastionReference" class="mt-3 rounded border border-gray-700 p-3" data-import-create-bastion="true">
        <NText class="block text-sm font-medium">{{ $t('import.dependencies.createBastionTitle', { reference: creatingBastionReference }) }}</NText>
        <div class="mt-2 grid gap-2 md:grid-cols-2">
          <NInput v-model:value="newBastion.name" :placeholder="$t('import.dependencies.bastionName')" />
          <NInput v-model:value="newBastion.ip" :placeholder="$t('import.dependencies.bastionHost')" />
          <NInput v-model:value="newBastion.sshUser" :placeholder="$t('import.dependencies.bastionUser')" />
          <NInputNumber v-model:value="newBastion.port" :min="1" :max="65535" :placeholder="$t('import.dependencies.bastionPort')" />
          <NSelect v-model:value="newBastion.authType" :options="[{ label: 'PEM', value: 'pem' }, { label: $t('import.dependencies.password'), value: 'password' }]" />
          <NSelect v-if="newBastion.authType === 'pem'" v-model:value="newBastion.systemPemKeyId" :options="pemKeys.map(key => ({ label: key.name, value: key.id }))" :placeholder="$t('import.dependencies.selectPem')" />
          <NInput v-else v-model:value="newBastion.password" type="password" show-password-on="click" :placeholder="$t('import.dependencies.password')" />
        </div>
        <NText v-if="createBastionError" class="mt-2 block text-xs text-red-300">{{ createBastionError }}</NText>
        <NSpace class="mt-3" justify="end">
          <NButton size="small" @click="creatingBastionReference = ''">{{ $t('common.cancel') }}</NButton>
          <NButton size="small" type="primary" :loading="creatingBastion" @click="createAndMapBastion">{{ $t('import.dependencies.createAndUse') }}</NButton>
        </NSpace>
      </div>
    </NCard>

    <!-- ── Preview ──────────────────────────────────────────────────────── -->
    <NCard
      v-if="privateHostsWithoutBastion.length || unresolvedBastionHosts.length"
      size="small"
      class="mt-3"
      :title="$t('import.routing.title')"
      data-import-routing-policy="true"
    >
      <div v-if="privateHostsWithoutBastion.length" class="grid gap-2 md:grid-cols-[1fr_minmax(260px,1fr)] md:items-center">
        <div>
          <NText class="block text-sm font-medium">{{ $t('import.routing.privateDetected', { count: privateHostsWithoutBastion.length }) }}</NText>
          <NText depth="3" class="block text-xs">{{ $t('import.routing.privateHint') }}</NText>
        </div>
        <NSelect
          v-model:value="privateConnectionMode"
          :options="[
            { label: $t('import.routing.agentRecommended'), value: 'agent_tenant_fallback' },
            { label: $t('import.routing.auto'), value: 'auto' },
            { label: $t('import.routing.direct'), value: 'direct' },
          ]"
          :placeholder="$t('import.routing.choose')"
          :aria-label="$t('import.routing.privateLabel')"
          data-import-private-route="true"
          @update:value="serverPreview = null"
        />
      </div>
      <div v-if="unresolvedBastionHosts.length" class="mt-3 grid gap-2 border-t border-gray-800 pt-3 md:grid-cols-[1fr_minmax(260px,1fr)] md:items-center">
        <div>
          <NText class="block text-sm font-medium">{{ $t('import.routing.unresolvedBastion', { count: unresolvedBastionHosts.length }) }}</NText>
          <NText depth="3" class="block text-xs">{{ $t('import.routing.unresolvedBastionHint') }}</NText>
        </div>
        <NSelect
          v-model:value="unresolvedBastionPolicy"
          :options="[
            { label: $t('import.routing.blockUnresolved'), value: 'block' },
            { label: $t('import.routing.allowUnresolved'), value: 'allow' },
          ]"
          :aria-label="$t('import.routing.bastionPolicyLabel')"
          data-import-bastion-policy="true"
          @update:value="serverPreview = null"
        />
      </div>
    </NCard>

    <template v-if="parsedHosts.length">
      <div class="mt-5">
        <div class="flex items-center justify-between mb-2">
          <NText class="text-sm font-medium">
            {{ $t('import.parsedTitle') }}
            <span class="text-gray-500 ml-1">({{ parsedHosts.length }})</span>
          </NText>
          <NSpace size="small">
            <NButton size="tiny" text @click="setAllParsedHostsSelected(true)">{{ $t('import.selectAll') }}</NButton>
            <NButton size="tiny" text @click="setAllParsedHostsSelected(false)">{{ $t('import.deselectAll') }}</NButton>
          </NSpace>
        </div>
        <div class="mb-3 grid gap-2 rounded border border-gray-800 bg-[#18181c] p-3 md:grid-cols-4">
          <NSelect
            v-model:value="previewFilter"
            size="small"
            :options="[
              { label: $t('import.filters.all'), value: 'all' },
              { label: $t('import.filters.ready'), value: 'ready' },
              { label: $t('import.filters.blocked'), value: 'blocked' },
              { label: $t('import.filters.warning'), value: 'warning' },
              { label: $t('import.filters.duplicate'), value: 'duplicate' },
            ]"
            :aria-label="$t('import.filters.label')"
          />
          <NInput v-model:value="bulkSshUser" size="small" :placeholder="$t('import.bulk.user')" />
          <NInput v-model:value="bulkFolderPath" size="small" :placeholder="$t('import.bulk.folder')" />
          <NSpace size="small" justify="end">
            <input v-model="bulkPort" type="number" min="1" max="65535" class="w-[90px] rounded border border-gray-700 bg-[#18181c] px-2 text-xs" :placeholder="$t('import.bulk.port')" />
            <NButton size="small" :disabled="!selected.length" @click="applyBulkChanges">{{ $t('import.bulk.apply') }}</NButton>
          </NSpace>
        </div>
        <NDataTable
          :columns="columns"
          :data="filteredParsedHosts"
          :row-key="(r) => r.key"
          size="small"
          :max-height="240"
          :scroll-x="1450"
          :bordered="false"
          style="font-size:12px"
        />
      </div>

      <div v-if="usesServerImport" class="mt-3 grid gap-2 rounded border border-gray-800 p-3 md:grid-cols-[1fr_auto]">
        <div>
          <NText class="block text-sm font-medium">{{ $t('import.duplicates.title') }}</NText>
          <NText depth="3" class="block text-xs">{{ $t('import.duplicates.hint') }}</NText>
          <NSelect
            v-model:value="duplicateStrategy"
            class="mt-2 max-w-sm"
            size="small"
            :options="[
              { label: $t('import.duplicates.skip'), value: 'skip' },
              { label: $t('import.duplicates.create'), value: 'create' },
              ...(auth.isAdmin ? [{ label: $t('import.duplicates.update'), value: 'update' }] : []),
            ]"
            @update:value="serverPreview = null"
          />
        </div>
        <NButton size="small" :loading="connectivityTesting" :disabled="validationSummary.ready === 0" @click="testSelectedConnectivity">
          {{ $t('import.connectivity.test') }}
        </NButton>
      </div>

      <NAlert
        :type="validationSummary.blocked > 0 ? 'warning' : 'success'"
        class="mt-3"
        :title="$t('import.validation.title')"
      >
        <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span>{{ $t('import.validation.selectedCount', { count: validationSummary.selected }) }}</span>
          <span class="na-status-success">{{ $t('import.validation.readyCount', { count: validationSummary.ready }) }}</span>
          <span v-if="validationSummary.blocked > 0" class="na-status-danger">
            {{ $t('import.validation.blockedCount', { count: validationSummary.blocked }) }}
          </span>
          <span v-if="validationSummary.warnings > 0" class="na-status-warning">
            {{ $t('import.validation.warningCount', { count: validationSummary.warnings }) }}
          </span>
          <span v-if="validationSummary.pem > 0" class="na-status-warning">
            {{ $t('import.validation.pemCount', { count: validationSummary.pem }) }}
          </span>
        </div>
        <div v-if="serverPreview?.report.some(row => row.existingHost)" class="mt-3 space-y-1 rounded bg-black/20 p-2 text-xs">
          <div class="font-medium">{{ $t('import.duplicates.comparison') }}</div>
          <div v-for="row in (serverPreview?.report ?? []).filter(item => item.existingHost).slice(0, 8)" :key="row.sourceId" class="grid gap-1 md:grid-cols-2">
            <span>{{ $t('import.duplicates.fromFile') }}: {{ row.name }}</span>
            <span>{{ $t('import.duplicates.existing') }}: {{ row.existingHost?.name }} · {{ row.existingHost?.ip }}:{{ row.existingHost?.port }} · {{ row.existingHost?.sshUser }}</span>
          </div>
        </div>
      </NAlert>

      <NAlert v-if="hasImportedHierarchy" type="info" class="mt-3" :title="$t('import.hierarchy.title')">
        <div class="text-xs leading-5">
          <NCheckbox v-model:checked="preserveImportedHierarchy">
            {{ $t('import.hierarchy.preserve') }}
          </NCheckbox>
          <div class="mt-1 text-gray-400">
            {{ preserveImportedHierarchy
              ? $t('import.hierarchy.preview', { count: missingHierarchyPaths.length })
              : $t('import.hierarchy.flattened') }}
          </div>
        </div>
      </NAlert>

      <div v-if="sessionsPreviewHosts.length" class="mt-3 rounded border border-gray-800 bg-[#111113] p-3">
        <div class="mb-2">
          <NText class="block text-sm font-medium">{{ $t('import.sessionsPreview.title') }}</NText>
          <NText depth="3" class="block text-xs">{{ $t('import.sessionsPreview.description') }}</NText>
        </div>
        <ImportSessionsTreePreview
          :rows="sessionsPreviewRows"
          :total-hosts="sessionsPreviewTreeHosts.length"
          :all-hosts-only="sessionsPreviewAllHostsOnly"
        />
      </div>

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
        <div class="mb-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" data-import-impact-preview="true">
          <div class="rounded border border-gray-700 p-2"><strong>{{ serverPreview.summary.hostsToCreate }}</strong><span class="ml-1 text-xs">{{ $t('import.impact.create') }}</span></div>
          <div class="rounded border border-gray-700 p-2"><strong>{{ serverPreview.summary.hostsToUpdate }}</strong><span class="ml-1 text-xs">{{ $t('import.impact.update') }}</span></div>
          <div class="rounded border border-gray-700 p-2"><strong>{{ serverPreview.summary.hostsToSkip }}</strong><span class="ml-1 text-xs">{{ $t('import.impact.skip') }}</span></div>
          <div class="rounded border border-gray-700 p-2"><strong>{{ serverPreview.summary.foldersToCreate }}</strong><span class="ml-1 text-xs">{{ $t('import.impact.folders') }}</span></div>
        </div>
        <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span>{{ $t('import.serverPreview.ready', { count: serverPreview.summary.ready }) }}</span>
          <span>{{ $t('import.serverPreview.blocked', { count: serverPreview.summary.blocked }) }}</span>
          <span>{{ $t('import.serverPreview.folders', { count: serverPreview.summary.foldersToCreate }) }}</span>
          <span>{{ $t('import.serverPreview.acls', { count: serverPreview.summary.aclMappings }) }}</span>
          <span>{{ $t('import.serverPreview.credentials', { count: serverPreview.summary.credentialsToImport }) }}</span>
          <span v-if="serverPreview.summary.duplicates">{{ $t('import.serverPreview.duplicates', { count: serverPreview.summary.duplicates }) }}</span>
          <span v-if="serverPreview.summary.privateHostsViaAgent">{{ $t('import.impact.viaAgent', { count: serverPreview.summary.privateHostsViaAgent }) }}</span>
          <span v-if="serverPreview.summary.unresolvedBastions" class="text-amber-300">{{ $t('import.impact.unresolvedBastions', { count: serverPreview.summary.unresolvedBastions }) }}</span>
          <span>{{ serverPreview.summary.reversible ? $t('import.impact.reversible') : $t('import.impact.notReversible') }}</span>
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
          <span class="na-status-info">{{ $t('import.license.remaining', { count: remainingLicenseSlots }) }}</span>
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

    <NAlert v-else-if="sshConfigText || csvText || guacamoleText || mobaxtermText" type="warning" class="mt-4" :title="$t('import.noHosts')" />

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
      <NSpace class="mt-3" size="small">
        <NButton size="tiny" @click="downloadImportReport('csv')">{{ $t('import.report.csv') }}</NButton>
        <NButton size="tiny" @click="downloadImportReport('json')">{{ $t('import.report.json') }}</NButton>
        <NButton
          v-if="lastImportId && auth.isAdmin"
          size="tiny"
          type="error"
          secondary
          :loading="revertLoading"
          data-import-undo="true"
          @click="revertLastImport"
        >
          {{ $t('import.history.undoNow') }}
        </NButton>
      </NSpace>
    </NAlert>

    <NAlert v-if="revertFeedback" :type="revertFeedback.type" class="mt-3" :title="revertFeedback.message" data-import-revert-feedback="true" />

    <NCard v-if="auth.isAdmin" size="small" class="mt-4" :title="$t('import.history.title')">
      <template #header-extra>
        <NButton size="tiny" :loading="historyLoading" @click="loadImportHistory">{{ $t('import.history.refresh') }}</NButton>
      </template>
      <NSpin v-if="historyLoading && !importHistory.length" size="small" />
      <NText v-else-if="!importHistory.length" depth="3" class="text-xs">{{ $t('import.history.empty') }}</NText>
      <div v-for="item in importHistory" :key="item.id" class="flex flex-wrap items-center justify-between gap-2 border-b border-gray-800 py-2 text-xs last:border-0">
        <span>{{ new Date(item.timestamp).toLocaleString() }} · {{ item.actorName }} · {{ item.source }}</span>
        <span>{{ $t('import.history.summary', { hosts: item.createdHosts, folders: item.createdFolders, updated: item.updatedHosts }) }}</span>
        <NButton size="tiny" type="error" secondary :disabled="!item.canRevert" @click="revertImport(item)">
          {{ item.status === 'reverted' ? $t('import.history.reverted') : $t('import.history.revert') }}
        </NButton>
      </div>
    </NCard>

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
        <NButton v-if="!importCompleted" @click="emit('close')">{{ $t('common.cancel') }}</NButton>
        <NButton
          type="primary"
          :loading="importing"
          :disabled="!importCompleted && (!selected.length
            || validationSummary.ready === 0
            || importing
            || inventoryDestinationId === null
            || destinationAclLoading
            || destinationAclEntries.length === 0)"
          @click="importCompleted ? emit('close') : doImport()"
        >
          {{ importCompleted
            ? $t('common.close')
            : importing
            ? $t('import.importing')
            : usesServerImport && !serverPreview
              ? $t('import.serverPreview.validate')
              : usesServerImport
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
