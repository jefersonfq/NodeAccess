<script setup lang="ts">
import { useManualStore } from '@/stores/manual'
defineProps<{ chapter: string }>()
const manual = useManualStore()
</script>
<template>
  <RouterLink v-if="manual.enabled" :to="`/manual/${chapter}`" target="_blank" rel="noopener"
    class="manual-link" :aria-label="$t('manual.openChapter')" :title="$t('manual.openChapter')" :data-manual-link="chapter">
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
      <path d="M12 5v15M3 4c4-1 6 0 9 1 3-1 5-2 9-1v15c-4-1-6 0-9 1-3-1-5-2-9-1Z"/>
    </svg>
  </RouterLink>
</template>
<style scoped>
.manual-link { display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; flex-shrink:0; border-radius:7px; color:inherit; opacity:.8; }
.manual-link:hover { background:rgba(100,116,139,.15); opacity:1; }
.manual-link:focus-visible { outline:2px solid #3b82f6; outline-offset:2px; opacity:1; }
</style>
