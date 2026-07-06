export const NATIVE_SSH_GATEWAY_STATUS_KEY = 'native-ssh-gateway:status'
export const NATIVE_SSH_GATEWAY_STATUS_TTL_SECONDS = 45

export type NativeSshGatewayRuntimeState = 'online' | 'disabled' | 'error' | 'stopped'

export interface NativeSshGatewayRuntimeStatus {
  state: NativeSshGatewayRuntimeState
  host: string
  port: number
  enabled: boolean
  hostKeyConfigured: boolean
  startedAt: string
  lastSeenAt: string
  lastFailureAt: string | null
  lastFailureMessage: string | null
}
