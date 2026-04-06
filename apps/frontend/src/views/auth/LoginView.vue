<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NForm, NFormItem, NInput, NButton, NAlert, NDivider, NSpin } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { authService } from '@/services/auth.service'
import { LoginSchema } from '@nodeaccess/shared'
import { getSafeRedirectTarget } from '@/services/auth-redirect.service'

const route = useRoute()
const router = useRouter()
const auth   = useAuthStore()
const { t }  = useI18n()

const loading        = ref(false)
const error          = ref<string | null>(null)
const form           = ref({ email: '', password: '' })
const googleEnabled  = ref(false)
const googleClientId = ref<string | null>(null)
const googleLoading  = ref(false)
const googleBtnEl    = ref<HTMLElement | null>(null)
const redirectTarget = computed(() => getSafeRedirectTarget(route.query))
const sessionExpired = computed(() => route.query.reason === 'expired')
const sessionExpiredFromTerminal = computed(() => sessionExpired.value && route.query.context === 'terminal')

// ── Google Sign-In ───────────────────────────────────────────────────────────

async function initGoogle() {
  try {
    const { data } = await authService.googleConfig()
    if (!data.enabled || !data.clientId) return
    googleEnabled.value  = true
    googleClientId.value = data.clientId
    loadGIS(data.clientId)
  } catch {
    // silently ignore
  }
}

function loadGIS(clientId: string) {
  const script = document.createElement('script')
  script.src   = 'https://accounts.google.com/gsi/client'
  script.async = true
  script.defer = true
  script.onload = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = (window as any).google
    if (!g) return
    g.accounts.id.initialize({
      client_id:   clientId,
      callback:    handleGoogleCredential,
      auto_select: false,
    })
    if (googleBtnEl.value) {
      g.accounts.id.renderButton(googleBtnEl.value, {
        theme:          'filled_black',
        size:           'large',
        width:          340,
        text:           'signin_with',
        logo_alignment: 'left',
      })
    }
  }
  document.head.appendChild(script)
}

async function handleGoogleCredential(response: { credential: string }) {
  error.value         = null
  googleLoading.value = true
  try {
    const { data } = await authService.googleLogin(response.credential)
    auth.setTokens(data.accessToken, data.refreshToken)
    auth.user = auth.decodeToken(data.accessToken)
    router.push(redirectTarget.value)
  } catch (err: unknown) {
    const axiosError = err as { response?: { data?: { message?: string } } }
    error.value = axiosError.response?.data?.message ?? t('auth.login.googleError')
  } finally {
    googleLoading.value = false
  }
}

// ── E-mail + senha ───────────────────────────────────────────────────────────

async function submit() {
  error.value = null
  const parsed = LoginSchema.safeParse(form.value)
  if (!parsed.success) {
    error.value = parsed.error.errors[0]?.message ?? t('auth.login.invalidData')
    return
  }
  loading.value = true
  try {
    const { data } = await authService.login(parsed.data)
    auth.tempToken = data.tempToken
    if (data.requiresMfaSetup) {
      router.push({ name: 'setup-totp', query: { redirect: redirectTarget.value } })
    } else {
      router.push({ name: 'verify-totp', query: { redirect: redirectTarget.value } })
    }
  } catch (err: unknown) {
    const axiosError = err as { response?: { data?: { message?: string } } }
    error.value = axiosError.response?.data?.message ?? t('auth.login.invalidCredentials')
  } finally {
    loading.value = false
  }
}

onMounted(initGoogle)
</script>

<template>
  <div class="login-card rounded-2xl p-8">
    <NAlert
      v-if="sessionExpired"
      type="warning"
      class="mb-4"
      :title="sessionExpiredFromTerminal ? $t('auth.sessionExpiredTerminal') : $t('auth.sessionExpired')"
    />
    <NAlert v-if="error" type="error" class="mb-5" :title="error" />

    <!-- Google Sign-In -->
    <NSpin v-if="googleLoading" :show="true" class="mb-4 flex justify-center" />

    <div v-if="googleEnabled && !googleLoading" class="mb-2 flex justify-center">
      <div ref="googleBtnEl" />
    </div>

    <NDivider v-if="googleEnabled" style="margin: 16px 0;">
      <span class="text-xs" style="color:#4b4b58;">{{ $t('auth.login.orContinueWith') }}</span>
    </NDivider>

    <!-- Form -->
    <NForm @submit.prevent="submit">
      <NFormItem :label="$t('auth.login.emailLabel')" :show-feedback="false" class="mb-3">
        <NInput
          v-model:value="form.email"
          :input-props="{ inputmode: 'email' }"
          :placeholder="$t('auth.login.emailPlaceholder')"
          size="large"
          :disabled="loading"
        />
      </NFormItem>

      <NFormItem :label="$t('auth.login.passwordLabel')" :show-feedback="false" class="mb-5">
        <NInput
          v-model:value="form.password"
          type="password"
          :placeholder="$t('auth.login.passwordPlaceholder')"
          size="large"
          show-password-on="click"
          :disabled="loading"
          @keyup.enter="submit"
        />
      </NFormItem>

      <NButton
        type="primary"
        block
        size="large"
        :loading="loading"
        style="font-weight: 600;"
        @click="submit"
      >
        {{ $t('auth.login.submit') }}
      </NButton>
    </NForm>
  </div>
</template>

<style scoped>
.login-card {
  background: rgba(22, 22, 26, 0.85);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.07);
  box-shadow:
    0 0 0 1px rgba(0,0,0,0.4),
    0 32px 64px rgba(0,0,0,0.5),
    0 0 80px rgba(99,102,241,0.06);
}
</style>
