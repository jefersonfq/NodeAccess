<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NAlert, NButton, NCard, NEmpty, NModal, NSpin, NTag, NText } from 'naive-ui'
import type { DiagnosticRunCommand, DiagnosticRunDetail } from '@nodeaccess/shared'
import { diagnosticPlaybookService } from '@/services/diagnostic-playbook.service'
import { settingsService } from '@/services/settings.service'

const route = useRoute()
const router = useRouter()

const loading = ref(true)
const summaryRefreshing = ref(false)
const exporting = ref(false)
const showHelp = ref(false)
const error = ref<string | null>(null)
const run = ref<DiagnosticRunDetail | null>(null)
const autoSummaryEnabled = ref<boolean | null>(null)
let refreshTimer: number | null = null

const helpQuickItems = [
  {
    title: 'O que e',
    description: 'Detalhe completo de uma execucao de diagnostico, com comandos aprovados, saida coletada e resumo por IA.',
  },
  {
    title: 'Como usar',
    description: 'Revise status, leia o resumo por IA e confirme nos comandos a evidencia que sustenta a conclusao.',
  },
  {
    title: 'Quando abrir',
    description: 'Quando o dashboard indicar falha, risco relevante, IA pronta ou quando for preciso validar cada comando.',
  },
]
const helpSections = [
  {
    title: 'Resumo por IA',
    description: 'Sintetiza o resultado coletado, mostra risco, confianca, achados e proximos passos. O disparo automatico depende da configuracao do tenant.',
  },
  {
    title: 'Comandos',
    description: 'Lista os comandos previstos no playbook e o status de cada um durante a execucao.',
  },
  {
    title: 'Saida',
    description: 'Mostra a evidencia coletada pelo diagnostico, ja com truncamento e redaction quando necessario.',
  },
  {
    title: 'Regerar resumo',
    description: 'Solicita nova leitura por IA a partir da execucao ja persistida, sem rerodar o playbook.',
  },
]
const helpSteps = [
  'Confirme se a execucao terminou com sucesso ou falha.',
  'Se houver resumo por IA, use-o para ter uma triagem inicial do problema; se nao houver, valide se o modo automatico esta desligado e use Regerar resumo quando fizer sentido.',
  'Valide os achados principais diretamente na saida dos comandos.',
  'Use os proximos passos como guia operacional e reabra o terminal se precisar investigar mais.',
]
const helpScenarios = [
  {
    title: 'Falha operacional',
    description: 'Quando o playbook termina com erro ou parte dos comandos fica com status failed ou skipped.',
  },
  {
    title: 'Risco medio ou alto',
    description: 'Quando o resumo por IA indica necessidade de atencao e voce precisa confirmar a evidencia.',
  },
  {
    title: 'Comparacao manual',
    description: 'Quando o resumo parece insuficiente e voce quer confrontar a leitura automatica com a saida real.',
  },
]

const runId = computed(() => Number(route.params.runId))
const isActive = computed(() => (
  run.value?.status === 'pending'
  || run.value?.status === 'running'
  || run.value?.aiSummaryStatus === 'PROCESSING'
))
const shouldShowAutoSummaryHint = computed(() => (
  autoSummaryEnabled.value === false
  && !!run.value
  && run.value.status !== 'pending'
  && run.value.status !== 'running'
  && !run.value.aiSummaryStatus
  && !run.value.aiSummaryText
))

function runTagType(status: DiagnosticRunDetail['status']) {
  if (status === 'completed') return 'success'
  if (status === 'failed' || status === 'canceled') return 'error'
  if (status === 'running') return 'warning'
  return 'default'
}

function commandTagType(status: DiagnosticRunCommand['status']) {
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'error'
  if (status === 'running') return 'warning'
  return 'default'
}

function riskTagType(riskLevel: 'low' | 'medium' | 'high') {
  if (riskLevel === 'high') return 'error'
  if (riskLevel === 'medium') return 'warning'
  return 'success'
}

function formatDate(value: string | Date | null) {
  if (!value) return 'Sem registro'
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function scheduleRefresh() {
  if (refreshTimer) window.clearTimeout(refreshTimer)
  if (!isActive.value) return
  refreshTimer = window.setTimeout(() => {
    void load()
  }, 5000)
}

async function load() {
  if (!Number.isFinite(runId.value)) return
  loading.value = true
  error.value = null
  try {
    const [runResponse, settingsResponse] = await Promise.allSettled([
      diagnosticPlaybookService.getRun(runId.value),
      settingsService.get(),
    ])

    if (runResponse.status === 'rejected') {
      throw runResponse.reason
    }

    run.value = runResponse.value.data
    if (settingsResponse.status === 'fulfilled') {
      autoSummaryEnabled.value = settingsResponse.value.data.license.sessionAuditAiAutoSummaryEnabled === true
    }
  } catch {
    error.value = 'Nao foi possivel carregar esta execucao de diagnostico.'
  } finally {
    loading.value = false
    scheduleRefresh()
  }
}

async function regenerateSummary() {
  if (!Number.isFinite(runId.value) || summaryRefreshing.value) return
  summaryRefreshing.value = true
  error.value = null
  try {
    const { data } = await diagnosticPlaybookService.regenerateSummary(runId.value)
    run.value = data
    scheduleRefresh()
  } catch {
    error.value = 'Nao foi possivel solicitar a regeneracao do resumo por IA.'
  } finally {
    summaryRefreshing.value = false
  }
}

async function exportRun() {
  if (!Number.isFinite(runId.value) || exporting.value) return
  exporting.value = true
  error.value = null
  try {
    const response = await diagnosticPlaybookService.download(runId.value)
    const baseName = run.value?.playbookName
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'diagnostic-run'
    diagnosticPlaybookService.saveBlobAs(response.data, `${baseName}-${runId.value}.json`)
  } catch {
    error.value = 'Nao foi possivel exportar esta execucao de diagnostico.'
  } finally {
    exporting.value = false
  }
}

function goBack() {
  if (run.value?.hostId) {
    router.push({ name: 'host-dashboard', params: { hostId: String(run.value.hostId) } })
    return
  }
  router.push({ name: 'hosts' })
}

onMounted(() => {
  void load()
})

onBeforeUnmount(() => {
  if (refreshTimer) window.clearTimeout(refreshTimer)
})
</script>

<template>
  <div>
  <div class="diagnostic-run-detail-page">
    <div class="detail-header">
      <div class="min-w-0">
        <NButton text size="small" style="color:#9ca3af;margin-bottom:10px" @click="goBack">
          Voltar
        </NButton>
        <h1>{{ run?.playbookName ?? 'Execucao de diagnostico' }}</h1>
        <NText depth="3" class="text-sm">
          Comandos aprovados, status e saida coletada neste host.
        </NText>
      </div>
      <div class="detail-actions">
        <NButton size="small" ghost @click="load()">Atualizar</NButton>
        <NButton size="small" ghost @click="showHelp = true">Ajuda</NButton>
        <NButton size="small" ghost :loading="exporting" @click="exportRun">Exportar JSON</NButton>
        <NButton
          size="small"
          secondary
          :loading="summaryRefreshing"
          :disabled="run?.aiSummaryStatus === 'PROCESSING'"
          @click="regenerateSummary"
        >
          Regerar resumo
        </NButton>
      </div>
    </div>

    <NAlert v-if="error" type="error" :title="error" class="mb-4" />

    <NSpin :show="loading">
      <template v-if="run">
        <section class="detail-summary">
          <div class="summary-tile">
            <span>Status</span>
            <div class="summary-inline">
              <strong>{{ run.status }}</strong>
              <NTag size="small" :type="runTagType(run.status)">{{ run.status }}</NTag>
            </div>
          </div>
          <div class="summary-tile">
            <span>Solicitado em</span>
            <strong>{{ formatDate(run.createdAt) }}</strong>
          </div>
          <div class="summary-tile">
            <span>Inicio</span>
            <strong>{{ formatDate(run.startedAt) }}</strong>
          </div>
          <div class="summary-tile">
            <span>Fim</span>
            <strong>{{ formatDate(run.finishedAt) }}</strong>
          </div>
        </section>

        <NAlert
          v-if="run.errorMessage"
          type="warning"
          :title="run.errorMessage"
          class="mb-4"
        />

        <NAlert
          v-if="shouldShowAutoSummaryHint"
          type="info"
          title="Resumo automático desabilitado neste tenant"
          class="mb-4"
        >
          Esta execucao nao gera resumo por IA automaticamente. Use <strong>Regerar resumo</strong> quando quiser solicitar a analise manual.
        </NAlert>

        <section v-if="run.aiSummaryStatus || run.aiSummaryText" class="ai-summary-panel">
          <div class="ai-summary-header">
            <div>
              <h2>Resumo por IA</h2>
              <NText depth="3" class="text-sm">
                Analise automatica do resultado coletado neste diagnostico.
              </NText>
            </div>
            <NTag size="small" :type="run.aiSummaryStatus === 'READY' ? 'success' : run.aiSummaryStatus === 'FAILED' ? 'error' : 'warning'">
              {{ run.aiSummaryStatus ?? 'PENDING' }}
            </NTag>
          </div>
          <pre v-if="run.aiSummaryText" class="ai-summary-body">{{ run.aiSummaryText }}</pre>
          <NText v-else depth="3" class="text-sm">
            O resumo ainda esta sendo processado.
          </NText>
          <div v-if="run.aiSummaryStructured" class="ai-summary-grid">
            <div class="summary-tile">
              <span>Risco</span>
              <div class="summary-inline">
                <strong>{{ run.aiSummaryStructured.riskLevel }}</strong>
                <NTag size="small" :type="riskTagType(run.aiSummaryStructured.riskLevel)">
                  {{ run.aiSummaryStructured.riskLevel }}
                </NTag>
              </div>
            </div>
            <div class="summary-tile">
              <span>Confianca</span>
              <strong>{{ run.aiSummaryStructured.confidence }}</strong>
            </div>
          </div>
          <div v-if="run.aiSummaryStructured?.keyFindings?.length" class="ai-list-block">
            <div class="ai-list-title">Achados principais</div>
            <ul>
              <li v-for="item in run.aiSummaryStructured.keyFindings" :key="item">{{ item }}</li>
            </ul>
          </div>
          <div v-if="run.aiSummaryStructured?.nextActions?.length" class="ai-list-block">
            <div class="ai-list-title">Proximos passos</div>
            <ul>
              <li v-for="item in run.aiSummaryStructured.nextActions" :key="item">{{ item }}</li>
            </ul>
          </div>
        </section>

        <section class="command-list">
          <article v-for="command in run.commands" :key="command.id" class="command-card">
            <div class="command-header">
              <div class="min-w-0">
                <div class="command-title-row">
                  <strong>{{ command.commandId }}</strong>
                  <NTag size="small" :type="commandTagType(command.status)">{{ command.status }}</NTag>
                  <NTag v-if="command.redactionApplied" size="small" type="warning">Redaction</NTag>
                </div>
                <code class="command-line">{{ command.command }}</code>
              </div>
              <div class="command-meta">
                <span>Exit code: {{ command.exitCode ?? '-' }}</span>
                <span>{{ formatDate(command.startedAt) }}</span>
              </div>
            </div>

            <div class="command-output">
              <div class="command-output-label">Saida</div>
              <pre v-if="command.outputBody" class="command-output-body">{{ command.outputBody }}</pre>
              <NEmpty v-else description="Sem saida registrada para este comando." class="py-4" />
            </div>
          </article>
        </section>
      </template>

      <NEmpty v-else-if="!loading" description="Execucao indisponivel." class="py-10" />
    </NSpin>
  </div>

  <NModal v-model:show="showHelp">
    <NCard
      style="width: min(920px, calc(100vw - 32px))"
      title="Ajuda da execucao de diagnostico"
      :bordered="false"
      role="dialog"
      aria-modal="true"
    >
      <div class="max-h-[78vh] overflow-y-auto pr-1">
        <div class="mb-5 rounded border border-white/10 p-4">
          <NText depth="3" class="block text-sm">
            Esta tela concentra a leitura operacional de uma execucao: o que foi rodado, o que retornou e como a IA resumiu esse resultado.
          </NText>
          <div class="mt-4 grid gap-3 md:grid-cols-3">
            <div
              v-for="item in helpQuickItems"
              :key="item.title"
              class="rounded bg-white/5 p-3"
            >
              <NText strong class="block text-sm">{{ item.title }}</NText>
              <NText depth="3" class="block text-xs mt-1">{{ item.description }}</NText>
            </div>
          </div>
        </div>

        <div class="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <section>
            <h2 class="text-sm font-semibold text-white mb-3">Como ler a tela</h2>
            <div class="overflow-hidden rounded border border-white/10">
              <div
                v-for="section in helpSections"
                :key="section.title"
                class="grid gap-2 border-b border-white/10 p-3 last:border-b-0 md:grid-cols-[160px_1fr]"
              >
                <NText strong class="text-sm">{{ section.title }}</NText>
                <NText depth="3" class="text-sm">{{ section.description }}</NText>
              </div>
            </div>

            <h2 class="text-sm font-semibold text-white mt-5 mb-3">Passo a passo recomendado</h2>
            <div class="rounded border border-white/10 p-3">
              <ol class="detail-help-steps">
                <li v-for="step in helpSteps" :key="step">{{ step }}</li>
              </ol>
            </div>
          </section>

          <section class="space-y-5">
            <div>
              <h2 class="text-sm font-semibold text-white mb-3">Cenarios atendidos</h2>
              <div class="space-y-3">
                <div
                  v-for="scenario in helpScenarios"
                  :key="scenario.title"
                  class="rounded border border-white/10 p-3"
                >
                  <NText strong class="block text-sm">{{ scenario.title }}</NText>
                  <NText depth="3" class="block text-sm mt-2">{{ scenario.description }}</NText>
                </div>
              </div>
            </div>

            <div class="rounded border border-blue-500/30 bg-blue-500/10 p-3">
              <NText strong class="block text-sm text-white">Leitura recomendada</NText>
              <NText depth="3" class="block text-sm mt-2">
                Use o resumo por IA como triagem. Use a saida dos comandos como evidencia final para decidir se o problema esta confirmado, se precisa de nova coleta ou se vale abrir o terminal para aprofundar.
              </NText>
            </div>
          </section>
        </div>
      </div>
    </NCard>
  </NModal>
  </div>
</template>

<style scoped>
.diagnostic-run-detail-page {
  max-width: 1100px;
  padding: 32px;
}

.detail-header,
.detail-summary,
.command-header,
.summary-inline {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.detail-header {
  margin-bottom: 24px;
}

.detail-header h1 {
  margin: 0 0 4px;
  color: #fff;
  font-size: 28px;
  font-weight: 650;
}

.detail-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.ai-summary-panel,
.summary-tile,
.command-card {
  border: 1px solid #25252b;
  border-radius: 8px;
  background: #17171b;
}

.ai-summary-panel {
  padding: 16px;
  margin-bottom: 16px;
}

.ai-summary-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.ai-summary-header h2 {
  margin: 0 0 4px;
  color: #fff;
  font-size: 16px;
  font-weight: 650;
}

.ai-summary-body {
  margin: 0;
  padding: 12px;
  border-radius: 6px;
  background: #111114;
  color: #e5e7eb;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.ai-summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 12px;
}

.ai-list-block {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #25252b;
}

.ai-list-title {
  margin-bottom: 8px;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
}

.ai-list-block ul {
  display: grid;
  gap: 6px;
  margin: 0;
  padding-left: 18px;
  color: #d1d5db;
  font-size: 13px;
}

.detail-help-steps {
  display: grid;
  gap: 8px;
  margin: 0;
  padding-left: 18px;
  color: #d1d5db;
  font-size: 13px;
  line-height: 1.5;
}

.summary-tile {
  padding: 14px;
}

.summary-tile span,
.command-output-label,
.command-meta span {
  display: block;
  color: #8b8b95;
  font-size: 12px;
}

.summary-tile strong {
  display: block;
  margin-top: 8px;
  color: #fff;
  font-size: 18px;
}

.summary-inline {
  justify-content: flex-start;
  align-items: center;
  margin-top: 8px;
}

.command-list {
  display: grid;
  gap: 12px;
}

.command-card {
  padding: 16px;
}

.command-header {
  margin-bottom: 12px;
}

.command-title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.command-title-row strong {
  color: #fff;
  font-size: 14px;
}

.command-line {
  display: block;
  white-space: pre-wrap;
  word-break: break-word;
  color: #d1d5db;
  font-size: 12px;
}

.command-meta {
  display: grid;
  gap: 6px;
  text-align: right;
}

.command-output {
  border-top: 1px solid #25252b;
  padding-top: 12px;
}

.command-output-body {
  margin: 8px 0 0;
  padding: 12px;
  border-radius: 6px;
  background: #111114;
  color: #e5e7eb;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-x: auto;
}

@media (max-width: 960px) {
  .diagnostic-run-detail-page {
    padding: 20px;
  }

  .detail-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .ai-summary-grid {
    grid-template-columns: 1fr;
  }

  .command-header {
    flex-direction: column;
  }

  .command-meta {
    width: 100%;
    text-align: left;
  }
}

@media (max-width: 640px) {
  .detail-summary {
    grid-template-columns: 1fr;
  }
}
</style>
