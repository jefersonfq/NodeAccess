<script setup lang="ts">
import { NTag } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { HostPublic } from '@nodeaccess/shared'

defineProps<{
  host: HostPublic
  favorite?: boolean
  folderName: string | null
  protocolLabel: string
  protocolTagType: 'default' | 'success' | 'warning' | 'error' | 'info'
  accessLabel: string
  accessTitle?: string
  active?: boolean
  disabled?: boolean
  disabledReason?: string
}>()
const { t } = useI18n()
</script>

<template>
  <button
    type="button"
    :data-quick-access-favorite="favorite ? 'true' : undefined"
    :data-quick-access-recent="!favorite ? 'true' : undefined"
    :data-host-folder="folderName ?? ''"
    :data-host-id="host.id"
    class="min-w-0 rounded-md border border-gray-800 bg-[#111113] px-2.5 py-2 text-left hover:border-gray-700 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-emerald-400/70 disabled:cursor-not-allowed"
    :disabled="disabled"
    :title="disabled ? disabledReason : undefined"
  >
    <div class="flex min-w-0 items-start gap-2 text-sm font-medium text-white">
      <span v-if="favorite" class="shrink-0 text-amber-300" role="img" :aria-label="t('hosts.favorites')" data-testid="quick-access-favorite-icon">★</span>
      <span class="quick-access-host-name" :title="host.name">{{ host.name }}</span>
    </div>
    <div class="mt-1 flex min-w-0 items-center justify-between gap-2">
      <span class="truncate font-mono text-[11px] text-gray-500" :title="`${host.ip}:${host.port}`">{{ host.ip }}:{{ host.port }}</span>
      <NTag class="shrink-0" size="tiny" :type="protocolTagType">{{ protocolLabel }}</NTag>
    </div>
    <div :data-testid="favorite ? 'hosts-quick-favorite-access' : 'hosts-quick-recent-access'" class="mt-1 whitespace-normal break-words text-[10px]" :class="active ? 'text-emerald-300' : 'text-gray-500'" :title="accessTitle">{{ accessLabel }}</div>
    <div v-if="folderName" class="mt-1 flex min-w-0 items-center gap-1 text-[11px] text-gray-500" :title="folderName" data-testid="quick-access-folder">
      <span class="shrink-0">{{ t('hosts.quickAccess.folder') }}:</span>
      <span class="truncate">{{ folderName }}</span>
    </div>
  </button>
</template>

<style scoped>
.quick-access-host-name {
  display: -webkit-box;
  min-width: 0;
  overflow: hidden;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}
</style>
