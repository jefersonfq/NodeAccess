<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NDataTable,
  NDescriptions,
  NDescriptionsItem,
  NProgress,
  NSpace,
  NSpin,
  NTag,
  NText,
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

const memoryRows = computed(() => {
  const memory = snapshot.value?.host.memory
  if (!memory) return []
  return [
    { label: 'Servidor', usedBytes: memory.usedBytes, totalBytes: memory.totalBytes, usedPercent: memory.usedPercent },
    { label: 'Processo Node RSS', usedBytes: memory.processRssBytes, totalBytes: memory.totalBytes, usedPercent: memory.totalBytes > 0 ? Math.round((memory.processRssBytes / memory.totalBytes) * 100) : 0 },
    { label: 'Heap Node', usedBytes: memory.processHeapUsedBytes, totalBytes: memory.processHeapTotalBytes, usedPercent: memory.processHeapTotalBytes > 0 ? Math.round((memory.processHeapUsedBytes / memory.processHeapTotalBytes) * 100) : 0 },
  ]
})

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

function gaugeStyle(value: number | null | undefined, threshold: number) {
  const pct = clampPercent(value)
  const color = thresholdColor(value, threshold)
  return {
    background: `conic-gradient(${color} ${pct * 3.6}deg, rgba(148, 163, 184, 0.18) 0deg)`,
  }
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
    <div class="flex flex-col gap-4 mb-6 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <h1 class="text-xl font-semibold text-white">Observabilidade</h1>
        <NText depth="3" class="text-sm">
          Saúde operacional, recursos do servidor e containers deste nó.
        </NText>
      </div>
      <NButton :loading="loading" @click="load">Atualizar</NButton>
    </div>

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

      <div class="observability-summary">
        <NCard :bordered="false" class="na-card">
          <template #header>Status geral</template>
          <div class="flex items-center justify-between gap-3">
            <NTag :type="statusType[snapshot.status]" size="large">
              {{ statusLabel[snapshot.status] }}
            </NTag>
            <NText depth="3" class="text-xs text-right">Atualizado em {{ updatedAt }}</NText>
          </div>
          <NDescriptions :column="1" size="small" class="mt-4">
            <NDescriptionsItem label="Nó">{{ snapshot.scope.nodeId }}</NDescriptionsItem>
            <NDescriptionsItem label="Versão">{{ snapshot.version }}</NDescriptionsItem>
            <NDescriptionsItem label="Cache">{{ snapshot.cacheTtlMs }} ms</NDescriptionsItem>
            <NDescriptionsItem label="Limites">
              CPU {{ snapshot.thresholds.cpuWarningPercent }}%,
              memória {{ snapshot.thresholds.memoryWarningPercent }}%,
              disco {{ snapshot.thresholds.diskWarningPercent }}%,
              backup {{ snapshot.thresholds.backupMaxAgeHours }}h
            </NDescriptionsItem>
          </NDescriptions>
        </NCard>

        <NCard :bordered="false" class="na-card">
          <template #header>CPU</template>
          <div class="metric-gauge-wrap">
            <div class="metric-gauge" :style="gaugeStyle(snapshot.host.cpu.loadPercentOfCores, cpuThreshold())">
              <div class="metric-gauge__inner">{{ formatPercent(snapshot.host.cpu.loadPercentOfCores) }}</div>
            </div>
          </div>
          <NText depth="3" class="block text-xs text-center">Load sobre {{ snapshot.host.cpu.cores }} cores</NText>
          <NDescriptions :column="1" size="small" class="mt-4">
            <NDescriptionsItem label="1 min">{{ snapshot.host.cpu.loadAverage.oneMinute }}</NDescriptionsItem>
            <NDescriptionsItem label="5 min">{{ snapshot.host.cpu.loadAverage.fiveMinutes }}</NDescriptionsItem>
            <NDescriptionsItem label="15 min">{{ snapshot.host.cpu.loadAverage.fifteenMinutes }}</NDescriptionsItem>
          </NDescriptions>
        </NCard>

        <NCard :bordered="false" class="na-card">
          <template #header>Memória</template>
          <div class="metric-gauge-wrap">
            <div class="metric-gauge" :style="gaugeStyle(snapshot.host.memory.usedPercent, memoryThreshold())">
              <div class="metric-gauge__inner">{{ formatPercent(snapshot.host.memory.usedPercent) }}</div>
            </div>
          </div>
          <NText depth="3" class="block text-xs text-center">
            {{ formatBytes(snapshot.host.memory.usedBytes) }} / {{ formatBytes(snapshot.host.memory.totalBytes) }}
          </NText>
          <div class="mt-4 space-y-3">
            <div v-for="row in memoryRows" :key="row.label">
              <div class="mb-1 flex items-center justify-between gap-3 text-xs">
                <span>{{ row.label }}</span>
                <span>{{ formatPercent(row.usedPercent) }}</span>
              </div>
              <NProgress
                :percentage="clampPercent(row.usedPercent)"
                :height="6"
                :show-indicator="false"
                :status="row.label === 'Servidor' ? thresholdProgressStatus(row.usedPercent, memoryThreshold()) : progressStatus(row.usedPercent)"
              />
            </div>
          </div>
        </NCard>

        <NCard :bordered="false" class="na-card">
          <template #header>Disco</template>
          <div class="metric-gauge-wrap">
            <div class="metric-gauge" :style="gaugeStyle(highestDisk?.usedPercent, diskThreshold())">
              <div class="metric-gauge__inner">{{ formatPercent(highestDisk?.usedPercent) }}</div>
            </div>
          </div>
          <NText depth="3" class="block text-xs text-center truncate">
            {{ highestDisk?.path || 'Sem métrica de disco' }}
          </NText>
          <NDescriptions :column="1" size="small" class="mt-4">
            <NDescriptionsItem label="Hostname">{{ snapshot.host.hostname }}</NDescriptionsItem>
            <NDescriptionsItem label="Plataforma">{{ snapshot.host.platform }} / {{ snapshot.host.arch }}</NDescriptionsItem>
            <NDescriptionsItem label="Uptime">{{ formatUptime(snapshot.host.uptimeSeconds) }}</NDescriptionsItem>
          </NDescriptions>
        </NCard>
      </div>

      <NCard :bordered="false" class="na-card mt-4">
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
        <NCard :bordered="false" class="na-card">
          <template #header>Componentes</template>
          <NText depth="3" class="block text-xs mb-3">
            O tempo em ms mostra quanto cada checagem levou para responder. Saudável indica resposta dentro do timeout operacional.
          </NText>
          <div class="component-grid">
            <div v-for="component in snapshot.components" :key="component.name" class="component-row">
              <div class="min-w-0">
                <div class="text-sm font-medium text-white">{{ componentLabels[component.name] }}</div>
                <NText v-if="component.message" depth="3" class="block text-xs truncate">{{ component.message }}</NText>
              </div>
              <NSpace align="center" :size="8">
                <NText depth="3" class="text-xs">Resposta {{ component.latencyMs }} ms</NText>
                <NTag :type="statusType[component.status]" size="small">{{ statusLabel[component.status] }}</NTag>
              </NSpace>
            </div>
          </div>
        </NCard>

        <NCard :bordered="false" class="na-card">
          <template #header>Backups</template>
          <div class="component-grid">
            <div v-for="backup in snapshot.backups" :key="backup.type" class="component-row">
              <div class="min-w-0">
                <div class="text-sm font-medium text-white">{{ backupLabels[backup.type] }}</div>
                <NText depth="3" class="block text-xs truncate">
                  {{ backup.latestFile || backup.message || backup.directory }}
                </NText>
              </div>
              <NSpace align="center" :size="8">
                <NText depth="3" class="text-xs">{{ backup.ageHours === null ? '—' : `${backup.ageHours}h` }}</NText>
                <NTag :type="statusType[backup.status]" size="small">{{ statusLabel[backup.status] }}</NTag>
              </NSpace>
            </div>
          </div>
        </NCard>
      </div>

      <NCard :bordered="false" class="na-card mt-4">
        <template #header>Disco</template>
        <NDataTable
          :columns="diskColumns"
          :data="snapshot.host.disks"
          :pagination="false"
          size="small"
          :scroll-x="620"
        />
      </NCard>

      <NCard :bordered="false" class="na-card mt-4">
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <span>Containers</span>
            <NTag :type="statusType[snapshot.docker.status]" size="small">
              {{ statusLabel[snapshot.docker.status] }}
            </NTag>
          </div>
        </template>
        <NAlert v-if="snapshot.docker.message" type="warning" class="mb-3" title="Docker stats indisponível">
          {{ snapshot.docker.message }}
        </NAlert>
        <NDataTable
          :columns="containerColumns"
          :data="snapshot.docker.containers"
          :pagination="{ pageSize: 8 }"
          size="small"
          :scroll-x="820"
        />
      </NCard>
    </template>
  </div>
</template>

<style scoped>
.observability-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.metric-gauge-wrap {
  display: flex;
  justify-content: center;
  margin: 4px 0 10px;
}

.metric-gauge {
  width: 112px;
  height: 112px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.12);
}

.metric-gauge__inner {
  width: 78px;
  height: 78px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.88);
  color: #f8fafc;
  font-size: 20px;
  font-weight: 700;
}

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
  min-height: 48px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.14);
}

.component-row:last-child {
  border-bottom: 0;
}

@media (max-width: 1280px) {
  .observability-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .observability-view {
    padding: 16px;
  }

  .observability-summary {
    grid-template-columns: 1fr;
  }

  .trend-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .trend-grid {
    grid-template-columns: 1fr;
  }

  .component-row {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
