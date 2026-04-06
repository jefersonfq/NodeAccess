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
import type { CreateHostDto } from '@nodeaccess/shared'

const emit = defineEmits<{ close: []; imported: [] }>()

const { t } = useI18n()

// ── Groups ────────────────────────────────────────────────────────────────

const groupOptions = ref<{ label: string; value: number }[]>([])
groupService.list().then(({ data }) => {
  groupOptions.value = data.map(g => ({ label: g.name, value: g.id }))
})

// ── Parsed host row ────────────────────────────────────────────────────────

interface ParsedHost {
  key:         string   // uuid for table row key
  name:        string
  ip:          string
  port:        number
  sshUser:     string
  authType:    'password' | 'pem'
  proxyJump:   string   // informational only — no auto-bastion mapping
  selected:    boolean
}

// ── Default scope / group for import ─────────────────────────────────────

const defaultScope = ref<'personal' | 'team' | 'global'>('personal')
const defaultGroup = ref<number | null>(null)

const scopeOptions = computed(() => [
  { label: t('hosts.scopes.personal'), value: 'personal' },
  { label: t('hosts.scopes.team'),     value: 'team'     },
  { label: t('hosts.scopes.global'),   value: 'global'   },
])

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
        proxyJump: '',
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

const CSV_TEMPLATE = `name,ip,port,sshUser,authType
web-prod,192.168.1.1,22,ubuntu,password
db-staging,10.0.0.5,2222,admin,pem
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
  const header = lines[0].toLowerCase().split(',').map(h => h.trim())
  const idx = (name: string) => header.indexOf(name)

  return lines.slice(1).map(line => {
    const cols = line.split(',').map(c => c.trim())
    const get  = (name: string) => cols[idx(name)] ?? ''
    const port = parseInt(get('port')) || 22
    const auth = get('authtype') === 'pem' ? 'pem' : 'password'
    return {
      key:       crypto.randomUUID(),
      name:      get('name') || get('ip'),
      ip:        get('ip'),
      port,
      sshUser:   get('sshuser') || get('user') || 'root',
      authType:  auth as 'password' | 'pem',
      proxyJump: '',
      selected:  true,
    } satisfies ParsedHost
  }).filter(h => h.ip)
}

function onCsvFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (ev) => { csvText.value = ev.target?.result as string ?? '' }
  reader.readAsText(file)
}

const csvParsed = computed(() => parseCsv(csvText.value))

// ── Active tab → active parsed list ──────────────────────────────────────

const activeTab   = ref('ssh')
const parsedHosts = computed(() => activeTab.value === 'ssh' ? sshParsed.value : csvParsed.value)
const selected    = computed(() => parsedHosts.value.filter(h => h.selected))

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
  { key: 'proxyJump', title: t('import.columns.proxyJump'), width: 120,
    render: (row) => row.proxyJump
      ? h(NTooltip, { trigger: 'hover' }, {
          trigger: () => h(NText, { depth: 3, style: 'font-size:11px' }, () => `→ ${row.proxyJump}`),
          default: () => t('import.proxyJumpHint'),
        })
      : h('span', '—'),
  },
])

// ── Import ────────────────────────────────────────────────────────────────

const importing  = ref(false)
const importResult = ref<{ success: number; failed: number } | null>(null)

async function doImport() {
  if (!selected.value.length) return
  importing.value  = true
  importResult.value = null
  let success = 0, failed = 0

  for (const h of selected.value) {
    const dto: CreateHostDto = {
      name:    h.name,
      ip:      h.ip,
      port:    h.port,
      sshUser: h.sshUser,
      authType: h.authType,
      connectionMode: 'direct',
      scope:   defaultScope.value,
      groupId: defaultGroup.value ?? undefined,
    }
    try {
      await hostService.create(dto)
      success++
    } catch {
      failed++
    }
  }

  importing.value   = false
  importResult.value = { success, failed }
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
    </template>

    <NAlert v-else-if="sshConfigText || csvText" type="warning" class="mt-4" :title="$t('import.noHosts')" />

    <!-- ── Import result ──────────────────────────────────────────────────── -->
    <NAlert
      v-if="importResult"
      :type="importResult.failed === 0 ? 'success' : 'warning'"
      class="mt-4"
      :title="importResult.failed === 0
        ? $t('import.successAll', { count: importResult.success })
        : $t('import.successPartial', { success: importResult.success, failed: importResult.failed })"
    />

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
          :disabled="!selected.length || importing"
          @click="doImport"
        >
          {{ importing ? $t('import.importing') : $t('import.importBtn', { count: selected.length }) }}
        </NButton>
      </NSpace>
    </template>
  </NModal>
</template>
