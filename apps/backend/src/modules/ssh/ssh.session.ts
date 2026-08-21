import { createHash } from 'node:crypto'
import { Client, type ClientChannel, type ConnectConfig, type SFTPWrapper } from 'ssh2'
import type { Duplex } from 'node:stream'
import type { WebSocket } from 'ws'
import { decrypt, type EncryptedPayload } from '../../shared/crypto.js'

// ---------------------------------------------------------------------------
// Protocolo WebSocket (texto = JSON de controle; binário = dados do terminal)
//
// Cliente → Servidor (texto JSON):
//   { type: 'resize', cols: N, rows: N }
//   { type: 'ping' }
//
// Servidor → Cliente (texto JSON):
//   { type: 'connected', sessionId: N, hostName: '...' }
//   { type: 'error',     message: '...' }
//   { type: 'closed' }
//   { type: 'pong' }
//
// Cliente → Servidor (binário): input do terminal (teclas, pastes)
// Servidor → Cliente (binário): output do terminal (texto, escape codes)
// ---------------------------------------------------------------------------

export interface SshCredentials {
  host:             string
  port:             number
  username:         string
  authType:         'PEM' | 'PASSWORD' | 'PEM_PASSWORD'
  trustedHostKeyFingerprint?: string | null
  passwordEncrypted?: string | null
  pemKey?:          { encryptedKey: string; iv: string; encryptedPassphrase?: string | null; passphraseIv?: string | null } | null
  /** Stream pré-conectado (ex: agente reverse tunnel) */
  sock?:            Duplex
}

interface SshSessionHooks {
  onStdout?: (data: Buffer) => Buffer | void
  onClose?: () => void
}

export interface SshSessionTransport {
  send(data: Buffer | string): void
}

export interface SshSessionOptions {
  sendClosedControl?: boolean
}

export interface SshDirectoryEntry {
  name: string
  path: string
  type: 'file' | 'directory' | 'symlink'
  size: number
  permissions: string
  owner: number
  group: number
  modifiedAt: string
}

class WebSocketSshTransport implements SshSessionTransport {
  constructor(private readonly ws: WebSocket) {}

  send(data: Buffer | string): void {
    this.ws.send(data)
  }
}

export class HostKeyVerificationError extends Error {
  constructor(
    public readonly reason: 'unknown' | 'changed',
    public readonly presentedFingerprint: string,
    public readonly trustedFingerprint: string | null,
  ) {
    super(reason === 'changed' ? 'Host key changed' : 'Host key not trusted yet')
    this.name = 'HostKeyVerificationError'
  }
}

function classifyCause(step: 'bastion' | 'target', cause: unknown): string {
  const nodeCode = (cause as NodeJS.ErrnoException).code
  const msg      = cause instanceof Error ? cause.message : ''
  if (step === 'bastion') {
    if (nodeCode === 'ECONNREFUSED') return 'BASTION_PORT_REFUSED'
    if (nodeCode === 'ETIMEDOUT')    return 'BASTION_UNREACHABLE'
    if (nodeCode === 'ENOTFOUND')    return 'BASTION_DNS_FAILED'
    if (/auth/i.test(msg))           return 'BASTION_AUTH_FAILED'
    return 'BASTION_CONNECT_FAILED'
  }
  if (nodeCode === 'ECONNREFUSED')   return 'HOST_PORT_REFUSED'
  if (nodeCode === 'ETIMEDOUT')      return 'HOST_UNREACHABLE'
  if (nodeCode === 'ENOTFOUND')      return 'DNS_FAILED'
  if (/auth/i.test(msg) || /all configured/i.test(msg)) return 'AUTH_FAILED'
  if (/timed out|handshake/i.test(msg)) return 'SSH_HANDSHAKE_TIMEOUT'
  return 'CONNECT_FAILED'
}

export class SshConnectionStepError extends Error {
  public readonly errorCode: string

  constructor(
    public readonly step: 'bastion' | 'target',
    cause: unknown,
  ) {
    const message = cause instanceof Error ? cause.message : 'Erro desconhecido'
    super(step === 'bastion'
      ? `Falha ao conectar no bastion: ${message}`
      : `Falha ao conectar ao host final: ${message}`)
    this.name = 'SshConnectionStepError'
    this.cause = cause
    this.errorCode = classifyCause(step, cause)
  }
}

export class SshSession {
  private readonly conn        = new Client()
  private readonly transport: SshSessionTransport
  private bastionConn: Client | null = null
  private shell: ClientChannel | null = null
  private sftp: SFTPWrapper | null = null
  private sftpOpening: Promise<SFTPWrapper> | null = null
  private disposed = false
  private lastHostKeyError: HostKeyVerificationError | null = null

  constructor(
    transport: WebSocket | SshSessionTransport,
    private readonly target: SshCredentials,
    private readonly bastion: SshCredentials | null = null,
    private readonly hooks: SshSessionHooks = {},
    private readonly options: SshSessionOptions = {},
  ) {
    this.transport = transportIsWebSocket(transport)
      ? new WebSocketSshTransport(transport)
      : transport
  }

  // ---------------------------------------------------------------------------
  // Conexão principal
  // ---------------------------------------------------------------------------

  async connect(cols = 80, rows = 24): Promise<void> {
    const targetConfig = this.buildConnectConfig(this.target)

    // Se há um socket pré-conectado (agente), usá-lo diretamente
    if (this.target.sock) {
      await this.connectDirect({ ...targetConfig, sock: this.target.sock }, cols, rows)
    } else if (this.bastion) {
      await this.connectViaBastionion(targetConfig, cols, rows)
    } else {
      await this.connectDirect(targetConfig, cols, rows)
    }
  }

  private connectDirect(config: ConnectConfig, cols: number, rows: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.conn
        .on('ready', () => this.openShell(this.conn, cols, rows).then(resolve).catch(reject))
        .on('error', (err) => reject(this.lastHostKeyError ?? new SshConnectionStepError('target', err)))
        .connect(config)
    })
  }

  private connectViaBastionion(targetConfig: ConnectConfig, cols: number, rows: number): Promise<void> {
    const bastionConfig = this.buildConnectConfig(this.bastion!)
    this.bastionConn = new Client()

    return new Promise((resolve, reject) => {
      this.bastionConn!
        .on('ready', () => {
          this.bastionConn!.forwardOut(
            '127.0.0.1', 0,
            targetConfig.host as string, targetConfig.port as number,
            (err, stream) => {
              if (err) return reject(err)

              this.conn
                .on('ready', () => this.openShell(this.conn, cols, rows).then(resolve).catch(reject))
                .on('error', (error) => reject(this.lastHostKeyError ?? new SshConnectionStepError('target', error)))
                .connect({ ...targetConfig, sock: stream })
            },
          )
        })
        .on('error', (error) => reject(new SshConnectionStepError('bastion', error)))
        .connect(bastionConfig)
    })
  }

  private openShell(conn: Client, cols: number, rows: number): Promise<void> {
    return new Promise((resolve, reject) => {
      conn.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
        if (err) return reject(err)

        this.shell = stream

        // Terminal output → cliente (binário)
        stream.on('data', (data: Buffer) => {
          const output = this.hooks.onStdout?.(data) ?? data
          if (!this.disposed) this.transport.send(output)
        })
        stream.stderr.on('data', (data: Buffer) => {
          const output = this.hooks.onStdout?.(data) ?? data
          if (!this.disposed) this.transport.send(output)
        })

        // Shell fechou no lado SSH
        stream.on('close', () => {
          this.hooks.onClose?.()
          this.sendControl({ type: 'closed' })
          this.dispose()
        })

        resolve()
      })
    })
  }

  // ---------------------------------------------------------------------------
  // API pública
  // ---------------------------------------------------------------------------

  write(data: Buffer): void {
    this.shell?.write(data)
  }

  resize(cols: number, rows: number): void {
    // ssh2: setWindow(rows, cols, height, width)
    this.shell?.setWindow(rows, cols, 0, 0)
  }

  warmSftp(): Promise<void> {
    return this.ensureSftp().then(() => undefined)
  }

  async sftpHome(): Promise<string> {
    const sftp = await this.ensureSftp()
    return new Promise((resolve) => sftp.realpath('.', (error, path) => resolve(error ? '/' : path)))
  }

  async listDirectory(path: string): Promise<SshDirectoryEntry[]> {
    const sftp = await this.ensureSftp()
    return new Promise((resolve, reject) => {
      sftp.readdir(path, (error, list) => {
        if (error) { reject(error); return }
        resolve(list.map((item) => {
          const mode = item.attrs.mode ?? 0
          const type = (mode & 0o170000) === 0o040000 ? 'directory' as const
            : (mode & 0o170000) === 0o120000 ? 'symlink' as const : 'file' as const
          return {
            name: item.filename,
            path: `${path.replace(/\/$/, '')}/${item.filename}`,
            type,
            size: item.attrs.size ?? 0,
            permissions: formatPermissions(mode),
            owner: item.attrs.uid ?? 0,
            group: item.attrs.gid ?? 0,
            modifiedAt: new Date((item.attrs.mtime ?? 0) * 1000).toISOString(),
          }
        }))
      })
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    try { this.sftp?.end() }        catch { /* ignore */ }
    this.sftp = null
    this.sftpOpening = null
    try { this.shell?.end() }       catch { /* ignore */ }
    try { this.conn.end() }          catch { /* ignore */ }
    try { this.bastionConn?.end() } catch { /* ignore */ }
    try { this.target.sock?.destroy() } catch { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private buildConnectConfig(creds: SshCredentials): ConnectConfig {
    const config: ConnectConfig = {
      host:              creds.host,
      port:              creds.port,
      username:          creds.username,
      readyTimeout:      15_000,
      keepaliveInterval: 10_000,
    }

    if ('trustedHostKeyFingerprint' in creds) {
      config.hostVerifier = (key: Buffer) => {
        const fingerprint = `SHA256:${createHash('sha256').update(key).digest('base64')}`

        if (!creds.trustedHostKeyFingerprint) {
          this.lastHostKeyError = new HostKeyVerificationError('unknown', fingerprint, null)
          return false
        }

        if (creds.trustedHostKeyFingerprint !== fingerprint) {
          this.lastHostKeyError = new HostKeyVerificationError('changed', fingerprint, creds.trustedHostKeyFingerprint)
          return false
        }

        this.lastHostKeyError = null
        return true
      }
    }

    if ((creds.authType === 'PASSWORD' || creds.authType === 'PEM_PASSWORD') && creds.passwordEncrypted) {
      const payload = JSON.parse(creds.passwordEncrypted) as EncryptedPayload
      config.password = decrypt(payload)
    }

    if ((creds.authType === 'PEM' || creds.authType === 'PEM_PASSWORD') && creds.pemKey) {
      config.privateKey = decrypt({
        encrypted: creds.pemKey.encryptedKey,
        iv:        creds.pemKey.iv,
      })
      if (creds.pemKey.encryptedPassphrase && creds.pemKey.passphraseIv) {
        config.passphrase = decrypt({
          encrypted: creds.pemKey.encryptedPassphrase,
          iv: creds.pemKey.passphraseIv,
        })
      }
    }

    return config
  }

  private ensureSftp(): Promise<SFTPWrapper> {
    if (this.disposed) return Promise.reject(new Error('Sessão SSH encerrada'))
    if (this.sftp) return Promise.resolve(this.sftp)
    if (this.sftpOpening) return this.sftpOpening
    this.sftpOpening = new Promise<SFTPWrapper>((resolve, reject) => {
      this.conn.sftp((error, channel) => {
        if (error) { reject(error); return }
        if (this.disposed) { channel.end(); reject(new Error('Sessão SSH encerrada')); return }
        this.sftp = channel
        channel.once('close', () => { if (this.sftp === channel) this.sftp = null })
        channel.once('error', () => { if (this.sftp === channel) this.sftp = null })
        resolve(channel)
      })
    }).finally(() => { this.sftpOpening = null })
    return this.sftpOpening
  }

  private sendControl(msg: object): void {
    if (this.options.sendClosedControl === false) return
    if (!this.disposed) this.transport.send(JSON.stringify(msg))
  }
}

function formatPermissions(mode: number): string {
  const bits: Array<[number, string]> = [
    [0o400, 'r'], [0o200, 'w'], [0o100, 'x'], [0o040, 'r'], [0o020, 'w'],
    [0o010, 'x'], [0o004, 'r'], [0o002, 'w'], [0o001, 'x'],
  ]
  return bits.map(([bit, character]) => mode & bit ? character : '-').join('')
}

function transportIsWebSocket(transport: WebSocket | SshSessionTransport): transport is WebSocket {
  return 'readyState' in transport && typeof transport.send === 'function'
}
