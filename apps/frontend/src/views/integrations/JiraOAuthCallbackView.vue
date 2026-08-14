<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NCard, NResult, NSpin, NText } from 'naive-ui'
import { integrationService } from '@/services/integration.service'

const route = useRoute()
const router = useRouter()
const status = ref<'loading' | 'success' | 'error'>('loading')
const siteName = ref('')

onMounted(async () => {
  const code = typeof route.query.code === 'string' ? route.query.code : ''
  const state = typeof route.query.state === 'string' ? route.query.state : ''

  // Remove credenciais efêmeras do histórico e da barra antes da chamada externa.
  window.history.replaceState({}, document.title, route.path)

  if (!code || !state) {
    status.value = 'error'
    return
  }

  try {
    const { data } = await integrationService.completeJiraOAuth(code, state)
    siteName.value = data.siteName
    status.value = 'success'
  } catch {
    status.value = 'error'
  }
})

function returnToIntegrations() {
  void router.replace({ name: 'admin-integrations', query: { section: 'jira' } })
}
</script>

<template>
  <main class="min-h-screen flex items-center justify-center p-4" style="background:var(--na-background, #0b1020);">
    <NCard :bordered="false" class="w-full max-w-lg" style="background:var(--na-surface-raised);">
      <div v-if="status === 'loading'" class="py-10 text-center" role="status" aria-live="polite">
        <NSpin size="large" />
        <div class="mt-4 font-semibold text-white">Concluindo conexão com o Jira</div>
        <NText depth="3">Validando a autorização e o site selecionado.</NText>
      </div>

      <NResult
        v-else-if="status === 'success'"
        status="success"
        title="Jira conectado"
        :description="siteName ? `Autorização read-only concluída para ${siteName}.` : 'Autorização read-only concluída.'"
      >
        <template #footer>
          <NButton type="primary" autofocus @click="returnToIntegrations">Voltar às integrações</NButton>
        </template>
      </NResult>

      <NResult
        v-else
        status="error"
        title="Não foi possível conectar o Jira"
        description="A autorização expirou, já foi utilizada ou não corresponde ao site configurado. Inicie uma nova tentativa."
      >
        <template #footer>
          <NButton type="primary" autofocus @click="returnToIntegrations">Tentar novamente</NButton>
        </template>
      </NResult>
    </NCard>
  </main>
</template>
