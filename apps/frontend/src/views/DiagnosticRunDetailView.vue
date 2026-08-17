<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NAlert, NButton, NCard, NCheckbox, NEmpty, NInput, NModal, NSelect, NSpin, NTag, NText, useMessage } from 'naive-ui'
import type { DiagnosticRunCommand, DiagnosticRunComparison, DiagnosticRunDetail, DiagnosticRunPublic, DiagnosticRunReport } from '@nodeaccess/shared'
import { diagnosticPlaybookService } from '@/services/diagnostic-playbook.service'
import { settingsService } from '@/services/settings.service'

const route = useRoute()
const router = useRouter()
const message = useMessage()

const loading = ref(true)
const summaryRefreshing = ref(false)
const exporting = ref(false)
const showHelp = ref(false)
const showTraceability = ref(false)
const traceabilitySaving = ref(false)
const showJiraPublish = ref(false)
const jiraPublishing = ref(false)
const jiraIncludeAttachment = ref(false)
const jiraAttachmentConfirmed = ref(false)
const showComparison = ref(false)
const comparisonLoading = ref(false)
const comparisonError = ref<string | null>(null)
const baselineRunId = ref<number | null>(null)
const comparisonCandidates = ref<DiagnosticRunPublic[]>([])
const comparison = ref<DiagnosticRunComparison | null>(null)
const error = ref<string | null>(null)
const run = ref<DiagnosticRunDetail | null>(null)
const report = ref<DiagnosticRunReport | null>(null)
const autoSummaryEnabled = ref<boolean | null>(null)
const traceabilityForm = ref({ sessionId: '', ticketKey: '', actionRunId: '' })
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
const comparisonOptions = computed(() => comparisonCandidates.value
  .filter((candidate) => candidate.id !== runId.value)
  .map((candidate) => ({
    value: candidate.id,
    label: `#${candidate.id} · ${candidate.playbookName} · ${formatDate(candidate.finishedAt ?? candidate.createdAt)}`,
  })))

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

function comparisonTagType(value: DiagnosticRunComparison['verdict'] | DiagnosticRunComparison['commands'][number]['change']) {
  if (value === 'improved') return 'success'
  if (value === 'regressed') return 'error'
  if (value === 'mixed') return 'warning'
  if (value === 'added' || value === 'removed') return 'info'
  return 'default'
}

const comparisonLabel = (value: string) => ({
  improved: 'melhorou', regressed: 'regrediu', unchanged: 'sem alteração', mixed: 'resultado misto', added: 'adicionado', removed: 'removido',
}[value] ?? value)

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
    const [runResponse, settingsResponse, reportResponse] = await Promise.allSettled([
      diagnosticPlaybookService.getRun(runId.value),
      settingsService.get(),
      diagnosticPlaybookService.getReport(runId.value),
    ])

    if (runResponse.status === 'rejected') {
      throw runResponse.reason
    }

    run.value = runResponse.value.data
    report.value = reportResponse.status === 'fulfilled' ? reportResponse.value.data : null
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

async function copyChecksum() {
  if (!report.value) return
  try {
    await navigator.clipboard.writeText(report.value.integrity.checksum)
  } catch {
    error.value = 'Não foi possível copiar o checksum automaticamente.'
  }
}

function openTraceability() {
  traceabilityForm.value = {
    sessionId: report.value?.traceability.sessionId ? String(report.value.traceability.sessionId) : '',
    ticketKey: report.value?.traceability.ticketKey ?? '',
    actionRunId: report.value?.traceability.actionRunId ? String(report.value.traceability.actionRunId) : '',
  }
  showTraceability.value = true
}

function parseOptionalPositiveId(value: string): number | null | undefined {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

async function saveTraceability() {
  const sessionId = parseOptionalPositiveId(traceabilityForm.value.sessionId)
  const actionRunId = parseOptionalPositiveId(traceabilityForm.value.actionRunId)
  if (sessionId === undefined || actionRunId === undefined) {
    error.value = 'Sessão e ActionRun devem ser IDs numéricos positivos.'
    return
  }
  traceabilitySaving.value = true
  error.value = null
  try {
    const { data } = await diagnosticPlaybookService.updateTraceability(runId.value, {
      sessionId,
      ticketKey: traceabilityForm.value.ticketKey.trim() || null,
      actionRunId,
    })
    run.value = data
    report.value = (await diagnosticPlaybookService.getReport(runId.value)).data
    showTraceability.value = false
  } catch (cause: unknown) {
    error.value = (cause as { response?: { data?: { message?: string } } })?.response?.data?.message
      ?? 'Não foi possível atualizar a rastreabilidade.'
  } finally {
    traceabilitySaving.value = false
  }
}

async function publishToJira() {
  if (!report.value?.traceability.ticketKey) return
  if (jiraIncludeAttachment.value && !jiraAttachmentConfirmed.value) return
  jiraPublishing.value = true
  error.value = null
  try {
    const reportUrl = new URL(router.resolve({ name: 'diagnostic-run-detail', params: { runId: runId.value } }).href, window.location.origin).toString()
    const { data } = await diagnosticPlaybookService.publishReportToJira(runId.value, {
      reportUrl,
      includeAttachment: jiraIncludeAttachment.value,
    })
    showJiraPublish.value = false
    message.success(`${data.queuedActions.length} publicação(ões) enfileirada(s) para ${data.ticketKey}.`)
  } catch (cause: unknown) {
    error.value = (cause as { response?: { data?: { message?: string } } })?.response?.data?.message
      ?? 'Não foi possível enfileirar o relatório no Jira.'
  } finally {
    jiraPublishing.value = false
  }
}

function openJiraPublish() {
  jiraIncludeAttachment.value = false
  jiraAttachmentConfirmed.value = false
  showJiraPublish.value = true
}

async function openComparison() {
  if (!run.value) return
  showComparison.value = true
  comparison.value = null
  comparisonError.value = null
  comparisonLoading.value = true
  try {
    comparisonCandidates.value = (await diagnosticPlaybookService.listRunsForHost(run.value.hostId)).data
    baselineRunId.value = comparisonOptions.value[0]?.value ?? null
  } catch {
    comparisonError.value = 'Não foi possível carregar o histórico deste host.'
  } finally {
    comparisonLoading.value = false
  }
}

async function compareRuns() {
  if (!baselineRunId.value) return
  comparisonLoading.value = true
  comparisonError.value = null
  try {
    comparison.value = (await diagnosticPlaybookService.compareRuns(runId.value, baselineRunId.value)).data
  } catch (cause: unknown) {
    comparisonError.value = (cause as { response?: { data?: { message?: string } } })?.response?.data?.message
      ?? 'Não foi possível comparar estas execuções.'
  } finally {
    comparisonLoading.value = false
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

        <section v-if="report" class="report-panel">
          <div class="ai-summary-header">
            <div>
              <h2>Relatório verificável</h2>
              <NText depth="3" class="text-sm">Rastreabilidade e evidências consolidadas desta execução.</NText>
            </div>
            <div class="flex items-center gap-2">
              <NTag size="small" type="info">v{{ report.version }}</NTag>
              <NButton size="small" secondary @click="openComparison">Comparar antes/depois</NButton>
              <NButton size="small" secondary @click="openTraceability">Vincular origem</NButton>
              <NButton
                v-if="report.traceability.ticketKey"
                size="small"
                type="primary"
                secondary
                @click="openJiraPublish"
              >
                Publicar no Jira
              </NButton>
            </div>
          </div>

          <div class="report-grid">
            <div class="summary-tile">
              <span>Host</span>
              <strong>{{ report.identity.hostName ?? `Host #${report.identity.hostId}` }}</strong>
              <NText depth="3" class="text-xs">{{ report.identity.hostIp ?? 'IP histórico indisponível' }}</NText>
            </div>
            <div class="summary-tile">
              <span>Evidências</span>
              <strong>{{ report.evidence.completed }}/{{ report.evidence.total }} concluídas</strong>
              <NText depth="3" class="text-xs">{{ report.evidence.failed }} falhas · {{ report.evidence.skipped }} ignoradas</NText>
            </div>
            <div class="summary-tile">
              <span>Redaction</span>
              <strong>{{ report.evidence.redacted }}</strong>
              <NText depth="3" class="text-xs">saídas com conteúdo sensível mascarado</NText>
            </div>
          </div>

          <NAlert type="info" :show-icon="false" class="mt-3">
            {{ report.traceability.note }}
          </NAlert>
          <div class="mt-3 flex flex-wrap gap-2">
            <NTag size="small" :type="report.traceability.sessionId ? 'success' : 'default'">
              Sessão: {{ report.traceability.sessionId ? `#${report.traceability.sessionId}` : 'não vinculada' }}
            </NTag>
            <NTag size="small" :type="report.traceability.ticketKey ? 'success' : 'default'">
              Ticket: {{ report.traceability.ticketKey ?? 'não vinculado' }}
            </NTag>
            <NTag size="small" :type="report.traceability.actionRunId ? 'success' : 'default'">
              ActionRun: {{ report.traceability.actionRunId ? `#${report.traceability.actionRunId}` : 'não vinculado' }}
            </NTag>
          </div>

          <div class="checksum-row">
            <div class="min-w-0">
              <span>Integridade SHA-256</span>
              <code>{{ report.integrity.checksum }}</code>
            </div>
            <NButton size="small" secondary @click="copyChecksum">Copiar checksum</NButton>
          </div>
        </section>

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

  <NModal v-model:show="showTraceability">
    <NCard
      style="width: min(620px, calc(100vw - 32px))"
      title="Vincular origem do diagnóstico"
      :bordered="false"
      role="dialog"
      aria-modal="true"
    >
      <div class="space-y-4">
        <NAlert type="info" :show-icon="false">
          Cada referência será validada no mesmo tenant e host. Usuários comuns só podem vincular registros do próprio escopo.
        </NAlert>
        <div>
          <label for="diagnostic-origin-session" class="mb-1 block text-sm text-zinc-300">ID da sessão</label>
          <NInput id="diagnostic-origin-session" v-model:value="traceabilityForm.sessionId" placeholder="Ex.: 1824" />
        </div>
        <div>
          <label for="diagnostic-origin-ticket" class="mb-1 block text-sm text-zinc-300">Ticket Jira</label>
          <NInput id="diagnostic-origin-ticket" v-model:value="traceabilityForm.ticketKey" placeholder="Ex.: OPS-1234" />
        </div>
        <div>
          <label for="diagnostic-origin-action" class="mb-1 block text-sm text-zinc-300">ID do ActionRun</label>
          <NInput id="diagnostic-origin-action" v-model:value="traceabilityForm.actionRunId" placeholder="Ex.: 74" />
        </div>
        <div class="flex justify-end gap-2">
          <NButton :disabled="traceabilitySaving" @click="showTraceability = false">Cancelar</NButton>
          <NButton type="primary" :loading="traceabilitySaving" @click="saveTraceability">Validar e salvar</NButton>
        </div>
      </div>
    </NCard>
  </NModal>

  <NModal v-model:show="showJiraPublish">
    <NCard
      style="width: min(620px, calc(100vw - 32px))"
      title="Publicar relatório no Jira"
      :bordered="false"
      role="dialog"
      aria-modal="true"
    >
      <div class="space-y-4">
        <NAlert type="info" :show-icon="false">
          Será publicado um comentário no ticket {{ report?.traceability.ticketKey }} com link, resultado e checksum do relatório. O processamento ocorre pela outbox com retry.
        </NAlert>
        <NCheckbox v-model:checked="jiraIncludeAttachment" @update:checked="jiraAttachmentConfirmed = false">
          Anexar também o relatório JSON verificável
        </NCheckbox>
        <NAlert v-if="jiraIncludeAttachment" type="warning" :show-icon="false">
          O anexo contém comandos e saídas sanitizadas do diagnóstico e será enviado ao Jira externo.
          <div class="mt-3">
            <NCheckbox v-model:checked="jiraAttachmentConfirmed">
              Confirmo o envio das evidências operacionais para o Jira.
            </NCheckbox>
          </div>
        </NAlert>
        <div class="flex justify-end gap-2">
          <NButton :disabled="jiraPublishing" @click="showJiraPublish = false">Cancelar</NButton>
          <NButton
            type="primary"
            :loading="jiraPublishing"
            :disabled="jiraIncludeAttachment && !jiraAttachmentConfirmed"
            @click="publishToJira"
          >
            Enfileirar publicação
          </NButton>
        </div>
      </div>
    </NCard>
  </NModal>

  <NModal v-model:show="showComparison">
    <NCard style="width: min(960px, calc(100vw - 32px))" title="Comparar antes/depois" :bordered="false" role="dialog" aria-modal="true">
      <NSpin :show="comparisonLoading">
        <div class="space-y-4">
          <NAlert type="info" :show-icon="false">
            A execução aberta é o <strong>depois</strong>. A comparação usa diferenças observáveis e não atribui causalidade.
          </NAlert>
          <div v-if="comparisonOptions.length" class="comparison-selector">
            <div class="min-w-0 flex-1">
              <label for="diagnostic-comparison-baseline" class="mb-1 block text-sm text-zinc-300">Execução de referência (antes)</label>
              <NSelect id="diagnostic-comparison-baseline" v-model:value="baselineRunId" :options="comparisonOptions" filterable @update:value="comparison = null" />
            </div>
            <NButton type="primary" :disabled="!baselineRunId" :loading="comparisonLoading" @click="compareRuns">Comparar</NButton>
          </div>
          <NAlert v-if="comparisonError" type="error" :title="comparisonError" />
          <NEmpty v-if="!comparisonLoading && !comparisonOptions.length && !comparisonError" description="Ainda não há outra execução acessível neste host para comparar." />

          <template v-if="comparison">
            <div class="comparison-heading">
              <div><NText depth="3" class="block text-xs">Resultado observado</NText><strong>#{{ comparison.baseline.runId }} antes → #{{ comparison.current.runId }} depois</strong></div>
              <NTag :type="comparisonTagType(comparison.verdict)">{{ comparisonLabel(comparison.verdict) }}</NTag>
            </div>
            <NAlert v-for="warning in comparison.warnings" :key="warning" type="warning" :show-icon="false">{{ warning }}</NAlert>
            <div class="comparison-metrics">
              <div v-for="metric in comparison.metrics" :key="metric.key" class="summary-tile">
                <span>{{ metric.label }}</span><strong>{{ metric.baseline }} → {{ metric.current }}</strong>
                <NTag size="small" :type="comparisonTagType(metric.change)">{{ comparisonLabel(metric.change) }}</NTag>
              </div>
            </div>
            <section>
              <h3 class="comparison-section-title">Comandos</h3>
              <div class="comparison-command-list">
                <div v-for="command in comparison.commands" :key="command.commandId" class="comparison-command">
                  <div class="min-w-0"><strong>{{ command.commandId }}</strong><code>{{ command.command }}</code></div>
                  <div class="comparison-command-status"><span>{{ command.baselineStatus ?? 'ausente' }} → {{ command.currentStatus ?? 'ausente' }}</span><NTag size="small" :type="comparisonTagType(command.change)">{{ comparisonLabel(command.change) }}</NTag></div>
                </div>
              </div>
            </section>
            <section class="comparison-findings">
              <div><h3>Resolvidos</h3><ul v-if="comparison.findings.resolved.length"><li v-for="item in comparison.findings.resolved" :key="item">{{ item }}</li></ul><NText v-else depth="3" class="text-xs">Nenhum achado deixou de aparecer.</NText></div>
              <div><h3>Novos</h3><ul v-if="comparison.findings.new.length"><li v-for="item in comparison.findings.new" :key="item">{{ item }}</li></ul><NText v-else depth="3" class="text-xs">Nenhum achado novo.</NText></div>
              <div><h3>Persistentes</h3><ul v-if="comparison.findings.persistent.length"><li v-for="item in comparison.findings.persistent" :key="item">{{ item }}</li></ul><NText v-else depth="3" class="text-xs">Nenhum achado textual persistente.</NText></div>
            </section>
          </template>
        </div>
      </NSpin>
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
.report-panel,
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

.report-panel {
  padding: 16px;
  margin-bottom: 16px;
}

.report-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.checksum-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #25252b;
}

.checksum-row span {
  display: block;
  color: #8b8b95;
  font-size: 12px;
}

.checksum-row code {
  display: block;
  overflow: hidden;
  margin-top: 4px;
  color: #d1d5db;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.comparison-selector,
.comparison-heading,
.comparison-command {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
}

.comparison-heading {
  align-items: center;
  padding: 14px;
  border: 1px solid #25252b;
  border-radius: 8px;
  background: #17171b;
}

.comparison-heading strong { color: #fff; }

.comparison-metrics,
.comparison-findings {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.comparison-metrics .summary-tile strong { margin-bottom: 8px; }
.comparison-section-title,
.comparison-findings h3 { margin: 0 0 8px; color: #fff; font-size: 14px; }
.comparison-command-list { overflow: hidden; border: 1px solid #25252b; border-radius: 8px; }
.comparison-command { align-items: center; padding: 12px; border-bottom: 1px solid #25252b; }
.comparison-command:last-child { border-bottom: 0; }
.comparison-command strong,
.comparison-command code { display: block; }
.comparison-command code { margin-top: 4px; color: #a1a1aa; white-space: normal; word-break: break-word; }
.comparison-command-status { display: flex; flex-shrink: 0; align-items: center; gap: 8px; color: #a1a1aa; font-size: 12px; }
.comparison-findings > div { padding: 12px; border: 1px solid #25252b; border-radius: 8px; }
.comparison-findings ul { margin: 0; padding-left: 18px; color: #d1d5db; font-size: 12px; }

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

  .report-grid {
    grid-template-columns: 1fr;
  }

  .comparison-metrics,
  .comparison-findings { grid-template-columns: 1fr; }

  .comparison-selector,
  .comparison-command { align-items: stretch; flex-direction: column; }

  .comparison-command-status { justify-content: space-between; }

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

  .checksum-row {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
