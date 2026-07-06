<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { NAlert, NButton, NCard, NInput, NSelect, NSpin, NTag, NText, useMessage } from 'naive-ui'
import type { HostPublic, LocalAiChatResponse, LocalAiProposedAction, LocalAiStatus } from '@nodeaccess/shared'
import { localAiService } from '@/services/local-ai.service'
import { featuresService } from '@/services/features.service'
import { getLocalAiLastScreen } from '@/services/local-ai-context.service'
import { useAuthStore } from '@/stores/auth'
import { hostService } from '@/services/host.service'

const { t } = useI18n()
const route = useRoute()
const message = useMessage()
const auth = useAuthStore()

const loading = ref(true)
const sending = ref(false)
const featureLicensed = ref(false)
const status = ref<LocalAiStatus | null>(null)
const prompt = ref('')
const history = ref<Array<{ role: 'user' | 'assistant'; text: string; provider?: string; citations?: LocalAiChatResponse['citations'] }>>([])
const proposalHosts = ref<HostPublic[]>([])
const proposalTargetHostId = ref<number | null>(null)
const proposalReason = ref('')
const creatingProposal = ref(false)
const reviewingProposalId = ref<number | null>(null)
const myProposals = ref<LocalAiProposedAction[]>([])
const adminProposals = ref<LocalAiProposedAction[]>([])
const lastScreen = computed(() => getLocalAiLastScreen())
const isAdmin = computed(() => auth.isAdmin)
const hostOptions = computed(() => proposalHosts.value.map((host) => ({
  label: `${host.name} (${host.ip})`,
  value: host.id,
})))
const pendingAdminProposals = computed(() => adminProposals.value.filter((item) => item.status === 'pending'))
const suggestionPrompts = computed(() => {
  const routeName = lastScreen.value?.routeName ?? null

  if (routeName === 'hosts') {
    return [
      t('localAi.suggestions.items.hostsByGroup'),
      t('localAi.suggestions.items.hostConnection'),
      t('localAi.suggestions.items.hostSummary'),
      t('localAi.suggestions.items.features'),
    ]
  }

  if (routeName === 'admin-session-audit' || routeName === 'admin-session-audit-detail' || routeName === 'admin-reports-sessions') {
    return [
      t('localAi.suggestions.items.audit'),
      t('localAi.suggestions.items.sessions'),
      t('localAi.suggestions.items.ticket'),
      t('localAi.suggestions.items.hostSummary'),
    ]
  }

  if (routeName === 'admin-integrations') {
    return [
      t('localAi.suggestions.items.features'),
      t('localAi.suggestions.items.knowledge'),
      t('localAi.suggestions.items.integrations'),
      t('localAi.suggestions.items.ticket'),
    ]
  }

  if (routeName === 'agents') {
    return [
      t('localAi.suggestions.items.agents'),
      t('localAi.suggestions.items.hostConnection'),
      t('localAi.suggestions.items.features'),
      t('localAi.suggestions.items.sessions'),
    ]
  }

  return [
    t('localAi.suggestions.items.features'),
    t('localAi.suggestions.items.sessions'),
    t('localAi.suggestions.items.hostsByGroup'),
    t('localAi.suggestions.items.audit'),
    t('localAi.suggestions.items.ticket'),
    t('localAi.suggestions.items.knowledge'),
  ]
})

const canChat = computed(() => featureLicensed.value && status.value?.available === true)

async function load() {
  loading.value = true
  try {
    const [features, statusRes] = await Promise.all([
      featuresService.get(),
      localAiService.status(),
    ])
    featureLicensed.value = features.localAiLicensed
    status.value = statusRes.data
    if (features.localAiLicensed) {
      const requests: Array<Promise<unknown>> = [
        hostService.list({ limit: 100 }),
        localAiService.listMineProposedActions(),
      ]
      if (auth.isAdmin) {
        requests.push(localAiService.listAdminProposedActions())
      }
      const [hostsRes, mineRes, adminRes] = await Promise.all(requests)
      proposalHosts.value = (hostsRes as Awaited<ReturnType<typeof hostService.list>>).data.data
      myProposals.value = (mineRes as Awaited<ReturnType<typeof localAiService.listMineProposedActions>>).data
      adminProposals.value = auth.isAdmin
        ? (adminRes as Awaited<ReturnType<typeof localAiService.listAdminProposedActions>>).data
        : []
    }
  } catch {
    featureLicensed.value = false
    status.value = null
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function send() {
  const text = prompt.value.trim()
  if (!text) return
  await submitPrompt(text)
}

async function submitPrompt(text: string) {
  if (!canChat.value) {
    message.warning(t('localAi.messages.unavailable'))
    return
  }

  history.value.push({ role: 'user', text })
  prompt.value = ''
  sending.value = true
  try {
    const { data } = await localAiService.chat({
      message: text,
      contextRoute: route.fullPath,
      contextScreen: typeof route.name === 'string' ? route.name : null,
    })
    history.value.push({
      role: 'assistant',
      text: data.answer,
      provider: data.provider,
      citations: data.citations,
    })
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    message.error(e.response?.data?.message ?? t('localAi.messages.error'))
  } finally {
    sending.value = false
  }
}

function applySuggestion(text: string) {
  prompt.value = text
}

async function runQuickTest() {
  await submitPrompt(t('localAi.quickTest.prompt'))
}

function clearHistory() {
  history.value = []
}

async function createProposal() {
  if (!proposalTargetHostId.value) {
    message.warning(t('localAi.proposals.messages.hostRequired'))
    return
  }
  if (proposalReason.value.trim().length < 10) {
    message.warning(t('localAi.proposals.messages.reasonRequired'))
    return
  }

  const host = proposalHosts.value.find((item) => item.id === proposalTargetHostId.value)
  creatingProposal.value = true
  try {
    const { data } = await localAiService.createProposedAction({
      actionType: 'test_host_connection',
      targetType: 'host',
      targetId: proposalTargetHostId.value,
      title: t('localAi.proposals.defaultTitle', { host: host?.name ?? `#${proposalTargetHostId.value}` }),
      reason: proposalReason.value.trim(),
    })
    myProposals.value = [data, ...myProposals.value]
    if (isAdmin.value) {
      adminProposals.value = [data, ...adminProposals.value]
    }
    proposalTargetHostId.value = null
    proposalReason.value = ''
    message.success(t('localAi.proposals.messages.created'))
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    message.error(e.response?.data?.message ?? t('localAi.proposals.messages.createError'))
  } finally {
    creatingProposal.value = false
  }
}

async function reviewProposal(id: number, decision: 'approved' | 'rejected') {
  reviewingProposalId.value = id
  try {
    const { data } = await localAiService.reviewProposedAction(id, { decision })
    adminProposals.value = adminProposals.value.map((item) => item.id === id ? data : item)
    myProposals.value = myProposals.value.map((item) => item.id === id ? data : item)
    message.success(decision === 'approved'
      ? t('localAi.proposals.messages.approved')
      : t('localAi.proposals.messages.rejected'))
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    message.error(e.response?.data?.message ?? t('localAi.proposals.messages.reviewError'))
  } finally {
    reviewingProposalId.value = null
  }
}

function proposalStatusType(status: LocalAiProposedAction['status']) {
  if (status === 'approved') return 'success'
  if (status === 'rejected') return 'error'
  return 'warning'
}
</script>

<template>
  <div class="p-6 max-w-4xl">
    <div class="mb-6">
      <h1 class="text-xl font-semibold text-white">{{ $t('localAi.title') }}</h1>
      <NText depth="3" class="text-sm">{{ $t('localAi.subtitle') }}</NText>
    </div>

    <NSpin :show="loading">
      <div class="space-y-4">
        <NAlert v-if="!featureLicensed" type="warning">
          {{ $t('localAi.unlicensed') }}
        </NAlert>

        <NAlert v-else-if="status && !status.available" type="info">
          {{ status.message ?? $t('localAi.messages.unavailable') }}
        </NAlert>

        <NAlert v-if="status?.guardrailMessage" type="warning">
          {{ status.guardrailMessage }}
        </NAlert>

        <NCard :bordered="false" class="na-card">
          <div class="flex flex-wrap gap-3">
            <NTag size="small">{{ $t('localAi.status.mode') }}: {{ status?.mode ?? '-' }}</NTag>
            <NTag size="small">{{ $t('localAi.status.routing') }}: {{ status?.routingPolicy ?? '-' }}</NTag>
            <NTag size="small">{{ $t('localAi.status.provider') }}: {{ status?.effectiveProvider ?? '-' }}</NTag>
            <NTag size="small">{{ $t('localAi.status.execution') }}: {{ status?.actionExecutionEnabled ? $t('localAi.status.executionEnabled') : $t('localAi.status.executionDisabled') }}</NTag>
          </div>
        </NCard>

        <NCard :bordered="false" class="na-card">
          <div class="space-y-3">
            <div>
              <div class="text-sm font-medium text-white">{{ $t('localAi.capabilities.title') }}</div>
              <NText depth="3" class="text-xs">{{ $t('localAi.capabilities.subtitle') }}</NText>
            </div>
            <div class="grid gap-4 md:grid-cols-2">
              <div>
                <div class="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-300">
                  {{ $t('localAi.capabilities.canDoTitle') }}
                </div>
                <ul class="space-y-1 text-sm text-zinc-200">
                  <li v-for="item in 4" :key="`can-${item}`">
                    - {{ $t(`localAi.capabilities.canDo.items.${item}`) }}
                  </li>
                </ul>
              </div>
              <div>
                <div class="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-300">
                  {{ $t('localAi.capabilities.limitsTitle') }}
                </div>
                <ul class="space-y-1 text-sm text-zinc-400">
                  <li v-for="item in 3" :key="`limit-${item}`">
                    - {{ $t(`localAi.capabilities.limits.items.${item}`) }}
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </NCard>

        <NCard :bordered="false" class="na-card">
          <div class="space-y-3">
            <div>
              <div class="text-sm font-medium text-white">{{ $t('localAi.suggestions.title') }}</div>
              <NText depth="3" class="text-xs">
                {{
                  lastScreen?.routeName
                    ? $t('localAi.suggestions.contextualSubtitle', { screen: lastScreen.routeName })
                    : $t('localAi.suggestions.subtitle')
                }}
              </NText>
            </div>
            <div class="flex flex-wrap gap-2">
              <NButton
                v-for="suggestion in suggestionPrompts"
                :key="suggestion"
                size="small"
                secondary
                :disabled="!canChat"
                @click="applySuggestion(suggestion)"
              >
                {{ suggestion }}
              </NButton>
            </div>
          </div>
        </NCard>

        <NCard :bordered="false" class="na-card">
          <div class="space-y-4">
            <div>
              <div class="text-sm font-medium text-white">{{ $t('localAi.proposals.title') }}</div>
              <NText depth="3" class="text-xs">{{ $t('localAi.proposals.subtitle') }}</NText>
            </div>

            <NAlert type="info" :show-icon="false">
              {{ $t('localAi.proposals.info') }}
            </NAlert>

            <div class="grid gap-3 md:grid-cols-2">
              <div>
                <div class="mb-1 text-sm text-zinc-300">{{ $t('localAi.proposals.hostLabel') }}</div>
                <NSelect
                  v-model:value="proposalTargetHostId"
                  :options="hostOptions"
                  filterable
                  clearable
                  :placeholder="$t('localAi.proposals.hostPlaceholder')"
                  :disabled="!featureLicensed || creatingProposal"
                />
              </div>
              <div>
                <div class="mb-1 text-sm text-zinc-300">{{ $t('localAi.proposals.reasonLabel') }}</div>
                <NInput
                  v-model:value="proposalReason"
                  type="textarea"
                  :rows="3"
                  :placeholder="$t('localAi.proposals.reasonPlaceholder')"
                  :disabled="!featureLicensed || creatingProposal"
                />
              </div>
            </div>

            <div class="flex justify-end">
              <NButton type="primary" :loading="creatingProposal" :disabled="!featureLicensed" @click="createProposal">
                {{ $t('localAi.proposals.createButton') }}
              </NButton>
            </div>

            <div class="space-y-2">
              <div class="text-sm font-medium text-white">{{ $t('localAi.proposals.mineTitle') }}</div>
              <NAlert v-if="myProposals.length === 0" type="info" :show-icon="false">
                {{ $t('localAi.proposals.emptyMine') }}
              </NAlert>
              <div
                v-for="item in myProposals"
                :key="item.id"
                class="na-item rounded-lg border p-4"
              >
                <div class="mb-2 flex flex-wrap items-center gap-2">
                  <NTag size="small">{{ $t('localAi.proposals.actionType.test_host_connection') }}</NTag>
                  <NTag size="small" :type="proposalStatusType(item.status)">
                    {{ $t(`localAi.proposals.status.${item.status}`) }}
                  </NTag>
                </div>
                <div class="text-sm text-zinc-100">{{ item.title }}</div>
                <div class="mt-1 text-xs text-zinc-400">{{ item.reason }}</div>
              </div>
            </div>

            <div v-if="isAdmin" class="space-y-2">
              <div class="text-sm font-medium text-white">{{ $t('localAi.proposals.adminTitle') }}</div>
              <NAlert v-if="pendingAdminProposals.length === 0" type="info" :show-icon="false">
                {{ $t('localAi.proposals.emptyAdmin') }}
              </NAlert>
              <div
                v-for="item in pendingAdminProposals"
                :key="`admin-${item.id}`"
                class="na-item rounded-lg border p-4"
              >
                <div class="mb-2 flex flex-wrap items-center gap-2">
                  <NTag size="small">{{ $t('localAi.proposals.actionType.test_host_connection') }}</NTag>
                  <NTag size="small" type="warning">{{ $t('localAi.proposals.status.pending') }}</NTag>
                  <NTag size="small">{{ item.requester.name }}</NTag>
                </div>
                <div class="text-sm text-zinc-100">{{ item.title }}</div>
                <div class="mt-1 text-xs text-zinc-400">{{ item.reason }}</div>
                <div class="mt-3 flex flex-wrap gap-2">
                  <NButton size="small" type="success" :loading="reviewingProposalId === item.id" @click="reviewProposal(item.id, 'approved')">
                    {{ $t('localAi.proposals.approveButton') }}
                  </NButton>
                  <NButton size="small" type="error" ghost :loading="reviewingProposalId === item.id" @click="reviewProposal(item.id, 'rejected')">
                    {{ $t('localAi.proposals.rejectButton') }}
                  </NButton>
                </div>
              </div>
            </div>
          </div>
        </NCard>

        <NCard :bordered="false" class="na-card">
          <div class="space-y-4">
            <div v-if="history.length === 0" class="text-sm text-zinc-400">
              {{ $t('localAi.empty') }}
            </div>

            <div class="flex flex-wrap justify-end gap-2">
              <NButton
                size="small"
                secondary
                :disabled="!canChat || sending"
                @click="runQuickTest"
              >
                {{ $t('localAi.quickTest.button') }}
              </NButton>
              <NButton
                size="small"
                tertiary
                :disabled="history.length === 0 || sending"
                @click="clearHistory"
              >
                {{ $t('localAi.quickTest.clear') }}
              </NButton>
            </div>

            <div v-for="(item, index) in history" :key="index" class="na-item rounded-lg border p-4">
              <div class="mb-2 flex items-center gap-2">
                <NTag :type="item.role === 'assistant' ? 'success' : 'default'" size="small">
                  {{ item.role === 'assistant' ? $t('localAi.roles.assistant') : $t('localAi.roles.user') }}
                </NTag>
                <NTag v-if="item.provider" size="small">{{ item.provider }}</NTag>
              </div>
              <div class="whitespace-pre-wrap text-sm text-zinc-100">{{ item.text }}</div>
              <div v-if="item.citations?.length" class="mt-3 flex flex-wrap gap-2">
                <NTag v-for="citation in item.citations" :key="`${citation.kind}-${citation.label}`" size="small" type="info">
                  {{ citation.label }}
                </NTag>
              </div>
            </div>

            <div class="space-y-3">
              <NInput
                v-model:value="prompt"
                type="textarea"
                :rows="4"
                :placeholder="$t('localAi.placeholder')"
                :disabled="!canChat"
              />
              <div class="flex justify-end">
                <NButton type="primary" :loading="sending" :disabled="!canChat" @click="send">
                  {{ $t('localAi.send') }}
                </NButton>
              </div>
            </div>
          </div>
        </NCard>
      </div>
    </NSpin>
  </div>
</template>
