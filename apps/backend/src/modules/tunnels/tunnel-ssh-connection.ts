import { createHash } from 'node:crypto'
import { Client, type ConnectConfig } from 'ssh2'
import { AppError } from '../../shared/errors.js'

/** Same target trust policy and agent-before-bastion precedence as the terminal. */
export async function connectTunnelSsh(
  config: ConnectConfig,
  trustedFingerprint: string | null | undefined,
  bastionConfig?: ConnectConfig,
): Promise<Client> {
  const ssh = new Client()
  let bastion: Client | undefined
  let verificationError: AppError | undefined
  config = { ...config, keepaliveInterval: 10000, keepaliveCountMax: 3,
    hostVerifier: (key: Buffer) => {
      const fingerprint = `SHA256:${createHash('sha256').update(key).digest('base64')}`
      if (trustedFingerprint === fingerprint) return true
      verificationError = new AppError(
        trustedFingerprint
          ? 'A chave SSH do host mudou. Valide a identidade pelo terminal antes de abrir o túnel.'
          : 'Chave SSH ainda não confiável. Valide a identidade pelo terminal antes de abrir o túnel.',
        409, trustedFingerprint ? 'HOST_KEY_CHANGED' : 'HOST_KEY_VERIFICATION_REQUIRED',
      )
      return false
    },
  }
  const cleanup = () => { bastion?.end(); config.sock?.destroy() }
  ssh.on('close', cleanup)
  // Keep an error listener after startup; the runtime service owns further cleanup.
  ssh.on('error', () => {})
  try {
    if (!config.sock && bastionConfig) {
      bastion = new Client()
      bastion.on('error', () => ssh.end())
      bastion.on('close', () => ssh.end())
      await ready(bastion, bastionConfig)
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
    const closed = () => reject(new AppError('Conexão SSH encerrada durante a abertura do túnel', 502, 'TUNNEL_SSH_CLOSED'))
    const failed = (error: Error) => reject(error)
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
