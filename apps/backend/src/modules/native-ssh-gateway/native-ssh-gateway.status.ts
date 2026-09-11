export const NATIVE_SSH_GATEWAY_STATUS_KEY = 'native-ssh-gateway:status'
export const NATIVE_SSH_GATEWAY_STATUS_TTL_SECONDS = 45

export type NativeSshGatewayRuntimeState = 'online' | 'disabled' | 'error' | 'stopped'
export type NativeSshGatewayHostKeyState = 'missing' | 'valid' | 'unreadable' | 'invalid'

export interface NativeSshGatewayRuntimeStatus {
  state: NativeSshGatewayRuntimeState
  host: string
  port: number
  enabled: boolean
  hostKeyConfigured: boolean
  hostKeyState: NativeSshGatewayHostKeyState
  hostKeyPath: string | null
  hostKeyAlgorithm: string | null
  hostKeyFingerprint: string | null
  hostKeyPermissionsSafe: boolean | null
  hostKeyMessage: string | null
  startedAt: string
  lastSeenAt: string
  lastFailureAt: string | null
  lastFailureMessage: string | null
}
