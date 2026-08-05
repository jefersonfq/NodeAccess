<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NDataTable,
  NProgress,
  NSpin,
  NTag,
  NText,
  NTooltip,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import {
  observabilityService,
  type BackupMetric,
  type ComponentHealthMetric,
  type DockerContainerMetric,
  type HostDiskMetric,
  type ObservabilitySnapshot,
  type ObservabilityStatus,
} from '@/services/observability.service'

const loading = ref(true)
const error = ref<string | null>(null)
const snapshot = ref<ObservabilitySnapshot | null>(null)

onMounted(() => {
  void load()
})

async function load() {
  loading.value = true
  error.value = null
  try {
    const { data } = await observabilityService.getSummary()
    snapshot.value = data
  } catch {
    error.value = 'Não foi possível carregar a observabilidade operacional.'
  } finally {
    loading.value = false
  }
}

const statusType: Record<ObservabilityStatus, 'success' | 'warning' | 'error'> = {
  ok: 'success',
  degraded: 'warning',
  unavailable: 'error',
}

const statusLabel: Record<ObservabilityStatus, string> = {
  ok: 'Saudável',
  degraded: 'Atenção',
  unavailable: 'Indisponível',
}

const componentLabels: Record<ComponentHealthMetric['name'], string> = {
  api: 'API',
  gateway: 'Gateway SSH',
  mysql: 'MySQL',
  redis: 'Redis',
  guacd: 'guacd',
}

const backupLabels: Record<BackupMetric['type'], string> = {
  mysql: 'MySQL',
  session_audit: 'Auditoria SSH',
}

const updatedAt = computed(() =>
  snapshot.value ? formatDate(snapshot.value.timestamp) : '—',
)

const highestDisk = computed(() => {
  const disks = snapshot.value?.host.disks ?? []
  return disks.reduce<HostDiskMetric | null>((highest, disk) => {
    if (!highest || disk.usedPercent > highest.usedPercent) return disk
    return highest
  }, null)
})

const trendMetrics = computed(() => {
  const points = snapshot.value?.history ?? []
  const thresholds = snapshot.value?.thresholds
  return [
    {
      key: 'cpu',
      label: 'CPU',
      latest: points.at(-1)?.cpuPercent ?? snapshot.value?.host.cpu.loadPercentOfCores ?? null,
      points: points.map((point) => point.cpuPercent),
      threshold: thresholds?.cpuWarningPercent ?? 85,
    },
    {
      key: 'memory',
      label: 'Memória',
      latest: points.at(-1)?.memoryPercent ?? snapshot.value?.host.memory.usedPercent ?? null,
      points: points.map((point) => point.memoryPercent),
      threshold: thresholds?.memoryWarningPercent ?? 85,
    },
    {
      key: 'disk',
      label: 'Disco',
      latest: points.at(-1)?.diskPercent ?? highestDisk.value?.usedPercent ?? null,
      points: points.map((point) => point.diskPercent),
      threshold: thresholds?.diskWarningPercent ?? 90,
    },
  ]
})

const containerColumns = computed<DataTableColumns<DockerContainerMetric>>(() => [
  {
    title: 'Container',
    key: 'name',
    minWidth: 190,
    render: (row) => h('div', { class: 'min-w-0' }, [
      h(NText, { strong: true, style: 'font-size:13px;display:block' }, () => row.name),
      row.id ? h(NText, { depth: 3, style: 'font-size:11px;font-family:monospace' }, () => row.id) : null,
    ]),
  },
  {
    title: 'CPU',
    key: 'cpuPercent',
    width: 100,
    render: (row) => formatPercent(row.cpuPercent),
  },
  {
    title: 'Memória',
    key: 'memory',
    minWidth: 180,
    render: (row) => h('div', [
      h(NText, { style: 'font-size:12px' }, () => `${formatBytes(row.memoryUsageBytes)} / ${formatBytes(row.memoryLimitBytes)}`),
      h(NProgress, {
        percentage: clampPercent(row.memoryPercent),
        height: 6,
        showIndicator: false,
        status: progressStatus(row.memoryPercent),
        style: 'margin-top:6px',
      }),
    ]),
  },
  {
    title: 'Rede',
    key: 'network',
    minWidth: 160,
    render: (row) => `${formatBytes(row.networkInputBytes)} / ${formatBytes(row.networkOutputBytes)}`,
  },
  {
    title: 'Disco I/O',
    key: 'block',
    minWidth: 160,
    render: (row) => `${formatBytes(row.blockInputBytes)} / ${formatBytes(row.blockOutputBytes)}`,
  },
])

const diskColumns = computed<DataTableColumns<HostDiskMetric>>(() => [
  {
    title: 'Caminho',
    key: 'path',
    minWidth: 220,
    render: (row) => h('div', { class: 'min-w-0' }, [
      h(NText, { strong: true, style: 'font-size:13px;display:block' }, () => row.path),
      h(NText, { depth: 3, style: 'font-size:11px;font-family:monospace' }, () => row.mount),
    ]),
  },
  {
    title: 'Uso',
    key: 'usedPercent',
    minWidth: 180,
    render: (row) => h('div', [
      h(NText, { style: 'font-size:12px' }, () => `${formatBytes(row.usedBytes)} / ${formatBytes(row.totalBytes)}`),
      h(NProgress, {
        percentage: clampPercent(row.usedPercent),
        height: 6,
        showIndicator: false,
        status: thresholdProgressStatus(row.usedPercent, diskThreshold()),
        style: 'margin-top:6px',
      }),
    ]),
  },
  {
    title: 'Livre',
    key: 'availableBytes',
    width: 140,
    render: (row) => formatBytes(row.availableBytes),
  },
])

function formatBytes(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let amount = value
  let unitIndex = 0
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024
    unitIndex += 1
  }
  return `${amount >= 10 || unitIndex === 0 ? Math.round(amount) : amount.toFixed(1)} ${units[unitIndex]}`
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`
}

function clampPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function progressStatus(value: number | null | undefined) {
  const pct = clampPercent(value)
  if (pct >= 90) return 'error'
  if (pct >= 75) return 'warning'
  return 'success'
}

function thresholdStatus(value: number | null | undefined, threshold: number) {
  const pct = clampPercent(value)
  if (pct >= Math.max(90, threshold)) return 'critical'
  if (pct >= threshold) return 'warning'
  return 'ok'
}

function thresholdColor(value: number | null | undefined, threshold: number) {
  const status = thresholdStatus(value, threshold)
  if (status === 'critical') return '#ef4444'
  if (status === 'warning') return '#f59e0b'
  return '#22c55e'
}

function thresholdProgressStatus(value: number | null | undefined, threshold: number) {
  const status = thresholdStatus(value, threshold)
  if (status === 'critical') return 'error'
  if (status === 'warning') return 'warning'
  return 'success'
}

function cpuThreshold() {
  return snapshot.value?.thresholds.cpuWarningPercent ?? 85
}

function memoryThreshold() {
  return snapshot.value?.thresholds.memoryWarningPercent ?? 85
}

function diskThreshold() {
  return snapshot.value?.thresholds.diskWarningPercent ?? 90
}

function trendStyle(value: number | null | undefined, threshold: number) {
  const pct = clampPercent(value)
  const color = thresholdColor(value, threshold)
  return {
    height: `${Math.max(8, pct)}%`,
    backgroundColor: color,
  }
}

function trendSummary(metric: { label: string; latest: number | null; points: Array<number | null>; threshold: number }) {
  const values = metric.points.filter((point): point is number => point !== null && Number.isFinite(point))
  const max = values.length ? Math.max(...values) : null
  return `${metric.label}: ${metric.points.length} amostra${metric.points.length === 1 ? '' : 's'}, ultimo valor ${formatPercent(metric.latest)}, maior valor ${formatPercent(max)}, limite ${metric.threshold}%`
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}min`
  return `${minutes}min`
}
</script>

<template>
  <div class="p-6 observability-view">
    <header class="observability-header">
      <div>
        <NText depth="3" class="section-eyebrow">Plataforma</NText>
        <h1 class="text-xl font-semibold text-white">Observabilidade</h1>
        <NText depth="3" class="text-sm">
          Saúde operacional e capacidade deste nó.
        </NText>
      </div>
      <div class="header-actions">
        <NText v-if="snapshot" depth="3" class="text-xs">Atualizado {{ updatedAt }}</NText>
        <NButton secondary :loading="loading" @click="load">Atualizar</NButton>
      </div>
    </header>

    <NAlert v-if="error" type="error" class="mb-4" :title="error" />

    <NSpin v-if="loading && !snapshot" />

    <template v-else-if="snapshot">
      <NAlert
        v-if="snapshot.scope.aggregation === 'local-only'"
        type="info"
        class="mb-4"
        title="Snapshot local"
      >
        {{ snapshot.scope.note }}
      </NAlert>

      <NAlert
        v-if="snapshot.warnings.length"
        type="warning"
        class="mb-4"
        title="Alertas ativos"
      >
        <ul class="m-0 pl-4">
          <li v-for="warning in snapshot.warnings" :key="warning">{{ warning }}</li>
        </ul>
      </NAlert>

      <section class="health-overview" aria-labelledby="health-title">
        <div class="health-heading">
          <div>
            <h2 id="health-title">Visão geral</h2>
            <NText depth="3" class="text-xs">Recursos comparados aos limites operacionais.</NText>
          </div>
          <NTag :type="statusType[snapshot.status]" round>{{ statusLabel[snapshot.status] }}</NTag>
        </div>

        <div class="metric-grid">
          <NTooltip trigger="hover">
            <template #trigger>
              <article class="metric-tile" tabindex="0" :aria-label="`CPU ${formatPercent(snapshot.host.cpu.loadPercentOfCores)}. Load de 1 minuto ${snapshot.host.cpu.loadAverage.oneMinute}, 5 minutos ${snapshot.host.cpu.loadAverage.fiveMinutes}, 15 minutos ${snapshot.host.cpu.loadAverage.fifteenMinutes}. Alerta em ${cpuThreshold()}%.`">
                <span>CPU</span>
                <strong>{{ formatPercent(snapshot.host.cpu.loadPercentOfCores) }}</strong>
                <NProgress :percentage="clampPercent(snapshot.host.cpu.loadPercentOfCores)" :height="5" :show-indicator="false" :status="thresholdProgressStatus(snapshot.host.cpu.loadPercentOfCores, cpuThreshold())" />
                <small>{{ snapshot.host.cpu.cores }} cores</small>
              </article>
            </template>
            Load: 1 min {{ snapshot.host.cpu.loadAverage.oneMinute }}, 5 min {{ snapshot.host.cpu.loadAverage.fiveMinutes }}, 15 min {{ snapshot.host.cpu.loadAverage.fifteenMinutes }}. Alerta em {{ cpuThreshold() }}%.
          </NTooltip>
          <NTooltip trigger="hover">
            <template #trigger>
              <article class="metric-tile" tabindex="0" :aria-label="`Memória ${formatPercent(snapshot.host.memory.usedPercent)}. Heap Node ${formatBytes(snapshot.host.memory.processHeapUsedBytes)}. RSS ${formatBytes(snapshot.host.memory.processRssBytes)}. Alerta em ${memoryThreshold()}%.`">
                <span>Memória</span>
                <strong>{{ formatPercent(snapshot.host.memory.usedPercent) }}</strong>
                <NProgress :percentage="clampPercent(snapshot.host.memory.usedPercent)" :height="5" :show-indicator="false" :status="thresholdProgressStatus(snapshot.host.memory.usedPercent, memoryThreshold())" />
                <small>{{ formatBytes(snapshot.host.memory.usedBytes) }} de {{ formatBytes(snapshot.host.memory.totalBytes) }}</small>
              </article>
            </template>
            Heap Node: {{ formatBytes(snapshot.host.memory.processHeapUsedBytes) }}. RSS: {{ formatBytes(snapshot.host.memory.processRssBytes) }}. Alerta em {{ memoryThreshold() }}%.
          </NTooltip>
          <NTooltip trigger="hover">
            <template #trigger>
              <article class="metric-tile" tabindex="0" :aria-label="`Disco ${formatPercent(highestDisk?.usedPercent)}. ${snapshot.host.disks.length} volumes. Alerta em ${diskThreshold()}%.`">
                <span>Disco</span>
                <strong>{{ formatPercent(highestDisk?.usedPercent) }}</strong>
                <NProgress :percentage="clampPercent(highestDisk?.usedPercent)" :height="5" :show-indicator="false" :status="thresholdProgressStatus(highestDisk?.usedPercent, diskThreshold())" />
                <small>{{ highestDisk?.path || 'Sem métrica de disco' }}</small>
              </article>
            </template>
            Maior ocupação entre {{ snapshot.host.disks.length }} volume(s). Alerta em {{ diskThreshold() }}%.
          </NTooltip>
        </div>
      </section>

      <NCard :bordered="false" class="na-card mt-4 compact-card">
        <template #header>Tendência recente</template>
        <div class="trend-header">
          <NText depth="3" class="text-xs">
            Últimos snapshots mantidos em memória neste nó para leitura rápida de tendência.
          </NText>
          <NText depth="3" class="text-xs">
            {{ snapshot.history.length }} amostra{{ snapshot.history.length === 1 ? '' : 's' }}
          </NText>
        </div>
        <div class="trend-grid">
          <div v-for="metric in trendMetrics" :key="metric.key" class="trend-row">
            <div class="trend-label">
              <span>{{ metric.label }}</span>
              <strong>{{ formatPercent(metric.latest) }}</strong>
            </div>
            <p class="sr-only">{{ trendSummary(metric) }}</p>
            <div class="trend-bars" :aria-label="trendSummary(metric)">
              <span
                v-for="(point, index) in metric.points"
                :key="`${metric.key}-${index}`"
                class="trend-bar"
                :style="trendStyle(point, metric.threshold)"
                :title="formatPercent(point)"
              />
            </div>
          </div>
        </div>
      </NCard>

      <div class="grid grid-cols-1 gap-4 mt-4 xl:grid-cols-2">
        <NCard :bordered="false" class="na-card compact-card">
          <template #header>Componentes</template>
          <div class="component-grid">
            <NTooltip v-for="component in snapshot.components" :key="component.name" trigger="hover">
              <template #trigger>
                <div class="component-row" tabindex="0" :aria-label="`${componentLabels[component.name]}: ${statusLabel[component.status]}, ${component.latencyMs} ms. ${component.message || 'Sem mensagem adicional.'}`">
                  <span class="status-dot" :class="`status-dot--${component.status}`" />
                  <div class="min-w-0 component-name">{{ componentLabels[component.name] }}</div>
                  <NText depth="3" class="text-xs">{{ component.latencyMs }} ms</NText>
                  <NTag :type="statusType[component.status]" size="small" round>{{ statusLabel[component.status] }}</NTag>
                </div>
              </template>
              <div class="min-w-0">
                {{ component.message || `${componentLabels[component.name]} respondeu em ${component.latencyMs} ms.` }}
              </div>
            </NTooltip>
          </div>
        </NCard>

        <NCard :bordered="false" class="na-card compact-card">
          <template #header>Backups</template>
          <div class="component-grid">
            <NTooltip v-for="backup in snapshot.backups" :key="backup.type" trigger="hover">
              <template #trigger>
                <div class="component-row" tabindex="0" :aria-label="`${backupLabels[backup.type]}: ${statusLabel[backup.status]}, ${backup.ageHours === null ? 'idade indisponível' : `${backup.ageHours} horas`}. ${backup.latestFile || backup.message || backup.directory}`">
                  <span class="status-dot" :class="`status-dot--${backup.status}`" />
                  <div class="min-w-0 component-name">{{ backupLabels[backup.type] }}</div>
                  <NText depth="3" class="text-xs">{{ backup.ageHours === null ? '—' : `${backup.ageHours}h` }}</NText>
                  <NTag :type="statusType[backup.status]" size="small" round>{{ statusLabel[backup.status] }}</NTag>
                </div>
              </template>
              {{ backup.latestFile || backup.message || backup.directory }}
            </NTooltip>
          </div>
        </NCard>
      </div>

      <section class="technical-details" aria-label="Detalhes técnicos">
        <details class="detail-panel">
          <summary>
            <span><strong>Servidor e limites</strong><small>{{ snapshot.host.hostname }} · uptime {{ formatUptime(snapshot.host.uptimeSeconds) }}</small></span>
            <span class="detail-action">Ver detalhes</span>
          </summary>
          <div class="host-details">
            <div><span>Nó</span><strong>{{ snapshot.scope.nodeId }}</strong></div>
            <div><span>Versão</span><strong>{{ snapshot.version }}</strong></div>
            <div><span>Plataforma</span><strong>{{ snapshot.host.platform }} / {{ snapshot.host.arch }}</strong></div>
            <div><span>Cache</span><strong>{{ snapshot.cacheTtlMs }} ms</strong></div>
            <div class="host-details__wide"><span>Limites</span><strong>CPU {{ snapshot.thresholds.cpuWarningPercent }}%, memória {{ snapshot.thresholds.memoryWarningPercent }}%, disco {{ snapshot.thresholds.diskWarningPercent }}%, backup {{ snapshot.thresholds.backupMaxAgeHours }}h</strong></div>
          </div>
        </details>
        <details class="detail-panel">
          <summary>
            <span><strong>Volumes de disco</strong><small>{{ snapshot.host.disks.length }} volume(s) monitorado(s)</small></span>
            <span class="detail-action">Ver detalhes</span>
          </summary>
          <NDataTable :columns="diskColumns" :data="snapshot.host.disks" :pagination="false" size="small" :scroll-x="620" />
        </details>
        <details class="detail-panel">
          <summary>
            <span><strong>Containers</strong><small>{{ snapshot.docker.containers.length }} container(s)</small></span>
            <NTag :type="statusType[snapshot.docker.status]" size="small" round>{{ statusLabel[snapshot.docker.status] }}</NTag>
          </summary>
          <NAlert v-if="snapshot.docker.message" type="warning" class="mb-3" title="Docker stats indisponível">{{ snapshot.docker.message }}</NAlert>
          <NDataTable :columns="containerColumns" :data="snapshot.docker.containers" :pagination="{ pageSize: 8 }" size="small" :scroll-x="820" />
        </details>
      </section>
    </template>
  </div>
</template>

<style scoped>
.observability-header, .health-heading, .header-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.observability-header { margin-bottom: 24px; }
.section-eyebrow { display: block; margin-bottom: 3px; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }

.health-overview {
  padding: 18px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 12px;
  background: linear-gradient(145deg, rgba(30, 41, 59, .68), rgba(15, 23, 42, .48));
}

.health-heading h2 { margin: 0 0 2px; color: #f8fafc; font-size: 15px; font-weight: 600; }
.metric-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 16px; }
.metric-tile { min-width: 0; padding: 14px; border: 1px solid rgba(148,163,184,.12); border-radius: 9px; background: rgba(15,23,42,.42); outline: none; }
.metric-tile:focus-visible { box-shadow: 0 0 0 2px #60a5fa; }
.metric-tile span, .metric-tile small { display: block; color: #94a3b8; font-size: 11px; }
.metric-tile strong { display: block; margin: 3px 0 8px; color: #f8fafc; font-size: 22px; font-weight: 650; }
.metric-tile small { margin-top: 7px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.compact-card :deep(.n-card-header) { padding-bottom: 8px; }
.compact-card :deep(.n-card__content) { padding-top: 4px; }
.component-name { flex: 1; color: #e2e8f0; font-size: 13px; font-weight: 500; }
.status-dot { width: 7px; height: 7px; flex: none; border-radius: 50%; background: #22c55e; }
.status-dot--degraded { background: #f59e0b; }
.status-dot--unavailable { background: #ef4444; }

.technical-details { display: grid; gap: 8px; margin-top: 16px; }
.detail-panel { border: 1px solid rgba(148,163,184,.14); border-radius: 9px; background: rgba(15,23,42,.34); }
.detail-panel summary { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 62px; padding: 12px 16px; cursor: pointer; list-style: none; }
.detail-panel summary::-webkit-details-marker { display: none; }
.detail-panel summary:focus-visible { outline: 2px solid #60a5fa; outline-offset: 2px; }
.detail-panel summary > span:first-child { display: grid; gap: 3px; }
.detail-panel summary strong { color: #e2e8f0; font-size: 13px; }
.detail-panel summary small, .detail-action { color: #94a3b8; font-size: 11px; }
.detail-panel[open] .detail-action { color: #60a5fa; }
.detail-panel > :not(summary) { margin: 0 16px 16px; }
.host-details { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 10px; padding-top: 4px; }
.host-details div { display: grid; gap: 3px; padding: 10px; border-radius: 7px; background: rgba(30,41,59,.55); }
.host-details span { color: #94a3b8; font-size: 11px; }
.host-details strong { overflow-wrap: anywhere; color: #e2e8f0; font-size: 12px; font-weight: 500; }
.host-details__wide { grid-column: span 4; }

.trend-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.trend-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.trend-row {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.trend-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: #e2e8f0;
  font-size: 13px;
}

.trend-label strong {
  color: #f8fafc;
  font-size: 14px;
}

.trend-bars {
  height: 76px;
  display: flex;
  align-items: end;
  gap: 5px;
  padding: 10px;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.42);
}

.trend-bar {
  flex: 1 1 0;
  min-width: 4px;
  border-radius: 999px 999px 2px 2px;
  opacity: 0.9;
}

.component-grid {
  display: grid;
  gap: 10px;
}

.component-row {
  display: flex;
  min-height: 42px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.14);
}

.component-row:last-child {
  border-bottom: 0;
}

@media (max-width: 720px) {
  .observability-view {
    padding: 16px;
  }

  .observability-header { align-items: stretch; flex-direction: column; }
  .header-actions { width: 100%; }
  .metric-grid { grid-template-columns: 1fr; }
  .host-details { grid-template-columns: 1fr; }
  .host-details__wide { grid-column: auto; }

  .trend-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .trend-grid {
    grid-template-columns: 1fr;
  }

  .detail-panel summary { min-height: 58px; }
}
</style>
