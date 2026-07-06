<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NCard, NAlert, NInput, NButton, NText, NSpace } from 'naive-ui'
import type { InputInst } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { authService } from '@/services/auth.service'
import { getSafeRedirectTarget } from '@/services/auth-redirect.service'

const auth    = useAuthStore()
const route   = useRoute()
const router  = useRouter()
const { t }   = useI18n()

const code        = ref('')
const error       = ref<string | null>(null)
const loading     = ref(false)
const resending   = ref(false)
const countdown   = ref(0)
const codeInput   = ref<InputInst | null>(null)

let timer: ReturnType<typeof setInterval> | null = null

function startCountdown(seconds: number) {
  countdown.value = seconds
  timer = setInterval(() => {
    if (countdown.value > 0) {
      countdown.value--
    } else {
      clearInterval(timer!)
    }
  }, 1000)
}

onMounted(async () => {
  if (!auth.tempToken) {
    router.push({ name: 'login', query: { redirect: getSafeRedirectTarget(route.query) } })
    return
  }
  await sendOtp()
  await nextTick()
  codeInput.value?.focus()
})

onUnmounted(() => { if (timer) clearInterval(timer) })

async function sendOtp() {
  resending.value = true
  error.value = null
  try {
    await authService.requestEmailOtp(auth.tempToken!)
    startCountdown(60)
  } catch {
    error.value = t('auth.verifyEmailOtp.sendError')
  } finally {
    resending.value = false
  }
}

async function verify() {
  if (code.value.length !== 6) { error.value = t('auth.verifyEmailOtp.codeLength'); return }
  error.value   = null
  loading.value = true
  try {
    const { data } = await authService.verifyEmailOtp(code.value, auth.tempToken!)
    auth.setTokens(data.accessToken, data.refreshToken)
    auth.user      = auth.decodeToken(data.accessToken)
    auth.tempToken = null
    router.push(getSafeRedirectTarget(route.query))
  } catch (err: any) {
    error.value = err?.response?.data?.message ?? t('auth.verifyEmailOtp.invalidCode')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <NCard :bordered="false" style="background: #1e1e22;">
    <NSpace vertical align="center" class="mb-4">
      <NText class="text-lg font-semibold">{{ $t('auth.verifyEmailOtp.title') }}</NText>
      <NText depth="3" class="text-sm text-center">
        {{ $t('auth.verifyEmailOtp.description') }}
      </NText>
    </NSpace>

    <NAlert v-if="error" type="error" class="mb-4" :title="error" />

    <NInput
      ref="codeInput"
      v-model:value="code"
      :placeholder="$t('auth.verifyEmailOtp.codePlaceholder')"
      maxlength="6"
      size="large"
      class="text-center text-2xl tracking-widest"
      @keyup.enter="verify"
    />

    <NButton type="primary" block class="mt-4" :loading="loading" @click="verify">
      {{ $t('auth.verifyEmailOtp.submit') }}
    </NButton>

    <NButton
      text
      block
      class="mt-2"
      :disabled="countdown > 0 || resending"
      :loading="resending"
      @click="sendOtp"
    >
      {{ countdown > 0
        ? $t('auth.verifyEmailOtp.resendIn', { seconds: countdown })
        : $t('auth.verifyEmailOtp.resend') }}
    </NButton>

    <NButton text block class="mt-1" @click="router.push({ name: 'verify-totp', query: { redirect: getSafeRedirectTarget(route.query) } })">
      {{ $t('auth.verifyEmailOtp.backToTotp') }}
    </NButton>
  </NCard>
</template>
