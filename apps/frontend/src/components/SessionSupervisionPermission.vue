<script setup lang="ts">
import { ref, watch } from 'vue'
import { NAlert, NButton, NSwitch } from 'naive-ui'
import { supervisionService } from '@/services/session-supervision.service'
const props = defineProps<{ userId: number }>()
const enabled = ref(false)
const busy = ref(true)
const error = ref('')
const saved = ref(false)
const loaded = ref(false)
let requestVersion = 0
async function load() {
  const version = ++requestVersion
  busy.value = true; saved.value = false; error.value = ''; loaded.value = false
  try {
    const result = await supervisionService.userPermission(props.userId)
    if (version !== requestVersion) return
    enabled.value = result.data.enabled; loaded.value = true
  } catch { if (version === requestVersion) error.value = 'Não foi possível consultar a permissão de supervisão.' }
  finally { if (version === requestVersion) busy.value = false }
}
watch(() => props.userId, load, { immediate: true })
watch(enabled, () => { saved.value = false })
async function save() {
  if (!loaded.value || busy.value) return
  const version = requestVersion
  busy.value = true; error.value = ''; saved.value = false
  try {
    await supervisionService.setPermission(props.userId, enabled.value)
    if (version !== requestVersion) return
    saved.value = true; window.dispatchEvent(new Event('nodeaccess:supervision-permission-changed'))
  } catch { if (version === requestVersion) error.value = 'Não foi possível salvar a permissão. Tente novamente.' }
  finally { if (version === requestVersion) busy.value = false }
}
</script>
<template>
  <section class="mb-4 rounded border p-3">
    <label class="flex items-center gap-3"><NSwitch aria-label="Pode supervisionar sessões SSH" v-model:value="enabled" :disabled="busy || !loaded" />Pode supervisionar sessões SSH</label>
    <p class="my-2 text-xs">Somente leitura, limitada aos hosts autorizados. Não avisa o operador a cada observação. Toda supervisão exige justificativa e fica auditada. A organização deve informar sua política de monitoramento.</p>
    <NAlert v-if="error" type="error">{{ error }}</NAlert>
    <NButton v-if="!loaded && error" size="small" :loading="busy" @click="load">Tentar novamente</NButton>
    <NAlert v-if="saved" type="success">Permissão de supervisão salva.</NAlert>
    <NButton size="small" :disabled="!loaded" :loading="busy" @click="save">Salvar permissão de supervisão</NButton>
  </section>
</template>
