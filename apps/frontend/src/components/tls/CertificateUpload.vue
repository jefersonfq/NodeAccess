<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
const {t}=useI18n()
const props=defineProps<{disabled:boolean}>()
const emit=defineEmits<{validate:[certificate:string,privateKey:string]}>()
const generation=ref(0)
const certificate=ref(''),privateKey=ref(''),error=ref('')
async function read(event:Event,kind:'certificate'|'privateKey'){
  const input=event.target as HTMLInputElement,file=input.files?.[0];error.value=''
  if(!file)return
  if(kind==='certificate')certificate.value='';else privateKey.value=''
  if(file.size>(kind==='certificate'?100000:30000)){error.value=t('tls.fileTooLarge');input.value='';return}
  try{const value=await file.text();if(kind==='certificate')certificate.value=value;else privateKey.value=value}catch{error.value=t('tls.fileReadError')}
}
function submit(){if(!props.disabled&&certificate.value&&privateKey.value)emit('validate',certificate.value,privateKey.value)}
function clear(){certificate.value='';privateKey.value='';error.value='';generation.value++}
defineExpose({clear})
</script>
<template>
  <form :key="generation" @submit.prevent="submit" class="tls-upload">
    <p>{{ $t('tls.uploadHint') }}</p>
    <label>{{ $t('tls.chain') }}<input type="file" accept=".pem,.crt,.cer" :disabled="disabled" @change="read($event,'certificate')" /></label>
    <label>{{ $t('tls.key') }}<input type="file" accept=".pem,.key" :disabled="disabled" @change="read($event,'privateKey')" /></label>
    <p v-if="error" role="alert">{{ error }}</p>
    <button class="tls-button" type="submit" :disabled="disabled||!certificate||!privateKey">{{ $t('tls.validate') }}</button>
  </form>
</template>
<style scoped>.tls-upload{display:grid;gap:16px}.tls-upload label{display:grid;gap:8px}.tls-upload input{max-width:100%}</style>
