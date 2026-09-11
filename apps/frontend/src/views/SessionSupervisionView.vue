<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { NAlert, NButton, NInput, NEmpty, NSpin } from 'naive-ui'
import { Terminal } from 'xterm'
import 'xterm/css/xterm.css'
import { supervisionService, type SupervisionSession } from '@/services/session-supervision.service'
import { useAuthStore } from '@/stores/auth'
const auth = useAuthStore()
const sessions = ref<SupervisionSession[]>([])
const loading = ref(false)
const error = ref('')
const reason = ref('')
const selected = ref<SupervisionSession | null>(null)
const status = ref('')
const element = ref<HTMLElement | null>(null)
let ws: WebSocket | undefined
let terminal: Terminal | undefined
let observationVersion = 0
async function load() {
  loading.value = true; error.value = ''
  try { sessions.value = (await supervisionService.list()).data }
  catch { sessions.value = []; error.value = 'Não foi possível consultar as sessões. Verifique sua permissão de supervisão e tente novamente.' }
  finally { loading.value = false }
}
function stop() { observationVersion++; ws?.close(); ws = undefined; terminal?.dispose(); terminal = undefined; selected.value = null }
async function observe(session: SupervisionSession) {
  stop(); selected.value = session; status.value = 'Conectando…'; error.value = ''
  const version = observationVersion
  await nextTick()
  if (version !== observationVersion || !element.value) return
  terminal = new Terminal({ disableStdin: true, cols: 120, rows: 32, scrollback: 3000, convertEol: false })
  terminal.open(element.value!)
  // No input, clipboard integration, resize or command channel is registered.
  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/session-supervision/${session.id}`)
  ws = socket; socket.binaryType = 'arraybuffer'
  socket.onopen = () => socket.send(JSON.stringify({ token: auth.accessToken, reason: reason.value.trim() }))
  socket.onmessage = event => {
    if (ws !== socket) return
    if (typeof event.data !== 'string') terminal?.write(new Uint8Array(event.data))
    else { const message = JSON.parse(event.data); if (message.type === 'resize' && Number.isInteger(message.cols) && Number.isInteger(message.rows) && message.cols > 0 && message.rows > 0 && message.cols <= 1000 && message.rows <= 1000) terminal?.resize(message.cols, message.rows); if (message.type === 'ready') status.value = 'Acompanhando — somente leitura, a partir deste momento' }
  }
  socket.onclose = () => { if (ws === socket) status.value = 'Supervisão encerrada. A sessão pode ter terminado ou sua autorização expirou.' }
  socket.onerror = () => { if (ws === socket) error.value = 'Não foi possível estabelecer o acompanhamento.' }
}
onMounted(load)
onBeforeUnmount(stop)
</script>
<template>
  <main class="space-y-4 p-4 md:p-6">
    <h1 class="text-xl font-semibold">Supervisão de sessões SSH</h1>
    <NAlert type="info">Acompanhamento administrativo somente leitura, sem aviso individual ao operador. Início e fim ficam registrados na auditoria. Exige política organizacional de monitoramento. Mostra novas saídas de sessões SSH web; não inclui histórico anterior, RDP/VNC ou terminal nativo.</NAlert>
    <NAlert v-if="error" type="error">{{ error }}</NAlert>
    <div><label for="supervision-reason" class="block">Justificativa</label><NInput v-model:value="reason" :input-props="{ id: 'supervision-reason' }" :maxlength="500" placeholder="Informe o motivo da supervisão (mínimo 5 caracteres)" /></div>
    <NButton :loading="loading" @click="load">Atualizar sessões</NButton>
    <NSpin :show="loading">
      <NEmpty v-if="!sessions.length && !loading && !error" description="Nenhuma sessão SSH autorizada em andamento." />
      <ul class="space-y-2"><li v-for="session in sessions" :key="session.id" class="flex flex-wrap items-center justify-between gap-2 rounded border p-3"><span>{{ session.host.name }} · {{ session.user.name }} · #{{ session.id }}</span><NButton :disabled="reason.trim().length < 5" @click="observe(session)">Acompanhar</NButton></li></ul>
    </NSpin>
    <section v-if="selected" class="space-y-2">
      <p role="status">{{ selected.host.name }} — {{ status }}</p>
      <NButton @click="stop">Encerrar acompanhamento</NButton>
      <div class="overflow-auto rounded bg-black p-2"><div ref="element" aria-label="Saída da sessão supervisionada, somente leitura" /></div>
    </section>
  </main>
</template>
