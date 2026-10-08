<script setup lang="ts">
import { nextTick, onErrorCaptured, ref } from 'vue'
import { NButton } from 'naive-ui'
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
const panel = ref<HTMLElement | null>(null)
const failed = ref(false)
const retryButton = ref<InstanceType<typeof NButton> | null>(null)
onErrorCaptured(() => {
  const restoreFocus = !!panel.value?.contains(document.activeElement)
  failed.value = true
  if (restoreFocus) void nextTick(() => {
    const element: unknown = retryButton.value?.$el
    if (element instanceof HTMLElement) element.focus()
  })
  return false
})
function retry(): void { failed.value = false }
</script>
<template>
  <div
    ref="panel"
    class="flex flex-col min-h-0"
  >
    <div
      v-if="failed"
      class="p-4"
      role="alert"
    >
      <p class="mb-3">
        {{ t('common.panelError') }}
      </p>
      <NButton
        ref="retryButton"
        @click="retry"
      >
        {{ t('common.retry') }}
      </NButton>
    </div>
    <template v-else>
      <slot />
    </template>
  </div>
</template>
