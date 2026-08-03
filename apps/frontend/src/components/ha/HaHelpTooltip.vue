<script setup lang="ts">
import { NTooltip } from 'naive-ui'

defineProps<{
  label: string
  text: string
}>()
</script>

<template>
  <NTooltip trigger="hover" placement="top" :delay="150">
    <template #trigger>
      <button type="button" class="help-trigger" :aria-label="`Ajuda: ${label}`" :title="text">
        ?
      </button>
    </template>
    <span class="help-content">{{ text }}</span>
  </NTooltip>
</template>

<style scoped>
.help-trigger {
  display: inline-grid;
  width: 18px;
  height: 18px;
  margin-left: 5px;
  padding: 0;
  place-items: center;
  border: 1px solid rgba(148, 163, 184, .45);
  border-radius: 50%;
  background: transparent;
  color: #cbd5e1;
  font: 700 .6875rem/1 sans-serif;
  cursor: help;
  vertical-align: text-bottom;
}
.help-trigger:hover,
.help-trigger:focus-visible {
  border-color: #38bdf8;
  color: #7dd3fc;
  outline: 2px solid rgba(56, 189, 248, .28);
  outline-offset: 2px;
}
.help-content {
  display: block;
  max-width: 320px;
  line-height: 1.45;
}
</style>
