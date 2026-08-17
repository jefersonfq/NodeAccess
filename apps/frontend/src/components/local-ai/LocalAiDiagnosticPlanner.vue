<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NAlert, NButton, NInput, NSelect, NTag, NText, useMessage } from 'naive-ui'
import type { HostPublic, LocalAiDiagnosticPlan } from '@nodeaccess/shared'
import { localAiService } from '@/services/local-ai.service'
import { aiSshActionService } from '@/services/ai-ssh-action.service'

const props = defineProps<{
  hosts: HostPublic[]
  enabled: boolean
}>()

const router = useRouter()
const message = useMessage()
const hostId = ref<number | null>(null)
const objective = ref('')
const plan = ref<LocalAiDiagnosticPlan | null>(null)
const generating = ref(false)
const creating = ref(false)
const error = ref<string | null>(null)
const hostOptions = computed(() => props.hosts.map((host) => ({ label: `${host.name} (${host.ip})`, value: host.id })))
const canGenerate = computed(() => props.enabled && hostId.value !== null && objective.value.trim().length >= 10)

function riskType(risk: LocalAiDiagnosticPlan['steps'][number]['risk']) {
  if (risk === 'blocked') return 'error'
  if (risk === 'approval_required') return 'warning'
  return 'success'
}

function riskLabel(risk: LocalAiDiagnosticPlan['steps'][number]['risk']) {
  if (risk === 'blocked') return 'Bloqueado'
  if (risk === 'approval_required') return 'Exige aprovação'
  return 'Seguro'
}

async function generate() {
  if (!canGenerate.value || hostId.value === null) return
  generating.value = true
  error.value = null
  plan.value = null
  try {
    const { data } = await localAiService.generateDiagnosticPlan({ hostId: hostId.value, objective: objective.value.trim() })
    plan.value = data
  } catch (cause: unknown) {
    error.value = (cause as { response?: { data?: { message?: string } } })?.response?.data?.message
      ?? 'Não foi possível gerar o plano de diagnóstico.'
  } finally {
    generating.value = false
  }
}

async function createActionRun() {
  if (!plan.value?.executable) return
  creating.value = true
  try {
    const { data } = await aiSshActionService.createForHost(plan.value.hostId, {
      mode: plan.value.recommendedMode,
      channel: 'local_ai',
      summary: plan.value.summary,
      steps: plan.value.steps.map(({ id, label, command, timeoutSeconds }) => ({ id, label, command, timeoutSeconds })),
    })
    message.success(data.status === 'pending_approval' ? 'ActionRun criado e aguardando aprovação.' : 'ActionRun criado.')
    await router.push({ name: 'ai-ssh-action-run-detail', params: { runId: data.id } })
  } catch (cause: unknown) {
    message.error((cause as { response?: { data?: { message?: string } } })?.response?.data?.message
      ?? 'Não foi possível criar o ActionRun.')
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <div>
      <div class="text-sm font-medium text-white">Diagnóstico assistido</div>
      <NText depth="3" class="text-xs">Descreva o objetivo, revise todos os comandos e somente então crie um ActionRun governado.</NText>
    </div>

    <NAlert type="info" :show-icon="false">
      A IA apenas propõe o plano. O NodeAccess classifica cada comando e revalida licença, acesso e policy ao criar e executar o ActionRun.
    </NAlert>
    <NAlert v-if="!enabled" type="warning" :show-icon="false">
      Este fluxo exige os módulos Assistente NodeAccess e Ações SSH por IA habilitados para o tenant.
    </NAlert>
    <NAlert v-if="error" type="error">{{ error }}</NAlert>

    <div class="grid gap-3 md:grid-cols-2">
      <div>
        <label class="mb-1 block text-sm text-zinc-300" for="ai-diagnostic-host">Host alvo</label>
        <NSelect
          id="ai-diagnostic-host"
          v-model:value="hostId"
          :options="hostOptions"
          filterable
          clearable
          :disabled="!enabled || generating"
          placeholder="Selecione um host"
          @update:value="plan = null"
        />
      </div>
      <div>
        <label class="mb-1 block text-sm text-zinc-300" for="ai-diagnostic-objective">Objetivo do diagnóstico</label>
        <NInput
          id="ai-diagnostic-objective"
          v-model:value="objective"
          type="textarea"
          :rows="3"
          :disabled="!enabled || generating"
          placeholder="Ex.: verificar carga, memória, disco, LVM e processos que mais consomem recursos"
          @update:value="plan = null"
        />
      </div>
    </div>
    <div class="flex justify-end">
      <NButton type="primary" secondary :loading="generating" :disabled="!canGenerate" @click="generate">
        Gerar preview seguro
      </NButton>
    </div>

    <div v-if="plan" class="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4" aria-live="polite">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="font-medium text-zinc-100">{{ plan.summary }}</div>
          <div class="mt-1 text-xs text-zinc-500">{{ plan.hostName }} · {{ plan.provider }} · {{ plan.recommendedMode }}</div>
        </div>
        <NTag :type="plan.executable ? 'success' : 'error'">{{ plan.executable ? 'Pronto para revisão' : 'Plano bloqueado' }}</NTag>
      </div>

      <NAlert v-for="warning in plan.warnings" :key="warning" :type="plan.executable ? 'warning' : 'error'" :show-icon="false">
        {{ warning }}
      </NAlert>

      <ol class="space-y-2">
        <li v-for="(step, index) in plan.steps" :key="step.id" class="rounded border border-zinc-800 p-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <strong class="text-sm text-zinc-200">{{ index + 1 }}. {{ step.label }}</strong>
            <div class="flex items-center gap-2">
              <span class="text-xs text-zinc-500">timeout {{ step.timeoutSeconds }}s</span>
              <NTag size="small" :type="riskType(step.risk)">{{ riskLabel(step.risk) }}</NTag>
            </div>
          </div>
          <pre class="mt-2 overflow-x-auto rounded bg-black/30 p-2 text-xs text-zinc-300">{{ step.command }}</pre>
        </li>
      </ol>

      <div class="flex justify-end">
        <NButton type="primary" :loading="creating" :disabled="!plan.executable || creating" @click="createActionRun">
          Criar ActionRun após revisão
        </NButton>
      </div>
    </div>
  </div>
</template>
