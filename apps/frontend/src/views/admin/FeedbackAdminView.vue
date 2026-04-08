<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { FeedbackPublic, FeedbackStatus, FeedbackType } from '@nodeaccess/shared'
import { NButton, NCard, NCollapse, NCollapseItem, NEmpty, NInput, NModal, NForm, NFormItem, NSelect, NSpin, NTag, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { feedbackService } from '@/services/feedback.service'
import { featuresService } from '@/services/features.service'

const { t } = useI18n()
const message = useMessage()

const loading = ref(false)
const saving = ref(false)
const feedbacks = ref<FeedbackPublic[]>([])
const selected = ref<FeedbackPublic | null>(null)
const showEdit = ref(false)
const search = ref('')
const feedbackLicensed = ref(true)
const filters = ref<{ status: FeedbackStatus | 'all'; type: FeedbackType | 'all' }>({
  status: 'all',
  type: 'all',
})

const editForm = ref({
  status: 'new' as FeedbackStatus,
  adminResponse: '',
})

const typeOptions = computed(() => [
  { label: t('common.all'), value: 'all' },
  { label: t('feedback.types.suggestion'), value: 'suggestion' },
  { label: t('feedback.types.problem'), value: 'problem' },
  { label: t('feedback.types.question'), value: 'question' },
])

const statusOptions = computed(() => [
  { label: t('common.all'), value: 'all' },
  { label: t('feedback.statuses.new'), value: 'new' },
  { label: t('feedback.statuses.in_review'), value: 'in_review' },
  { label: t('feedback.statuses.accepted'), value: 'accepted' },
  { label: t('feedback.statuses.not_planned'), value: 'not_planned' },
  { label: t('feedback.statuses.completed'), value: 'completed' },
])

const editStatusOptions = computed(() =>
  statusOptions.value.filter((option) => option.value !== 'all'),
)

const filteredFeedbacks = computed(() => {
  const query = search.value.trim().toLowerCase()
  if (!query) return feedbacks.value

  return feedbacks.value.filter((item) => {
    const haystack = [
      item.title,
      item.message,
      item.user?.name ?? '',
      item.user?.email ?? '',
      item.contextScreen ?? '',
      item.contextRoute ?? '',
    ].join(' ').toLowerCase()

    return haystack.includes(query)
  })
})

const feedbackTrend = computed(() => {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  return Array.from({ length: 4 }, (_, index) => {
    const weeksAgo = 3 - index
    const periodStart = new Date(startOfToday)
    periodStart.setDate(periodStart.getDate() - (weeksAgo * 7 + periodStart.getDay()))

    const periodEnd = new Date(periodStart)
    periodEnd.setDate(periodEnd.getDate() + 7)

    const items = feedbacks.value.filter((item) => {
      const createdAt = new Date(item.createdAt)
      return createdAt >= periodStart && createdAt < periodEnd
    })

    return {
      periodStart,
      periodEnd,
      total: items.length,
      newCount: items.filter((item) => item.status === 'new').length,
      inReviewCount: items.filter((item) => item.status === 'in_review').length,
      completedCount: items.filter((item) => item.status === 'completed').length,
    }
  })
})

const feedbackTrendMax = computed(() =>
  Math.max(
    1,
    ...feedbackTrend.value.map((item) => Math.max(item.total, item.newCount, item.inReviewCount, item.completedCount)),
  ),
)

onMounted(() => {
  void load()
})

async function load() {
  loading.value = true
  try {
    const features = await featuresService.get()
    feedbackLicensed.value = features.feedbackLicensed
    if (!feedbackLicensed.value) {
      feedbacks.value = []
      return
    }
    const { data } = await feedbackService.listForAdmin({
      status: filters.value.status !== 'all' ? filters.value.status : undefined,
      type: filters.value.type !== 'all' ? filters.value.type : undefined,
    })
    feedbacks.value = data
  } catch {
    message.error(t('feedback.admin.loadError'))
  } finally {
    loading.value = false
  }
}

function openEdit(item: FeedbackPublic) {
  selected.value = item
  editForm.value = {
    status: item.status,
    adminResponse: item.adminResponse ?? '',
  }
  showEdit.value = true
}

async function saveFeedback() {
  if (!selected.value) return
  if (selected.value.deletedAt) return
  saving.value = true
  try {
    await feedbackService.update(selected.value.id, editForm.value)
    message.success(t('feedback.admin.saveSuccess'))
    showEdit.value = false
    await load()
  } catch {
    message.error(t('feedback.admin.saveError'))
  } finally {
    saving.value = false
  }
}

async function deleteFeedback(item: FeedbackPublic) {
  if (item.deletedAt) return
  if (!window.confirm(t('feedback.admin.deleteConfirm', { title: item.title }))) return

  saving.value = true
  try {
    await feedbackService.remove(item.id)
    if (selected.value?.id === item.id) {
      showEdit.value = false
      selected.value = null
    }
    message.success(t('feedback.admin.deleteSuccess'))
    await load()
  } catch {
    message.error(t('feedback.admin.deleteError'))
  } finally {
    saving.value = false
  }
}

function formatDate(value: string) {
  return new Date(value).toLocaleString()
}

function formatTrendPeriodLabel(start: Date, end: Date) {
  const inclusiveEnd = new Date(end.getTime() - 1)
  return `${start.toLocaleDateString()} - ${inclusiveEnd.toLocaleDateString()}`
}

function statusType(status: FeedbackStatus) {
  if (status === 'completed') return 'success'
  if (status === 'accepted') return 'info'
  if (status === 'not_planned') return 'warning'
  return 'default'
}

function formatContext(item: FeedbackPublic) {
  if (item.contextScreen && item.contextRoute) {
    return `${item.contextScreen} · ${item.contextRoute}`
  }
  return item.contextScreen ?? item.contextRoute ?? null
}
</script>

<template>
  <div class="p-6 max-w-6xl">
    <div class="mb-6">
      <h1 class="text-xl font-semibold text-white">{{ $t('feedback.admin.title') }}</h1>
      <p class="text-sm text-gray-400 mt-1">{{ $t('feedback.admin.subtitle') }}</p>
    </div>

    <NCard v-if="!feedbackLicensed" :bordered="false" style="background: #1e1e22;" class="mb-4">
      <p class="text-sm text-gray-300">{{ $t('feedback.license.disabled') }}</p>
    </NCard>

    <NCard v-if="feedbackLicensed" :bordered="false" style="background: #1e1e22;" class="mb-4">
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
        <NFormItem :label="$t('feedback.fields.status')">
          <NSelect v-model:value="filters.status" :options="statusOptions" />
        </NFormItem>
        <NFormItem :label="$t('feedback.fields.type')">
          <NSelect v-model:value="filters.type" :options="typeOptions" />
        </NFormItem>
        <NFormItem :label="$t('feedback.fields.search')">
          <NInput
            v-model:value="search"
            :placeholder="$t('feedback.placeholders.search')"
            clearable
          />
        </NFormItem>
        <div class="flex items-end">
          <NButton type="primary" @click="load">{{ $t('feedback.admin.applyFilters') }}</NButton>
        </div>
      </div>
    </NCard>

    <NSpin :show="loading">
      <div v-if="feedbackLicensed && filteredFeedbacks.length" class="space-y-4">
        <NCard
          v-for="item in filteredFeedbacks"
          :key="item.id"
          :bordered="false"
          style="background: #1e1e22;"
        >
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <div class="flex items-center gap-2 mb-2 flex-wrap">
                <h3 class="text-base font-medium text-white">{{ item.title }}</h3>
                <NTag size="small">{{ $t(`feedback.types.${item.type}`) }}</NTag>
                <NTag size="small" :type="statusType(item.status)">
                  {{ $t(`feedback.statuses.${item.status}`) }}
                </NTag>
                <NTag v-if="item.deletedAt" size="small" type="error">
                  {{ $t('feedback.admin.deletedTag') }}
                </NTag>
              </div>
              <p class="text-sm text-gray-300 whitespace-pre-wrap">{{ item.message }}</p>
              <p class="text-xs text-gray-500 mt-3">
                {{ item.user?.name || '—' }} · {{ item.user?.email || '—' }} · {{ formatDate(item.createdAt) }}
              </p>
              <p v-if="formatContext(item)" class="text-xs text-gray-500 mt-1">
                {{ $t('feedback.common.context') }}: {{ formatContext(item) }}
              </p>
              <p v-if="item.adminResponse" class="text-sm text-blue-300 mt-3 whitespace-pre-wrap">
                {{ item.adminResponse }}
              </p>
              <p v-if="item.deletedAt" class="text-xs text-rose-300 mt-3">
                {{ $t('feedback.admin.deletedMeta', {
                  user: item.deletedBy?.name || item.deletedBy?.email || '—',
                  date: formatDate(item.deletedAt),
                }) }}
              </p>
            </div>
            <div class="flex flex-col gap-2">
              <NButton secondary :disabled="!!item.deletedAt" @click="openEdit(item)">
                {{ $t('feedback.admin.reviewAction') }}
              </NButton>
              <NButton secondary type="error" :disabled="!!item.deletedAt" @click="deleteFeedback(item)">
                {{ $t('common.delete') }}
              </NButton>
            </div>
          </div>
        </NCard>
      </div>

      <NEmpty
        v-else
        :description="feedbackLicensed ? (search ? $t('feedback.admin.emptySearch') : $t('feedback.admin.empty')) : $t('feedback.license.disabled')"
        class="py-12"
      />
    </NSpin>

    <NCollapse v-if="feedbackLicensed" class="mt-6">
      <NCollapseItem :title="$t('feedback.admin.trend.title')" name="trend">
        <div class="mb-4 text-xs text-gray-400">
          {{ $t('feedback.admin.trend.subtitle') }}
        </div>

        <NEmpty
          v-if="!feedbackTrend.length"
          :description="$t('feedback.admin.trend.empty')"
          class="py-6"
        />

        <div v-else class="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div
            v-for="item in feedbackTrend"
            :key="item.periodStart.toISOString()"
            class="rounded-lg border border-gray-800 bg-[#111113] px-4 py-4"
          >
            <div class="text-xs uppercase tracking-[0.14em] text-gray-500">
              {{ $t('feedback.admin.trend.weekOf', { date: item.periodStart.toLocaleDateString() }) }}
            </div>
            <div class="mt-1 text-[11px] text-gray-500">
              {{ formatTrendPeriodLabel(item.periodStart, item.periodEnd) }}
            </div>
            <div class="mt-3 space-y-3">
              <div>
                <div class="mb-1 flex items-center justify-between text-xs text-gray-400">
                  <span>{{ $t('feedback.admin.trend.total') }}</span>
                  <span>{{ item.total }}</span>
                </div>
                <div class="h-2 overflow-hidden rounded-full bg-[#222228]">
                  <div
                    class="h-full rounded-full bg-blue-500"
                    :style="{ width: `${Math.max(8, (item.total / feedbackTrendMax) * 100)}%` }"
                  />
                </div>
              </div>
              <div>
                <div class="mb-1 flex items-center justify-between text-xs text-gray-400">
                  <span>{{ $t('feedback.admin.trend.new') }}</span>
                  <span>{{ item.newCount }}</span>
                </div>
                <div class="h-2 overflow-hidden rounded-full bg-[#222228]">
                  <div
                    class="h-full rounded-full bg-amber-500"
                    :style="{ width: `${Math.max(8, (item.newCount / feedbackTrendMax) * 100)}%` }"
                  />
                </div>
              </div>
              <div>
                <div class="mb-1 flex items-center justify-between text-xs text-gray-400">
                  <span>{{ $t('feedback.admin.trend.inReview') }}</span>
                  <span>{{ item.inReviewCount }}</span>
                </div>
                <div class="h-2 overflow-hidden rounded-full bg-[#222228]">
                  <div
                    class="h-full rounded-full bg-violet-500"
                    :style="{ width: `${Math.max(8, (item.inReviewCount / feedbackTrendMax) * 100)}%` }"
                  />
                </div>
              </div>
              <div>
                <div class="mb-1 flex items-center justify-between text-xs text-gray-400">
                  <span>{{ $t('feedback.admin.trend.completed') }}</span>
                  <span>{{ item.completedCount }}</span>
                </div>
                <div class="h-2 overflow-hidden rounded-full bg-[#222228]">
                  <div
                    class="h-full rounded-full bg-emerald-500"
                    :style="{ width: `${Math.max(8, (item.completedCount / feedbackTrendMax) * 100)}%` }"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </NCollapseItem>
    </NCollapse>

    <NModal
      v-model:show="showEdit"
      preset="card"
      :title="$t('feedback.admin.modalTitle')"
      class="max-w-2xl"
      style="background: #18181c;"
    >
      <NForm label-placement="top" @submit.prevent="saveFeedback">
        <NFormItem :label="$t('feedback.fields.status')">
          <NSelect v-model:value="editForm.status" :options="editStatusOptions" :disabled="!!selected?.deletedAt" />
        </NFormItem>
        <NFormItem :label="$t('feedback.fields.adminResponse')">
          <NInput
            v-model:value="editForm.adminResponse"
            type="textarea"
            :rows="5"
            :placeholder="$t('feedback.placeholders.adminResponse')"
            :disabled="!!selected?.deletedAt"
          />
        </NFormItem>
        <p v-if="selected?.deletedAt" class="mb-3 text-xs text-rose-300">
          {{ $t('feedback.admin.deletedMeta', {
            user: selected?.deletedBy?.name || selected?.deletedBy?.email || '—',
            date: formatDate(selected.deletedAt),
          }) }}
        </p>
        <div class="flex justify-end gap-2">
          <NButton @click="showEdit = false">{{ $t('common.cancel') }}</NButton>
          <NButton type="primary" :loading="saving" :disabled="!!selected?.deletedAt" @click="saveFeedback">
            {{ $t('common.save') }}
          </NButton>
        </div>
      </NForm>
    </NModal>
  </div>
</template>
