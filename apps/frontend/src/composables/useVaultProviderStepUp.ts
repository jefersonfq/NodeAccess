import { nextTick, ref, type Ref } from 'vue'
import type { VaultDelivery } from '@/services/vault-delivery'
import { VaultClientError } from '@/services/vault-http'
import { openVaultProviderWindow, requestGoogleIdToken } from '@/services/vault-provider-confirm'

/**
 * NA-0184/NA-0183 — OIDC/Google step-up for a vault delivery: provider window, Google prompt target and the
 * NodeAccess TOTP prompt when the provider proof did not assert MFA. Nothing is kept after the step finishes.
 */
export function useVaultProviderStepUp(delivery: Pick<VaultDelivery, 'unlockWithProvider'>): {
  googleTarget: Ref<HTMLElement | null>; googlePending: Ref<boolean>; totpPending: Ref<boolean>; token: Ref<string>
  confirm: () => Promise<void>; submitTotp: () => void; cancel: () => void
} {
  const googleTarget = ref<HTMLElement | null>(null), googlePending = ref(false), totpPending = ref(false), token = ref('')
  let waiter: { resolve(value: string): void; reject(error: unknown): void } | null = null
  function cancel(): void {
    const current = waiter; waiter = null
    totpPending.value = false; googlePending.value = false; token.value = ''
    current?.reject(new VaultClientError('locked'))
  }
  async function confirm(): Promise<void> {
    await delivery.unlockWithProvider({
      redirect: (url, signal) => openVaultProviderWindow(url, signal),
      google: async (clientId, nonce, signal) => {
        googlePending.value = true
        await nextTick()
        try {
          if (!googleTarget.value) throw new VaultClientError('unavailable')
          return await requestGoogleIdToken(googleTarget.value, clientId, nonce, signal)
        } finally { googlePending.value = false }
      },
      totp: signal => new Promise<string>((resolve, reject) => {
        token.value = ''; totpPending.value = true; waiter = { resolve, reject }
        signal.addEventListener('abort', cancel, { once: true })
      }),
    })
    token.value = ''; totpPending.value = false
  }
  function submitTotp(): void {
    const current = waiter, value = token.value
    waiter = null; token.value = ''; totpPending.value = false
    current?.resolve(value)
  }
  return { googleTarget, googlePending, totpPending, token, confirm, submitTotp, cancel }
}
