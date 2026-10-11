<script setup lang="ts">
defineProps<{ name: 'searchTabs' | 'fullscreen' | 'hosts' | 'snippets' | 'links' | 'share' | 'ownSession' | 'jit' | 'files' | 'forwardings' | 'localAi' | 'feedback' | 'diagnostics' | 'editHost' }>()
</script>

<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <template v-if="name === 'searchTabs'"><circle
      cx="11"
      cy="11"
      r="7"
    /><path d="m20 20-3.5-3.5" /></template>
    <template v-else-if="name === 'fullscreen'"><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M16 3h3a2 2 0 0 1 2 2v3" /><path d="M8 21H5a2 2 0 0 1-2-2v-3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /></template>
    <template v-else-if="name === 'hosts'"><rect
      x="2"
      y="2"
      width="20"
      height="8"
      rx="2"
    /><rect
      x="2"
      y="14"
      width="20"
      height="8"
      rx="2"
    /><line
      x1="6"
      y1="6"
      x2="6.01"
      y2="6"
    /><line
      x1="6"
      y1="18"
      x2="6.01"
      y2="18"
    /></template>
    <template v-else-if="name === 'snippets'"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></template>
    <template v-else-if="name === 'links'"><path d="M10 13a5 5 0 0 0 7.54.54l2.92-2.92a5 5 0 0 0-7.07-7.07L11.5 5.43" /><path d="M14 11a5 5 0 0 0-7.54-.54L3.54 13.38a5 5 0 1 0 7.07 7.07l1.88-1.88" /></template>
    <template v-else-if="name === 'share'"><circle
      cx="18"
      cy="5"
      r="3"
    /><circle
      cx="6"
      cy="12"
      r="3"
    /><circle
      cx="18"
      cy="19"
      r="3"
    /><path d="m8.59 13.51 6.83 3.98" /><path d="m15.41 6.51-6.82 3.98" /></template>
    <template v-else-if="name === 'ownSession'"><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></template>
    <template v-else-if="name === 'jit'"><circle
      cx="7.5"
      cy="15.5"
      r="5.5"
    /><path d="m21 2-9.6 9.6" /><path d="m15.5 7.5 3 3L22 7l-3-3" /></template>
    <template v-else-if="name === 'files'"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l1.5 2h9A1.5 1.5 0 0 1 20.5 9.5v8A1.5 1.5 0 0 1 19 19H5a2 2 0 0 1-2-2z" /></template>
    <template v-else-if="name === 'forwardings'"><path d="M19 7H7" /><path d="m10 4-3 3 3 3" /><path d="M5 17h12" /><path d="m14 14 3 3-3 3" /></template>
    <template v-else-if="name === 'localAi'"><path d="M9.5 2A2.5 2.5 0 0 0 7 4.5V6H5a2 2 0 0 0-2 2v5" /><path d="M14.5 2A2.5 2.5 0 0 1 17 4.5V6h2a2 2 0 0 1 2 2v5" /><path d="M8 14h8" /><path d="M10 18h4" /><circle
      cx="9"
      cy="10"
      r="1"
    /><circle
      cx="15"
      cy="10"
      r="1"
    /></template>
    <template v-else-if="name === 'feedback'"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /><path d="M8 9h8" /><path d="M8 13h5" /></template>
    <template v-else-if="name === 'diagnostics'"><path d="M3 12h4l3 8 4-16 3 8h4" /></template>
    <template v-else-if="name === 'editHost'"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4z" /></template>
  </svg>
</template>
