<script setup lang="ts">
/** NA-0189 — local stroke icons (no dependency, no remote asset; allowed by the popup CSP). */
import { computed } from 'vue'

const props = defineProps<{ name: 'shield' | 'lock' | 'search' | 'key' | 'file' | 'external' | 'alert' }>()
const paths: Record<typeof props.name, string[]> = {
  shield: ['M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z', 'M9 12l2 2 4-4'],
  lock: ['M6 11h12v9H6z', 'M8.5 11V8a3.5 3.5 0 017 0v3'],
  search: ['M11 18a7 7 0 100-14 7 7 0 000 14z', 'M20 20l-4-4'],
  key: ['M8 14a4 4 0 110-8 4 4 0 010 8z', 'M11 10h9', 'M17 10v3', 'M20 10v2'],
  file: ['M7 3h7l4 4v14H7z', 'M14 3v4h4', 'M10 14h5', 'M10 17h3'],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v6H4V6h6'],
  alert: ['M12 4l9 16H3z', 'M12 10v4', 'M12 17h.01'],
}
const d = computed(() => paths[props.name])
</script>

<template>
  <svg
    class="icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path
      v-for="(path, index) in d"
      :key="index"
      :d="path"
    />
  </svg>
</template>
