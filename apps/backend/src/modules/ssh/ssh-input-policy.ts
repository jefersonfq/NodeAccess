export interface SshInputPolicyContext {
  sessionId?: number
  tenantId: number
  userId: number
  hostId: number
  source: 'websocket_gateway' | 'native_ssh_gateway'
}

export interface SshInputPolicyDecision {
  allow: boolean
  data?: Buffer
  message?: string
}

export interface SshInputPolicy {
  evaluate(data: Buffer, context: SshInputPolicyContext): Promise<SshInputPolicyDecision>
}

export class AllowAllSshInputPolicy implements SshInputPolicy {
  async evaluate(data: Buffer): Promise<SshInputPolicyDecision> {
    return { allow: true, data }
  }
}
