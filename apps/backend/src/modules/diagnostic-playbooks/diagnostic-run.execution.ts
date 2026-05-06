import { createHash } from 'node:crypto'
import { Client, type ConnectConfig } from 'ssh2'
import type { Duplex } from 'node:stream'
import { decrypt, encrypt, type EncryptedPayload } from '../../shared/crypto.js'
import type { HostCredentials } from '../ssh/ssh.repository.js'
import type { OnePasswordService } from '../integrations/onepassword.service.js'

const MAX_OUTPUT_CHARS = 12_000

export interface DiagnosticExecutionResult {
  commandId: string
  exitCode: number | null
  output: string
  executionError: boolean
}

export interface DiagnosticExecutionRunner {
  run(input: {
    host: HostCredentials
    commands: Array<{ id: string; command: string; timeoutSeconds: number }>
    onCommandStart?: (command: { id: string; command: string; timeoutSeconds: number }) => Promise<void> | void
  }): Promise<DiagnosticExecutionResult[]>
}

function truncateOutput(value: string): string {
  return value.length > MAX_OUTPUT_CHARS ? `${value.slice(0, MAX_OUTPUT_CHARS)}\n...[truncado]` : value
}

export class SshIsolatedDiagnosticRunner implements DiagnosticExecutionRunner {
  constructor(private readonly onePassword: OnePasswordService) {}

  async run(input: {
    host: HostCredentials
    commands: Array<{ id: string; command: string; timeoutSeconds: number }>
    onCommandStart?: (command: { id: string; command: string; timeoutSeconds: number }) => Promise<void> | void
  }): Promise<DiagnosticExecutionResult[]> {
    if (input.host.connectionMode !== 'DIRECT') {
      throw new Error('Execucao de diagnostico isolado ainda suporta apenas hosts com rota direta')
    }

    const resolved = await this.resolveHostCredentials(input.host)
    const targetConfig = this.buildConnectConfig(resolved.target, true)
    const bastionConfig = resolved.bastion ? this.buildConnectConfig(resolved.bastion, false) : null
    const connection = bastionConfig
      ? await this.connectViaBastion(targetConfig, bastionConfig)
      : await this.connectDirect(targetConfig)

    try {
      const results: DiagnosticExecutionResult[] = []
      for (const command of input.commands) {
        await input.onCommandStart?.(command)
        try {
          const result = await this.execCommand(connection.conn, command.command, command.timeoutSeconds)
          results.push({
            commandId: command.id,
            exitCode: result.exitCode,
            output: truncateOutput(result.output),
            executionError: false,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Falha desconhecida ao executar comando'
          results.push({
            commandId: command.id,
            exitCode: null,
            output: truncateOutput(message),
            executionError: true,
          })
          break
        }
      }
      return results
    } finally {
      try { connection.conn.end() } catch {}
      try { connection.bastionConn?.end() } catch {}
    }
  }

  private async resolveHostCredentials(host: HostCredentials): Promise<{
    target: HostCredentials
    bastion: HostCredentials['bastion']
  }> {
    let passwordEncrypted = host.passwordEncrypted
    let pemKey = host.pemKey

    if (host.onePasswordRef) {
      const secret = await this.onePassword.resolve(host.tenantId, host.onePasswordRef)
      if (host.authType === 'PASSWORD' || host.authType === 'PEM_PASSWORD') {
        passwordEncrypted = JSON.stringify(encrypt(secret))
      } else {
        const enc = encrypt(secret)
        pemKey = { encryptedKey: enc.encrypted, iv: enc.iv }
      }
    }

    return {
      target: {
        ...host,
        passwordEncrypted,
        pemKey,
      },
      bastion: host.bastion,
    }
  }

  private buildConnectConfig(creds: {
    ip: string
    port: number
    sshUser: string
    authType: 'PEM' | 'PASSWORD' | 'PEM_PASSWORD'
    passwordEncrypted: string | null
    pemKey: { encryptedKey: string; iv: string } | null
    trustedHostKeyFingerprint?: string | null
    sock?: Duplex
  }, verifyHostKey: boolean): ConnectConfig {
    const config: ConnectConfig = {
      host: creds.ip,
      port: creds.port,
      username: creds.sshUser,
      readyTimeout: 15_000,
      keepaliveInterval: 10_000,
      ...(creds.sock ? { sock: creds.sock } : {}),
    }

    if (verifyHostKey) {
      config.hostVerifier = (key: Buffer) => {
        const fingerprint = `SHA256:${createHash('sha256').update(key).digest('base64')}`
        return !!creds.trustedHostKeyFingerprint && creds.trustedHostKeyFingerprint === fingerprint
      }
    }

    if ((creds.authType === 'PASSWORD' || creds.authType === 'PEM_PASSWORD') && creds.passwordEncrypted) {
      const payload = JSON.parse(creds.passwordEncrypted) as EncryptedPayload
      config.password = decrypt(payload)
    }

    if ((creds.authType === 'PEM' || creds.authType === 'PEM_PASSWORD') && creds.pemKey) {
      config.privateKey = decrypt({ encrypted: creds.pemKey.encryptedKey, iv: creds.pemKey.iv })
    }

    return config
  }

  private connectDirect(config: ConnectConfig): Promise<{ conn: Client; bastionConn: null }> {
    return new Promise((resolve, reject) => {
      const conn = new Client()
      conn.on('ready', () => resolve({ conn, bastionConn: null }))
      conn.on('error', (err) => {
        try { conn.end() } catch {}
        reject(err)
      })
      conn.connect(config)
    })
  }

  private connectViaBastion(targetConfig: ConnectConfig, bastionConfig: ConnectConfig): Promise<{ conn: Client; bastionConn: Client }> {
    return new Promise((resolve, reject) => {
      const bastionConn = new Client()
      bastionConn.on('ready', () => {
        bastionConn.forwardOut('127.0.0.1', 0, targetConfig.host as string, targetConfig.port as number, (err, stream) => {
          if (err) {
            try { bastionConn.end() } catch {}
            return reject(err)
          }
          const conn = new Client()
          conn.on('ready', () => resolve({ conn, bastionConn }))
          conn.on('error', (error) => {
            try { conn.end() } catch {}
            try { bastionConn.end() } catch {}
            reject(error)
          })
          conn.connect({ ...targetConfig, sock: stream })
        })
      })
      bastionConn.on('error', (err) => {
        try { bastionConn.end() } catch {}
        reject(err)
      })
      bastionConn.connect(bastionConfig)
    })
  }

  private execCommand(conn: Client, command: string, timeoutSeconds: number): Promise<{ exitCode: number | null; output: string }> {
    return new Promise((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      let settled = false
      let exitCode: number | null = null
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        reject(new Error(`Timeout ao executar comando apos ${timeoutSeconds}s`))
      }, timeoutSeconds * 1000)

      conn.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer)
          return reject(err)
        }
        stream.on('data', (chunk: Buffer | string) => {
          stdout += chunk.toString()
        })
        stream.stderr.on('data', (chunk: Buffer | string) => {
          stderr += chunk.toString()
        })
        stream.on('exit', (code) => {
          exitCode = typeof code === 'number' ? code : null
        })
        stream.on('close', () => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve({
            exitCode,
            output: [stdout.trimEnd(), stderr.trimEnd()].filter(Boolean).join('\n'),
          })
        })
      })
    })
  }
}
