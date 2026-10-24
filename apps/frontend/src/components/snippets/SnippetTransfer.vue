<script setup lang="ts">
import { ref } from 'vue'
import { NButton, NAlert, NModal } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { snippetService, type Snippet } from '@/services/snippet.service'
import { exportSnippets, parseSnippetImport, type PortableSnippet } from '@/services/snippet-transfer'
const props=defineProps<{snippets:Snippet[]}>()
const emit=defineEmits<{imported:[]}>()
const {t}=useI18n()
const file=ref<HTMLInputElement|null>(null)
const pending=ref<PortableSnippet[]>([])
const open=ref(false),busy=ref(false),error=ref('')
const imported=ref(0)
function download():void {
  const url=URL.createObjectURL(new Blob([exportSnippets(props.snippets)],{type:'application/json'}))
  const anchor=document.createElement('a');anchor.href=url;anchor.download='nodeaccess-snippets.json';anchor.click()
  setTimeout(()=>URL.revokeObjectURL(url),1000)
}
async function read(event:Event):Promise<void>{
  const input=event.target as HTMLInputElement
  const selected=input.files?.[0]; if(!selected)return
  error.value=''; imported.value=0
  try {
    if(selected.size>2_000_000)throw new Error('size')
    pending.value=parseSnippetImport(await selected.text());open.value=true
  }catch{error.value=t('snippets.macro.importError')}
  finally{input.value=''}
}
async function save():Promise<void>{
  busy.value=true;error.value=''
  try{
    while(pending.value.length){
      const item=pending.value[0]
      await snippetService.create({...item,scope:'PERSONAL',groupId:null})
      pending.value.shift();imported.value++
    }
    open.value=false
  }catch{error.value=t('snippets.macro.importPartial',{count:imported.value})}
  finally{busy.value=false;emit('imported')}
}
</script>
<template>
  <div class="flex flex-wrap gap-2 items-center">
    <input
      ref="file"
      type="file"
      accept=".json,application/json"
      class="hidden"
      data-snippet-import
      @change="read"
    >
    <NButton
      size="small"
      @click="file?.click()"
    >
      {{ t('snippets.macro.import') }}
    </NButton>
    <NButton
      size="small"
      :disabled="!snippets.length"
      @click="download"
    >
      {{ t('snippets.macro.export') }}
    </NButton>
    <NAlert
      v-if="error && !open"
      type="error"
    >
      {{ error }}
    </NAlert>
    <NModal
      :show="open"
      preset="card"
      :title="t('snippets.macro.import')"
      style="width:min(600px,calc(100vw - 32px))"
      :mask-closable="!busy"
      :closable="!busy"
      :close-on-esc="!busy"
      @update:show="value=>{if(!busy)open=value}"
    >
      <p>{{ t('snippets.macro.importHint',{count:pending.length}) }}</p>
      <ul class="max-h-64 overflow-auto">
        <li
          v-for="(item,index) in pending"
          :key="index"
        >
          {{ item.name }}
        </li>
      </ul>
      <NAlert
        v-if="error"
        type="error"
      >
        {{ error }}
      </NAlert>
      <div class="flex justify-end gap-2 mt-4">
        <NButton
          :disabled="busy"
          @click="open=false"
        >
          {{ t('common.cancel') }}
        </NButton>
        <NButton
          :loading="busy"
          :disabled="!pending.length"
          type="primary"
          @click="save"
        >
          {{ t('snippets.macro.import') }}
        </NButton>
      </div>
    </NModal>
  </div>
</template>
