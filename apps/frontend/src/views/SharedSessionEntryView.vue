<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NAlert, NSpin } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { buildAuthRedirectQuery } from '@/services/auth-redirect.service'
import { sharedSessionService } from '@/services/shared-session.service'
import { savePendingSharedSession } from '@/services/shared-session-launch.service'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
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
    error.value = t('sharedSessions.invalid')
    loading.value = false
    return
  }

  const authenticated = await ensureAuthenticated()
  if (!authenticated) {
    await router.replace({ name: 'login', query: buildAuthRedirectQuery(route) })
    return
  }

  try {
    const { data } = await sharedSessionService.resolve(token)
    savePendingSharedSession(data)
    await router.replace({ name: 'shared-session-view', params: { id: data.sharedSessionId } })
  } catch (err: unknown) {
    const axiosError = err as { response?: { data?: { message?: string } } }
    error.value = axiosError.response?.data?.message ?? t('sharedSessions.invalid')
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
        <div class="text-sm text-gray-300">{{ $t('sharedSessions.resolving') }}</div>
      </div>
      <NAlert
        v-else-if="error"
        type="error"
        :title="$t('sharedSessions.openErrorTitle')"
      >
        {{ error }}
      </NAlert>
    </div>
  </div>
</template>
