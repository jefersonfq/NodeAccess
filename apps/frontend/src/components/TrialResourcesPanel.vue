<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { NAlert, NButton } from 'naive-ui'
import { isGuidedTrial } from '@/services/trial-experience'
import TrialCustomHosts from '@/components/TrialCustomHosts.vue'
import { featuresService } from '@/services/features.service'
import { trialService, type TrialResources } from '@/services/trial.service'
const emit = defineEmits<{ changed: []; showHosts: [] }>()
const customHostPanel = ref<InstanceType<typeof TrialCustomHosts> | null>(null)
const enabled = ref(false)
const guided = ref(false)
const resources = ref<TrialResources | null>(null)
const loading = ref(false)
const submitting = ref(false)
const count = ref(1)
const error = ref('')
const notice = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
let disposed = false
const maxAvailable = computed(() => resources.value ? Math.min(resources.value.maxMachines, resources.value.maxHosts - resources.value.customHostCount) : 0)
const canRequest = computed(() => !!resources.value && !resources.value.provisioning && resources.value.machineCount < maxAvailable.value)
function scheduleRefresh(): void {
  clearTimeout(timer)
  if (!disposed && resources.value?.provisioning) timer = setTimeout(() => { if (document.hidden) scheduleRefresh(); else void refresh() }, 5000)
}
async function refresh(): Promise<void> {
  if (loading.value || disposed) return
  clearTimeout(timer)
  loading.value = true
  error.value = ''
  try {
    const previous = resources.value
    resources.value = await trialService.resources()
    if (disposed) return
    count.value = Math.min(maxAvailable.value, Math.max(resources.value.machineCount + 1, count.value))
    if (previous && previous.machineCount !== resources.value.machineCount) {
      notice.value = 'As máquinas preparadas já estão disponíveis na lista de hosts.'
      emit('changed')
    }

  } catch { error.value = 'Não foi possível consultar seu laboratório. Tente atualizar novamente.' }
  finally { loading.value = false; scheduleRefresh() }
}
async function request(): Promise<void> {
  if (!resources.value || !canRequest.value || submitting.value) return
  if (!Number.isInteger(count.value) || count.value <= resources.value.machineCount || count.value > maxAvailable.value) {
    error.value = 'Escolha uma quantidade dentro do limite disponível.'
    return
  }
  submitting.value = true; error.value = ''; notice.value = ''
  try {
    await trialService.requestMachines(count.value)
    notice.value = 'Solicitação recebida. Você pode continuar usando as máquinas já disponíveis.'
    await refresh()
  } catch { error.value = 'Não foi possível solicitar as máquinas. Atualize o laboratório para conferir a quota e tente novamente.' }
  finally { submitting.value = false }
}
async function changed(): Promise<void> { await refresh(); emit('changed') }
async function openOwnHost(id: number, remove = false): Promise<boolean> {
  const trial = (await featuresService.get()).trial
  enabled.value = !!trial
  guided.value = isGuidedTrial(trial)
  if (!guided.value) return false
  if (!resources.value?.customHosts?.some(item => item.id === id)) {
    await refresh()
    await nextTick()
  }
  const host = resources.value?.customHosts?.find(item => item.id === id)
  if (!host || !customHostPanel.value) return false
  if (remove) customHostPanel.value.askRemove(host)
  else customHostPanel.value.open(host)
  return true
}
defineExpose({ openOwnHost, isTrial: guided })
onMounted(async () => {
  try {
    const trial = (await featuresService.get()).trial
    enabled.value = !!trial
    guided.value = isGuidedTrial(trial)
    if (enabled.value) await refresh()
  } catch { /* Normal host navigation remains available if capabilities cannot be loaded. */ }
})
onUnmounted(() => { disposed = true; clearTimeout(timer) })
</script>

<template>
  <details
    v-if="enabled"
    class="trial-resources"
    aria-labelledby="trial-resources-heading"
  >
    <summary>Recursos e limites do teste <span v-if="loading">· Consultando</span><span v-else-if="error">· Consulta indisponível</span><span v-else-if="resources?.provisioning">· Preparando máquinas</span></summary>
    <header>
      <div>
        <h2 id="trial-resources-heading">
          Seu laboratório de teste
        </h2>
        <p v-if="resources">
          {{ resources.machineCount }} máquina(s) de demonstração disponível(is), até {{ maxAvailable }} neste ambiente.
        </p>
      </div>
      <NButton
        :loading="loading"
        :disabled="submitting"
        @click="refresh"
      >
        Atualizar laboratório
      </NButton>
    </header>
    <NButton
      v-if="resources && resources.machineCount > 0"
      @click="emit('showHosts')"
    >
      Ver hosts disponíveis
    </NButton>
    <NAlert
      v-if="error"
      type="error"
      role="alert"
    >
      {{ error }}
    </NAlert>
    <NAlert
      v-if="notice"
      type="success"
      role="status"
    >
      {{ notice }}
    </NAlert>
    <NAlert
      v-if="resources?.provisioning && !resources.error"
      type="info"
      role="status"
    >
      Preparando seu laboratório para {{ resources.requestedMachines }} máquina(s). Os acessos existentes continuam disponíveis.
    </NAlert>
    <NAlert
      v-else-if="resources?.error"
      type="warning"
    >
      A preparação está temporariamente indisponível e será repetida automaticamente. Suas máquinas existentes permanecem disponíveis; use Atualizar laboratório para acompanhar.
    </NAlert>
    <form
      v-if="canRequest"
      @submit.prevent="request"
    >
      <label>Quantidade total desejada de máquinas de demonstração
        <input
          v-model.number="count"
          type="number"
          :min="(resources?.machineCount ?? 0) + 1"
          :max="maxAvailable"
          step="1"
          required
          :disabled="submitting"
        >
      </label>
      <NButton
        type="primary"
        attr-type="submit"
        :loading="submitting"
      >
        Solicitar máquinas
      </NButton>
    </form>
    <p v-else-if="resources && !resources.provisioning">
      O limite de máquinas de demonstração disponíveis para este teste foi atingido.
    </p>
    <TrialCustomHosts
      v-if="guided && resources?.allowCustomHosts"
      ref="customHostPanel"
      :resources="resources"
      @changed="changed"
    />
    <p v-if="!guided && resources?.allowCustomHosts">
      Use o cadastro normal de hosts para adicionar seus equipamentos, conforme suas permissões.
    </p>
    <p v-if="resources?.allowCustomHosts">
      Hosts próprios: {{ resources.customHostCount }} de {{ resources.maxCustomHosts }}. O limite total do ambiente é {{ resources.maxHosts }} hosts.
    </p>
  </details>
</template>

<style scoped>
.trial-resources { margin-bottom: 1.25rem; padding: 1rem; border: 1px solid var(--na-border, #64748b); border-radius: .75rem; display: grid; gap: .75rem; }
header, form { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
summary { cursor: pointer; font-weight: 600; }
summary:focus-visible { outline: 2px solid #3b82f6; outline-offset: 4px; }
.trial-resources[open] > :not(summary) { margin-top: .75rem; }
h2 { font-weight: 600; }
p { font-size: .875rem; }
label { display: grid; gap: .35rem; }
input { max-width: 8rem; border: 1px solid #64748b; border-radius: .35rem; padding: .4rem .6rem; color: inherit; background: transparent; }
input:focus-visible { outline: 2px solid #3b82f6; outline-offset: 2px; }
</style>
