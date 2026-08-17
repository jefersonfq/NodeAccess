<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { NAlert, NButton, NCard, NProgress, NSpin, NTag } from 'naive-ui'
import type { LocalAiConfigPublic, LocalAiStatus } from '@nodeaccess/shared'
import { featuresService, type Features } from '@/services/features.service'
import { localAiService } from '@/services/local-ai.service'
import { integrationService } from '@/services/integration.service'
import LocalAiUsagePanel from '@/components/local-ai/LocalAiUsagePanel.vue'
import AiInteractionLedgerPanel from '@/components/local-ai/AiInteractionLedgerPanel.vue'

const router = useRouter()
const { t } = useI18n()
const loading = ref(true)
const error = ref('')
const features = ref<Features | null>(null)
const status = ref<LocalAiStatus | null>(null)
const config = ref<LocalAiConfigPublic | null>(null)
const testing = ref(false)

const providerReady = computed(() => !!status.value?.effectiveProvider && status.value.enabled && status.value.available)
const providerHealthy = computed(() => providerReady.value && config.value?.healthStatus === 'healthy')
const effectiveModel = computed(() => status.value?.providerStates?.find((provider) => provider.selected)?.model ?? null)
const steps = computed(() => [
  { key: 'license', done: !!features.value?.localAiLicensed, route: 'admin-settings' },
  { key: 'provider', done: providerReady.value, route: 'admin-integrations' },
  { key: 'test', done: providerHealthy.value, route: 'admin-integrations' },
  { key: 'mcp', done: !!features.value?.mcpLicensed, route: 'admin-mcp-tokens' },
  { key: 'actions', done: !!features.value?.aiSshActionsLicensed, route: 'admin-diagnostic-playbooks' },
])
const completed = computed(() => steps.value.filter((step) => step.done).length)
const progress = computed(() => Math.round((completed.value / steps.value.length) * 100))

async function load() {
  loading.value = true
  error.value = ''
  try {
    features.value = await featuresService.get()
    if (features.value.localAiLicensed) {
      const [statusResponse, configResponse] = await Promise.all([
        localAiService.status(),
        integrationService.getLocalAi(),
      ])
      status.value = statusResponse.data
      config.value = configResponse.data
    } else {
      status.value = null
      config.value = null
    }
  } catch (reason) {
    error.value = (reason as { response?: { data?: { message?: string } } })?.response?.data?.message ?? t('aiHub.loadError')
  } finally {
    loading.value = false
  }
}

async function testProvider() {
  testing.value = true
  try {
    const result = (await integrationService.testLocalAi()).data
    if (config.value) {
      config.value = {
        ...config.value,
        healthStatus: result.healthStatus,
        healthMessage: result.healthMessage,
        lastCheckedAt: result.checkedAt,
      }
    }
  } catch (reason) {
    error.value = (reason as { response?: { data?: { message?: string } } })?.response?.data?.message ?? t('aiHub.testError')
  } finally {
    testing.value = false
  }
}

function capabilityLicensed(capability: string) {
  if (!features.value) return false
  if (capability === 'mcp') return features.value.mcpLicensed
  if (capability === 'actions') return features.value.aiSshActionsLicensed
  return features.value.localAiLicensed
}

function go(name: string) {
  void router.push({ name })
}

onMounted(load)
</script>

<template>
  <main class="mx-auto max-w-7xl space-y-5 p-4 md:p-6" data-testid="ai-automation-hub">
    <header class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div>
        <p class="text-xs font-semibold uppercase tracking-wider text-emerald-400">{{ $t('aiHub.eyebrow') }}</p>
        <h1 class="mt-1 text-2xl font-semibold text-white">{{ $t('aiHub.title') }}</h1>
        <p class="mt-2 max-w-3xl text-sm text-zinc-400">{{ $t('aiHub.subtitle') }}</p>
      </div>
      <NButton secondary :loading="loading" @click="load">{{ $t('aiHub.refresh') }}</NButton>
    </header>

    <div v-if="loading" class="flex min-h-48 items-center justify-center" aria-live="polite"><NSpin /></div>
    <NAlert v-else-if="error" type="error" :title="$t('aiHub.loadError')">
      {{ error }}<div class="mt-3"><NButton size="small" @click="load">{{ $t('aiHub.retry') }}</NButton></div>
    </NAlert>

    <template v-else-if="features">
      <NAlert v-if="!features.localAiLicensed" type="warning" :title="$t('aiHub.unlicensedTitle')">
        {{ $t('aiHub.unlicensedText') }}
      </NAlert>

      <section class="grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
        <NCard :bordered="false" class="na-card">
          <div class="flex items-start justify-between gap-3">
            <div><h2 class="text-base font-medium text-white">{{ $t('aiHub.guideTitle') }}</h2><p class="mt-1 text-xs text-zinc-400">{{ $t('aiHub.guideText') }}</p></div>
            <NTag :type="progress === 100 ? 'success' : 'info'">{{ completed }}/{{ steps.length }}</NTag>
          </div>
          <NProgress class="mt-4" type="line" :percentage="progress" :show-indicator="false" />
          <ol class="mt-4 space-y-2">
            <li v-for="(step, index) in steps" :key="step.key" class="flex items-center gap-3 rounded-lg border border-zinc-800 p-3">
              <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold" :class="step.done ? 'bg-emerald-500/20 text-emerald-300' : 'bg-zinc-800 text-zinc-300'">{{ step.done ? '✓' : index + 1 }}</span>
              <div class="min-w-0 flex-1"><div class="text-sm text-zinc-100">{{ $t(`aiHub.steps.${step.key}.title`) }}</div><div class="text-xs text-zinc-500">{{ $t(`aiHub.steps.${step.key}.text`) }}</div></div>
              <NButton text size="small" @click="go(step.route)">{{ step.done ? $t('aiHub.review') : $t('aiHub.configure') }}</NButton>
            </li>
          </ol>
        </NCard>

        <NCard :bordered="false" class="na-card">
          <h2 class="text-base font-medium text-white">{{ $t('aiHub.routingTitle') }}</h2>
          <p class="mt-1 text-xs text-zinc-400">{{ $t('aiHub.routingText') }}</p>
          <dl class="mt-4 space-y-3 text-sm">
            <div class="flex justify-between gap-4"><dt class="text-zinc-500">{{ $t('aiHub.effectiveProvider') }}</dt><dd class="text-right text-zinc-200">{{ status?.effectiveProvider ?? '—' }}</dd></div>
            <div class="flex justify-between gap-4"><dt class="text-zinc-500">{{ $t('aiHub.model') }}</dt><dd class="break-all text-right text-zinc-200">{{ effectiveModel ?? '—' }}</dd></div>
            <div class="flex justify-between gap-4"><dt class="text-zinc-500">{{ $t('aiHub.mode') }}</dt><dd class="text-right text-zinc-200">{{ status?.mode ?? '—' }}</dd></div>
            <div class="flex justify-between gap-4"><dt class="text-zinc-500">{{ $t('aiHub.failover') }}</dt><dd><NTag size="small" :type="status?.runtimeFailoverEnabled ? 'success' : 'default'">{{ status?.runtimeFailoverEnabled ? $t('common.yes') : $t('common.no') }}</NTag></dd></div>
          </dl>
          <NAlert class="mt-4" :type="providerHealthy ? 'success' : 'warning'" :show-icon="false">
            {{ config?.healthMessage ?? status?.routingExplanation ?? $t('aiHub.noProvider') }}
          </NAlert>
          <div class="mt-4 grid gap-2 sm:grid-cols-2">
            <NButton secondary @click="go('admin-integrations')">{{ $t('aiHub.manageProviders') }}</NButton>
            <NButton type="primary" :loading="testing" :disabled="!providerReady" @click="testProvider">{{ $t('aiHub.testProvider') }}</NButton>
          </div>
        </NCard>
      </section>

      <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <NCard v-for="capability in ['assistant','terminal','mcp','actions']" :key="capability" :bordered="false" class="na-card">
          <div class="flex items-center justify-between gap-2"><h2 class="text-sm font-medium text-white">{{ $t(`aiHub.capabilities.${capability}.title`) }}</h2><NTag size="small" :type="capabilityLicensed(capability) ? 'success' : 'warning'">{{ capabilityLicensed(capability) ? $t('aiHub.licensed') : $t('aiHub.unlicensed') }}</NTag></div>
          <p class="mt-2 min-h-12 text-xs text-zinc-400">{{ $t(`aiHub.capabilities.${capability}.text`) }}</p>
          <NButton class="mt-3" text type="primary" @click="go(capability === 'mcp' ? 'admin-mcp-tokens' : capability === 'actions' ? 'admin-diagnostic-playbooks' : 'local-ai')">{{ $t('aiHub.open') }}</NButton>
        </NCard>
      </section>

      <LocalAiUsagePanel v-if="features.localAiLicensed" />
      <AiInteractionLedgerPanel v-if="features.localAiLicensed" />
    </template>
  </main>
</template>
