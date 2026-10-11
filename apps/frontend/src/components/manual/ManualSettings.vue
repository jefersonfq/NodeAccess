<script setup lang="ts">
import { ref } from 'vue'
import { NButton, NSwitch, NAlert, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useManualStore } from '@/stores/manual'
const manual = useManualStore()
const busy = ref(false)
const message = useMessage()
const { t } = useI18n()
async function save(value:boolean): Promise<void> {
  busy.value = true
  try { if (await manual.save(value)) message.success(t('manual.settings.saved')) }
  catch { message.error(t('manual.settings.saveError')) }
  finally { busy.value = false }
}
</script>
<template>
  <section
    id="manual"
    class="mb-6 rounded-xl border border-gray-700/40 p-5"
    data-manual-settings
  >
    <div class="flex items-center justify-between gap-5">
      <div>
        <h2 class="text-base font-semibold">
          {{ $t('manual.settings.title') }}
        </h2>
        <p class="mt-1 text-sm opacity-70">
          {{ $t('manual.settings.description') }}
        </p>
      </div>
      <NSwitch
        :value="manual.enabled"
        :loading="busy || manual.loading"
        :disabled="busy || manual.loading || manual.failed"
        :aria-label="$t('manual.settings.enable')"
        @update:value="save"
      />
    </div>
    <NAlert
      v-if="manual.failed"
      type="warning"
      class="mt-3"
    >
      {{ $t('manual.loadError') }}
      <NButton
        size="small"
        @click="manual.load"
      >
        {{ $t('manual.retry') }}
      </NButton>
    </NAlert>
    <RouterLink
      v-if="manual.enabled"
      to="/manual"
      class="mt-3 inline-block text-sm underline"
    >
      {{ $t('manual.settings.preview') }}
    </RouterLink>
  </section>
</template>
