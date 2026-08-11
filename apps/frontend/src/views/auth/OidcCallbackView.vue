<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NAlert, NButton, NSpin } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { authService } from '@/services/auth.service'
import { getSafeRedirectTarget } from '@/services/auth-redirect.service'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { t } = useI18n()
const loading = ref(true)
const error = ref<string | null>(null)

onMounted(async () => {
  const state = typeof route.query.state === 'string' ? route.query.state : ''
  const code = typeof route.query.code === 'string' ? route.query.code : ''
  const providerError = typeof route.query.error === 'string' ? route.query.error : ''
  if (providerError || !state || !code) {
    error.value = t('auth.login.oidcError')
    loading.value = false
    return
  }
  try {
    const { data } = await authService.oidcComplete(state, code)
    const stored = sessionStorage.getItem('na_oidc_redirect')
    sessionStorage.removeItem('na_oidc_redirect')
    const redirect = getSafeRedirectTarget({ redirect: stored })
    if ('accessToken' in data) {
      auth.completeLogin(data.accessToken, data.refreshToken)
      await router.replace(redirect)
      return
    }
    auth.setPendingMfa(data.tempToken, data.emailOtpAvailable ?? false)
    await router.replace({
      name: data.requiresMfaSetup ? 'setup-totp' : 'verify-totp',
      query: { redirect },
    })
  } catch (err: unknown) {
    const axiosError = err as { response?: { data?: { message?: string } } }
    error.value = axiosError.response?.data?.message ?? t('auth.login.oidcError')
    loading.value = false
  }
})
</script>

<template>
  <div class="rounded-2xl border border-white/10 bg-neutral-900/90 p-8 text-center">
    <NSpin v-if="loading" size="large" :description="$t('auth.login.oidcCompleting')" />
    <template v-else>
      <NAlert type="error" :title="error || $t('auth.login.oidcError')" class="mb-5" />
      <NButton type="primary" @click="router.replace({ name: 'login' })">
        {{ $t('auth.login.oidcBack') }}
      </NButton>
    </template>
  </div>
</template>
