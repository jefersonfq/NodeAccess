<script setup lang="ts">
import { computed } from 'vue'
import { NAlert, NEmpty, NTag, NText } from 'naive-ui'
import type { DiagnosticRunHistory } from '@nodeaccess/shared'

const props = defineProps<{ history: DiagnosticRunHistory | null }>()
const emit = defineEmits<{ openRun: [runId: number] }>()

const recentTrend = computed(() => props.history?.trend.slice(-12) ?? [])

function riskType(risk: 'low' | 'medium' | 'high' | null) {
  if (risk === 'high') return 'error'
  if (risk === 'medium') return 'warning'
  if (risk === 'low') return 'success'
  return 'default'
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="dashboard-panel diagnostic-history-panel">
    <div class="panel-title">
      <div>
        <h2>Histórico dos diagnósticos</h2>
        <p>Evolução observada nas últimas {{ history?.windowSize ?? 30 }} execuções, sem atribuição automática de causa.</p>
      </div>
    </div>

    <template v-if="history?.totals.runs">
      <div class="history-totals" aria-label="Resumo histórico dos diagnósticos">
        <div><span>Execuções</span><strong>{{ history.totals.runs }}</strong></div>
        <div><span>Concluídas</span><strong>{{ history.totals.completed }}</strong></div>
        <div><span>Execuções falhas</span><strong :class="{ danger: history.totals.failed > 0 }">{{ history.totals.failed }}</strong></div>
        <div><span>Comandos falhos</span><strong :class="{ danger: history.totals.commandFailures > 0 }">{{ history.totals.commandFailures }}</strong></div>
        <div><span>Risco alto</span><strong :class="{ danger: history.totals.highRisk > 0 }">{{ history.totals.highRisk }}</strong></div>
      </div>

      <NAlert v-for="warning in history.warnings" :key="warning" type="warning" :show-icon="false" class="history-warning">
        {{ warning }}
      </NAlert>

      <section aria-labelledby="diagnostic-history-trend-title">
        <h3 id="diagnostic-history-trend-title">Linha do tempo recente</h3>
        <div class="history-trend" role="list">
          <button
            v-for="point in recentTrend"
            :key="point.runId"
            type="button"
            class="history-point"
            role="listitem"
            :aria-label="`Abrir execução ${point.runId}, ${point.failedCommands} comandos falhos, risco ${point.riskLevel ?? 'indisponível'}`"
            @click="emit('openRun', point.runId)"
          >
            <span class="history-point-date">{{ formatDate(point.createdAt) }}</span>
            <strong>#{{ point.runId }}</strong>
            <NTag size="tiny" :type="point.failedCommands ? 'error' : point.status === 'completed' ? 'success' : 'default'">
              {{ point.failedCommands }} falha(s)
            </NTag>
            <NTag size="tiny" :type="riskType(point.riskLevel)">Risco {{ point.riskLevel ?? 'n/d' }}</NTag>
            <NText depth="3" class="history-playbook">{{ point.playbookName }}</NText>
          </button>
        </div>
      </section>

      <section aria-labelledby="diagnostic-recurring-findings-title">
        <h3 id="diagnostic-recurring-findings-title">Achados recorrentes</h3>
        <div v-if="history.recurringFindings.length" class="recurring-findings">
          <div v-for="finding in history.recurringFindings" :key="finding.finding" class="recurring-finding">
            <div><strong>{{ finding.finding }}</strong><NText depth="3" class="block text-xs">Última ocorrência: {{ formatDate(finding.lastSeenAt) }}</NText></div>
            <NTag type="warning" size="small">{{ finding.occurrences }} ocorrências</NTag>
          </div>
        </div>
        <NEmpty v-else description="Nenhum achado textual apareceu em duas ou mais execuções." class="py-4" />
      </section>
    </template>
    <NEmpty v-else description="Execute ao menos um diagnóstico para formar o histórico deste host." class="py-5" />
  </div>
</template>

<style scoped>
.diagnostic-history-panel { grid-column: 1 / -1; }
.panel-title { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.panel-title h2, h3 { margin: 0; color: #fff; }
.panel-title h2 { font-size: 16px; }
.panel-title p { margin: 4px 0 0; color: #8b8b95; font-size: 12px; }
h3 { margin: 16px 0 8px; font-size: 13px; }
.history-totals { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
.history-totals > div { padding: 12px; border: 1px solid #29292f; border-radius: 8px; background: #17171b; }
.history-totals span { display: block; color: #8b8b95; font-size: 11px; }
.history-totals strong { display: block; margin-top: 5px; color: #fff; font-size: 20px; }
.history-totals strong.danger { color: #fca5a5; }
.history-warning { margin-top: 12px; }
.history-trend { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; }
.history-point { min-width: 0; padding: 10px; border: 1px solid #29292f; border-radius: 8px; background: #17171b; color: inherit; text-align: left; cursor: pointer; }
.history-point:hover, .history-point:focus-visible { border-color: #60a5fa; outline: none; }
.history-point > * { display: block; margin-top: 5px; }
.history-point-date { margin-top: 0; color: #8b8b95; font-size: 10px; }
.history-point strong { color: #fff; font-size: 13px; }
.history-playbook { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.recurring-findings { display: grid; gap: 8px; }
.recurring-finding { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border: 1px solid #29292f; border-radius: 8px; }
.recurring-finding strong { color: #e5e7eb; font-size: 12px; }
@media (max-width: 760px) {
  .history-totals { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .history-trend { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .recurring-finding { align-items: flex-start; flex-direction: column; }
}
</style>
