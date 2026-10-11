<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { NButton, NTooltip } from 'naive-ui'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { tlsService } from '@/services/tls.service'
const router=useRouter(),{t}=useI18n(),count=ref(0)
let timer:ReturnType<typeof setTimeout>|undefined,disposed=false
async function refresh(){
  if(disposed||document.hidden)return
  try{const status=await tlsService.alerts();if(!disposed)count.value=status.enabled?status.alerts.length:0}
  catch{if(!disposed)count.value=1}
  finally{if(!disposed){clearTimeout(timer);timer=setTimeout(refresh,60000)}}
}
function visibility(){clearTimeout(timer);if(!document.hidden)void refresh()}
onMounted(()=>{void refresh();document.addEventListener('visibilitychange',visibility)})
onBeforeUnmount(()=>{disposed=true;clearTimeout(timer);document.removeEventListener('visibilitychange',visibility)})
</script>
<template>
  <NTooltip v-if="count" placement="right"><template #trigger><NButton data-tls-alert size="tiny" type="warning" :aria-label="t('tls.globalAlert',{count})" @click="router.push('/admin/tls')">HTTPS !</NButton></template>{{ t('tls.globalAlert',{count}) }}</NTooltip>
</template>
