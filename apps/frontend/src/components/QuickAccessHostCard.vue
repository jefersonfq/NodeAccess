<script setup lang="ts">
import { computed, ref } from 'vue'
import { NTooltip } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import HostProtocolIcon from './HostProtocolIcon.vue'
import type { HostPublic } from '@nodeaccess/shared'

const props = defineProps<{
  host: HostPublic
  favorite?: boolean
  folderName: string | null
  folderPath?: string | null
  protocolLabel: string
  accessLabel: string
  accessTitle?: string
  lastAccessedAt?: string | Date | null
  active?: boolean
  disabled?: boolean
  disabledReason?: string
}>()
const { t, locale } = useI18n()
const activeHint = ref<'access' | 'protocol' | null>(null)
const cardFocused = ref(false)
const protocolDescription = computed(() => t('hosts.quickAccess.protocolHint', { protocol: props.protocolLabel }))
function closeHints(): void {
  activeHint.value = null
}
function showPointerHint(event: PointerEvent, hint: 'access' | 'protocol' | null): void {
  // Touch generates compatibility mouse events after the tap; only click opens its hint.
  if (event.pointerType !== 'touch') activeHint.value = hint
}
const accessDate = computed(() => {
  if (!props.lastAccessedAt) return null
  const date = new Date(props.lastAccessedAt)
  return Number.isNaN(date.getTime()) ? null : date
})
const shortAccessDate = computed(() => accessDate.value
  ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(accessDate.value)
  : '—')
const accessDescription = computed(() => [
  props.accessLabel,
  accessDate.value
    ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'long', timeStyle: 'short' }).format(accessDate.value)
    : props.accessTitle,
].filter(Boolean).join(' — '))
const isRootFolder = computed(() => ['_root_', '__root__'].includes(props.folderName?.trim() ?? ''))
const folderLabel = computed(() => isRootFolder.value ? t('hosts.quickAccess.rootFolder') : props.folderName)
const folderDescription = computed(() => isRootFolder.value ? t('hosts.quickAccess.rootFolderHint') : props.folderPath || props.folderName || '')
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
    @focus="cardFocused = true; activeHint = 'protocol'"
    @blur="cardFocused = false; closeHints()"
    @pointerleave="showPointerHint($event, null)"
    @keydown.esc.stop="closeHints()"
  >
    <div class="flex min-w-0 items-start gap-2 text-sm font-medium text-white">
      <span
        v-if="favorite"
        class="shrink-0 text-amber-300"
        role="img"
        :aria-label="t('hosts.favorites')"
        data-testid="quick-access-favorite-icon"
      >★</span>
      <span
        class="quick-access-host-name"
        :title="host.name"
        @pointerenter="showPointerHint($event, null)"
      >{{ host.name }}</span>
      <NTooltip
        :show="activeHint === 'protocol'"
        :animated="false"
        style="max-width: min(320px, calc(100vw - 24px)); overflow-wrap: anywhere;"
        :disabled="disabled"
        placement="top"
      >
        <template #trigger>
          <span
            class="ml-auto inline-flex h-5 w-5 shrink-0 items-center justify-center text-gray-400"
            data-testid="quick-access-protocol"
            title=""
            @pointerenter="showPointerHint($event, 'protocol')"
            @pointerleave="showPointerHint($event, null)"
            @click.stop="activeHint = 'protocol'"
          >
            <HostProtocolIcon :protocol="host.accessProtocol ?? 'ssh'" />
            <span class="sr-only">{{ protocolDescription }}</span>
          </span>
        </template>
        <span data-testid="quick-access-protocol-tooltip">{{ protocolDescription }}<template v-if="cardFocused"> — {{ accessDescription }}</template></span>
      </NTooltip>
    </div>
    <div class="quick-access-metadata mt-1 text-[11px] text-gray-400">
      <span class="flex min-w-0 items-center gap-1">
        <span
          class="truncate font-mono"
          :title="`${host.ip}:${host.port}`"
          @pointerenter="showPointerHint($event, null)"
        >{{ host.ip }}:{{ host.port }}</span>
      </span>
      <span class="quick-access-folder-time">
        <span
          v-if="folderName"
          class="flex min-w-0 items-center gap-1"
          :title="folderDescription"
          data-testid="quick-access-folder"
          @pointerenter="showPointerHint($event, null)"
        >
          <svg
            aria-hidden="true"
            class="shrink-0"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          ><path d="M3 7V5h7l2 2h9v12H3Z" /></svg>
          <span class="sr-only">{{ t('hosts.quickAccess.folder') }}: </span>
          <span class="truncate">{{ folderLabel }}</span>
        </span>
        <NTooltip
          :show="activeHint === 'access'"
          :animated="false"
          style="max-width: min(320px, calc(100vw - 24px)); overflow-wrap: anywhere;"
          :disabled="disabled"
          placement="top"
        >
          <template #trigger>
            <span
              :data-testid="favorite ? 'hosts-quick-favorite-access' : 'hosts-quick-recent-access'"
              class="inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap"
              title=""
              @pointerenter="showPointerHint($event, 'access')"
              @pointerleave="showPointerHint($event, null)"
              @click.stop="activeHint = 'access'"
            >
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
              ><circle
                cx="12"
                cy="12"
                r="9"
              /><path d="M12 7v5l3 2" /></svg>
              <span
                aria-hidden="true"
                data-testid="quick-access-short-date"
              >{{ shortAccessDate }}</span>
              <span class="sr-only">{{ accessDescription }}</span>
            </span>
          </template>
          <span data-testid="quick-access-time-tooltip">{{ accessDescription }}</span>
        </NTooltip>
      </span>
    </div>
    <div
      v-if="active"
      class="mt-1 text-[10px] text-emerald-300"
      data-testid="quick-access-active"
    >
      {{ accessLabel }}
    </div>
  </button>
</template>

<style scoped>
.quick-access-metadata {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: 8px;
}
.quick-access-metadata > :first-child {
  max-width: 100%;
  flex-shrink: 0;
}
.quick-access-folder-time {
  display: flex;
  min-width: 0;
  flex: 0 1 auto;
  max-width: 100%;
  align-items: center;
  gap: 6px;
}
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
