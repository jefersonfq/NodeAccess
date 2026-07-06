<script setup lang="ts">
import { onMounted, onUnmounted, watchEffect } from 'vue'
import { NConfigProvider, NMessageProvider, NDialogProvider, darkTheme, ptBR, datePtBR } from 'naive-ui'
import { useUiStore } from '@/stores/ui'
import { initUserPreferencesSync } from '@/services/user-preferences.service'
import { initTerminalPopoutCoordinator } from '@/services/terminal-popout-coordinator.service'
import router from '@/router'

const ui = useUiStore()

onMounted(() => {
  initUserPreferencesSync()
  initTerminalPopoutCoordinator(router)
})

const stopThemeEffect = watchEffect(() => {
  document.body.dataset.theme = ui.themeMode
})

onUnmounted(() => {
  stopThemeEffect()
  delete document.body.dataset.theme
})
</script>

<template>
  <NConfigProvider :theme="ui.isDark ? darkTheme : null" :locale="ptBR" :date-locale="datePtBR">
    <NMessageProvider>
      <NDialogProvider>
        <RouterView />
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>
