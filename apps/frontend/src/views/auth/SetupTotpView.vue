<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NCard, NAlert, NSpin, NInput, NButton, NText, NSpace, NSteps, NStep } from 'naive-ui'
import type { InputInst } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { authService } from '@/services/auth.service'
import { getSafeRedirectTarget } from '@/services/auth-redirect.service'

const route = useRoute()
const router = useRouter()
const auth   = useAuthStore()
const { t }  = useI18n()

const loading  = ref(false)
const qrCode   = ref<string | null>(null)
const token    = ref('')
const error    = ref<string | null>(null)
const step     = ref(0) // 0=qr, 1=confirm
const tokenInput = ref<InputInst | null>(null)

onMounted(async () => {
  if (!auth.tempToken) {
    router.push({ name: 'login', query: { reason: 'mfa_setup_expired', redirect: getSafeRedirectTarget(route.query) } })
    return
  }
  loading.value = true
  try {
    const { data } = await authService.setupTotp(auth.tempToken)
    qrCode.value   = data.qrCode
    step.value     = 0
    await nextTick()
    tokenInput.value?.focus()
  } catch {
    error.value = t('auth.setupTotp.qrError')
  } finally {
    loading.value = false
  }
})

async function confirm() {
  if (!token.value || token.value.length !== 6) {
    error.value = t('auth.setupTotp.codeLength')
    return
  }
  error.value  = null
  loading.value = true
  try {
    const { data } = await authService.confirmTotp({
      token: token.value,
      setupToken: auth.tempToken!,
    })
    auth.completeLogin(data.accessToken, data.refreshToken)
    router.push(getSafeRedirectTarget(route.query))
  } catch {
    error.value = t('auth.setupTotp.invalidCode')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <NCard :bordered="false" style="background: #1e1e22;">
    <NSteps :current="step" class="mb-6">
      <NStep :title="$t('auth.setupTotp.scanStep')" />
      <NStep :title="$t('auth.setupTotp.confirmStep')" />
    </NSteps>

    <NSpin v-if="loading && !qrCode" />

    <NAlert v-if="error" type="error" class="mb-4" :title="error" />

    <template v-if="qrCode">
      <NSpace vertical align="center">
        <NText>{{ $t('auth.setupTotp.scanInstructions') }}</NText>
        <img :src="qrCode" alt="QR Code TOTP" class="w-48 h-48 rounded" />
        <NText depth="3" class="text-sm">{{ $t('auth.setupTotp.enterCode') }}</NText>
      </NSpace>

      <div class="mt-6">
        <NInput
          ref="tokenInput"
          v-model:value="token"
          :placeholder="$t('auth.setupTotp.codePlaceholder')"
          maxlength="6"
          autofocus
          class="text-center text-2xl tracking-widest"
          @keyup.enter="confirm"
        />
        <NButton type="primary" block class="mt-3" :loading="loading" @click="confirm">
          {{ $t('auth.setupTotp.submit') }}
        </NButton>
      </div>
    </template>
  </NCard>
</template>
