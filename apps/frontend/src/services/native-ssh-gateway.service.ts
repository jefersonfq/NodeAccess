import api from './api'

export interface NativeSshGatewayConfig {
  enabled: boolean
  bindHost: string
  host: string
  port: number
  publicEndpoint: string | null
  hostKeyPath: string | null
  passwordAuth: boolean
  mfaRequired: boolean
  publicKeyAuth: boolean
  hostKeyConfigured: boolean
  hostKeyPathConfigured: boolean
  suggestedEndpoint: string
  appUrl: string
  configSource: 'database' | 'env'
  effective: {
    enabled: boolean
    bindHost: string
    port: number
    hostKeyConfigured: boolean
    hostKeyPathConfigured: boolean
  }
  operational: {
    appMode: 'api' | 'gateway'
    processStatusObservable: boolean
    processState: 'online' | 'disabled' | 'error' | 'stopped' | 'unknown'
    runtimeHost: string | null
    runtimePort: number | null
    runtimeStartedAt: string | null
    runtimeLastSeenAt: string | null
    runtimeLastFailureAt: string | null
    runtimeLastFailureMessage: string | null
    hostKeyState: 'missing' | 'valid' | 'unreadable' | 'invalid' | 'unknown'
    hostKeyPath: string | null
    hostKeyAlgorithm: string | null
    hostKeyFingerprint: string | null
    hostKeyPermissionsSafe: boolean | null
    hostKeyMessage: string | null
    activeNativeSshSessions: number
  }
  differsFromEnv: boolean
  requiresGatewayRestart: boolean
}

export interface NativeSshGatewayProbeResult {
  success: boolean
  testedAt: string
  latencyMs: number | null
  banner: string | null
  endpoint: string | null
  attempts: Array<{ host: string; port: number; success: boolean; latencyMs: number | null; banner: string | null; error: string | null }>
  message: string
}

export interface UpdateNativeSshGatewayConfigPayload {
  enabled: boolean
  bindHost: string
  port: number
  publicEndpoint: string | null
  hostKeyPath: string | null
  passwordAuth: boolean
  mfaRequired: boolean
  publicKeyAuth: boolean
}

export const nativeSshGatewayService = {
  getConfig: () => api.get<NativeSshGatewayConfig>('/native-ssh-gateway/config'),
  updateConfig: (payload: UpdateNativeSshGatewayConfigPayload) =>
    api.patch<NativeSshGatewayConfig>('/native-ssh-gateway/config', payload),
  probe: () => api.post<NativeSshGatewayProbeResult>('/native-ssh-gateway/diagnostics/probe'),
}
