<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { NAlert, NButton, NCard, NEmpty } from 'naive-ui'
import api from '@/services/api'
type Health = { status: 'disabled'|'ready'|'degraded'|'unobserved'|'unavailable'; instances: Array<{id:string;observedAt:number;state:string;database:boolean;activity:null|{requests:number;errors:number;timeouts:number;pendingOperations:number;p95Ms:number|null}}> }
const health = ref<Health|null>(null), loading = ref(false), failed = ref(false)
let timer: ReturnType<typeof setInterval> | undefined, disposed = false
const labels = { disabled: 'TACACS+ desabilitado neste cliente', ready: 'Serviço observado como disponível', degraded: 'Serviço requer atenção', unobserved: 'Nenhuma instância observada', unavailable: 'Diagnóstico indisponível' }
const title = computed(() => failed.value ? 'Não foi possível atualizar o diagnóstico' : health.value ? labels[health.value.status] : 'Consultando saúde do serviço')
async function load() {
  if (loading.value) return
  loading.value = true
  try { const { data } = await api.get<Health>('/network-access/health'); if (!disposed) { health.value = data; failed.value = false } }
  catch { if (!disposed) { failed.value = true; health.value = null } }
  finally { loading.value = false }
}
onMounted(() => { void load(); timer = setInterval(() => { if (!document.hidden) void load() }, 10000) })
onUnmounted(() => { disposed = true; clearInterval(timer) })
</script>
<template>
  <NCard title="Saúde do serviço TACACS+" size="small" data-testid="tacacs-health">
    <NAlert :type="failed || health?.status==='unavailable' ? 'error' : health?.status==='degraded' || health?.status==='unobserved' ? 'warning' : health?.status==='ready' ? 'success' : 'info'" :title="title" role="status" aria-live="polite">
      <p v-if="failed || health?.status==='unavailable'">Não foi possível confirmar a saúde. Atualize o diagnóstico ou verifique o serviço de monitoramento. A política de acesso permanece inalterada.</p>
      <p v-else-if="health?.status==='disabled'">Habilite e salve a configuração do cliente para acompanhar o serviço.</p>
      <p v-else-if="health?.status==='unobserved'">Verifique se o processo TACACS+ está iniciado e publica seu estado. Ausência de diagnóstico não comprova que o serviço está parado.</p>
      <p v-else-if="health?.status==='degraded'">Há instância sem atualização recente, banco indisponível ou operações demoradas/saturadas. Verifique o serviço antes de depender dele para novos acessos.</p>
      <p v-else>Estado observado recentemente. A conectividade e a configuração AAA de cada equipamento precisam ser validadas no próprio equipamento.</p>
    </NAlert>
    <NButton class="mt-3" size="small" :loading="loading" @click="load">Atualizar diagnóstico</NButton>
    <p class="my-3 text-sm">Atualização a cada 10 segundos enquanto esta página está visível. Atividade abaixo exclusiva deste cliente, acumulada por instância; reinícios zeram contadores. Latência p95 das últimas 128 operações concluídas.</p>
    <ul v-if="health?.instances.length" class="space-y-3">
      <li v-for="(instance,index) in health.instances" :key="instance.id" class="rounded border border-zinc-500/30 p-3">
        <p><strong>Instância {{ index+1 }}</strong> · {{ instance.state==='ready'?'Disponível':instance.state==='stale'?'Atualização atrasada':'Requer atenção' }}</p>
        <p>Última observação: {{ new Date(instance.observedAt).toLocaleString() }} · Banco: {{ instance.state==='stale'?'sem confirmação recente':instance.database?'acessível':'sem confirmação' }}</p>
        <dl v-if="instance.activity" class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div><dt>Pedidos</dt><dd>{{ instance.activity.requests }}</dd></div>
          <div><dt>Erros</dt><dd>{{ instance.activity.errors }}</dd></div>
          <div><dt>Timeouts</dt><dd>{{ instance.activity.timeouts }}</dd></div>
          <div><dt>Operações pendentes</dt><dd>{{ instance.activity.pendingOperations }}</dd></div>
          <div><dt>Latência p95</dt><dd>{{ instance.activity.p95Ms===null?'Sem amostras':`${instance.activity.p95Ms} ms` }}</dd></div>
        </dl>
        <NEmpty v-else class="mt-3" description="Sem atividade recente observada deste cliente nesta instância." />
      </li>
    </ul>
  </NCard>
</template>
