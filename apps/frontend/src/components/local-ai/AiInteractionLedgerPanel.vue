<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { NAlert, NButton, NCard, NEmpty, NSpin, NTag } from 'naive-ui'
import type { AiInteraction, AiInteractionList } from '@nodeaccess/shared'
import { useI18n } from 'vue-i18n'
import { localAiService } from '@/services/local-ai.service'

const { t, locale } = useI18n()
const loading = ref(true)
const error = ref('')
const ledger = ref<AiInteractionList | null>(null)

async function load() {
  loading.value = true
  error.value = ''
  try {
    ledger.value = (await localAiService.interactions(30)).data
  } catch (reason) {
    error.value = (reason as { response?: { data?: { message?: string } } })?.response?.data?.message ?? t('aiHub.ledger.error')
  } finally {
    loading.value = false
  }
}

function statusType(status: AiInteraction['status']) {
  if (status === 'succeeded') return 'success'
  if (status === 'cancelled') return 'warning'
  return 'error'
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function formatEstimatedCost(micros: number) {
  return new Intl.NumberFormat(locale.value, { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 6 }).format(micros / 1_000_000)
}

onMounted(load)
</script>

<template>
  <NCard :bordered="false" class="na-card" data-testid="ai-interaction-ledger">
    <header class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 class="text-base font-medium text-white">{{ $t('aiHub.ledger.title') }}</h2>
        <p class="mt-1 text-xs text-zinc-400">{{ $t('aiHub.ledger.subtitle') }}</p>
      </div>
      <NButton size="small" secondary :loading="loading" @click="load">{{ $t('aiHub.refresh') }}</NButton>
    </header>

    <div v-if="loading" class="flex min-h-28 items-center justify-center" aria-live="polite"><NSpin size="small" /></div>
    <NAlert v-else-if="error" class="mt-4" type="error" :title="$t('aiHub.ledger.error')">
      {{ error }}<div class="mt-2"><NButton size="tiny" @click="load">{{ $t('aiHub.retry') }}</NButton></div>
    </NAlert>
    <NEmpty v-else-if="!ledger?.items.length" class="py-8" :description="$t('aiHub.ledger.empty')" />

    <template v-else>
      <p class="mt-3 text-xs text-zinc-500">{{ $t('aiHub.ledger.retention', { days: ledger?.retentionDays }) }}</p>
      <div class="mt-3 overflow-x-auto rounded-lg border border-zinc-800">
        <table class="min-w-[860px] w-full text-left text-xs">
          <thead class="bg-zinc-900/80 text-zinc-400">
            <tr>
              <th class="px-3 py-2 font-medium">{{ $t('aiHub.ledger.when') }}</th>
              <th class="px-3 py-2 font-medium">{{ $t('aiHub.ledger.channel') }}</th>
              <th class="px-3 py-2 font-medium">{{ $t('aiHub.ledger.provider') }}</th>
              <th class="px-3 py-2 font-medium">{{ $t('aiHub.ledger.metrics') }}</th>
              <th class="px-3 py-2 font-medium">{{ $t('aiHub.ledger.status') }}</th>
              <th class="px-3 py-2 font-medium">Correlation ID</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-800">
            <tr v-for="item in ledger?.items" :key="item.id" class="text-zinc-300">
              <td class="whitespace-nowrap px-3 py-3">{{ dateTime(item.createdAt) }}</td>
              <td class="px-3 py-3"><div>{{ item.channel }}</div><div class="text-zinc-500">{{ item.purpose }}</div></td>
              <td class="px-3 py-3"><div>{{ item.provider }}</div><div class="max-w-44 truncate text-zinc-500" :title="item.model">{{ item.model }}</div></td>
              <td class="whitespace-nowrap px-3 py-3">
                <div>{{ item.latencyMs }} ms · {{ item.inputTokens + item.outputTokens }} tokens</div>
                <div v-if="item.estimatedUsdMicros != null" class="text-zinc-500">{{ formatEstimatedCost(item.estimatedUsdMicros) }}</div>
                <div v-if="item.scriptArtifactId || item.actionRunId" class="text-zinc-500">
                  <span v-if="item.scriptArtifactId">script #{{ item.scriptArtifactId }}</span><span v-if="item.scriptArtifactId && item.actionRunId"> · </span><span v-if="item.actionRunId">run #{{ item.actionRunId }}</span>
                </div>
              </td>
              <td class="px-3 py-3"><NTag size="small" :type="statusType(item.status)">{{ $t(`aiHub.ledger.statuses.${item.status}`) }}</NTag></td>
              <td class="px-3 py-3 font-mono text-[11px] text-zinc-500"><span :title="item.correlationId">{{ item.correlationId.slice(0, 8) }}…</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </NCard>
</template>
