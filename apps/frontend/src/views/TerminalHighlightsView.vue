<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { TerminalHighlightRule } from '@nodeaccess/shared'
import { NAlert, NButton, NCard, NSpin, NSwitch, useMessage } from 'naive-ui'
import { useAuthStore } from '@/stores/auth'
import { terminalHighlightService, type EffectiveTerminalHighlights } from '@/services/terminal-highlight.service'
import TerminalHighlightRuleEditor from '@/components/TerminalHighlightRuleEditor.vue'
import TerminalHighlightEffectiveRules from '@/components/TerminalHighlightEffectiveRules.vue'

const auth = useAuthStore()
const message = useMessage()
const loading = ref(true)
const saving = ref(false)
const loadError = ref(false)
const effectiveError = ref(false)
const enabled = ref(true)
const personalRules = ref<TerminalHighlightRule[]>([])
const effective = ref<EffectiveTerminalHighlights | null>(null)

async function loadEffective() {
  effectiveError.value = false
  try { effective.value = (await terminalHighlightService.effective({ fresh: true })).data }
  catch { effective.value = null; effectiveError.value = true }
}
async function load() {
  loading.value = true
  loadError.value = false
  try {
    const preference = (await terminalHighlightService.getPreference()).data
    enabled.value = preference.enabled
    personalRules.value = preference.rules
    await loadEffective()
  } catch { loadError.value = true }
  finally { loading.value = false }
}
async function savePersonal() {
  if (personalRules.value.some(rule => !rule.name.trim() || !rule.pattern)) return message.warning('Informe nome e expressão em todas as regras.')
  for (const rule of personalRules.value) {
    if (rule.mode === 'regex') {
      try { new RegExp(rule.pattern) } catch { return message.warning(`Regex inválido: ${rule.name}`) }
    }
  }
  saving.value = true
  try {
    await terminalHighlightService.savePreference({ enabled: enabled.value, rules: personalRules.value })
    message.success('Personalização salva. Terminais abertos foram atualizados.')
    await loadEffective()
  } catch (error: any) { message.error(error?.response?.data?.message ?? 'Não foi possível salvar as regras. Suas alterações foram mantidas.') }
  finally { saving.value = false }
}
onMounted(load)
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-5 p-4 md:p-6" data-terminal-highlights-page="true">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div><h1 class="text-2xl font-semibold text-white">Meus destaques do terminal</h1><p class="mt-1 text-sm text-gray-400">Personalize suas regras e consulte os templates recebidos da organização.</p></div>
      <RouterLink v-if="auth.isAdmin" :to="{ name: 'admin-terminal-highlights' }" class="text-sm text-emerald-400 underline focus-visible:outline">Gerenciar destaques da organização</RouterLink>
    </header>
    <NAlert type="info">Regras pessoais se aplicam somente a você. Apenas administradores podem atribuir templates a usuários e grupos. Aplicações como vim e htop são ignoradas automaticamente.</NAlert>
    <NAlert v-if="loadError" type="error" title="Não foi possível carregar suas regras."><NButton @click="load">Tentar novamente</NButton></NAlert>
    <NSpin :show="loading">
      <div v-if="!loadError && !loading" class="space-y-5">
        <NCard title="Minhas regras" :bordered="false" class="na-card">
          <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div><div class="font-medium">Aplicar destaques no meu terminal</div><div class="text-xs text-gray-400">Desligar também suspende os templates recebidos. As regras salvas são preservadas.</div></div>
            <NSwitch v-model:value="enabled" :disabled="saving" aria-label="Aplicar destaques no terminal" />
          </div>
          <TerminalHighlightRuleEditor v-model="personalRules" :disabled="!enabled || saving" />
          <div class="mt-4 flex justify-end"><NButton type="primary" :loading="saving" @click="savePersonal">Salvar personalização</NButton></div>
        </NCard>
        <NCard title="Configuração em uso" :bordered="false" class="na-card">
          <NButton class="mb-4" :disabled="saving" @click="loadEffective">Atualizar configuração</NButton>
          <p class="mb-4 text-sm text-gray-400">Esta visão reflete a última configuração salva. Alterações pessoais só entram em vigor após salvar.</p>
          <NAlert v-if="effectiveError" type="error" title="Não foi possível consultar a configuração em uso."><NButton @click="loadEffective">Recarregar configuração</NButton></NAlert>
          <TerminalHighlightEffectiveRules v-else-if="effective" :effective="effective" />
        </NCard>
      </div>
    </NSpin>
  </div>
</template>
