<script setup lang="ts">
import { nextTick } from 'vue'
import { useI18n } from 'vue-i18n'

import type { HostFormTab } from '@/types/host-form'
const props = defineProps<{ modelValue: HostFormTab; errorTab?: HostFormTab | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: HostFormTab] }>()
const { t } = useI18n()
const tabs: HostFormTab[] = ['connection', 'access', 'organization', 'resources']

async function navigate(event: KeyboardEvent, index: number): Promise<void> {
  let target: number
  if (event.key === 'ArrowRight') target = (index + 1) % tabs.length
  else if (event.key === 'ArrowLeft') target = (index + tabs.length - 1) % tabs.length
  else if (event.key === 'Home') target = 0
  else if (event.key === 'End') target = tabs.length - 1
  else return
  event.preventDefault()
  emit('update:modelValue', tabs[target])
  await nextTick()
  document.getElementById(`host-form-tab-${tabs[target]}`)?.focus()
}
</script>

<template>
  <div
    class="host-form-tabs"
    role="tablist"
    :aria-label="t('hosts.form.tabs.label')"
  >
    <button
      v-for="(tab, index) in tabs"
      :id="`host-form-tab-${tab}`"
      :key="tab"
      type="button"
      role="tab"
      :aria-label="t(`hosts.form.tabs.${tab}`)"
      :aria-selected="props.modelValue === tab"
      :aria-controls="`host-form-panel-${tab}`"
      :tabindex="props.modelValue === tab ? 0 : -1"
      @click="emit('update:modelValue', tab)"
      @keydown="navigate($event, index)"
    >
      {{ t(`hosts.form.tabs.${tab}`) }}
      <span
        v-if="errorTab === tab"
        class="host-form-tab-error"
        aria-hidden="true"
      >!</span>
    </button>
  </div>
</template>

<style scoped>
.host-form-tabs { display:flex; flex-shrink:0; gap:20px; overflow-x:auto; border-bottom:1px solid var(--n-border-color); }
.host-form-tabs button { min-height:44px; padding:10px 2px; flex-shrink:0; border:0; border-bottom:3px solid transparent; background:transparent; color:var(--n-text-color); cursor:pointer; font-size:14px; white-space:nowrap; }
.host-form-tabs button[aria-selected='true'] { border-bottom-color:var(--host-form-accent, #63e2b7); font-weight:600; }
.host-form-tabs button:focus-visible { outline:2px solid var(--host-form-accent, #63e2b7); outline-offset:-3px; border-radius:4px; }
.host-form-tab-error { margin-left:4px; color:var(--host-form-danger, #ff8a8a); font-weight:700; }
@media(max-width:600px) { .host-form-tabs { gap:16px; } .host-form-tabs button { font-size:13px; } }
</style>
