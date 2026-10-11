<script setup lang="ts">
import FileManager from '@/components/FileManager.vue'
import PanelErrorBoundary from '@/components/PanelErrorBoundary.vue'
defineProps<{ hostId: number; sessionId?: number | null }>()
</script>
<template>
  <PanelErrorBoundary :key="`${hostId}:${sessionId ?? ''}`">
    <FileManager
      :host-id="hostId"
      :session-id="sessionId"
      class="flex-1 min-h-0"
    />
  </PanelErrorBoundary>
</template>
