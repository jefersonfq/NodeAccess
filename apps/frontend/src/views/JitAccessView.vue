<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { NAlert, NButton, NInput, NSpin } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { HostLinkPublicInfo, HostLinkPublicResolved } from '@nodeaccess/shared'
import TerminalPane from '@/components/TerminalPane.vue'
import { hostLinkService } from '@/services/host-link.service'
import { useTerminalStore } from '@/stores/terminals'

const route = useRoute()
const { t, d } = useI18n()
const termStore = useTerminalStore()

const token = computed(() => String(route.params.token ?? ''))
const guestName = ref('')
const pin = ref('')
const loading = ref(false)
const infoLoading = ref(false)
const error = ref<string | null>(null)
const publicInfo = ref<HostLinkPublicInfo | null>(null)
const resolved = ref<HostLinkPublicResolved | null>(null)
const tabId = ref<string | null>(null)
const pinRequired = computed(() => publicInfo.value?.pinRequired === true)
const canEnter = computed(() => guestName.value.trim().length >= 2 && (!pinRequired.value || pin.value.trim().length >= 4))

async function loadPublicInfo() {
  if (!token.value) return
  infoLoading.value = true
  error.value = null
  try {
    const { data } = await hostLinkService.publicInfo(token.value)
    publicInfo.value = data
    if (data.status !== 'active') {
      error.value = t('jitAccess.invalid')
    }
  } catch (err: unknown) {
    const axiosError = err as { response?: { data?: { message?: string } } }
    error.value = axiosError.response?.data?.message ?? t('jitAccess.invalid')
  } finally {
    infoLoading.value = false
  }
}

async function enter() {
  const trimmedName = guestName.value.trim()
  const trimmedPin = pin.value.trim()
  if (!token.value || !canEnter.value) return

  loading.value = true
  error.value = null
  try {
    const { data } = await hostLinkService.resolvePublic(token.value, trimmedName, pinRequired.value ? trimmedPin : undefined)
    resolved.value = data
    const id = termStore.add({
      id: data.host.id,
      name: data.host.name,
      ip: data.host.ip,
      port: data.host.port,
      authType: data.host.authType,
      accessProtocol: data.host.accessProtocol,
    })
    tabId.value = id
  } catch (err: unknown) {
    const axiosError = err as { response?: { data?: { message?: string } } }
    error.value = axiosError.response?.data?.message ?? t('jitAccess.invalid')
  } finally {
    loading.value = false
  }
}

onMounted(loadPublicInfo)
</script>

<template>
  <div class="min-h-screen bg-[#101014] text-gray-100">
    <div v-if="!resolved" class="flex min-h-screen items-center justify-center px-4">
      <div class="w-full max-w-md rounded-xl border border-gray-800 bg-[#16161a] p-5 shadow-xl">
        <div class="mb-4">
          <h1 class="text-base font-semibold text-gray-100">{{ $t('jitAccess.title') }}</h1>
          <p class="mt-1 text-sm text-gray-400">{{ $t('jitAccess.description') }}</p>
        </div>

        <label class="mb-1 block text-xs font-medium text-gray-400" for="jit-guest-name">
          {{ $t('jitAccess.guestName') }}
        </label>
        <NInput
          id="jit-guest-name"
          v-model:value="guestName"
          :placeholder="$t('jitAccess.guestNamePlaceholder')"
          :disabled="loading"
          @keyup.enter="enter"
        />

        <div v-if="pinRequired">
          <label class="mb-1 mt-3 block text-xs font-medium text-gray-400" for="jit-pin">
            {{ $t('jitAccess.pin') }}
          </label>
          <NInput
            id="jit-pin"
            v-model:value="pin"
            :placeholder="$t('jitAccess.pinPlaceholder')"
            :disabled="loading"
            inputmode="numeric"
            maxlength="10"
            @keyup.enter="enter"
          />
          <p class="mt-1 text-xs text-gray-500">{{ $t('jitAccess.pinHelp') }}</p>
        </div>

        <NAlert v-if="error" class="mt-3" type="error" :show-icon="false">
          {{ error }}
        </NAlert>

        <NButton
          class="mt-4 w-full"
          type="primary"
          :loading="loading || infoLoading"
          :disabled="!canEnter || infoLoading || Boolean(error)"
          @click="enter"
        >
          {{ $t('jitAccess.enter') }}
        </NButton>
      </div>
    </div>

    <div v-else class="flex h-screen flex-col bg-[#141518]">
      <header class="flex min-h-[48px] items-center justify-between gap-3 border-b border-gray-800 bg-[#111113] px-4">
        <div class="min-w-0">
          <div class="truncate text-sm font-medium text-gray-100">{{ resolved.host.name }}</div>
          <div class="truncate text-xs text-gray-500">
            {{ $t('jitAccess.sessionAs', { name: resolved.guestName }) }}
          </div>
        </div>
        <div class="shrink-0 text-xs text-gray-500">
          {{ $t('jitAccess.expiresAt', { date: d(new Date(resolved.expiresAt), 'short') }) }}
        </div>
      </header>
      <main class="min-h-0 flex-1 p-2">
        <TerminalPane
          v-if="tabId"
          :host-id="resolved.host.id"
          :tab-id="tabId"
          :visible="true"
          :connection-token="resolved.accessToken"
        />
        <div v-else class="flex h-full items-center justify-center">
          <NSpin />
        </div>
      </main>
    </div>
  </div>
</template>
