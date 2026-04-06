<script setup lang="ts">
import { onMounted } from 'vue'
import { NConfigProvider, NMessageProvider, NDialogProvider, darkTheme } from 'naive-ui'
import { useUiStore } from '@/stores/ui'
import { initUserPreferencesSync } from '@/services/user-preferences.service'

const ui = useUiStore()

onMounted(() => {
  initUserPreferencesSync()
})
</script>

<template>
  <NConfigProvider :theme="ui.isDark ? darkTheme : null">
    <NMessageProvider>
      <NDialogProvider>
        <RouterView />
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>
