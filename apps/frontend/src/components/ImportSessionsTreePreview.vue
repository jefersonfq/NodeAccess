<script setup lang="ts">
import { computed } from 'vue'
import type { ImportSessionsPreviewRow } from '@/services/import-sessions-preview.service'

const MAX_VISIBLE_ROWS = 120
const props = defineProps<{
  rows: ImportSessionsPreviewRow[]
  totalHosts: number
  allHostsOnly: number
}>()
const visibleRows = computed(() => props.rows.slice(0, MAX_VISIBLE_ROWS))
const hiddenRows = computed(() => Math.max(0, props.rows.length - visibleRows.value.length))
</script>

<template>
  <section
    class="na-panel overflow-hidden rounded border border-gray-800"
    :aria-label="$t('import.sessionsPreview.title')"
    data-import-sessions-preview="true"
  >
    <header class="border-b border-gray-800 px-3 py-2">
      <div class="text-xs font-semibold text-white">{{ $t('terminal.sessionsNavigator.title') }}</div>
      <div class="text-[10px] text-gray-500">{{ $t('import.sessionsPreview.subtitle') }}</div>
    </header>
    <div class="p-2" role="tree" :aria-label="$t('import.sessionsPreview.treeLabel')">
      <div v-if="allHostsOnly" class="sessions-preview-row px-2 text-gray-300" role="treeitem" aria-level="1">
        <span aria-hidden="true">🖥</span>
        <span class="min-w-0 flex-1 truncate text-xs">{{ $t('hosts.allHosts') }}</span>
        <span class="sessions-preview-badge">+{{ allHostsOnly }}</span>
      </div>
      <div class="sessions-preview-section mb-1">
        <span aria-hidden="true">▾</span>
        <span class="min-w-0 flex-1 truncate">{{ $t('hosts.corporateFolders.title') }}</span>
        <span class="sessions-preview-badge">{{ totalHosts }}</span>
      </div>
      <div
        v-for="row in visibleRows"
        :key="row.key"
        role="treeitem"
        :aria-level="row.depth + 1"
        class="sessions-preview-row"
        :class="row.kind === 'host' ? 'text-gray-200' : 'text-gray-300'"
        :style="{ paddingLeft: `${10 + row.depth * 14}px` }"
      >
        <span aria-hidden="true">{{ row.kind === 'folder' ? '📁' : '○' }}</span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-xs">{{ row.name }}</span>
          <span v-if="row.endpoint" class="block truncate font-mono text-[10px] text-gray-500">{{ row.endpoint }}</span>
        </span>
        <span v-if="row.kind === 'folder' && row.hostCount" class="sessions-preview-badge">{{ row.hostCount }}</span>
      </div>
      <div v-if="hiddenRows" class="px-2 py-2 text-[10px] text-gray-500">
        {{ $t('import.sessionsPreview.moreItems', { count: hiddenRows }) }}
      </div>
    </div>
  </section>
</template>

<style scoped>
.sessions-preview-section,
.sessions-preview-row {
  display: flex;
  min-height: 30px;
  align-items: center;
  gap: 8px;
  border-radius: 6px;
}
.sessions-preview-section {
  padding: 6px 8px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .04em;
  color: var(--na-text-muted);
}
.sessions-preview-row { padding-bottom: 4px; padding-right: 8px; padding-top: 4px; }
.sessions-preview-row:hover { background: var(--na-sidebar-hover); }
.sessions-preview-badge {
  min-width: 22px;
  border-radius: 9999px;
  background: var(--na-shortcut-bg);
  padding: 1px 6px;
  text-align: center;
  font-size: 10px;
  color: var(--na-text-muted);
}
</style>
