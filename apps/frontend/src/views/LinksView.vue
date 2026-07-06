<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NCard, NDescriptions, NDescriptionsItem, NEmpty, NInput, NModal, NPagination, NPopconfirm, NSelect, NSpace, NSpin, NTag, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { resolveHostLinkTemplate, type AdminLogPublic, type HostAssociatedLink } from '@nodeaccess/shared'
import { hostService, type HostAssociatedLinkCatalogItem } from '@/services/host.service'
import { hostLinkService, type HostLinkListItem } from '@/services/host-link.service'
import { sharedSessionService, type SharedSessionListItem } from '@/services/shared-session.service'
import { logsService } from '@/services/logs.service'

const { d, t } = useI18n()
const router = useRouter()
const message = useMessage()

type HostLinkCatalogItem = {
  key: string
  host: HostAssociatedLinkCatalogItem['host']
  link: HostAssociatedLink
  resolvedUrl: string
}

const loading = ref(false)
const temporaryLoading = ref(false)
const showHelp = ref(false)
const temporaryLinksExpanded = ref(true)
const hostShortcutsExpanded = ref(true)
const search = ref('')
const temporarySearch = ref('')
const temporaryTypeFilter = ref<'all' | 'public_once' | 'authenticated' | 'live'>('all')
const temporaryStatusFilter = ref<'all' | 'active' | 'used' | 'expired' | 'revoked' | 'ended'>('all')
const pageSizeOptions = [5, 10, 20, 50]
const temporaryPage = ref(1)
const temporaryPageSize = ref(5)
const shortcutPage = ref(1)
const shortcutPageSize = ref(5)
const catalogItems = ref<HostAssociatedLinkCatalogItem[]>([])
const hostLinks = ref<HostLinkListItem[]>([])
const sharedSessions = ref<SharedSessionListItem[]>([])
const selectedTemporaryLink = ref<TemporaryLinkRow | null>(null)
const detailLogs = ref<AdminLogPublic[]>([])
const detailLogsLoading = ref(false)

async function load() {
  loading.value = true
  try {
    const { data } = await hostService.listAssociatedLinksCatalog()
    catalogItems.value = data
  } finally {
    loading.value = false
  }
}

onMounted(load)
onMounted(loadTemporaryLinks)

const links = computed<HostLinkCatalogItem[]>(() =>
  catalogItems.value.map((item, index) => ({
    key: `${item.host.id}-${item.link.id ?? index}-${item.link.label}`,
    host: item.host,
    link: item.link,
    resolvedUrl: resolveHostLinkTemplate(item.link.urlTemplate, {
      id: item.host.id,
      name: item.host.name,
      ip: item.host.ip,
      port: item.host.port,
      sshUser: item.host.sshUser,
    }),
  })),
)

const filteredLinks = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return links.value
  return links.value.filter((item) =>
    item.link.label.toLowerCase().includes(q)
    || item.host.name.toLowerCase().includes(q)
    || item.host.ip.toLowerCase().includes(q)
    || item.resolvedUrl.toLowerCase().includes(q)
    || (item.link.sourceProvider ?? '').toLowerCase().includes(q),
  )
})

const paginatedLinks = computed(() => {
  const start = (shortcutPage.value - 1) * shortcutPageSize.value
  return filteredLinks.value.slice(start, start + shortcutPageSize.value)
})

type TemporaryLinkKind = 'public_once' | 'authenticated' | 'live'
type TemporaryLinkStatus = 'active' | 'used' | 'expired' | 'revoked' | 'ended'

type TemporaryLinkRow = {
  key: string
  kind: TemporaryLinkKind
  id: number
  hostId: number
  hostName: string
  hostIp?: string | null
  createdBy: string
  createdAt: string
  expiresAt: string
  status: TemporaryLinkStatus
  activeCount: number
  pinRequired: boolean
  pin: string | null
  url: string | null
}

async function loadTemporaryLinks() {
  temporaryLoading.value = true
  try {
    const [hostLinksRes, sharedSessionsRes] = await Promise.all([
      hostLinkService.listTemporary(),
      sharedSessionService.list(),
    ])
    hostLinks.value = hostLinksRes.data
    sharedSessions.value = sharedSessionsRes.data
  } finally {
    temporaryLoading.value = false
  }
}

function resolveTemporaryStatus(status: TemporaryLinkStatus, expiresAt: string) {
  if (status === 'active' && new Date(expiresAt).getTime() <= Date.now()) return 'expired'
  return status
}

const temporaryLinks = computed<TemporaryLinkRow[]>(() => [
  ...hostLinks.value.map((item) => ({
    key: `host-link-${item.id}`,
    kind: item.type,
    id: item.id,
    hostId: item.hostId,
    hostName: item.hostName ?? `Host #${item.hostId}`,
    hostIp: item.hostIp ?? null,
    createdBy: item.createdBy.name,
    createdAt: item.createdAt,
    expiresAt: item.expiresAt,
    status: resolveTemporaryStatus(item.status, item.expiresAt),
    activeCount: item.activeSessions,
    pinRequired: item.pinRequired,
    pin: item.pin,
    url: item.url,
  })),
  ...sharedSessions.value.map((item) => ({
    key: `shared-session-${item.id}`,
    kind: 'live' as const,
    id: item.id,
    hostId: item.hostId,
    hostName: item.hostName,
    hostIp: null,
    createdBy: item.owner.name,
    createdAt: item.createdAt,
    expiresAt: item.expiresAt,
    status: resolveTemporaryStatus(item.status === 'ended' ? 'ended' : item.status, item.expiresAt),
    activeCount: item.activeParticipants,
    pinRequired: false,
    pin: null,
    url: item.url,
  })),
].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()))

const filteredTemporaryLinks = computed(() => {
  const q = temporarySearch.value.trim().toLowerCase()
  return temporaryLinks.value.filter((item) => {
    if (temporaryTypeFilter.value !== 'all' && item.kind !== temporaryTypeFilter.value) return false
    if (temporaryStatusFilter.value !== 'all' && item.status !== temporaryStatusFilter.value) return false
    if (!q) return true
    return item.hostName.toLowerCase().includes(q)
      || (item.hostIp ?? '').toLowerCase().includes(q)
      || item.createdBy.toLowerCase().includes(q)
      || String(item.id).includes(q)
  })
})

const paginatedTemporaryLinks = computed(() => {
  const start = (temporaryPage.value - 1) * temporaryPageSize.value
  return filteredTemporaryLinks.value.slice(start, start + temporaryPageSize.value)
})

watch([search, filteredLinks], () => { shortcutPage.value = 1 })
watch([temporarySearch, temporaryTypeFilter, temporaryStatusFilter, filteredTemporaryLinks], () => { temporaryPage.value = 1 })

function temporaryKindLabel(kind: TemporaryLinkKind) {
  if (kind === 'public_once') return 'JIT publico'
  if (kind === 'authenticated') return 'Sessao propria'
  return 'Sessao ao vivo'
}

function temporaryStatusLabel(status: TemporaryLinkStatus) {
  if (status === 'active') return 'Ativo'
  if (status === 'used') return 'Usado'
  if (status === 'expired') return 'Expirado'
  if (status === 'revoked') return 'Revogado'
  return 'Encerrado'
}

function temporaryStatusType(status: TemporaryLinkStatus) {
  if (status === 'active') return 'success'
  if (status === 'expired' || status === 'used' || status === 'ended') return 'warning'
  return 'error'
}

function canRevokeTemporaryLink(item: TemporaryLinkRow) {
  if (item.kind === 'live') return item.status === 'active'
  return item.status === 'active' || item.activeCount > 0
}

async function revokeTemporaryLink(item: TemporaryLinkRow) {
  if (item.kind === 'live') {
    await sharedSessionService.revoke(item.id)
  } else {
    await hostLinkService.revoke(item.id)
  }
  message.success('Link revogado.')
  await loadTemporaryLinks()
}

async function copyPin(pin: string) {
  await navigator.clipboard.writeText(pin)
  message.success('PIN copiado.')
}

async function copyTemporaryUrl(url: string) {
  await navigator.clipboard.writeText(url)
  message.success('Link copiado.')
}

function detailTargetType(item: TemporaryLinkRow) {
  return item.kind === 'live' ? 'SharedSession' : 'HostLink'
}

function detailTargetLabel(log: AdminLogPublic) {
  if (log.targetType === 'Session') return `Sessao #${log.targetId}`
  if (log.targetType === 'SharedSession') return `Compartilhamento #${log.targetId}`
  if (log.targetType === 'HostLink') return `Link #${log.targetId}`
  return `${log.targetType} #${log.targetId}`
}

function formatLogAction(action: string) {
  return action
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^\w/, (char) => char.toUpperCase())
}

function parseLogDetails(details?: string | null): Record<string, unknown> | null {
  if (!details) return null
  try {
    const parsed = JSON.parse(details) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function logDetailSummary(log: AdminLogPublic) {
  const details = parseLogDetails(log.details)
  if (!details) return log.details ?? '-'
  const entries = Object.entries(details)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .slice(0, 4)
  return entries.length
    ? entries.map(([key, value]) => `${key}: ${String(value)}`).join(' | ')
    : '-'
}

function isJitSessionLogForLink(log: AdminLogPublic, linkId: number) {
  const details = parseLogDetails(log.details)
  return Number(details?.jitLinkId) === linkId
}

function mergeRecentLogs(logGroups: AdminLogPublic[][], limit = 12) {
  const byId = new Map<number, AdminLogPublic>()
  for (const log of logGroups.flat()) {
    byId.set(log.id, log)
  }
  return [...byId.values()]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit)
}

async function openTemporaryDetails(item: TemporaryLinkRow) {
  selectedTemporaryLink.value = item
  detailLogs.value = []
  detailLogsLoading.value = true
  try {
    const baseLogsRequest = logsService.listAdmin({
      targetType: detailTargetType(item),
      targetId: item.id,
      page: 1,
      limit: 8,
    })
    if (item.kind !== 'public_once') {
      const { data } = await baseLogsRequest
      detailLogs.value = data.data
      return
    }

    const [baseLogs, sessionLogs] = await Promise.all([
      baseLogsRequest,
      logsService.listAdmin({
        targetType: 'Session',
        search: `"jitLinkId":${item.id}`,
        page: 1,
        limit: 12,
      }),
    ])
    detailLogs.value = mergeRecentLogs([
      baseLogs.data.data,
      sessionLogs.data.data.filter((log) => isJitSessionLogForLink(log, item.id)),
    ])
  } finally {
    detailLogsLoading.value = false
  }
}

function sourceTypeLabel(link: HostAssociatedLink) {
  if (link.sourceType === 'integration') return t('linksPage.source.integration')
  if (link.sourceType === 'derived') return t('linksPage.source.derived')
  return t('linksPage.source.manual')
}

function sourceStatusLabel(link: HostAssociatedLink) {
  if (link.sourceStatus === 'synced') return t('linksPage.status.synced')
  if (link.sourceStatus === 'stale') return t('linksPage.status.stale')
  if (link.sourceStatus === 'error') return t('linksPage.status.error')
  return t('linksPage.status.manual')
}

function providerLabel(link: HostAssociatedLink) {
  if (link.sourceProvider === 'onepassword') return '1Password'
  return link.sourceProvider ?? null
}

function openLink(item: HostLinkCatalogItem) {
  const target = item.link.openMode === 'same_tab' ? '_self' : '_blank'
  window.open(item.resolvedUrl, target, target === '_blank' ? 'noopener,noreferrer' : undefined)
}

async function copyLink(item: HostLinkCatalogItem) {
  await navigator.clipboard.writeText(item.resolvedUrl)
  message.success(t('linksPage.copied'))
}

function goToHost(hostId: number) {
  void router.push({ name: 'hosts', query: { editHostId: String(hostId) } })
}
</script>

<template>
  <div class="p-6">
    <div class="flex items-center justify-between gap-4 mb-5">
      <div>
        <h1 class="text-xl font-semibold text-white">{{ $t('linksPage.title') }}</h1>
        <p class="text-gray-400 mt-1 text-sm">{{ $t('linksPage.subtitle') }}</p>
      </div>
      <div class="text-right text-xs text-gray-500">
        <div>{{ $t('linksPage.temporaryCount', { count: filteredTemporaryLinks.length }) }}</div>
        <div>{{ $t('linksPage.shortcutCount', { count: filteredLinks.length }) }}</div>
      </div>
    </div>

    <section class="mb-5 na-panel rounded-xl border">
      <div class="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
        <button
          type="button"
          class="min-w-0 flex-1 text-left"
          @click="temporaryLinksExpanded = !temporaryLinksExpanded"
        >
          <h2 class="text-sm font-semibold text-white">Acessos temporarios</h2>
          <p class="mt-1 text-xs text-gray-500">
            JIT publico, sessao propria e sessao ao vivo gerados no NodeAccess. Links antigos nao exibem URL novamente porque o token e armazenado apenas como hash.
          </p>
        </button>
        <div class="flex shrink-0 items-center gap-3">
          <NTag size="small" :bordered="false">{{ $t('linksPage.temporaryCount', { count: filteredTemporaryLinks.length }) }}</NTag>
          <NButton size="small" tertiary :loading="temporaryLoading" @click="loadTemporaryLinks">
            Atualizar
          </NButton>
          <button
            type="button"
            class="text-xs text-gray-500"
            :aria-label="temporaryLinksExpanded ? 'Recolher acessos temporarios' : 'Expandir acessos temporarios'"
            @click="temporaryLinksExpanded = !temporaryLinksExpanded"
          >
            {{ temporaryLinksExpanded ? '▲' : '▼' }}
          </button>
        </div>
      </div>

      <div v-if="temporaryLinksExpanded" class="border-t border-gray-800 px-4 py-4">
      <div class="grid gap-3 md:grid-cols-[1fr_180px_180px]">
        <NInput
          v-model:value="temporarySearch"
          clearable
          placeholder="Buscar por host, IP, criador ou ID..."
        />
        <NSelect
          v-model:value="temporaryTypeFilter"
          :options="[
            { label: 'Todos os tipos', value: 'all' },
            { label: 'JIT publico', value: 'public_once' },
            { label: 'Sessao propria', value: 'authenticated' },
            { label: 'Sessao ao vivo', value: 'live' },
          ]"
        />
        <NSelect
          v-model:value="temporaryStatusFilter"
          :options="[
            { label: 'Todos os status', value: 'all' },
            { label: 'Ativos', value: 'active' },
            { label: 'Usados', value: 'used' },
            { label: 'Expirados', value: 'expired' },
            { label: 'Revogados', value: 'revoked' },
            { label: 'Encerrados', value: 'ended' },
          ]"
        />
      </div>

      <NSpin :show="temporaryLoading">
        <NEmpty
          v-if="filteredTemporaryLinks.length === 0"
          class="mt-4"
          description="Nenhum acesso temporario encontrado."
        />

        <div v-else class="mt-4 overflow-x-auto">
          <table class="w-full min-w-[860px] text-left text-sm">
            <thead class="text-xs uppercase tracking-[0.12em] text-gray-500">
              <tr>
                <th class="px-3 py-2 font-medium">Tipo</th>
                <th class="px-3 py-2 font-medium">Host</th>
                <th class="px-3 py-2 font-medium">Criado por</th>
                <th class="px-3 py-2 font-medium">Status</th>
                <th class="px-3 py-2 font-medium">Validade</th>
                <th class="px-3 py-2 font-medium">Uso</th>
                <th class="px-3 py-2 text-right font-medium">Acoes</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in paginatedTemporaryLinks"
                :key="item.key"
                class="border-t border-gray-800"
              >
                <td class="px-3 py-3">
                  <NTag size="small" :type="item.kind === 'public_once' ? 'warning' : item.kind === 'live' ? 'info' : 'default'">
                    {{ temporaryKindLabel(item.kind) }}
                  </NTag>
                </td>
                <td class="px-3 py-3">
                  <div class="font-medium text-gray-100">{{ item.hostName }}</div>
                  <div class="text-xs text-gray-500">{{ item.hostIp || `Host #${item.hostId}` }}</div>
                </td>
                <td class="px-3 py-3 text-gray-300">
                  <div>{{ item.createdBy }}</div>
                  <div class="text-xs text-gray-500">{{ d(new Date(item.createdAt), 'short') }}</div>
                </td>
                <td class="px-3 py-3">
                  <NTag size="small" :type="temporaryStatusType(item.status)">
                    {{ temporaryStatusLabel(item.status) }}
                  </NTag>
                </td>
                <td class="px-3 py-3 text-gray-300">
                  {{ d(new Date(item.expiresAt), 'short') }}
                </td>
                <td class="px-3 py-3 text-gray-300">
                  <span v-if="item.kind === 'public_once'">{{ item.activeCount }} sessao(oes)</span>
                  <span v-else-if="item.kind === 'live'">{{ item.activeCount }} participante(s)</span>
                  <span v-else>-</span>
                </td>
                <td class="px-3 py-3">
                  <NSpace justify="end" :size="6">
                    <NButton
                      size="tiny"
                      tertiary
                      @click="openTemporaryDetails(item)"
                    >
                      Detalhes
                    </NButton>
                    <NButton
                      v-if="item.url"
                      size="tiny"
                      tertiary
                      @click="copyTemporaryUrl(item.url)"
                    >
                      Copiar link
                    </NButton>
                    <NButton
                      v-if="item.pin"
                      size="tiny"
                      tertiary
                      @click="copyPin(item.pin)"
                    >
                      Copiar PIN
                    </NButton>
                    <NPopconfirm
                      v-if="canRevokeTemporaryLink(item)"
                      positive-text="Revogar"
                      negative-text="Cancelar"
                      @positive-click="revokeTemporaryLink(item)"
                    >
                      <template #trigger>
                        <NButton size="tiny" tertiary type="error">
                          Revogar
                        </NButton>
                      </template>
                      Revogar este acesso temporario?
                    </NPopconfirm>
                  </NSpace>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="filteredTemporaryLinks.length > temporaryPageSize" class="mt-4 flex justify-end">
          <NPagination
            v-model:page="temporaryPage"
            v-model:page-size="temporaryPageSize"
            :item-count="filteredTemporaryLinks.length"
            :page-sizes="pageSizeOptions"
            show-size-picker
            size="small"
          />
        </div>
      </NSpin>
      </div>
    </section>

    <NModal
      :show="!!selectedTemporaryLink"
      preset="card"
      style="width:min(760px, 94vw)"
      title="Detalhes do acesso temporario"
      :bordered="false"
      @update:show="(value) => { if (!value) selectedTemporaryLink = null }"
    >
      <div v-if="selectedTemporaryLink" class="space-y-5">
        <div class="flex flex-wrap items-center gap-2">
          <NTag size="small" :type="selectedTemporaryLink.kind === 'public_once' ? 'warning' : selectedTemporaryLink.kind === 'live' ? 'info' : 'default'">
            {{ temporaryKindLabel(selectedTemporaryLink.kind) }}
          </NTag>
          <NTag size="small" :type="temporaryStatusType(selectedTemporaryLink.status)">
            {{ temporaryStatusLabel(selectedTemporaryLink.status) }}
          </NTag>
          <NTag v-if="selectedTemporaryLink.pinRequired" size="small" type="warning">
            PIN exigido
          </NTag>
        </div>

        <NDescriptions
          bordered
          size="small"
          label-placement="left"
          :column="1"
        >
          <NDescriptionsItem label="ID">
            #{{ selectedTemporaryLink.id }}
          </NDescriptionsItem>
          <NDescriptionsItem label="Host">
            {{ selectedTemporaryLink.hostName }} · {{ selectedTemporaryLink.hostIp || `Host #${selectedTemporaryLink.hostId}` }}
          </NDescriptionsItem>
          <NDescriptionsItem label="Criado por">
            {{ selectedTemporaryLink.createdBy }} em {{ d(new Date(selectedTemporaryLink.createdAt), 'short') }}
          </NDescriptionsItem>
          <NDescriptionsItem label="Expira em">
            {{ d(new Date(selectedTemporaryLink.expiresAt), 'short') }}
          </NDescriptionsItem>
          <NDescriptionsItem label="Uso atual">
            <span v-if="selectedTemporaryLink.kind === 'public_once'">{{ selectedTemporaryLink.activeCount }} sessao(oes)</span>
            <span v-else-if="selectedTemporaryLink.kind === 'live'">{{ selectedTemporaryLink.activeCount }} participante(s)</span>
            <span v-else>-</span>
          </NDescriptionsItem>
          <NDescriptionsItem label="Link">
            <div v-if="selectedTemporaryLink.url" class="flex flex-wrap items-center gap-2">
              <span class="break-all font-mono text-xs text-blue-300">{{ selectedTemporaryLink.url }}</span>
              <NButton size="tiny" tertiary @click="copyTemporaryUrl(selectedTemporaryLink.url)">
                Copiar
              </NButton>
            </div>
            <span v-else class="text-xs text-gray-500">
              Indisponivel para links antigos, pois o token anterior foi armazenado apenas como hash.
            </span>
          </NDescriptionsItem>
          <NDescriptionsItem v-if="selectedTemporaryLink.pin" label="PIN">
            <div class="flex items-center gap-2">
              <span class="font-mono text-sm text-amber-300">{{ selectedTemporaryLink.pin }}</span>
              <NButton size="tiny" tertiary @click="copyPin(selectedTemporaryLink.pin)">
                Copiar PIN
              </NButton>
            </div>
          </NDescriptionsItem>
        </NDescriptions>

        <div>
          <div class="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
            Historico recente
          </div>
          <NSpin :show="detailLogsLoading">
            <NEmpty
              v-if="detailLogs.length === 0"
              size="small"
              description="Nenhum evento encontrado para este alvo."
            />
            <div v-else class="space-y-2">
              <div
                v-for="log in detailLogs"
                :key="log.id"
                class="rounded-lg border border-gray-800 bg-[#111113] px-3 py-2"
              >
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="flex flex-wrap items-center gap-2">
                    <div class="text-sm font-medium text-gray-100">{{ formatLogAction(log.action) }}</div>
                    <NTag size="tiny" :bordered="false" type="info">
                      {{ detailTargetLabel(log) }}
                    </NTag>
                  </div>
                  <div class="text-xs text-gray-500">{{ d(new Date(log.timestamp), 'short') }}</div>
                </div>
                <div class="mt-1 text-xs text-gray-400">
                  {{ log.adminName }} · {{ logDetailSummary(log) }}
                </div>
              </div>
            </div>
          </NSpin>
        </div>
      </div>
    </NModal>

    <section class="mb-5 na-panel rounded-xl border">
      <button
        class="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
        @click="hostShortcutsExpanded = !hostShortcutsExpanded"
      >
        <div>
          <h2 class="text-sm font-semibold text-white">{{ $t('linksPage.shortcuts.title') }}</h2>
          <p class="mt-1 text-xs text-gray-500">{{ $t('linksPage.shortcuts.subtitle') }}</p>
        </div>
        <div class="flex shrink-0 items-center gap-3">
          <NTag size="small" :bordered="false">{{ $t('linksPage.shortcutCount', { count: filteredLinks.length }) }}</NTag>
          <span class="text-xs text-gray-500">{{ hostShortcutsExpanded ? '▲' : '▼' }}</span>
        </div>
      </button>

      <div v-if="hostShortcutsExpanded" class="border-t border-gray-800 px-4 py-4">
        <div class="mb-4 grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
          <NInput
            v-model:value="search"
            clearable
            :placeholder="$t('linksPage.search')"
          />
          <NButton size="small" tertiary :loading="loading" @click="load">
            {{ $t('linksPage.refresh') }}
          </NButton>
        </div>

        <NSpin :show="loading">
          <NEmpty
            v-if="filteredLinks.length === 0"
            :description="search ? $t('linksPage.noResults') : $t('linksPage.empty')"
          />

          <div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <NCard
              v-for="item in paginatedLinks"
              :key="item.key"
              size="small"
              :bordered="false"
              style="background:#17171c;"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-sm font-semibold text-white truncate">{{ item.link.label }}</div>
                  <button class="mt-1 text-xs text-gray-400 truncate hover:text-white" @click="goToHost(item.host.id)">
                    {{ item.host.name }} · {{ item.host.ip }}
                  </button>
                </div>
                <div class="flex flex-wrap justify-end gap-1">
                  <NTag size="small" :type="item.link.sourceType === 'manual' ? 'default' : 'info'">
                    {{ sourceTypeLabel(item.link) }}
                  </NTag>
                  <NTag size="small" :type="item.link.sourceStatus === 'error' ? 'error' : item.link.sourceStatus === 'stale' ? 'warning' : 'success'">
                    {{ sourceStatusLabel(item.link) }}
                  </NTag>
                </div>
              </div>

              <div v-if="providerLabel(item.link)" class="mt-2 text-[11px] text-gray-500">
                {{ providerLabel(item.link) }}
              </div>

              <div class="mt-3 rounded border border-gray-800 bg-[#111113] p-2.5">
                <div class="text-[11px] text-gray-500">{{ $t('linksPage.resolvedUrl') }}</div>
                <div class="mt-1 break-all font-mono text-[11px] text-blue-300">{{ item.resolvedUrl }}</div>
              </div>

              <div class="mt-3 flex flex-wrap gap-2">
                <NButton size="small" type="primary" @click="openLink(item)">{{ $t('linksPage.open') }}</NButton>
                <NButton size="small" quaternary @click="copyLink(item)">{{ $t('linksPage.copy') }}</NButton>
                <NButton size="small" quaternary @click="goToHost(item.host.id)">{{ $t('linksPage.goToHost') }}</NButton>
              </div>
            </NCard>
          </div>
          <div v-if="filteredLinks.length > shortcutPageSize" class="mt-4 flex justify-end">
            <NPagination
              v-model:page="shortcutPage"
              v-model:page-size="shortcutPageSize"
              :item-count="filteredLinks.length"
              :page-sizes="pageSizeOptions"
              show-size-picker
              size="small"
            />
          </div>
        </NSpin>
      </div>
    </section>

    <!-- Help section -->
    <div class="mb-4 na-panel rounded-xl border overflow-hidden">
      <button class="w-full flex items-center justify-between px-5 py-3.5 text-left" @click="showHelp = !showHelp">
        <span class="text-sm font-semibold text-gray-200">O que são Links e como usar</span>
        <span class="text-gray-500 text-xs">{{ showHelp ? '▲' : '▼' }}</span>
      </button>
      <div v-if="showHelp" class="border-t border-gray-800">
        <div class="px-5 py-4 space-y-4">

          <p class="text-sm text-gray-400">
            Links associam atalhos de URL a hosts — painéis de monitoramento, consoles de admin, portais internos. Use templates com variáveis do host (<span class="font-mono text-blue-300 text-xs">{ip}</span>, <span class="font-mono text-blue-300 text-xs">{port}</span>, <span class="font-mono text-blue-300 text-xs">{name}</span>) para que a URL seja resolvida automaticamente para cada servidor.
          </p>

          <!-- Cenários práticos -->
          <div>
            <p class="text-xs font-semibold text-gray-300 mb-2">Cenários práticos</p>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">

              <div class="na-code rounded-lg border p-3 space-y-1.5">
                <div class="flex items-center gap-2">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#60a5fa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0">
                    <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
                  </svg>
                  <p class="text-xs font-medium text-gray-200">Dashboard por host</p>
                </div>
                <p class="text-[11px] text-gray-500 leading-relaxed">Configure o link <span class="text-green-400 font-mono">Grafana</span> com <span class="text-blue-300 font-mono text-[10px]">http://grafana/d/host?var={name}</span>. Cada host terá seu próprio atalho direto para o painel.</p>
              </div>

              <div class="na-code rounded-lg border p-3 space-y-1.5">
                <div class="flex items-center gap-2">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#34d399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                  </svg>
                  <p class="text-xs font-medium text-gray-200">Integração com 1Password</p>
                </div>
                <p class="text-[11px] text-gray-500 leading-relaxed">Links sincronizados do 1Password aparecem aqui automaticamente com status <span class="text-green-400 font-mono">Sincronizado</span>. Sem cadastro manual — a integração mantém tudo atualizado.</p>
              </div>

              <div class="na-code rounded-lg border p-3 space-y-1.5">
                <div class="flex items-center gap-2">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#f472b6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                  </svg>
                  <p class="text-xs font-medium text-gray-200">Template de chamado</p>
                </div>
                <p class="text-[11px] text-gray-500 leading-relaxed">Crie um link com <span class="text-blue-300 font-mono text-[10px]">https://jira/issues?ip={ip}</span>. Ao clicar, abre o Jira já filtrado pelo IP do host — sem copiar e colar.</p>
              </div>

            </div>
          </div>

          <!-- Como funciona -->
          <div class="na-code rounded-lg p-4 space-y-2">
            <p class="text-xs font-semibold text-gray-300 mb-1">Como funciona</p>
            <div v-for="(step, i) in [
              'Configure links na ficha do host (aba Links) com rótulo, URL template e modo de abertura',
              'Os links aparecem aqui consolidados — visíveis conforme sua permissão de acesso aos hosts',
              'Clique em Abrir: a URL é resolvida com os dados reais do host ({ip}, {port}, {name}, {sshUser}) e aberta automaticamente',
            ]" :key="i" class="flex items-start gap-3 text-xs text-gray-400">
              <span class="shrink-0 w-5 h-5 rounded-full bg-blue-900 text-blue-300 flex items-center justify-center text-[10px] font-bold mt-0.5">{{ i + 1 }}</span>
              <p>{{ step }}</p>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div class="na-code rounded-lg border p-3 space-y-1.5">
              <p class="text-xs font-medium text-gray-200">Compartilhar sessão ao vivo</p>
              <p class="text-[11px] text-gray-500 leading-relaxed">
                Gera um link para outra pessoa acompanhar a sessão atual. O link expira conforme a política configurada e pode ser revogado nesta tela. Ao expirar ou revogar, novos acessos são bloqueados e a sessão aparece no histórico do link.
              </p>
            </div>

            <div class="na-code rounded-lg border p-3 space-y-1.5">
              <p class="text-xs font-medium text-gray-200">Abrir sessão própria</p>
              <p class="text-[11px] text-gray-500 leading-relaxed">
                Gera um link para um usuário autenticado abrir o mesmo host em uma sessão independente. A validade é exibida na lista e o link pode ser invalidado com Revogar.
              </p>
            </div>

            <div class="na-code rounded-lg border p-3 space-y-1.5">
              <p class="text-xs font-medium text-gray-200">Gerar link JIT</p>
              <p class="text-[11px] text-gray-500 leading-relaxed">
                Gera acesso público temporário ao host. Quando PIN estiver habilitado, o PIN aparece nos detalhes e pode ser copiado separadamente. Links JIT expirados, usados ou revogados não aceitam novas conexões.
              </p>
            </div>
          </div>

          <!-- Comportamentos -->
          <div class="na-code rounded-lg px-4 py-3 space-y-1 text-xs text-gray-500">
            <p class="font-medium text-gray-400">Comportamentos</p>
            <p>Templates resolvem <span class="text-gray-300 font-mono">{ip}</span>, <span class="text-gray-300 font-mono">{port}</span>, <span class="text-gray-300 font-mono">{name}</span>, <span class="text-gray-300 font-mono">{sshUser}</span> e <span class="text-gray-300 font-mono">{id}</span> com os dados reais do host</p>
            <p>Links de integração (ex: 1Password) são <span class="text-gray-300">sincronizados automaticamente</span> — não aparecem se a integração não estiver configurada</p>
            <p>Status <span class="text-yellow-400">Desatualizado</span> indica que o link veio de uma integração que não sincroniza há algum tempo — verifique a configuração do provider</p>
            <p>A lista de acessos temporários mostra status, validade, uso atual, PIN quando disponível e eventos recentes em Detalhes</p>
          </div>

        </div>
      </div>
    </div>

  </div>
</template>
