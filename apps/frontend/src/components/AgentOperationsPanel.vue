<script setup lang="ts">
import { computed, ref } from 'vue'
import { NAlert, NButton, NInput, NInputNumber, NTag, useMessage } from 'naive-ui'
import { agentService, type AgentInfo } from '@/services/agent.service'

const props = defineProps<{ agent: AgentInfo }>()
const emit = defineEmits<{ refreshed: [] }>()
const message = useMessage()
const busy = ref(false)
const impact = ref<Awaited<ReturnType<typeof agentService.impact>>['data'] | null>(null)
const history = ref<Awaited<ReturnType<typeof agentService.history>>['data'] | null>(null)
const rotatedToken = ref('')
const poolName = ref(props.agent.poolName ?? '')
const priority = ref(props.agent.priority ?? 100)

const checks = computed(() => [
  { label: 'Autenticação e WebSocket', ok: props.agent.online, detail: props.agent.online ? 'Canal autenticado e ativo.' : 'Agente não possui canal ativo.' },
  { label: 'Certificado TLS', ok: props.agent.tlsMode === 'verified', detail: props.agent.tlsMode === 'verified' ? 'Certificado validado.' : props.agent.tlsMode === 'insecure' ? 'Conectado sem validar certificado.' : 'Sem diagnóstico TLS atual.' },
  { label: 'Heartbeat', ok: props.agent.online && (props.agent.heartbeatAgeMs ?? Infinity) < 60_000, detail: props.agent.heartbeatAgeMs == null ? 'Sem heartbeat atual.' : `Última resposta há ${Math.round(props.agent.heartbeatAgeMs / 1000)}s.` },
  { label: 'Versão', ok: props.agent.versionStatus === 'current', detail: props.agent.versionStatus === 'outdated' ? `Atualize para ${props.agent.minimumSupportedVersion ?? 'a versão atual'}.` : props.agent.version ? `Versão ${props.agent.version}.` : 'Versão não informada.' },
])

async function run<T>(action: () => Promise<T>) {
  busy.value = true
  try { return await action() } finally { busy.value = false }
}
async function loadImpact() { const result = await run(() => agentService.impact(props.agent.id)); impact.value = result?.data ?? null }
async function loadHistory() { const result = await run(() => agentService.history(props.agent.id)); history.value = result?.data ?? null }
async function toggleMaintenance() {
  await run(() => agentService.setMaintenance(props.agent.id, !props.agent.maintenanceMode))
  message.success(props.agent.maintenanceMode ? 'Agente reaberto para novas sessões.' : 'Drenagem iniciada; sessões atuais foram preservadas.')
  emit('refreshed')
}
async function rotate() {
  if (!window.confirm('O token anterior deixará de autenticar novas conexões. Continuar?')) return
  const result = await run(() => agentService.rotateToken(props.agent.id))
  rotatedToken.value = result?.data.token ?? ''
}
async function savePool() {
  await run(() => agentService.configurePool(props.agent.id, { poolName: poolName.value || null, priority: priority.value ?? 100 }))
  message.success('Pool e prioridade atualizados.')
  emit('refreshed')
}
async function copyToken() { await navigator.clipboard.writeText(rotatedToken.value); message.success('Token copiado.') }
</script>

<template>
  <section class="mt-3 space-y-4 border-t border-white/10 pt-3" data-agent-operations>
    <div>
      <h3 class="text-xs font-semibold text-gray-300">Diagnóstico guiado</h3>
      <div class="mt-2 grid gap-2 md:grid-cols-2">
        <div v-for="check in checks" :key="check.label" class="na-item rounded border p-2">
          <div class="flex items-center justify-between gap-2"><span class="text-xs font-medium">{{ check.label }}</span><NTag size="tiny" :type="check.ok ? 'success' : 'warning'">{{ check.ok ? 'OK' : 'Verificar' }}</NTag></div>
          <p class="mt-1 text-[11px] text-gray-500">{{ check.detail }}</p>
        </div>
      </div>
    </div>

    <div class="flex flex-wrap gap-2">
      <NButton size="small" :loading="busy" @click="loadImpact">Ver impacto</NButton>
      <NButton size="small" :loading="busy" @click="loadHistory">Carregar histórico</NButton>
      <NButton size="small" :type="agent.maintenanceMode ? 'success' : 'warning'" :loading="busy" @click="toggleMaintenance">{{ agent.maintenanceMode ? 'Encerrar manutenção' : 'Drenar para manutenção' }}</NButton>
      <NButton size="small" :loading="busy" @click="rotate">Rotacionar credencial</NButton>
    </div>

    <NAlert v-if="impact" :type="impact.safeToRevoke ? 'success' : 'warning'" :show-icon="false">
      {{ impact.hostCount }} host(s) vinculado(s), {{ impact.activeSessionCount }} sessão(ões) ativa(s). {{ impact.safeToRevoke ? 'Sem impacto operacional identificado.' : 'Revise os vínculos ou drene antes de revogar.' }}
    </NAlert>
    <NAlert v-if="rotatedToken" type="warning" title="Nova credencial — exibida uma única vez">
      <div class="mt-2 flex gap-2"><code class="min-w-0 flex-1 break-all">{{ rotatedToken }}</code><NButton size="small" @click="copyToken">Copiar</NButton></div>
    </NAlert>

    <div v-if="agent.agentMode === 'SERVICE_BOUND'" class="grid gap-2 rounded border border-white/10 p-3 sm:grid-cols-[1fr_150px_auto]">
      <NInput v-model:value="poolName" aria-label="Pool de failover" placeholder="Pool/site, ex.: filial-sp" />
      <NInputNumber v-model:value="priority" aria-label="Prioridade do agente" :min="1" :max="1000" />
      <NButton size="small" :loading="busy" @click="savePool">Salvar failover</NButton>
      <p class="text-[11px] text-gray-500 sm:col-span-3">Menor prioridade é escolhida primeiro; agentes em manutenção são ignorados automaticamente.</p>
    </div>

    <div v-if="history" class="na-code rounded border p-3 text-xs">
      <p class="font-medium">Últimos eventos: {{ history.reconnects }} conexão(ões), {{ history.disconnects }} queda(s)</p>
      <ul class="mt-2 max-h-32 space-y-1 overflow-auto" aria-label="Histórico do agente">
        <li v-for="event in history.events" :key="`${event.action}-${event.createdAt}`">{{ new Date(event.createdAt).toLocaleString() }} · {{ event.action }}</li>
      </ul>
    </div>
  </section>
</template>
