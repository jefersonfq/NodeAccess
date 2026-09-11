import type { AxiosRequestConfig } from 'axios'

export function isPublicJitRequest(config?: AxiosRequestConfig): boolean {
  const url = String(config?.url ?? '')
  const method = String(config?.method ?? 'get').toLowerCase()
  if (/\/host-links\/[^/]+\/public-info(?:\?|$)/.test(url) && method === 'get') return true
  if (/\/host-links\/[^/]+\/public-resolve(?:\?|$)/.test(url) && method === 'post') return true
  return false
}

export function isPublicAuthRequest(config?: AxiosRequestConfig): boolean {
  if (isPublicJitRequest(config)) return true
  const url = String(config?.url ?? '')
  return [
    '/auth/lookup-tenant',
    '/auth/login',
    '/auth/setup-totp',
    '/auth/confirm-totp',
    '/auth/verify-totp',
    '/auth/request-email-otp',
    '/auth/verify-email-otp',
    '/auth/google/config',
    '/auth/google',
    '/auth/oidc/config',
    '/auth/oidc/start',
    '/auth/oidc/complete',
  ].some((path) => url === path || url.endsWith(path))
}


// These authenticated dialogs own their retry state; reloading loses edited ACLs.
export function isLocalAclRecoveryRequest(config?: AxiosRequestConfig): boolean {
  const url = String(config?.url ?? '').split('?')[0]
  return /^\/inventory\/nodes\/\d+\/(?:acl(?:\/(?:users|impact-preview|(?:USER|GROUP|ROLE)\/\d+))?|effective-permissions\/users\/\d+)$/.test(url)
    || /^\/inventory\/hosts\/\d+\/(?:my-access|node)$/.test(url)
}

// Webhook forms and histories expose local errors and retry without losing input.
export function isLocalWebhookRecoveryRequest(config?: AxiosRequestConfig): boolean {
  const url = String(config?.url ?? '').split('?')[0]
  return /^\/webhooks(?:\/|$)/.test(url) || /^\/inbound-webhooks\/endpoints(?:\/|$)/.test(url)
}

export function isLocalForwardingRecoveryRequest(config?: AxiosRequestConfig): boolean {
  return /^\/(?:forwardings|tunnels)(?:\/|\?|$)/.test(String(config?.url ?? ''))
}

// Import dialogs retain edited rows and own recovery after preview/history failures.
export function isLocalHostImportRecoveryRequest(config?: AxiosRequestConfig): boolean {
  return /^\/host-imports(?:\/|\?|$)/.test(String(config?.url ?? ''))
}

// File operations own their error/retry state. A permission/network failure must not reload SSH tabs.
export function isLocalSftpRecoveryRequest(config?: AxiosRequestConfig): boolean {
  return /^\/(?:hosts\/\d+\/sftp|sftp|session-supervision)(?:\/|\?|$)/.test(String(config?.url ?? ''))
}

// Network/AAA forms preserve credentials and handle retry locally.
export function isLocalNetworkAccessRecoveryRequest(config?: AxiosRequestConfig): boolean {
  return /^\/network-access(?:\/|\?|$)/.test(String(config?.url ?? ''))
}
