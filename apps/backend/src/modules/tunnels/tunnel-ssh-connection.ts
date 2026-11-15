import { createHostKeyVerifier, type HostKeyVerificationError } from '../../shared/ssh-host-key.js'
import { Client, type ConnectConfig } from 'ssh2'
import { AppError } from '../../shared/errors.js'

/** Same target trust policy and agent-before-bastion precedence as the terminal. */
export async function connectTunnelSsh(
  config: ConnectConfig,
  trustedFingerprint: string | null | undefined,
  bastionConfig?: ConnectConfig,
  bastionTrustedFingerprint?: string | null,
): Promise<Client> {
  const ssh = new Client()
  let bastion: Client | undefined
  let verificationError: HostKeyVerificationError | null = null
  config = { ...config, keepaliveInterval: 10000, keepaliveCountMax: 3,
    hostVerifier: createHostKeyVerifier(trustedFingerprint, 'target', (error) => { verificationError = error }),
  }
  const cleanup = (): void => { bastion?.end(); config.sock?.destroy() }
  ssh.on('close', cleanup)
  // Keep an error listener after startup; the runtime service owns further cleanup.
  ssh.on('error', () => {})
  try {
    if (!config.sock && bastionConfig) {
      bastion = new Client()
      bastion.on('error', () => ssh.end())
      bastion.on('close', () => ssh.end())
      await ready(bastion, { ...bastionConfig, hostVerifier: createHostKeyVerifier(bastionTrustedFingerprint, 'bastion', (error) => { verificationError = error }) })
      config.sock = await new Promise((resolve, reject) => {
        bastion!.forwardOut('127.0.0.1', 0, config.host!, config.port!, (err, stream) => err ? reject(err) : resolve(stream))
      })
    }
    await ready(ssh, config)
    return ssh
  } catch (error) {
    ssh.end()
    cleanup()
    throw verificationError ?? error
  }
}

function ready(client: Client, config: ConnectConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    const closed = (): void => reject(new AppError('Conexão SSH encerrada durante a abertura do túnel', 502, 'TUNNEL_SSH_CLOSED'))
    const failed = (error: Error): void => reject(error)
    client.once('close', closed)
    client.once('error', failed)
    client.once('ready', () => {
      client.removeListener('close', closed)
      client.removeListener('error', failed)
      resolve()
    })
    client.connect(config)
  })
}
