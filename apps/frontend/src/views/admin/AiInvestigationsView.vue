<script setup lang="ts">
import { h, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NAlert,NButton,NCard,NDataTable,NEmpty,NSpin,NTag,NText } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import type { AiInvestigation } from '@nodeaccess/shared'
import { aiInvestigationService } from '@/services/ai-investigation.service'
const router=useRouter(), loading=ref(true), error=ref(''), rows=ref<Array<AiInvestigation & {actionRunCount?:number}>>([])
const fmt=(v:Date|string)=>new Date(v).toLocaleString('pt-BR')
const tag=(s:string)=>s==='COMPLETED'?'success':s==='ABANDONED'?'default':s==='WAITING_USER'?'warning':'info'
const statusLabel=(s:string)=>({OPEN:'Em andamento',WAITING_USER:'Aguardando você',COMPLETED:'Concluída',ABANDONED:'Encerrada'}[s]??s)
const columns:DataTableColumns<any>=[
 {title:'#',key:'id',width:70,render:r=>h(NButton,{text:true,type:'primary',onClick:()=>router.push({name:'admin-ai-investigation-detail',params:{id:r.id}})},()=>`#${r.id}`)},
 {title:'Objetivo e host',key:'objective',minWidth:280,render:r=>h('div',[h(NText,{strong:true},()=>r.objective),h(NText,{depth:3,style:'display:block;font-size:12px'},()=>`${r.hostName} · ${r.hostIp}`)])},
 {title:'Estado',key:'status',width:150,render:r=>h(NTag,{type:tag(r.status),size:'small'},()=>statusLabel(r.status))},
 {title:'Execuções',key:'actionRunCount',width:100,render:r=>String(r.actionRunCount??0)},
 {title:'Solicitante',key:'requestedByName',width:170}, {title:'Última atividade',key:'lastActivityAt',width:190,render:r=>fmt(r.lastActivityAt)},
]
async function load(){loading.value=true;error.value='';try{rows.value=(await aiInvestigationService.list()).data}catch{error.value='Não foi possível carregar as investigações.'}finally{loading.value=false}}
onMounted(load)
</script>
<template><div class="p-4 sm:p-6" data-testid="ai-investigations-list"><div class="mb-6 flex flex-wrap items-start justify-between gap-3"><div><h1 class="text-xl font-semibold text-white">Investigações IA/MCP</h1><NText depth="3">Acompanhe pedidos do agente, execuções auditadas e conclusões sem manter conexões SSH abertas.</NText></div><NButton secondary @click="load">Atualizar</NButton></div><NAlert v-if="error" type="error" class="mb-4">{{error}}</NAlert><NCard embedded><NSpin :show="loading"><NDataTable v-if="rows.length" :columns="columns" :data="rows" :row-key="r=>r.id" :scroll-x="1060"/><NEmpty v-else-if="!loading" description="Nenhuma investigação registrada."/></NSpin></NCard></div></template>
