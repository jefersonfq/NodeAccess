<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { NButton, NText } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import FileManager from '@/components/FileManager.vue'
import { resetTerminalLayout } from '@/services/terminal-layout.service'
import { useTerminalStore } from '@/stores/terminals'

const { t }     = useI18n()
const router    = useRouter()
const route     = useRoute()
const termStore = useTerminalStore()

const hostId = computed(() => Number(route.params.hostId))

// Find the host name from an open terminal tab (if available)
const hostName = computed(() => {
  const tab = termStore.tabs.find(t => t.hostId === hostId.value)
  return tab?.hostName ?? `Host #${hostId.value}`
})

const sessionId = computed(() => {
  const tab = termStore.tabs.find(t => t.hostId === hostId.value)
  return tab?.sessionId ?? null
})

// Return to terminal if a session exists, otherwise go to hosts
function goBack() {
  if (termStore.tabs.length > 0) {
    resetTerminalLayout()
    router.push({ name: 'terminal' })
  } else {
    router.push({ name: 'hosts' })
  }
}
</script>

<template>
  <div class="flex flex-col h-screen bg-[#1a1b1e]">

    <!-- ── Header ──────────────────────────────────────────────────────── -->
    <div class="flex items-center gap-3 px-4 py-2 bg-[#18181c] border-b border-gray-800 shrink-0">
      <NButton text size="small" class="text-gray-400 hover:text-white" @click="goBack">
        ← {{ termStore.tabs.length > 0 ? $t('fileManager.backToTerminal') : $t('terminal.back') }}
      </NButton>

      <div class="w-px h-4 bg-gray-700" />

      <div class="flex items-center gap-2 min-w-0">
        <span class="text-xs text-gray-500">{{ $t('fileManager.title') }}</span>
        <span class="text-gray-600">—</span>
        <NText strong class="text-sm text-white truncate">{{ hostName }}</NText>
      </div>
    </div>

    <!-- ── FileManager fills remaining height ──────────────────────────── -->
    <div class="flex-1 overflow-hidden">
      <FileManager :host-id="hostId" :session-id="sessionId" class="h-full" />
    </div>

  </div>
</template>
