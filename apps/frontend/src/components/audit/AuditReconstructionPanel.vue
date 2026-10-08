<script setup lang="ts">
import {ref,watch,computed,onBeforeUnmount} from 'vue'
import {isAxiosError} from 'axios'
import {NAlert,NButton,NCollapse,NCollapseItem,NSelect,NSpace,NSpin,NTag,useMessage} from 'naive-ui'
import type {SessionAuditReconstruction} from '@nodeaccess/shared'
import {sessionAuditService} from '@/services/sessionAudit.service'
const props=defineProps<{sessionId:number}>()
const emit=defineEmits<{refreshed:[]}>()
const message=useMessage()
const metadata=ref<SessionAuditReconstruction|null>(null)
const history=ref<SessionAuditReconstruction[]>([])
const busy=ref(false),exporting=ref(false),comparing=ref(false),error=ref(''),historyError=ref('')
const selected=ref<string|null>(null)
const exportFormat=ref<'terminal'|'commands'|'technical'>('terminal')
const exportOptions=[{label:'Sessão legível',value:'terminal'},{label:'Somente comandos',value:'commands'},{label:'Relatório técnico',value:'technical'}]
const exportDescription=computed(()=>({terminal:'Prompts e respostas do terminal, com os comandos que apareceram na tela.',commands:'Comandos reconstruídos, sem saídas. Preserva o SQL multilinha.',technical:'Eventos, autoria, avisos e identificadores para investigação detalhada.'})[exportFormat.value])
const comparison=ref<Awaited<ReturnType<typeof sessionAuditService.compareReconstruction>>['data']|null>(null)
const labels={complete:'Sem lacunas detectadas',partial:'Gravação com lacunas',running:'Gravação em andamento',unavailable:'Gravação indisponível'}
const options=computed(()=>history.value.map(r=>({label:`${new Date(r.createdAt).toLocaleString()} · ${r.processorVersion} · ${r.commandCount} comandos`,value:r.id})))
let request=0
async function load(reprocess=false) {
 const token=++request
 busy.value=true;error.value='';historyError.value='';comparison.value=null
 try {
  const {data}=await (reprocess?sessionAuditService.reprocess(props.sessionId):sessionAuditService.reconstruction(props.sessionId))
  if(token!==request)return
  metadata.value=data
  try {const response=await sessionAuditService.reconstructionHistory(props.sessionId);if(token===request)history.value=response.data}
  catch {if(token===request)historyError.value='Não foi possível consultar o histórico de versões.'}
  if(reprocess&&token===request) {message.success('Gravação reprocessada. O original foi preservado.');emit('refreshed')}
 }catch {if(token===request)error.value='Não foi possível consultar a reconstrução. Você pode tentar novamente; o registro original permanece disponível.'}
 finally {if(token===request)busy.value=false}
}
async function downloadTxt() {
 if(exporting.value)return
 exporting.value=true
 const session=props.sessionId
 const format=exportFormat.value
 try {const {data}=await sessionAuditService.transcript(session,format);sessionAuditService.saveBlobAs(data,`session-audit-${session}${format==='terminal'?'':`-${format}`}.txt`)}
 catch (error) {
  const status=isAxiosError(error)?error.response?.status:undefined
  message.error(status===413?'Esta sessão excede o limite do TXT. Use o download JSONL original.':status===410?'A gravação foi removida pela política de retenção.':'Não foi possível gerar a transcrição TXT. Tente novamente.')
 }
 finally {exporting.value=false}
}
async function compare() {
 if(!selected.value||comparing.value)return
 comparing.value=true
 const token=request
 try {const result=await sessionAuditService.compareReconstruction(props.sessionId,selected.value);if(token===request)comparison.value=result.data}
 catch {message.error('Não foi possível comparar as versões. Tente novamente.')}
 finally {comparing.value=false}
}
onBeforeUnmount(()=>{request++})
watch(()=>props.sessionId,()=>{metadata.value=null;history.value=[];selected.value=null;void load()}, {immediate:true})
</script>
<template>
 <section class="mb-4 rounded-lg border border-zinc-700 p-3" aria-label="Reconstrução da auditoria" data-testid="audit-reconstruction">
  <NSpace align="center" justify="space-between">
   <div><strong>Gravação e reconstrução</strong><p class="mt-1 text-xs text-zinc-400">A transcrição e os comandos são derivados. O JSONL original permanece como fonte da auditoria.</p></div>
   <NSpace><NButton :loading="exporting" :disabled="busy || !metadata || metadata.state==='unavailable'" data-testid="audit-download-txt" @click="downloadTxt">Baixar TXT</NButton><NButton :loading="busy" :disabled="busy" data-testid="audit-reprocess" @click="load(true)">Reprocessar</NButton></NSpace>
  </NSpace>
  <div class="mt-3 max-w-md"><label for="audit-export-format" class="text-sm">Conteúdo do TXT</label><NSelect v-model:value="exportFormat" :options="exportOptions" :disabled="exporting" :input-props="{id:'audit-export-format','aria-label':'Conteúdo do TXT'}" data-testid="audit-export-format" /><p class="mt-1 text-xs text-zinc-400">{{exportDescription}} O playback e o JSONL continuam disponíveis.</p></div>
  <NAlert v-if="error" type="error" class="mt-3">{{error}} <NButton size="small" :disabled="busy" @click="load()">Tentar novamente</NButton></NAlert>
  <NSpin v-if="busy&&!metadata" class="mt-3" aria-label="Consultando reconstrução" />
  <template v-if="metadata">
   <NSpace class="mt-3" align="center"><NTag :type="metadata.state==='complete'?'success':'warning'">{{labels[metadata.state]}}</NTag><span class="text-xs text-zinc-400">{{metadata.commandCount}} comandos · {{metadata.eventCount}} eventos · {{metadata.processorVersion}}</span></NSpace>
   <NAlert v-if="metadata.issues.length" type="warning" class="mt-3" data-testid="audit-integrity-warning"><ul class="list-disc pl-4"><li v-for="(issue,index) in metadata.issues" :key="index">{{issue.message}} <span v-if="issue.chunkSeq">(parte {{issue.chunkSeq}})</span></li></ul></NAlert>
   <NCollapse class="mt-3"><NCollapseItem title="Rastreabilidade e versões preservadas" name="versions">
    <p class="break-all text-xs">Reconstrução: {{metadata.id}}</p><p class="mt-1 break-all text-xs">SHA-256 da fonte observada: {{metadata.sourceFingerprint}}</p>
    <p class="my-2 text-xs text-zinc-400">{{metadata.persisted?'Versão preservada no histórico.':'Versão não persistida; consulte os avisos ou aguarde o encerramento da sessão.'}} Verificado em {{new Date(metadata.verifiedAt ?? metadata.createdAt).toLocaleString()}}. A verificação em cache pode ser reutilizada por até 60 segundos; reprocessar faz uma nova leitura.</p>
    <NAlert v-if="historyError" type="warning">{{historyError}}</NAlert>
    <p v-else-if="!history.length" class="text-sm">Ainda não há versões preservadas.</p>
    <NSpace v-else vertical><label for="audit-version">Versão para comparar com a reconstrução atual</label><NSelect v-model:value="selected" :input-props="{id: 'audit-version', 'aria-label': 'Versão da reconstrução'}" :options="options" placeholder="Selecione uma versão" :disabled="busy||comparing" aria-label="Versão da reconstrução" /><NButton :disabled="!selected||busy" :loading="comparing" @click="compare">Comparar versões</NButton></NSpace>
    <div v-if="comparison" class="mt-3" data-testid="audit-version-comparison"><p>Comparação por posição: {{comparison.added}} adicionados, {{comparison.removed}} removidos, {{comparison.modified}} alterados.</p><p v-if="comparison.truncated">Exibindo as primeiras 20 diferenças.</p><div v-for="change in comparison.changes" :key="change.index" class="mt-2 rounded border border-zinc-700 p-2"><strong>Comando #{{change.index}}</strong><pre class="whitespace-pre-wrap break-words text-xs">Antes: {{change.before??'(ausente)'}}
Depois: {{change.after??'(ausente)'}}</pre><p v-if="change.beforeChars>2000||change.afterChars>2000" class="text-xs">Prévia limitada a 2.000 caracteres; consulte os comandos para o texto integral.</p><p v-if="change.outputChanged" class="text-xs">A saída associada mudou.</p><p v-if="change.actorChanged" class="text-xs">A autoria atribuída mudou.</p></div></div>
   </NCollapseItem></NCollapse>
  </template>
 </section>
</template>
