<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NAlert, NButton, NCard, NSelect, NSpin, NTag } from 'naive-ui'
import type { LocalAiUsageSummary } from '@nodeaccess/shared'
import { useI18n } from 'vue-i18n'
import { localAiService } from '@/services/local-ai.service'

const { t } = useI18n()
const loading = ref(true)
const error = ref<string | null>(null)
const days = ref(30)
const usage = ref<LocalAiUsageSummary | null>(null)
const periodOptions = [7, 30, 90].map((value) => ({ label: t('localAi.usage.days', { count: value }), value }))
const successRate = computed(() => {
  const total = usage.value?.totals.requests ?? 0
  return total ? Math.round(((usage.value?.totals.successes ?? 0) / total) * 1000) / 10 : 0
})

async function load() {
  loading.value = true
  error.value = null
  try {
    usage.value = (await localAiService.usage(days.value)).data
  } catch (reason: unknown) {
    usage.value = null
    error.value = (reason as { response?: { data?: { message?: string } } })?.response?.data?.message ?? t('localAi.usage.error')
  } finally {
    loading.value = false
  }
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value)
}

function formatCost(value: number | null) {
  if (value === null) return t('localAi.usage.unpriced')
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 4 }).format(value / 1_000_000)
}

onMounted(load)
</script>

<template>
  <NCard :bordered="false" class="na-card" data-testid="local-ai-usage">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 class="text-sm font-medium text-white">{{ $t('localAi.usage.title') }}</h2>
        <p class="mt-1 text-xs text-zinc-400">{{ $t('localAi.usage.subtitle') }}</p>
      </div>
      <div class="flex items-center gap-2">
        <NSelect v-model:value="days" class="w-32" :options="periodOptions" :aria-label="$t('localAi.usage.period')" @update:value="load" />
        <NButton secondary :loading="loading" @click="load">{{ $t('localAi.usage.refresh') }}</NButton>
      </div>
    </div>

    <NSpin :show="loading">
      <NAlert v-if="error" class="mt-4" type="error" :show-icon="false">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span>{{ error }}</span><NButton size="small" @click="load">{{ $t('localAi.usage.retry') }}</NButton>
        </div>
      </NAlert>
      <template v-else-if="usage">
        <div class="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <div class="rounded-lg border border-zinc-800 p-3"><div class="text-xs text-zinc-500">{{ $t('localAi.usage.requests') }}</div><div class="mt-1 text-lg text-white">{{ formatNumber(usage.totals.requests) }}</div></div>
          <div class="rounded-lg border border-zinc-800 p-3"><div class="text-xs text-zinc-500">{{ $t('localAi.usage.successRate') }}</div><div class="mt-1 text-lg text-white">{{ successRate }}%</div></div>
          <div class="rounded-lg border border-zinc-800 p-3"><div class="text-xs text-zinc-500">{{ $t('localAi.usage.tokens') }}</div><div class="mt-1 text-lg text-white">{{ formatNumber(usage.totals.inputTokens + usage.totals.outputTokens) }}</div></div>
          <div class="rounded-lg border border-zinc-800 p-3"><div class="text-xs text-zinc-500">{{ $t('localAi.usage.cost') }}</div><div class="mt-1 text-lg text-white">{{ formatCost(usage.totals.estimatedUsdMicros) }}</div></div>
        </div>
        <NAlert v-if="usage.totals.unpricedRequests" class="mt-3" type="warning" :show-icon="false">
          {{ $t('localAi.usage.unpricedWarning', { count: usage.totals.unpricedRequests }) }}
        </NAlert>
        <div v-if="usage.providers.length" class="mt-4 space-y-2">
          <div v-for="provider in usage.providers" :key="`${provider.provider}:${provider.model}`" class="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div><span class="text-sm text-zinc-200">{{ provider.provider }}</span><span class="ml-2 text-xs text-zinc-500">{{ provider.model }}</span></div>
              <NTag size="small" :type="provider.failures ? 'warning' : 'success'">{{ provider.successes }}/{{ provider.requests }}</NTag>
            </div>
            <div class="mt-2 grid grid-cols-2 gap-2 text-xs text-zinc-400 sm:grid-cols-4">
              <span>{{ $t('localAi.usage.latency') }}: {{ provider.averageLatencyMs }} ms</span>
              <span>{{ $t('localAi.usage.failures') }}: {{ provider.failures }}</span>
              <span>429: {{ provider.rateLimited }}</span>
              <span>{{ $t('localAi.usage.timeouts') }}: {{ provider.timeouts }}</span>
            </div>
          </div>
        </div>
        <NAlert v-else class="mt-4" type="info" :show-icon="false">{{ $t('localAi.usage.empty') }}</NAlert>
      </template>
    </NSpin>
  </NCard>
</template>
