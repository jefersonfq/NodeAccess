<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { NAlert, NButton, NCard, NEmpty, NPagination, NSpin, useMessage } from 'naive-ui'
import type { SessionAuditPublic } from '@nodeaccess/shared'
import { featuresService } from '@/services/features.service'
import { sessionAuditService } from '@/services/sessionAudit.service'

const rows = ref<SessionAuditPublic[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const error = ref('')
const message = useMessage()
async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const features = await featuresService.get()
    if (!features.trial?.resources.includes('audit') || !features.sessionAuditLicensed) {
      error.value = 'A auditoria não está habilitada nesta degustação.'
      rows.value = []
      return
    }
    const { data } = await sessionAuditService.list({ page: page.value, limit: 20 })
    rows.value = data.data
    total.value = data.total
  } catch {
    error.value = 'Não foi possível carregar as sessões. Tente novamente.'
  } finally { loading.value = false }
}
async function download(row: SessionAuditPublic): Promise<void> {
  try {
    const { data } = await sessionAuditService.download(row.sessionId)
    sessionAuditService.saveBlobAs(data, `sessao-${row.sessionId}.jsonl`)
  } catch { message.error('Não foi possível baixar o registro. Tente novamente.') }
}
onMounted(load)
</script>

<template>
  <main class="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
    <h1 class="text-xl font-semibold">
      Auditoria da degustação
    </h1>
    <p>Consulte e baixe os registros das sessões deste ambiente de teste.</p>
    <NAlert
      v-if="error"
      type="warning"
      role="alert"
    >
      {{ error }}
    </NAlert>
    <NButton
      :loading="loading"
      @click="load"
    >
      Atualizar sessões
    </NButton>
    <NSpin :show="loading">
      <NEmpty
        v-if="!loading && !error && rows.length === 0"
        description="Nenhuma sessão registrada ainda."
      />
      <div class="space-y-3">
        <NCard
          v-for="row in rows"
          :key="row.sessionId"
          :title="row.hostNameSnapshot"
          size="small"
        >
          <p>Sessão {{ row.sessionId }} · {{ row.status }}</p>
          <p>{{ row.userNameSnapshot }} · {{ new Date(row.startedAt).toLocaleString('pt-BR') }}</p>
          <NButton
            class="mt-3"
            :aria-label="`Baixar registro da sessão ${row.sessionId}`"
            @click="download(row)"
          >
            Baixar registro
          </NButton>
        </NCard>
      </div>
    </NSpin>
    <NPagination
      v-if="total > 20"
      v-model:page="page"
      :item-count="total"
      :page-size="20"
      @update:page="load"
    />
  </main>
</template>
