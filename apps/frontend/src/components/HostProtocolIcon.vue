<script setup lang="ts">
defineProps<{ protocol: string }>()
</script>

<template>
  <svg
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
    :data-protocol-icon="protocol"
  >
    <template v-if="protocol === 'rdp' || protocol === 'vnc'">
      <rect
        x="2"
        y="3"
        width="20"
        height="14"
        rx="2"
      />
      <path d="M8 21h8M12 17v4" />
      <path
        v-if="protocol === 'rdp'"
        d="M6 7h4v5H6zM14 7h4v5h-4z"
      />
      <path
        v-else
        d="m8 7 4 6 4-6"
      />
    </template>
    <template v-else-if="protocol === 'telnet'">
      <rect
        x="2"
        y="3"
        width="20"
        height="18"
        rx="2"
      />
      <path d="m5 9 3 3-3 3M11 8h7M14.5 8v8" />
    </template>
    <template v-else>
      <path d="M11 21H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5M6 8l3 3-3 3" />
      <rect
        x="13"
        y="14"
        width="9"
        height="7"
        rx="1"
      />
      <path d="M15 14v-2a2.5 2.5 0 0 1 5 0v2M17.5 17v1" />
    </template>
  </svg>
</template>
