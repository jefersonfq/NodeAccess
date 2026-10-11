<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton } from 'naive-ui'
import { connectionDiagnostic, diagnosticReference } from '@/services/connection-diagnostic'
const buttonTheme = { color: '#1f2937', colorHover: '#334155', colorPressed: '#334155', textColor: '#e5e7eb', textColorHover: '#ffffff', textColorPressed: '#ffffff' }
const props = defineProps<{ status: string; code: string | null; closedReason: string | null; hostId: number; sessionId: number | null; suppressed?: boolean }>()
const active = computed(() => !props.suppressed && (props.status === 'error' || (props.status === 'closed' && (!!props.code || props.closedReason === 'socket'))))
const expanded = ref(true), time = ref(''), copyState = ref('')
watch([active, (): string | null => props.code], (): void => { if (active.value) { expanded.value = true; time.value = new Date().toISOString(); copyState.value = '' } }, {immediate:true})
const diagnostic = computed(() => connectionDiagnostic(props.code, props.closedReason))
const reference = computed(() => diagnosticReference(props.hostId, props.sessionId, props.code, time.value))
async function copy(): Promise<void> {
  try { await navigator.clipboard.writeText(reference.value); copyState.value = 'Referência copiada.' }
  catch { copyState.value = 'Não foi possível copiar. Selecione a referência abaixo e copie manualmente.' }
}
</script>
<template>
  <aside
    v-if="active"
    class="connection-diagnostic"
    data-connection-diagnostic
    @keydown.stop
  >
    <NButton
      v-if="!expanded"
      :theme-overrides="buttonTheme"
      size="small"
      @click="expanded = true"
    >
      Ver diagnóstico do acesso
    </NButton>
    <section
      v-else
      class="diagnostic-card"
      aria-label="Diagnóstico do acesso"
    >
      <div class="diagnostic-heading">
        <strong>Diagnóstico do acesso</strong><NButton
          :theme-overrides="buttonTheme"
          size="tiny"
          @click="expanded = false"
        >
          Recolher diagnóstico
        </NButton>
      </div>
      <div
        role="status"
        aria-live="polite"
      >
        <p><strong>Etapa:</strong> {{ diagnostic.stage }}</p><p>{{ diagnostic.cause }}</p>
      </div>
      <p><strong>O que fazer:</strong> {{ diagnostic.action }}</p>
      <details>
        <summary>Referência para o suporte</summary><p class="diagnostic-reference">
          {{ reference }}
        </p><p>O horário indica quando o navegador recebeu o evento. A sessão pode não ter sido informada antes da falha.</p><NButton
          :theme-overrides="buttonTheme"
          size="small"
          @click="copy"
        >
          Copiar referência
        </NButton><p role="status">
          {{ copyState }}
        </p>
      </details>
      <p class="diagnostic-note">
        A reconexão continua manual. Recolha este painel para consultar a saída do terminal.
      </p>
    </section>
  </aside>
</template>
<style scoped>
.connection-diagnostic { position:absolute; z-index:40; top:8px; right:8px; max-width:calc(100% - 16px); max-height:calc(100% - 16px); overflow:auto; user-select:text; }
.diagnostic-card { width:420px; max-width:100%; box-sizing:border-box; padding:14px; border:1px solid #64748b; border-radius:8px; background:#111827; color:#e5e7eb; font:13px/1.5 system-ui,sans-serif; }
.diagnostic-heading { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; }
p { margin:10px 0; } summary { cursor:pointer; } summary:focus-visible { outline:2px solid #60a5fa; }
.diagnostic-reference { overflow-wrap:anywhere; font-family:monospace; }.diagnostic-note { color:#cbd5e1; font-size:12px; }
</style>
