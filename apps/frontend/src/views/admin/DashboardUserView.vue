<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  NAlert,
  NButton,
  NCollapse,
  NCollapseItem,
  NEmpty,
  NInput,
  NSelect,
  NSpin,
  NTag,
  NText,
  NTimeline,
  NTimelineItem,
} from 'naive-ui'
import type { UserDashboard, UserDashboardPeriodDays } from '@nodeaccess/shared'
import { userDashboardService } from '@/services/user-dashboard.service'
import { buildSessionReportRoute, buildTimelineReportRoute } from '@/utils/user-dashboard-navigation'

const route = useRoute()
const router = useRouter()

const periodDays = ref<UserDashboardPeriodDays>(30)
const loading = ref(true)
const error = ref<string | null>(null)
const dashboard = ref<UserDashboard | null>(null)
const timelineFilter = ref<'all' | 'session' | 'audit' | 'sharing' | 'auth' | 'error'>('all')
const timelineSeverity = ref<'all' | 'info' | 'success' | 'warning' | 'error'>('all')
const timelineSearch = ref('')

const periodOptions = [
  { label: '7 dias', value: 7 },
  { label: '15 dias', value: 15 },
  { label: '30 dias', value: 30 },
  { label: '60 dias', value: 60 },
]

// Dual-mode: se tiver userId no params e o usuário for admin, usa; senão usa o próprio
const targetUserId = computed(() => {
  const id = route.params.userId
  return id ? Number(id) : undefined
})

const chartWidth = 960
const chartHeight = 230
const chartLeft = 48
const chartRight = 18
const chartTop = 18
const chartBottom = 38
const chartPlotWidth = chartWidth - chartLeft - chartRight
const chartPlotHeight = chartHeight - chartTop - chartBottom

const chartMaximum = computed(() => {
  const values = dashboard.value?.daily.flatMap((point) => [point.sessions, point.failedSessions]) ?? [0]
  return Math.max(1, ...values)
})

const chartTicks = computed(() => {
  const maximum = chartMaximum.value
  return Array.from(new Set([maximum, Math.round(maximum * .75), Math.round(maximum * .5), Math.round(maximum * .25), 0]))
    .sort((a, b) => b - a)
})

function chartX(index: number) {
  const count = dashboard.value?.daily.length ?? 0
  return chartLeft + (count <= 1 ? chartPlotWidth / 2 : (index / (count - 1)) * chartPlotWidth)
}

function chartY(value: number) {
  return chartTop + chartPlotHeight - (value / chartMaximum.value) * chartPlotHeight
}

function chartSeriesPath(field: 'sessions' | 'failedSessions') {
  const points = dashboard.value?.daily ?? []
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${chartX(index)} ${chartY(point[field])}`).join(' ')
}

function showChartDateLabel(index: number) {
  const count = dashboard.value?.daily.length ?? 0
  if (count <= 15) return true
  const step = count <= 30 ? 3 : 6
  return index === 0 || index === count - 1 || index % step === 0
}

const totalAuditPosture = computed(() => {
  const posture = dashboard.value?.auditPosture
  if (!posture) return 0
  return posture.running + posture.completed + posture.failed + posture.purged
})

const cacheStatusLabel = computed(() => {
  if (!dashboard.value) return 'Cache indisponivel'
  const generatedAt = formatDate(dashboard.value.cache.generatedAt)
  return dashboard.value.cache.hit
    ? `Cache usado - gerado em ${generatedAt}`
    : `Atualizado em ${generatedAt}`
})

const successfulSessions = computed(() =>
  Math.max(0, (dashboard.value?.summary.sessions ?? 0) - (dashboard.value?.summary.failedSessions ?? 0)),
)

const sessionSuccessRate = computed(() => {
  const total = dashboard.value?.summary.sessions ?? 0
  return total > 0 ? Math.round((successfulSessions.value / total) * 100) : 0
})

const previousSessionSuccessRate = computed(() => {
  const previous = dashboard.value?.previousPeriod
  if (!previous?.sessions) return 0
  return Math.round(((previous.sessions - previous.failedSessions) / previous.sessions) * 100)
})

function comparisonLabel(current: number, previous: number, suffix = '') {
  if (previous === 0) return current === 0 ? 'Estavel vs. periodo anterior' : 'Novo uso no periodo'
  const change = Math.round(((current - previous) / previous) * 100)
  if (change === 0) return `Estavel${suffix}`
  return `${change > 0 ? '+' : ''}${change}%${suffix}`
}

const managementHealth = computed(() => {
  const value = dashboard.value
  if (!value || value.summary.sessions === 0) {
    return { label: 'Sem atividade', tone: 'neutral', detail: 'Nenhuma sessao no periodo selecionado.' }
  }
  if (value.summary.failedSessions > 0 || value.auditPosture.riskHigh > 0 || value.auditPosture.failed > 0) {
    return { label: 'Requer atencao', tone: 'danger', detail: 'Existem falhas ou riscos que precisam de revisao.' }
  }
  if (value.auditPosture.riskMedium > 0) {
    return { label: 'Acompanhar', tone: 'warning', detail: 'O uso esta ativo, com pontos de atencao moderados.' }
  }
  return { label: 'Uso saudavel', tone: 'success', detail: 'Atividade sem falhas ou riscos relevantes no periodo.' }
})

const timelineCounts = computed(() => {
  const items = dashboard.value?.timeline ?? []
  return {
    all: items.length,
    session: items.filter((item) => item.type === 'session').length,
    audit: items.filter((item) => item.type === 'audit').length,
    sharing: items.filter((item) => item.type === 'sharing').length,
    auth: items.filter((item) => item.type === 'auth').length,
    error: items.filter((item) => item.severity === 'error').length,
  }
})

const timelineSeverityOptions = [
  { label: 'Todas as severidades', value: 'all' },
  { label: 'Informativo', value: 'info' },
  { label: 'Concluido', value: 'success' },
  { label: 'Atencao', value: 'warning' },
  { label: 'Falha', value: 'error' },
]

const filteredTimeline = computed(() => {
  const query = timelineSearch.value.trim().toLocaleLowerCase('pt-BR')
  return (dashboard.value?.timeline ?? []).filter((item) => {
    const matchesType = timelineFilter.value === 'all'
      || (timelineFilter.value === 'error' ? item.severity === 'error' : item.type === timelineFilter.value)
    const matchesSeverity = timelineSeverity.value === 'all' || item.severity === timelineSeverity.value
    const matchesSearch = !query
      || item.title.toLocaleLowerCase('pt-BR').includes(query)
      || item.description.toLocaleLowerCase('pt-BR').includes(query)
      || String(item.sessionId ?? '').includes(query)
    return matchesType && matchesSeverity && matchesSearch
  })
})

async function load(forceRefresh = false) {
  loading.value = true
  error.value = null
  try {
    const { data } = await userDashboardService.get(periodDays.value, targetUserId.value, forceRefresh)
    dashboard.value = data
  } catch {
    error.value = 'Nao foi possivel carregar o dashboard deste usuario.'
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(periodDays, () => load())
watch(targetUserId, () => load())

function formatDate(value: string | Date | null) {
  if (!value) return 'Sem fim registrado'
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatShortDate(value: string) {
  const [, month, day] = value.split('-')
  return `${day}/${month}`
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function timelineTagType(severity: string) {
  if (severity === 'success') return 'success'
  if (severity === 'warning') return 'warning'
  if (severity === 'error') return 'error'
  return 'info'
}

function timelineTypeLabel(type: string) {
  const labels: Record<string, string> = {
    session: 'Sessao',
    audit: 'Auditoria',
    sharing: 'Compartilhamento',
    auth: 'Acesso',
  }
  return labels[type] ?? type
}

function timelineSeverityLabel(severity: string) {
  const labels: Record<string, string> = {
    info: 'Informativo',
    success: 'Concluido',
    warning: 'Atencao',
    error: 'Falha',
  }
  return labels[severity] ?? severity
}

function roleLabel(role: string) {
  return role === 'admin' ? 'Admin' : 'Usuario'
}

function roleTagType(role: string): 'warning' | 'default' {
  return role === 'admin' ? 'warning' : 'default'
}

function goBack() {
  if (targetUserId.value) {
    router.push({ name: 'admin-dashboard' })
  } else {
    router.push({ name: 'dashboard' })
  }
}

function openDailyReport(date: string, failuresOnly = false) {
  if (!dashboard.value) return
  void router.push(buildSessionReportRoute({
    userId: dashboard.value.user.id,
    date,
    hasError: failuresOnly ? true : undefined,
  }))
}

function openHostReport(hostId: number) {
  if (!dashboard.value) return
  void router.push(buildSessionReportRoute({
    userId: dashboard.value.user.id,
    hostId,
    periodDays: periodDays.value,
  }))
}

function openTimelineReport(item: UserDashboard['timeline'][number]) {
  if (!dashboard.value) return
  void router.push(buildTimelineReportRoute(item, dashboard.value.user.id, dashboard.value.user.email))
}
</script>

<template>
  <div class="user-dashboard-page">
    <div class="user-dashboard-header">
      <div class="min-w-0">
        <NButton text size="small" style="color:#9ca3af;margin-bottom:10px" @click="goBack">
          {{ targetUserId ? 'Voltar para dashboard admin' : 'Voltar para dashboard' }}
        </NButton>
        <h1>{{ dashboard?.user.name ?? 'Dashboard do usuario' }}</h1>
        <NText depth="3" class="text-sm">
          Atividade, sessoes e auditoria do usuario no periodo selecionado.
        </NText>
      </div>

      <div class="user-dashboard-actions">
        <NSelect
          v-model:value="periodDays"
          :options="periodOptions"
          size="small"
          style="width:120px"
          aria-label="Periodo do dashboard"
        />
        <NButton size="small" ghost @click="load()">Atualizar</NButton>
        <NButton size="small" secondary @click="load(true)">Ignorar cache</NButton>
      </div>
    </div>

    <NAlert v-if="error" type="error" :title="error" class="mb-4" />

    <NSpin :show="loading">
      <template v-if="dashboard">
        <!-- Leitura executiva -->
        <section class="executive-summary" data-testid="user-management-summary">
          <div class="executive-identity">
            <div>
              <span class="eyebrow">Leitura para gestao</span>
              <div class="user-email">{{ dashboard.user.email }}</div>
            </div>
            <NTag size="small" :type="roleTagType(dashboard.user.role)">
              {{ roleLabel(dashboard.user.role) }}
            </NTag>
          </div>
          <div class="executive-verdict" :class="`tone-${managementHealth.tone}`">
            <span>Status no periodo</span>
            <strong>{{ managementHealth.label }}</strong>
            <small>{{ managementHealth.detail }}</small>
          </div>
        </section>

        <!-- Respostas principais -->
        <section class="user-kpi-grid">
          <div class="metric-tile">
            <span>Atividade</span>
            <strong>{{ dashboard.summary.sessions }}</strong>
            <small>{{ dashboard.summary.activeSessions }} ativa(s) agora</small>
            <em>{{ comparisonLabel(dashboard.summary.sessions, dashboard.previousPeriod.sessions) }}</em>
          </div>
          <div class="metric-tile">
            <span>Confiabilidade</span>
            <strong :class="{ danger: sessionSuccessRate < 90 }">{{ sessionSuccessRate }}%</strong>
            <small>{{ successfulSessions }} de {{ dashboard.summary.sessions }} sessoes sem falha</small>
            <em>{{ comparisonLabel(sessionSuccessRate, previousSessionSuccessRate, ' vs. anterior') }}</em>
          </div>
          <div class="metric-tile">
            <span>Alcance operacional</span>
            <strong>{{ dashboard.summary.hostsAccessed }}</strong>
            <small>hosts distintos</small>
            <em>{{ comparisonLabel(dashboard.summary.hostsAccessed, dashboard.previousPeriod.hostsAccessed) }}</em>
          </div>
          <div class="metric-tile">
            <span>Pontos de atencao</span>
            <strong :class="{ danger: dashboard.summary.failedSessions + dashboard.auditPosture.failed + dashboard.auditPosture.riskHigh > 0 }">
              {{ dashboard.summary.failedSessions + dashboard.auditPosture.failed + dashboard.auditPosture.riskHigh }}
            </strong>
            <small>falhas de sessao, auditoria ou risco alto</small>
            <em>{{ dashboard.previousPeriod.failedSessions }} falha(s) de sessao no periodo anterior</em>
          </div>
        </section>

        <!-- Grid de painéis -->
        <section class="decision-grid">
          <!-- Grafico diario -->
          <div class="dashboard-panel wide priority-trend">
            <div class="panel-title">
              <div>
                <h2>Tendencia de acesso</h2>
                <p>Serie temporal de sessoes e falhas. Selecione um ponto para abrir o relatorio daquele dia.</p>
              </div>
              <div class="chart-totals" aria-label="Totais da serie">
                <span><i class="legend sessions" /> <strong>{{ dashboard.summary.sessions }}</strong> sessoes</span>
                <span><i class="legend failures" /> <strong>{{ dashboard.summary.failedSessions }}</strong> falhas</span>
              </div>
            </div>
            <div class="time-series-chart">
              <svg
                :viewBox="`0 0 ${chartWidth} ${chartHeight}`"
                role="img"
                aria-labelledby="access-trend-title access-trend-description"
              >
                <title id="access-trend-title">Tendencia diaria de sessoes e falhas</title>
                <desc id="access-trend-description">Cada ponto pode ser aberto para consultar as sessoes do usuario naquele dia.</desc>

                <g v-for="tick in chartTicks" :key="`tick-${tick}`" class="chart-axis">
                  <line :x1="chartLeft" :x2="chartWidth - chartRight" :y1="chartY(tick)" :y2="chartY(tick)" />
                  <text :x="chartLeft - 10" :y="chartY(tick) + 4">{{ tick }}</text>
                </g>

                <path class="chart-line sessions" :d="chartSeriesPath('sessions')" />
                <path class="chart-line failures" :d="chartSeriesPath('failedSessions')" />

                <g
                  v-for="(point, index) in dashboard.daily"
                  :key="point.date"
                  class="chart-day"
                >
                  <text
                    v-if="showChartDateLabel(index)"
                    class="chart-date"
                    :x="chartX(index)"
                    :y="chartHeight - 10"
                  >{{ formatShortDate(point.date) }}</text>

                  <g
                    class="chart-point sessions"
                  >
                    <title>{{ point.sessions }} sessoes em {{ formatShortDate(point.date) }}</title>
                    <circle
                      :cx="chartX(index)"
                      :cy="chartY(point.sessions)"
                      r="6"
                      role="button"
                      tabindex="0"
                      :aria-label="`${point.sessions} sessoes em ${formatShortDate(point.date)}. Abrir relatorio.`"
                      @click="openDailyReport(point.date)"
                      @keydown.enter.space.prevent="openDailyReport(point.date)"
                    />
                    <text class="chart-value" :x="chartX(index)" :y="chartY(point.sessions) - 10">{{ point.sessions }}</text>
                  </g>

                  <g
                    class="chart-point failures"
                  >
                    <title>{{ point.failedSessions }} falhas em {{ formatShortDate(point.date) }}</title>
                    <circle
                      :cx="chartX(index)"
                      :cy="chartY(point.failedSessions)"
                      r="6"
                      role="button"
                      tabindex="0"
                      :aria-label="`${point.failedSessions} falhas em ${formatShortDate(point.date)}. Abrir relatorio filtrado por falhas.`"
                      @click="openDailyReport(point.date, true)"
                      @keydown.enter.space.prevent="openDailyReport(point.date, true)"
                    />
                    <text
                      v-if="point.failedSessions > 0"
                      class="chart-value"
                      :x="chartX(index)"
                      :y="chartY(point.failedSessions) + 16"
                    >{{ point.failedSessions }}</text>
                  </g>
                </g>
              </svg>
            </div>
            <div class="chart-legend">
              <span><i class="legend sessions" /> Sessoes — abre todas do dia</span>
              <span><i class="legend failures" /> Falhas — abre somente sessoes com erro</span>
            </div>
          </div>

          <!-- Top hosts -->
          <div class="dashboard-panel priority-hosts">
            <div class="panel-title">
              <div>
                <h2>Top hosts acessados</h2>
                <p>Hosts com mais acessos no periodo.</p>
              </div>
            </div>
            <div v-if="dashboard.topHosts.length" class="bar-list">
              <button
                v-for="item in dashboard.topHosts"
                :key="item.hostId"
                type="button"
                class="bar-row host-report-link"
                :aria-label="`Abrir sessoes de ${item.hostName} neste periodo`"
                @click="openHostReport(item.hostId)"
              >
                <div class="bar-label">
                <div class="min-w-0">
                  <span class="block truncate">{{ item.hostName }}</span>
                  <NTag v-if="item.hostDeleted" size="small" type="warning" class="mt-1">
                    Host excluido
                  </NTag>
                  <span class="monospace block text-xs" style="color:#6b7280">{{ item.hostIp }}</span>
                </div>
                  <strong>{{ item.count }}</strong>
                </div>
                <div class="bar-meta">
                  <NText depth="3" class="text-xs">Ultimo: {{ formatDate(item.lastSeenAt) }}</NText>
                </div>
                <span class="host-report-hint">Ver sessoes filtradas →</span>
              </button>
            </div>
            <NEmpty v-else description="Sem hosts acessados no periodo." class="py-5" />
          </div>

          <!-- Postura de auditoria -->
          <div class="dashboard-panel detail-audit">
            <div class="panel-title">
              <div>
                <h2>Postura de auditoria</h2>
                <p>Status e risco das auditorias do usuario.</p>
              </div>
            </div>
            <div class="audit-posture">
              <div class="audit-posture-item">
                <span>Concluidas</span>
                <strong>{{ dashboard.auditPosture.completed }}</strong>
              </div>
              <div class="audit-posture-item">
                <span>Em execucao</span>
                <strong>{{ dashboard.auditPosture.running }}</strong>
              </div>
              <div class="audit-posture-item">
                <span>Falhas</span>
                <strong class="danger">{{ dashboard.auditPosture.failed }}</strong>
              </div>
              <div class="audit-posture-item">
                <span>Risco alto</span>
                <strong class="danger">{{ dashboard.auditPosture.riskHigh }}</strong>
              </div>
              <div class="audit-posture-item">
                <span>Risco medio</span>
                <strong :class="{ warn: dashboard.auditPosture.riskMedium > 0 }">{{ dashboard.auditPosture.riskMedium }}</strong>
              </div>
              <div class="audit-posture-item">
                <span>Risco baixo</span>
                <strong>{{ dashboard.auditPosture.riskLow }}</strong>
              </div>
            </div>
            <div class="risk-meter" :aria-label="`Total de auditorias: ${totalAuditPosture}`">
              <span class="ok" :style="{ width: `${totalAuditPosture ? (dashboard.auditPosture.completed / totalAuditPosture) * 100 : 0}%` }" />
              <span class="warn" :style="{ width: `${totalAuditPosture ? (dashboard.auditPosture.running / totalAuditPosture) * 100 : 0}%` }" />
              <span class="bad" :style="{ width: `${totalAuditPosture ? (dashboard.auditPosture.failed / totalAuditPosture) * 100 : 0}%` }" />
            </div>
          </div>

          <!-- Compartilhamentos -->
          <div class="dashboard-panel detail-sharing">
            <div class="panel-title">
              <div>
                <h2>Compartilhamentos</h2>
                <p>Sessoes compartilhadas criadas e das quais participou.</p>
              </div>
            </div>
            <div class="sharing-grid">
              <div class="sharing-item">
                <span>Criadas</span>
                <strong>{{ dashboard.summary.sharedSessionsOwned }}</strong>
                <small>como dono</small>
              </div>
              <div class="sharing-item">
                <span>Participadas</span>
                <strong>{{ dashboard.summary.sharedSessionsParticipated }}</strong>
                <small>como viewer</small>
              </div>
            </div>
          </div>

          <!-- Sessoes recentes -->
          <div class="dashboard-panel wide detail-sessions">
            <div class="panel-title">
              <div>
                <h2>Sessoes recentes</h2>
                <p>Ultimos acessos do periodo com host, data e status.</p>
              </div>
            </div>
            <div v-if="dashboard.recentSessions.length" class="recent-session-list">
              <div v-for="session in dashboard.recentSessions" :key="session.id" class="recent-session-row">
                <div>
                  <strong>{{ session.hostName }}</strong>
                  <NTag v-if="session.hostDeleted" size="small" type="warning" class="ml-2">
                    Host excluido
                  </NTag>
                  <span class="monospace">{{ session.hostIp }}</span>
                  <span>{{ formatDate(session.startedAt) }} - {{ formatDate(session.endedAt) }}</span>
                </div>
                <div class="recent-session-meta">
                  <NTag size="small" :type="session.active ? 'success' : 'default'">
                    {{ session.active ? 'Ativa' : 'Encerrada' }}
                  </NTag>
                  <NTag size="small">{{ session.connectionMethod }}</NTag>
                  <NTag v-if="session.errorCode" size="small" type="error">
                    {{ session.errorCode }}
                  </NTag>
                </div>
              </div>
            </div>
            <NEmpty v-else description="Sem sessoes recentes neste periodo." class="py-6" />
          </div>

          <!-- Timeline -->
          <div class="dashboard-panel wide priority-timeline" data-testid="user-activity-timeline">
            <div class="panel-title">
              <div>
                <h2>Timeline do usuario</h2>
                <p>Eventos recentes de sessoes, auditoria e compartilhamento.</p>
              </div>
            </div>
            <div v-if="dashboard.timeline.length" class="timeline-filter-bar">
              <div class="timeline-tools" role="group" aria-label="Filtrar timeline por tipo">
                <NButton size="small" :type="timelineFilter === 'all' ? 'primary' : 'default'" @click="timelineFilter = 'all'">Todos {{ timelineCounts.all }}</NButton>
                <NButton size="small" :type="timelineFilter === 'session' ? 'primary' : 'default'" @click="timelineFilter = 'session'">Sessoes {{ timelineCounts.session }}</NButton>
                <NButton size="small" :type="timelineFilter === 'audit' ? 'primary' : 'default'" @click="timelineFilter = 'audit'">Auditoria {{ timelineCounts.audit }}</NButton>
                <NButton size="small" :type="timelineFilter === 'sharing' ? 'primary' : 'default'" @click="timelineFilter = 'sharing'">Compart. {{ timelineCounts.sharing }}</NButton>
                <NButton size="small" :type="timelineFilter === 'auth' ? 'primary' : 'default'" @click="timelineFilter = 'auth'">Acessos {{ timelineCounts.auth }}</NButton>
                <NButton size="small" :type="timelineFilter === 'error' ? 'error' : 'default'" @click="timelineFilter = 'error'">Falhas {{ timelineCounts.error }}</NButton>
              </div>
              <div class="timeline-secondary-filters">
                <NInput
                  v-model:value="timelineSearch"
                  clearable
                  size="small"
                  placeholder="Buscar evento ou sessao"
                  aria-label="Buscar na timeline"
                />
                <NSelect
                  v-model:value="timelineSeverity"
                  :options="timelineSeverityOptions"
                  size="small"
                  aria-label="Filtrar por severidade"
                />
              </div>
            </div>
            <div v-if="dashboard.timeline.length" class="timeline-result-summary" aria-live="polite">
              {{ filteredTimeline.length }} de {{ dashboard.timeline.length }} evento(s) exibido(s)
            </div>
            <div v-if="filteredTimeline.length" class="timeline-list">
              <NTimeline>
                <NTimelineItem
                  v-for="item in filteredTimeline"
                  :key="item.id"
                  :type="timelineTagType(item.severity)"
                >
                  <div class="timeline-action">
                    <div class="timeline-title">
                      <div class="timeline-heading">
                        <strong>{{ item.title }}</strong>
                        <time :datetime="String(item.occurredAt)">{{ formatDate(item.occurredAt) }}</time>
                      </div>
                      <NTag size="small" :type="timelineTagType(item.severity)">
                        {{ timelineSeverityLabel(item.severity) }}
                      </NTag>
                      <NTag size="small" :bordered="false">
                        {{ timelineTypeLabel(item.type) }}
                      </NTag>
                      <NTag v-if="item.hostDeleted" size="small" type="warning">
                        {{ $t('hosts.messages.hostDeleted') }}
                      </NTag>
                      <NButton
                        size="tiny"
                        text
                        type="primary"
                        class="timeline-report-link"
                        @click="openTimelineReport(item)"
                      >
                        {{ item.type === 'audit' && item.sessionId ? 'Abrir auditoria' : item.type === 'auth' ? 'Ver logins' : 'Ver no relatorio' }} →
                      </NButton>
                    </div>
                    <NText depth="3" class="text-xs">{{ item.description }}</NText>

                    <NCollapse class="timeline-details" arrow-placement="right">
                      <NCollapseItem title="Ver detalhes" :name="item.id">
                        <div class="timeline-detail-grid">
                          <div>
                            <span>Tipo</span>
                            <strong>{{ timelineTypeLabel(item.type) }}</strong>
                          </div>
                          <div>
                            <span>Severidade</span>
                            <strong>{{ timelineSeverityLabel(item.severity) }}</strong>
                          </div>
                          <div>
                            <span>Data</span>
                            <strong>{{ formatDate(item.occurredAt) }}</strong>
                          </div>
                          <div>
                            <span>Sessao</span>
                            <strong>{{ item.sessionId ? `#${item.sessionId}` : 'Sem sessao' }}</strong>
                          </div>
                        </div>
                      </NCollapseItem>
                    </NCollapse>
                  </div>
                </NTimelineItem>
              </NTimeline>
            </div>
            <NEmpty v-else description="Sem eventos para este filtro." class="py-6" />
          </div>

          <div class="dashboard-panel wide technical-details">
            <NCollapse arrow-placement="right">
              <NCollapseItem title="Detalhes tecnicos e origem dos dados" name="technical-details">
                <div class="technical-detail-grid">
                  <div><span>ID do usuario</span><strong>#{{ dashboard.user.id }}</strong></div>
                  <div><span>Auditorias</span><strong>{{ dashboard.summary.audits }}</strong><small>{{ dashboard.summary.auditEvents }} eventos</small></div>
                  <div><span>Trafego auditado</span><strong>{{ formatBytes(dashboard.summary.bytesIn + dashboard.summary.bytesOut) }}</strong></div>
                  <div><span>Atualizacao</span><strong>{{ cacheStatusLabel }}</strong><small>TTL {{ dashboard.cache.ttlSeconds }}s</small></div>
                </div>
              </NCollapseItem>
            </NCollapse>
          </div>
        </section>
      </template>

      <NEmpty v-else-if="!loading" description="Dashboard indisponivel para este usuario." class="py-10" />
    </NSpin>
  </div>
</template>

<style scoped>
.user-dashboard-page {
  max-width: 1280px;
  padding: 32px;
}

.user-dashboard-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 24px;
}

.user-dashboard-header h1 {
  margin: 0 0 4px;
  color: #fff;
  font-size: 28px;
  font-weight: 650;
}

.user-dashboard-actions,
.user-tags,
.user-meta,
.chart-legend,
.recent-session-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.executive-summary,
.dashboard-panel,
.metric-tile {
  border: 1px solid #25252b;
  border-radius: 8px;
  background: #17171b;
}

.executive-summary {
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 16px;
  padding: 18px;
}

.executive-identity {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 1;
  gap: 16px;
}

.eyebrow {
  display: block;
  margin-bottom: 6px;
  color: #60a5fa;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.executive-verdict {
  display: grid;
  align-content: center;
  gap: 3px;
  width: min(390px, 42%);
  padding: 12px 14px;
  border-left: 3px solid #52525b;
  border-radius: 6px;
  background: #111114;
}

.executive-verdict span,
.executive-verdict small {
  color: #a1a1aa;
  font-size: 12px;
}

.executive-verdict strong {
  color: #fff;
  font-size: 18px;
}

.executive-verdict.tone-success { border-color: #22c55e; }
.executive-verdict.tone-warning { border-color: #f59e0b; }
.executive-verdict.tone-danger { border-color: #ef4444; }

.user-email {
  color: #fff;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 18px;
  font-weight: 700;
}

.user-meta {
  margin-top: 8px;
  color: #9ca3af;
  font-size: 13px;
}

.user-tags {
  margin-top: 12px;
}

.user-kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.metric-tile {
  min-height: 118px;
  padding: 14px;
}

.metric-tile span,
.metric-tile small {
  display: block;
  color: #8b8b95;
  font-size: 12px;
}

.metric-tile strong {
  display: block;
  margin: 8px 0 4px;
  color: #fff;
  font-size: 30px;
}

.metric-tile em {
  display: block;
  margin-top: 9px;
  color: #60a5fa;
  font-size: 11px;
  font-style: normal;
  font-weight: 600;
}

.danger {
  color: #f87171 !important;
}

.warn {
  color: #f59e0b !important;
}

.decision-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.dashboard-panel {
  min-width: 0;
  padding: 18px;
}

.dashboard-panel.wide {
  grid-column: 1 / -1;
}

.priority-trend { order: 1; }
.priority-hosts {
  grid-column: 1 / -1;
  order: 2;
}
.priority-timeline { order: 3; }
.detail-audit { order: 4; }
.detail-sharing { order: 5; }
.detail-sessions { order: 6; }
.technical-details { order: 7; }

.panel-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.panel-title h2 {
  margin: 0 0 4px;
  color: #fff;
  font-size: 16px;
  font-weight: 650;
}

.panel-title p {
  margin: 0;
  color: #8b8b95;
  font-size: 12px;
  line-height: 1.45;
}

.chart-totals {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px 16px;
  color: #a1a1aa;
  font-size: 12px;
}

.chart-totals strong {
  color: #fff;
  font-size: 16px;
}

.time-series-chart {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
}

.time-series-chart svg {
  display: block;
  width: 100%;
  min-width: 680px;
  height: auto;
}

.chart-axis line {
  stroke: #29292f;
  stroke-width: 1;
}

.chart-axis text {
  fill: #777783;
  font-size: 11px;
  text-anchor: end;
}

.chart-line {
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 3;
}

.chart-line.sessions {
  stroke: #38bdf8;
}

.chart-line.failures {
  stroke: #f87171;
}

.chart-point {
  cursor: pointer;
  outline: none;
}

.chart-point circle {
  stroke: #17171b;
  stroke-width: 3;
  transition: r .15s ease, filter .15s ease;
}

.chart-point.sessions circle {
  fill: #38bdf8;
}

.chart-point.failures circle {
  fill: #f87171;
}

.chart-point:hover circle,
.chart-point circle:focus {
  r: 7px;
  filter: brightness(1.2);
}

.chart-point circle:focus {
  stroke: #fff;
}

.chart-value {
  fill: #d4d4d8;
  font-size: 10px;
  font-weight: 700;
  pointer-events: none;
  text-anchor: middle;
}

.chart-date {
  fill: #777783;
  font-size: 10px;
  pointer-events: none;
  text-anchor: middle;
}

.legend.sessions {
  background: #38bdf8;
}

.legend.failures {
  background: #f87171;
}

.chart-legend {
  margin-top: 14px;
  color: #a1a1aa;
  font-size: 12px;
}

.legend {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  margin-right: 5px;
}

.bar-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.bar-row {
  display: grid;
  gap: 4px;
  width: 100%;
  padding: 12px;
  border: 1px solid #25252b;
  border-radius: 8px;
  background: #111114;
  color: inherit;
  text-align: left;
}

.host-report-link {
  cursor: pointer;
  transition: border-color .15s ease, background-color .15s ease;
}

.host-report-link:hover,
.host-report-link:focus-visible {
  border-color: #3b82f6;
  background: #15151a;
  outline: none;
}

.host-report-hint {
  margin-top: 5px;
  color: #60a5fa;
  font-size: 11px;
}

.bar-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: #d1d5db;
  font-size: 13px;
}

.bar-label strong {
  color: #fff;
  flex-shrink: 0;
}

.bar-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.monospace {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.audit-posture {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.audit-posture-item {
  min-height: 76px;
  padding: 10px;
  border: 1px solid #25252b;
  border-radius: 8px;
  background: #111114;
  text-align: left;
}

.audit-posture span {
  display: block;
  color: #8b8b95;
  font-size: 12px;
}

.audit-posture strong {
  display: block;
  margin-top: 8px;
  color: #fff;
  font-size: 24px;
}

.risk-meter {
  display: flex;
  height: 10px;
  overflow: hidden;
  margin-top: 16px;
  border-radius: 8px;
  background: #25252b;
}

.risk-meter .ok {
  background: #22c55e;
}

.risk-meter .warn {
  background: #f59e0b;
}

.risk-meter .bad {
  background: #ef4444;
}

.sharing-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.sharing-item {
  min-height: 90px;
  padding: 14px;
  border: 1px solid #25252b;
  border-radius: 8px;
  background: #111114;
}

.sharing-item span {
  display: block;
  color: #8b8b95;
  font-size: 12px;
}

.sharing-item strong {
  display: block;
  margin: 8px 0 4px;
  color: #fff;
  font-size: 30px;
}

.sharing-item small {
  display: block;
  color: #8b8b95;
  font-size: 12px;
}

.recent-session-list {
  display: grid;
  gap: 10px;
}

.recent-session-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px;
  border: 1px solid #25252b;
  border-radius: 8px;
  background: #111114;
}

.recent-session-row strong,
.recent-session-row span {
  display: block;
}

.recent-session-row strong {
  color: #fff;
  font-size: 13px;
}

.recent-session-row span {
  margin-top: 3px;
  color: #8b8b95;
  font-size: 12px;
}

.timeline-list {
  padding: 4px 2px 0;
}

.timeline-filter-bar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 8px;
}

.timeline-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.timeline-secondary-filters {
  display: grid;
  grid-template-columns: minmax(190px, 1fr) 180px;
  gap: 8px;
  width: min(430px, 100%);
}

.timeline-result-summary {
  margin-bottom: 18px;
  color: #8b8b95;
  font-size: 12px;
}

.timeline-action {
  display: grid;
  gap: 4px;
  width: 100%;
  padding: 13px 14px;
  border: 1px solid #25252b;
  border-radius: 8px;
  background: #111114;
  color: inherit;
  text-align: left;
}

.timeline-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.timeline-report-link {
  margin-left: auto;
}

.timeline-heading {
  display: grid;
  flex: 1;
  gap: 2px;
  min-width: 220px;
}

.timeline-heading time {
  color: #71717a;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.timeline-details {
  margin-top: 6px;
}

.timeline-detail-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.timeline-detail-grid div {
  min-height: 62px;
  padding: 9px;
  border: 1px solid #25252b;
  border-radius: 8px;
  background: #17171b;
}

.timeline-detail-grid span {
  display: block;
  color: #8b8b95;
  font-size: 11px;
}

.timeline-detail-grid strong {
  display: block;
  margin-top: 5px;
  color: #fff;
  font-size: 12px;
}

.technical-detail-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  padding-top: 8px;
}

.technical-detail-grid > div {
  display: grid;
  gap: 4px;
  padding: 12px;
  border: 1px solid #25252b;
  border-radius: 8px;
  background: #111114;
}

.technical-detail-grid span,
.technical-detail-grid small {
  color: #8b8b95;
  font-size: 11px;
}

.technical-detail-grid strong {
  color: #fff;
  font-size: 13px;
}

@media (max-width: 1100px) {
  .user-kpi-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .user-dashboard-page {
    padding: 20px;
  }

  .user-dashboard-header,
  .executive-summary,
  .recent-session-row {
    display: grid;
  }

  .executive-verdict {
    width: auto;
  }

  .user-kpi-grid,
  .decision-grid,
    .audit-posture,
    .timeline-detail-grid,
    .sharing-grid,
    .technical-detail-grid {
    grid-template-columns: 1fr;
  }

  .timeline-filter-bar,
  .timeline-secondary-filters,
  .bar-list {
    display: grid;
    grid-template-columns: 1fr;
    width: 100%;
  }

  .user-dashboard-actions {
    width: 100%;
  }
}
</style>
