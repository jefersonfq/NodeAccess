<script setup lang="ts">
import { ref } from 'vue'
import { NTooltip } from 'naive-ui'
import HostProtocolIcon from './HostProtocolIcon.vue'
defineProps<{ label: string; detail?: string; protocol?: string; mode?: string }>()
const focused = ref(false)
const hovered = ref(false)
</script>

<template>
  <NTooltip
    :show="focused || hovered"
    :animated="false"
  >
    <template #trigger>
      <span
        class="inline-flex items-center align-middle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
        tabindex="0"
        role="img"
        :aria-label="detail || label"
        @focus="focused = true"
        @blur="focused = false"
        @pointerenter="hovered = true"
        @pointerleave="hovered = false"
        @click.stop="focused = !focused"
        @keydown.enter.stop.prevent="focused = !focused"
        @keydown.space.stop.prevent="focused = !focused"
        @keydown.esc.stop="focused = false; hovered = false"
      >
        <HostProtocolIcon
          v-if="protocol"
          :protocol="protocol"
        />
        <svg
          v-else
          aria-hidden="true"
          focusable="false"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <template v-if="mode === 'direct'">
            <path d="M4 12h16m-4-4 4 4-4 4" />
          </template>
          <template v-else>
            <rect
              x="2"
              y="3"
              width="14"
              height="11"
              rx="2"
            />
            <path d="M6 18h6m-3-4v4m10-9 3 2v5c0 3-3 5-3 5s-3-2-3-5v-5z" />
            <path
              v-if="mode === 'auto'"
              d="m4 7 2 2 3-3"
            />
          </template>
        </svg>
        <span class="sr-only">{{ label }}</span>
      </span>
    </template>
    {{ detail || label }}
  </NTooltip>
</template>
