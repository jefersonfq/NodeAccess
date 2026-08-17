<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NAlert, NButton, NCard, NEmpty, NSpin, NTag, NText } from 'naive-ui'
import type { AiSshActionRunDetail, AiSshActionRunReport, AiSshActionRunStep } from '@nodeaccess/shared'
import { aiSshActionService } from '@/services/ai-ssh-action.service'
import { aiSshActionCommandPolicyService, type AiSshActionCommandPolicyEvaluation } from '@/services/ai-ssh-action-command-policy.service'

const route = useRoute()
const router = useRouter()

const loading = ref(true)
const actionLoading = ref(false)
const error = ref<string | null>(null)
const run = ref<AiSshActionRunDetail | null>(null)
const report = ref<AiSshActionRunReport | null>(null)
const stepRisks = ref<Record<number, AiSshActionCommandPolicyEvaluation['risk']>>({})
let refreshTimer: number | null = null

const runId = computed(() => Number(route.params.runId))
const isActive = computed(() => (
  run.value?.status === 'approved'
  || run.value?.status === 'running'
  || run.value?.status === 'pending_approval'
))
const canCancel = computed(() => (
  run.value?.status === 'approved'
  || run.value?.status === 'running'
  || run.value?.status === 'pending_approval'
))
const riskSummary = computed(() => {
  const values = Object.values(stepRisks.value)
  return {
    blocked: values.filter((item) => item === 'blocked').length,
    approvalRequired: values.filter((item) => item === 'approval_required').length,
    safe: values.filter((item) => item === 'safe').length,
  }
})
const approvalWarnings = computed(() => {
  if (!run.value || run.value.status !== 'pending_approval') return []
  const warnings: string[] = []
  if (riskSummary.value.blocked > 0) {
    warnings.push('Este run possui step bloqueado pela policy atual. A aprovação pode falhar na execução.')
  }
  if (riskSummary.value.approvalRequired > 0) {
    warnings.push('Este run possui comandos de risco operacional controlado e exige revisão humana antes da execução.')
  }
  return warnings
})

function runTagType(status: AiSshActionRunDetail['status']) {
  if (status === 'completed' || status === 'approved') return 'success'
  if (status === 'failed' || status === 'canceled' || status === 'rejected') return 'error'
  if (status === 'running' || status === 'pending_approval') return 'warning'
  return 'default'
}

function stepTagType(status: AiSshActionRunStep['status']) {
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'error'
  if (status === 'running') return 'warning'
  return 'default'
}

function riskTagType(risk: AiSshActionCommandPolicyEvaluation['risk']) {
  if (risk === 'safe') return 'success'
  if (risk === 'approval_required') return 'warning'
  return 'error'
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

function goBack() {
  if (run.value?.hostId) {
    router.push({ name: 'host-dashboard', params: { hostId: String(run.value.hostId) } })
    return
  }
  router.push({ name: 'hosts' })
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
    const [runResponse, reportResponse] = await Promise.all([
      aiSshActionService.getById(runId.value),
      aiSshActionService.getReport(runId.value),
    ])
    run.value = runResponse.data
    report.value = reportResponse.data
    void loadStepRisks(runResponse.data)
  } catch {
    error.value = 'Nao foi possivel carregar este action run por IA.'
  } finally {
    loading.value = false
    scheduleRefresh()
  }
}

async function loadStepRisks(detail: AiSshActionRunDetail) {
  const next: Record<number, AiSshActionCommandPolicyEvaluation['risk']> = {}
  const pairs = await Promise.all(detail.steps.map(async (step) => {
    try {
      const { data } = await aiSshActionCommandPolicyService.evaluate(step.command)
      return [step.id, data.risk] as const
    } catch {
      return [step.id, null] as const
    }
  }))
  for (const [stepId, risk] of pairs) {
    if (risk !== null) next[stepId] = risk
  }
  stepRisks.value = next
}

async function approveRun() {
  if (!run.value || actionLoading.value) return
  actionLoading.value = true
  error.value = null
  try {
    const { data } = await aiSshActionService.approve(run.value.id)
    run.value = data
    scheduleRefresh()
  } catch {
    error.value = 'Nao foi possivel aprovar este action run.'
  } finally {
    actionLoading.value = false
  }
}

async function rejectRun() {
  if (!run.value || actionLoading.value) return
  actionLoading.value = true
  error.value = null
  try {
    const { data } = await aiSshActionService.reject(run.value.id)
    run.value = data
    scheduleRefresh()
  } catch {
    error.value = 'Nao foi possivel rejeitar este action run.'
  } finally {
    actionLoading.value = false
  }
}

async function cancelRun() {
  if (!run.value || actionLoading.value) return
  actionLoading.value = true
  error.value = null
  try {
    const { data } = await aiSshActionService.cancel(run.value.id)
    run.value = data
    scheduleRefresh()
  } catch {
    error.value = 'Nao foi possivel cancelar este action run.'
  } finally {
    actionLoading.value = false
  }
}

onMounted(() => {
  void load()
})

onBeforeUnmount(() => {
  if (refreshTimer) window.clearTimeout(refreshTimer)
})
</script>

<template>
  <div class="ai-action-run-detail-page">
    <div class="detail-header">
      <div class="min-w-0">
        <NButton text size="small" style="color:#9ca3af;margin-bottom:10px" @click="goBack">
          Voltar
        </NButton>
        <h1>{{ run?.summary ?? 'Action run por IA' }}</h1>
        <NText depth="3" class="text-sm">
          Execucao controlada de steps por IA com trilha e status por etapa.
        </NText>
      </div>
      <div class="detail-actions">
        <NButton size="small" ghost @click="load()">Atualizar</NButton>
        <NButton
          v-if="canCancel"
          size="small"
          tertiary
          type="warning"
          :loading="actionLoading"
          @click="cancelRun"
        >
          Cancelar
        </NButton>
        <template v-if="run?.status === 'pending_approval'">
          <NButton size="small" type="success" tertiary :loading="actionLoading" @click="approveRun">Aprovar</NButton>
          <NButton size="small" type="error" tertiary :loading="actionLoading" @click="rejectRun">Rejeitar</NButton>
        </template>
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
            <span>Canal</span>
            <strong>{{ run.channel }}</strong>
          </div>
          <div class="summary-tile">
            <span>Modo</span>
            <strong>{{ run.mode }}</strong>
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

        <NAlert v-if="run.approvalReason" type="info" class="mb-4" title="Motivo registrado">
          {{ run.approvalReason }}
        </NAlert>

        <NAlert
          v-if="run.status === 'pending_approval'"
          type="warning"
          class="mb-4"
          title="Esta execução aguarda sua aprovação"
        >
          <div class="approval-review">
            <div>
              Revise os comandos abaixo. A execução só será iniciada depois que você selecionar <strong>Aprovar execução</strong>.
            </div>
            <div>
              Canal: <strong>{{ run.channel }}</strong> · Modo: <strong>{{ run.mode }}</strong> · Steps: <strong>{{ run.steps.length }}</strong>
            </div>
            <div>
              Riscos: safe={{ riskSummary.safe }}, approval_required={{ riskSummary.approvalRequired }}, blocked={{ riskSummary.blocked }}
            </div>
            <ul v-if="approvalWarnings.length">
              <li v-for="item in approvalWarnings" :key="item">{{ item }}</li>
            </ul>
            <div class="approval-actions">
              <NButton
                type="success"
                :loading="actionLoading"
                data-testid="approve-action-run"
                @click="approveRun"
              >
                Aprovar execução
              </NButton>
              <NButton
                type="error"
                tertiary
                :loading="actionLoading"
                data-testid="reject-action-run"
                @click="rejectRun"
              >
                Rejeitar
              </NButton>
            </div>
          </div>
        </NAlert>

        <NAlert v-if="run.errorMessage" type="warning" class="mb-4" title="Erro do run">
          {{ run.errorMessage }}
        </NAlert>

        <section v-if="report" class="report-panel">
          <div class="panel-title">
            <div>
              <h2>Validação pós-execução</h2>
              <p>Avaliação determinística das etapas persistidas; não é uma conclusão gerada pela IA.</p>
            </div>
            <NTag :type="report.assessment === 'successful' ? 'success' : report.assessment === 'failed' ? 'error' : report.assessment === 'partial' ? 'warning' : 'default'">
              {{ report.assessment }}
            </NTag>
          </div>
          <div class="report-grid">
            <div class="summary-tile"><span>Concluídas</span><strong>{{ report.evidence.completed }}/{{ report.evidence.total }}</strong></div>
            <div class="summary-tile"><span>Falhas</span><strong>{{ report.evidence.failed }}</strong></div>
            <div class="summary-tile"><span>Ignoradas</span><strong>{{ report.evidence.skipped }}</strong></div>
            <div class="summary-tile"><span>Redaction</span><strong>{{ report.evidence.redacted }}</strong></div>
          </div>
          <div class="checksum-row"><span>SHA-256</span><code>{{ report.integrity.checksum }}</code></div>
        </section>

        <section class="steps-section">
          <div class="panel-title">
            <div>
              <h2>Steps</h2>
              <p>Comandos previstos, status, exit code e saida resumida por etapa.</p>
            </div>
          </div>

          <div v-if="run.steps.length" class="step-list">
            <NCard v-for="step in run.steps" :key="step.id" embedded class="step-card">
              <div class="step-header">
                <div>
                  <strong>{{ step.label }}</strong>
                  <p>{{ step.stepId }}</p>
                </div>
                <div class="step-meta">
                  <NTag size="small" :type="stepTagType(step.status)">{{ step.status }}</NTag>
                  <NTag v-if="stepRisks[step.id]" size="small" :type="riskTagType(stepRisks[step.id])">
                    {{ stepRisks[step.id] }}
                  </NTag>
                  <NTag v-if="step.exitCode !== null" size="small" :type="step.exitCode === 0 ? 'success' : 'error'">
                    exit {{ step.exitCode }}
                  </NTag>
                  <NTag v-if="step.redactionApplied" size="small" type="warning">redaction</NTag>
                </div>
              </div>

              <div class="step-command">
                <div class="step-label">Comando</div>
                <pre>{{ step.command }}</pre>
              </div>

              <div class="step-grid">
                <div>
                  <div class="step-label">Timeout</div>
                  <div>{{ step.timeoutSeconds }}s</div>
                </div>
                <div>
                  <div class="step-label">Inicio</div>
                  <div>{{ formatDate(step.startedAt) }}</div>
                </div>
                <div>
                  <div class="step-label">Fim</div>
                  <div>{{ formatDate(step.finishedAt) }}</div>
                </div>
              </div>

              <div v-if="step.outputPreview" class="step-output">
                <div class="step-label">Saida resumida</div>
                <pre>{{ step.outputPreview }}</pre>
              </div>
              <NEmpty v-else description="Sem saida persistida para este step." class="py-4" />
            </NCard>
          </div>
          <NEmpty v-else description="Nenhum step registrado neste action run." class="py-6" />
        </section>
      </template>
    </NSpin>
  </div>
</template>

<style scoped>
.ai-action-run-detail-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 24px;
}

.detail-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.detail-header h1 {
  margin: 0;
  font-size: 28px;
  line-height: 1.1;
}

.detail-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.approval-review {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.approval-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}

.detail-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.summary-tile {
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
  background: rgba(255,255,255,0.03);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.summary-tile span,
.step-label {
  color: #8b8f98;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: .04em;
}

.summary-tile strong {
  font-size: 15px;
}

.summary-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.steps-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.report-panel {
  padding: 16px;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
  background: rgba(255,255,255,0.02);
}

.report-panel .panel-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.report-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;
}

.checksum-row { margin-top: 12px; color: #8b8f98; font-size: 11px; }
.checksum-row code { display: block; overflow: hidden; margin-top: 4px; color: #d1d5db; text-overflow: ellipsis; white-space: nowrap; }

.panel-title h2 {
  margin: 0;
  font-size: 18px;
}

.panel-title p {
  margin: 6px 0 0;
  color: #8b8f98;
}

.step-list {
  display: grid;
  gap: 12px;
}

.step-card :deep(.n-card__content) {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.step-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.step-header p {
  margin: 4px 0 0;
  color: #8b8f98;
  font-size: 12px;
}

.step-meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.approval-review {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
}

.approval-review ul {
  margin: 0;
  padding-left: 18px;
}

.step-command pre,
.step-output pre {
  margin: 8px 0 0;
  padding: 12px;
  border-radius: 8px;
  background: #111214;
  border: 1px solid rgba(255,255,255,0.08);
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.5;
}

.step-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

@media (max-width: 720px) {
  .ai-action-run-detail-page {
    padding: 16px;
  }

  .detail-header {
    flex-direction: column;
  }

  .detail-header h1 {
    font-size: 22px;
  }

  .step-header {
    flex-direction: column;
  }

  .report-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
