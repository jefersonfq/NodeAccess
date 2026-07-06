import { Client, type ConnectConfig } from 'ssh2'
import type { Duplex } from 'node:stream'
import { decrypt, type EncryptedPayload } from './crypto.js'

export interface TestCredentials {
  host:              string
  port:              number
  username:          string
  authType:          'PEM' | 'PASSWORD' | 'PEM_PASSWORD'
  passwordEncrypted?: string | null
  pemKey?:           { encryptedKey: string; iv: string } | null
  sock?:             Duplex
}

export interface TestResult {
  success:   boolean
  latencyMs: number | null
  message:   string
}

export async function testSshConnection(
  target:  TestCredentials,
  bastion: TestCredentials | null,
): Promise<TestResult> {
  const start = Date.now()
  try {
    if (bastion) {
      await connectViaBastion(buildConfig(target), buildConfig(bastion))
    } else {
      await connectDirect(buildConfig(target))
    }
    return { success: true, latencyMs: Date.now() - start, message: 'Conexão bem-sucedida' }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return { success: false, latencyMs: null, message }
  } finally {
    try { target.sock?.destroy() } catch { /* ignore */ }
  }
}

function buildConfig(creds: TestCredentials): ConnectConfig {
  const config: ConnectConfig = {
    host:         creds.host,
    port:         creds.port,
    username:     creds.username,
    readyTimeout: 10_000,
    ...(creds.sock ? { sock: creds.sock } : {}),
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

function connectDirect(config: ConnectConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    const conn = new Client()
    conn
      .on('ready', () => { conn.end(); resolve() })
      .on('error', (err) => { conn.end(); reject(err) })
      .connect(config)
  })
}

function connectViaBastion(targetConfig: ConnectConfig, bastionConfig: ConnectConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    const bastionConn = new Client()
    bastionConn
      .on('ready', () => {
        bastionConn.forwardOut(
          '127.0.0.1', 0,
          targetConfig.host as string, targetConfig.port as number,
          (err, stream) => {
            if (err) { bastionConn.end(); return reject(err) }
            const conn = new Client()
            conn
              .on('ready', () => { conn.end(); bastionConn.end(); resolve() })
              .on('error', (e) => { conn.end(); bastionConn.end(); reject(e) })
              .connect({ ...targetConfig, sock: stream })
          },
        )
      })
      .on('error', (err) => { bastionConn.end(); reject(err) })
      .connect(bastionConfig)
  })
}
