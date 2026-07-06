<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NAlert, NSpin } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useTerminalStore } from '@/stores/terminals'
import { buildAuthRedirectQuery } from '@/services/auth-redirect.service'
import { hostLinkService } from '@/services/host-link.service'
import { savePendingTerminalHost } from '@/services/terminal-launch.service'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const termStore = useTerminalStore()
const { t } = useI18n()

const loading = ref(true)
const error = ref<string | null>(null)

async function ensureAuthenticated() {
  if (auth.isAuthenticated) return true
  if (!auth.refreshToken) return false
  return auth.refresh()
}

async function resolveLink() {
  const token = String(route.params.token ?? '')
  if (!token) {
    error.value = t('hostLinks.invalid')
    loading.value = false
    return
  }

  const authenticated = await ensureAuthenticated()
  if (!authenticated) {
    await router.replace({ name: 'login', query: buildAuthRedirectQuery(route) })
    return
  }

  try {
    const { data } = await hostLinkService.resolve(token)
    savePendingTerminalHost(data.host)
    termStore.add({
      id: data.host.id,
      name: data.host.name,
      ip: data.host.ip,
      port: data.host.port,
      authType: data.host.authType,
      accessProtocol: data.host.accessProtocol,
    })
    await router.replace({ name: 'terminal' })
  } catch (err: unknown) {
    const axiosError = err as { response?: { data?: { message?: string } } }
    error.value = axiosError.response?.data?.message ?? t('hostLinks.invalid')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void resolveLink()
})
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-[#101014] px-4">
    <div class="w-full max-w-md rounded-2xl border border-gray-800 bg-[#16161a] p-6">
      <div v-if="loading" class="flex flex-col items-center gap-3 text-center">
        <NSpin size="large" />
        <div class="text-sm text-gray-300">{{ $t('hostLinks.resolving') }}</div>
      </div>
      <NAlert
        v-else-if="error"
        type="error"
        :title="$t('hostLinks.openErrorTitle')"
      >
        {{ error }}
      </NAlert>
    </div>
  </div>
</template>
