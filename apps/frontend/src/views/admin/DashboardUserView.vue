<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  NAlert,
  NButton,
  NCollapse,
  NCollapseItem,
  NEmpty,
  NSelect,
  NSpin,
  NTag,
  NText,
  NTimeline,
  NTimelineItem,
} from 'naive-ui'
import type { UserDashboard, UserDashboardPeriodDays } from '@nodeaccess/shared'
import { userDashboardService } from '@/services/user-dashboard.service'

const route = useRoute()
const router = useRouter()

const periodDays = ref<UserDashboardPeriodDays>(30)
const loading = ref(true)
const error = ref<string | null>(null)
const dashboard = ref<UserDashboard | null>(null)
const timelineFilter = ref<'all' | 'session' | 'audit' | 'sharing' | 'error'>('all')

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

const maxDailySessions = computed(() =>
  Math.max(1, ...(dashboard.value?.daily.map((p) => p.sessions) ?? [1])),
)

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

const filteredTimeline = computed(() => {
  const items = dashboard.value?.timeline ?? []
  if (timelineFilter.value === 'all') return items
  if (timelineFilter.value === 'error') return items.filter((item) => item.severity === 'error')
  return items.filter((item) => item.type === timelineFilter.value)
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
        <!-- Identidade do usuário -->
        <section class="user-identity-panel">
          <div class="user-identity-main">
            <div class="user-email">{{ dashboard.user.email }}</div>
            <div class="user-meta">
              <span>ID: #{{ dashboard.user.id }}</span>
            </div>
            <div class="user-tags">
              <NTag size="small" :type="roleTagType(dashboard.user.role)">
                {{ roleLabel(dashboard.user.role) }}
              </NTag>
              <NTag size="small" :type="dashboard.cache.hit ? 'success' : 'default'">
                Cache {{ dashboard.cache.hit ? 'usado' : 'atualizado' }} - {{ dashboard.cache.ttlSeconds }}s
              </NTag>
              <NText depth="3" class="text-xs">{{ cacheStatusLabel }}</NText>
            </div>
          </div>
        </section>

        <!-- KPIs -->
        <section class="user-kpi-grid">
          <div class="metric-tile">
            <span>Sessoes</span>
            <strong>{{ dashboard.summary.sessions }}</strong>
            <small>no periodo selecionado</small>
          </div>
          <div class="metric-tile">
            <span>Sessoes ativas</span>
            <strong>{{ dashboard.summary.activeSessions }}</strong>
            <small>agora</small>
          </div>
          <div class="metric-tile">
            <span>Falhas</span>
            <strong :class="{ danger: dashboard.summary.failedSessions > 0 }">{{ dashboard.summary.failedSessions }}</strong>
            <small>no periodo selecionado</small>
          </div>
          <div class="metric-tile">
            <span>Hosts acessados</span>
            <strong>{{ dashboard.summary.hostsAccessed }}</strong>
            <small>hosts distintos</small>
          </div>
          <div class="metric-tile">
            <span>Auditorias</span>
            <strong>{{ dashboard.summary.audits }}</strong>
            <small>{{ dashboard.summary.auditEvents }} eventos capturados</small>
          </div>
          <div class="metric-tile">
            <span>Trafego auditado</span>
            <strong>{{ formatBytes(dashboard.summary.bytesIn + dashboard.summary.bytesOut) }}</strong>
            <small>entrada e saida</small>
          </div>
        </section>

        <!-- Grid de painéis -->
        <section class="decision-grid">
          <!-- Grafico diario -->
          <div class="dashboard-panel wide">
            <div class="panel-title">
              <div>
                <h2>Tendencia de acesso</h2>
                <p>Sessoes e falhas por dia no periodo selecionado.</p>
              </div>
            </div>
            <div class="daily-chart" aria-label="Grafico diario de sessoes">
              <div v-for="point in dashboard.daily" :key="point.date" class="daily-column">
                <span class="daily-value">{{ point.sessions || '' }}</span>
                <div class="daily-stack">
                  <div
                    class="daily-bar sessions"
                    :style="{ height: `${Math.max(6, (point.sessions / maxDailySessions) * 128)}px` }"
                    :title="`${point.sessions} sessoes em ${formatShortDate(point.date)}`"
                  />
                  <div
                    v-if="point.failedSessions"
                    class="daily-bar failures"
                    :style="{ height: `${Math.max(4, (point.failedSessions / maxDailySessions) * 128)}px` }"
                    :title="`${point.failedSessions} falhas em ${formatShortDate(point.date)}`"
                  />
                </div>
                <small>{{ formatShortDate(point.date) }}</small>
              </div>
            </div>
            <div class="chart-legend">
              <span><i class="legend sessions" /> Sessoes</span>
              <span><i class="legend failures" /> Falhas</span>
            </div>
          </div>

          <!-- Top hosts -->
          <div class="dashboard-panel">
            <div class="panel-title">
              <div>
                <h2>Top hosts acessados</h2>
                <p>Hosts com mais acessos no periodo.</p>
              </div>
            </div>
            <div v-if="dashboard.topHosts.length" class="bar-list">
              <div
                v-for="item in dashboard.topHosts"
                :key="item.hostId"
                class="bar-row"
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
              </div>
            </div>
            <NEmpty v-else description="Sem hosts acessados no periodo." class="py-5" />
          </div>

          <!-- Postura de auditoria -->
          <div class="dashboard-panel">
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
          <div class="dashboard-panel">
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
          <div class="dashboard-panel wide">
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
          <div class="dashboard-panel wide">
            <div class="panel-title">
              <div>
                <h2>Timeline do usuario</h2>
                <p>Eventos recentes de sessoes, auditoria e compartilhamento.</p>
              </div>
            </div>
            <div v-if="dashboard.timeline.length" class="timeline-tools">
              <NButton size="tiny" :type="timelineFilter === 'all' ? 'primary' : 'default'" @click="timelineFilter = 'all'">Todos</NButton>
              <NButton size="tiny" :type="timelineFilter === 'session' ? 'primary' : 'default'" @click="timelineFilter = 'session'">Sessoes</NButton>
              <NButton size="tiny" :type="timelineFilter === 'audit' ? 'primary' : 'default'" @click="timelineFilter = 'audit'">Auditoria</NButton>
              <NButton size="tiny" :type="timelineFilter === 'sharing' ? 'primary' : 'default'" @click="timelineFilter = 'sharing'">Compart.</NButton>
              <NButton size="tiny" :type="timelineFilter === 'error' ? 'primary' : 'default'" @click="timelineFilter = 'error'">Falhas</NButton>
            </div>
            <div v-if="filteredTimeline.length" class="timeline-list">
              <NTimeline>
                <NTimelineItem
                  v-for="item in filteredTimeline"
                  :key="item.id"
                  :type="timelineTagType(item.severity)"
                  :time="formatDate(item.occurredAt)"
                >
                  <div class="timeline-action">
                    <div class="timeline-title">
                      <strong>{{ item.title }}</strong>
                      <NTag size="small" :type="timelineTagType(item.severity)">
                        {{ timelineTypeLabel(item.type) }}
                      </NTag>
                      <NTag v-if="item.hostDeleted" size="small" type="warning">
                        {{ $t('hosts.messages.hostDeleted') }}
                      </NTag>
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

.user-identity-panel,
.dashboard-panel,
.metric-tile {
  border: 1px solid #25252b;
  border-radius: 8px;
  background: #17171b;
}

.user-identity-panel {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 24px;
  padding: 18px;
}

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
  grid-template-columns: repeat(6, minmax(0, 1fr));
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
  padding: 18px;
}

.dashboard-panel.wide {
  grid-column: 1 / -1;
}

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

.daily-chart {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(22px, 1fr));
  align-items: end;
  gap: 8px;
  min-height: 172px;
}

.daily-column {
  display: grid;
  grid-template-rows: 14px 136px auto;
  align-items: end;
  gap: 4px;
  min-width: 0;
  text-align: center;
}

.daily-stack {
  display: flex;
  align-items: end;
  justify-content: center;
  gap: 3px;
  height: 136px;
}

.daily-bar {
  display: block;
  width: 8px;
  border-radius: 4px 4px 0 0;
}

.daily-bar.sessions,
.legend.sessions {
  background: #38bdf8;
}

.daily-bar.failures,
.legend.failures {
  background: #f87171;
}

.daily-column small {
  color: #777783;
  font-size: 11px;
}

.daily-value {
  font-size: 10px;
  color: #60a5fa;
  text-align: center;
  line-height: 1;
  font-variant-numeric: tabular-nums;
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
  gap: 14px;
}

.bar-row {
  display: grid;
  gap: 4px;
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

.timeline-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.timeline-action {
  display: grid;
  gap: 4px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #25252b;
  border-radius: 8px;
  background: #111114;
  color: inherit;
  text-align: left;
}

.timeline-title {
  display: flex;
  align-items: center;
  gap: 8px;
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
  .user-identity-panel,
  .recent-session-row {
    display: grid;
  }

  .user-kpi-grid,
  .decision-grid,
  .audit-posture,
  .timeline-detail-grid,
  .sharing-grid {
    grid-template-columns: 1fr;
  }

  .user-dashboard-actions {
    width: 100%;
  }
}
</style>
