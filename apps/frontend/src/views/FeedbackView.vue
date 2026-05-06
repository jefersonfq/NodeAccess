<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { FeedbackPublic, FeedbackStatus } from '@nodeaccess/shared'
import { NButton, NCard, NEmpty, NModal, NForm, NFormItem, NInput, NSelect, NSpin, NTag, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { feedbackService } from '@/services/feedback.service'
import { featuresService } from '@/services/features.service'
import { useRoute } from 'vue-router'

const { t } = useI18n()
const message = useMessage()
const route = useRoute()

const loading = ref(false)
const saving = ref(false)
const showCreate = ref(false)
const feedbacks = ref<FeedbackPublic[]>([])
const feedbackLicensed = ref(true)

const form = ref({
  type: 'suggestion' as 'suggestion' | 'problem' | 'question',
  title: '',
  message: '',
})

const typeOptions = computed(() => [
  { label: t('feedback.types.suggestion'), value: 'suggestion' },
  { label: t('feedback.types.problem'), value: 'problem' },
  { label: t('feedback.types.question'), value: 'question' },
])

function validateFeedbackForm() {
  const title = form.value.title.trim()
  const body = form.value.message.trim()

  if (title.length < 4) {
    message.warning(t('feedback.validation.titleMin'))
    return false
  }

  if (body.length < 10) {
    message.warning(t('feedback.validation.messageMin'))
    return false
  }

  return true
}

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
    const { data } = await feedbackService.listMine()
    feedbacks.value = data
  } catch {
    message.error(t('feedback.my.loadError'))
  } finally {
    loading.value = false
  }
}

async function createFeedback() {
  if (!feedbackLicensed.value) return
  if (!validateFeedbackForm()) return
  saving.value = true
  try {
    await feedbackService.create({
      type: form.value.type,
      title: form.value.title.trim(),
      message: form.value.message.trim(),
      contextRoute: route.fullPath,
      contextScreen: typeof route.name === 'string' ? route.name : null,
    })
    form.value = { type: 'suggestion', title: '', message: '' }
    showCreate.value = false
    message.success(t('feedback.create.success'))
    await load()
  } catch {
    message.error(t('feedback.create.error'))
  } finally {
    saving.value = false
  }
}

function formatDate(value: string) {
  return new Date(value).toLocaleString()
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
  <div class="p-6 max-w-5xl">
    <div class="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 class="text-xl font-semibold text-white">{{ $t('feedback.my.title') }}</h1>
        <p class="text-sm text-gray-400 mt-1">{{ $t('feedback.my.subtitle') }}</p>
      </div>
      <NButton type="primary" :disabled="!feedbackLicensed" @click="showCreate = true">
        {{ $t('feedback.create.action') }}
      </NButton>
    </div>

    <NCard v-if="!feedbackLicensed" :bordered="false" style="background: #1e1e22;" class="mb-4">
      <p class="text-sm text-gray-300">{{ $t('feedback.license.disabled') }}</p>
    </NCard>

    <NSpin :show="loading">
      <div v-if="feedbackLicensed && feedbacks.length" class="space-y-4">
        <NCard
          v-for="item in feedbacks"
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
              </div>
              <p class="text-sm text-gray-300 whitespace-pre-wrap">{{ item.message }}</p>
              <p class="text-xs text-gray-500 mt-3">
                {{ $t('feedback.common.sentAt', { date: formatDate(item.createdAt) }) }}
              </p>
              <p v-if="formatContext(item)" class="text-xs text-gray-500 mt-1">
                {{ $t('feedback.common.context') }}: {{ formatContext(item) }}
              </p>
            </div>
          </div>

          <div v-if="item.adminResponse" class="mt-4 rounded-lg border border-blue-900/40 bg-[#151a24] p-3">
            <p class="text-xs font-medium text-blue-300 mb-1">{{ $t('feedback.my.responseTitle') }}</p>
            <p class="text-sm text-gray-200 whitespace-pre-wrap">{{ item.adminResponse }}</p>
          </div>
        </NCard>
      </div>

      <NEmpty
        v-else
        :description="feedbackLicensed ? $t('feedback.my.empty') : $t('feedback.license.disabled')"
        class="py-12"
      />
    </NSpin>

    <NModal
      v-model:show="showCreate"
      preset="card"
      :title="$t('feedback.create.title')"
      class="max-w-2xl"
      style="background: #18181c;"
    >
      <NForm label-placement="top" @submit.prevent="createFeedback">
        <NFormItem :label="$t('feedback.fields.type')">
          <NSelect v-model:value="form.type" :options="typeOptions" />
        </NFormItem>
        <NFormItem :label="$t('feedback.fields.title')">
          <NInput v-model:value="form.title" :placeholder="$t('feedback.placeholders.title')" />
        </NFormItem>
        <NFormItem :label="$t('feedback.fields.message')">
          <NInput
            v-model:value="form.message"
            type="textarea"
            :rows="5"
            :placeholder="$t('feedback.placeholders.message')"
          />
        </NFormItem>
        <div class="flex justify-end gap-2">
          <NButton @click="showCreate = false">{{ $t('common.cancel') }}</NButton>
          <NButton type="primary" :loading="saving" @click="createFeedback">
            {{ $t('feedback.create.submit') }}
          </NButton>
        </div>
      </NForm>
    </NModal>
  </div>
</template>
