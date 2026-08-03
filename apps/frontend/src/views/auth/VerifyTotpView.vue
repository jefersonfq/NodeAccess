<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
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
const emailOtpAvailable = computed(() => auth.emailOtpAvailable)
const loading = ref(false)
const token   = ref('')
const error   = ref<string | null>(null)
const tokenInput = ref<InputInst | null>(null)

onMounted(async () => {
  if (!auth.tempToken) {
    router.push({ name: 'login', query: { redirect: getSafeRedirectTarget(route.query) } })
    return
  }
  await nextTick()
  tokenInput.value?.focus()
})

async function verify() {
  if (token.value.length !== 6) { error.value = t('auth.verifyTotp.codeLength'); return }
  error.value   = null
  loading.value = true
  try {
    const { data } = await authService.verifyTotp(token.value, auth.tempToken!)
    auth.completeLogin(data.accessToken, data.refreshToken)
    router.push(getSafeRedirectTarget(route.query))
  } catch {
    error.value = t('auth.verifyTotp.invalidCode')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <NCard :bordered="false" style="background: #1e1e22;">
    <NSpace vertical align="center" class="mb-4">
      <NText class="text-lg font-semibold">{{ $t('auth.verifyTotp.title') }}</NText>
      <NText depth="3" class="text-sm text-center">
        {{ $t('auth.verifyTotp.description') }}
      </NText>
    </NSpace>

    <NAlert v-if="error" type="error" class="mb-4" :title="error" />

    <NInput
      ref="tokenInput"
      v-model:value="token"
      :placeholder="$t('auth.verifyTotp.codePlaceholder')"
      maxlength="6"
      size="large"
      autofocus
      class="text-center text-2xl tracking-widest"
      @keyup.enter="verify"
    />

    <NButton type="primary" block class="mt-4" :loading="loading" @click="verify">
      {{ $t('auth.verifyTotp.submit') }}
    </NButton>

    <NButton v-if="emailOtpAvailable" text class="mt-2 w-full" @click="router.push({ name: 'verify-email-otp', query: { redirect: getSafeRedirectTarget(route.query) } })">
      {{ $t('auth.verifyTotp.useEmail') }}
    </NButton>

    <NButton text class="mt-1 w-full" @click="router.push({ name: 'login', query: { redirect: getSafeRedirectTarget(route.query) } })">
      {{ $t('auth.verifyTotp.back') }}
    </NButton>
  </NCard>
</template>
