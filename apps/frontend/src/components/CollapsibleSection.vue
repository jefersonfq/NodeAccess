<script setup lang="ts">
import { computed } from 'vue'
import { NCard, NText } from 'naive-ui'

const props = withDefaults(defineProps<{
  title: string
  defaultOpen?: boolean
  bodyClass?: string
}>(), {
  defaultOpen: false,
  bodyClass: 'mt-2',
})

const summaryAttrs = computed(() => (
  props.defaultOpen ? { open: true } : {}
))
</script>

<template>
  <details v-bind="summaryAttrs">
    <summary class="list-none cursor-pointer">
      <NCard embedded :bordered="false" style="background:#111115;">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-2 min-w-0">
            <slot name="title">
              <span class="font-medium text-white">{{ title }}</span>
            </slot>
            <slot name="header-extra" />
          </div>
          <NText depth="3" class="text-xs">Expandir</NText>
        </div>
      </NCard>
    </summary>
    <NCard embedded :class="bodyClass" style="background:#111115;">
      <slot />
    </NCard>
  </details>
</template>
