import { Client, type ConnectConfig } from 'ssh2'
import type { SFTPWrapper } from 'ssh2'
import type { SshRepository } from '../ssh/ssh.repository.js'
import type { OnePasswordService } from '../integrations/onepassword.service.js'
import { decrypt, encrypt, type EncryptedPayload } from '../../shared/crypto.js'
import { ForbiddenError, NotFoundError } from '../../shared/errors.js'
import { logger } from '../../config/logger.js'

export interface SftpEntry {
  name:        string
  path:        string        // full absolute path
  type:        'file' | 'directory' | 'symlink'
  size:        number
  permissions: string        // e.g. "rwxr-xr-x"
  owner:       number        // uid
  group:       number        // gid
  modifiedAt:  string        // ISO string
}

interface OpenSftpResult {
  sftp:        SFTPWrapper
  conn:        Client
  bastionConn: Client | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPermissions(mode: number): string {
  const bits: [number, string][] = [
    [0o400, 'r'], [0o200, 'w'], [0o100, 'x'],
    [0o040, 'r'], [0o020, 'w'], [0o010, 'x'],
    [0o004, 'r'], [0o002, 'w'], [0o001, 'x'],
  ]
  return bits.map(([bit, char]) => (mode & bit) ? char : '-').join('')
}

function buildConnectConfig(
  host:     string,
  port:     number,
  username: string,
  authType: 'PEM' | 'PASSWORD' | 'PEM_PASSWORD',
  passwordEncrypted: string | null,
  pemKey: { encryptedKey: string; iv: string } | null,
): ConnectConfig {
  const config: ConnectConfig = {
    host,
    port,
    username,
    readyTimeout:      15_000,
    keepaliveInterval: 10_000,
  }

  if ((authType === 'PASSWORD' || authType === 'PEM_PASSWORD') && passwordEncrypted) {
    const payload = JSON.parse(passwordEncrypted) as EncryptedPayload
    config.password = decrypt(payload)
  }

  if ((authType === 'PEM' || authType === 'PEM_PASSWORD') && pemKey) {
    config.privateKey = decrypt({ encrypted: pemKey.encryptedKey, iv: pemKey.iv })
  }

  return config
}

function openSftpOnConn(conn: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) { conn.end(); reject(err); return }
      resolve(sftp)
    })
  })
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SftpService {
  constructor(
    private readonly sshRepo:     SshRepository,
    private readonly onePassword: OnePasswordService,
  ) {}

  // ── Access check + SSH/SFTP connection ────────────────────────────────────

  private async openSftp(
    hostId:   number,
    userId:   number,
    tenantId: number,
    role:     string,
  ): Promise<OpenSftpResult> {
    // 1. Fetch host
    const host = await this.sshRepo.findHostWithCredentials(hostId, tenantId)
    if (!host) throw new NotFoundError('Host')

    // 2. Access control (mirrors ssh.gateway.ts lines 47-57)
    if (role !== 'admin') {
      if (host.scope === 'PERSONAL' && host.ownerId !== userId) {
        throw new ForbiddenError('Sem acesso a este host')
      }
      if (host.scope === 'TEAM') {
        const groupIds = await this.sshRepo.getUserGroupIds(userId)
        if (!host.groupId || !groupIds.includes(host.groupId)) {
          throw new ForbiddenError('Sem acesso a este host')
        }
      }
    }

    // 3. Resolve 1Password credential if configured (mirrors ssh.gateway.ts lines 66-84)
    let passwordEncrypted = host.passwordEncrypted
    let pemKey            = host.pemKey

    if (host.onePasswordRef) {
      try {
        const secret = await this.onePassword.resolve(host.tenantId, host.onePasswordRef)
        if (host.authType === 'PASSWORD' || host.authType === 'PEM_PASSWORD') {
          passwordEncrypted = JSON.stringify(encrypt(secret))
        } else {
          const enc         = encrypt(secret)
          pemKey            = { encryptedKey: enc.encrypted, iv: enc.iv }
        }
      } catch (err) {
        logger.error({ err, hostId: host.id }, '1Password: falha ao resolver credencial (SFTP)')
        throw new Error('Falha ao buscar credencial no 1Password')
      }
    }

    // 4. Build target connect config
    const targetConfig = buildConnectConfig(
      host.ip, host.port, host.sshUser, host.authType, passwordEncrypted, pemKey,
    )

    // 5. Open SSH connection (with optional bastion, same pattern as ssh.session.ts)
    if (host.bastion) {
      const bastionConfig = buildConnectConfig(
        host.bastion.ip,
        host.bastion.port,
        host.bastion.sshUser,
        host.bastion.authType,
        host.bastion.passwordEncrypted,
        host.bastion.pemKey,
      )

      return new Promise<OpenSftpResult>((resolve, reject) => {
        const bastionConn = new Client()
        bastionConn
          .on('ready', () => {
            bastionConn.forwardOut(
              '127.0.0.1', 0,
              targetConfig.host as string, targetConfig.port as number,
              (err, stream) => {
                if (err) { bastionConn.end(); reject(err); return }

                const conn = new Client()
                conn
                  .on('ready', () => {
                    openSftpOnConn(conn)
                      .then((sftp) => resolve({ sftp, conn, bastionConn }))
                      .catch(reject)
                  })
                  .on('error', (e) => { bastionConn.end(); reject(e) })
                  .connect({ ...targetConfig, sock: stream })
              },
            )
          })
          .on('error', reject)
          .connect(bastionConfig)
      })
    }

    // Direct connection
    return new Promise<OpenSftpResult>((resolve, reject) => {
      const conn = new Client()
      conn
        .on('ready', () => {
          openSftpOnConn(conn)
            .then((sftp) => resolve({ sftp, conn, bastionConn: null }))
            .catch(reject)
        })
        .on('error', reject)
        .connect(targetConfig)
    })
  }

  private closeAll({ conn, bastionConn }: OpenSftpResult): void {
    try { conn.end() }         catch { /* ignore */ }
    try { bastionConn?.end() } catch { /* ignore */ }
  }

  // ── Public SFTP operations ────────────────────────────────────────────────

  async ping(
    hostId: number, userId: number, tenantId: number, role: string,
  ): Promise<{ ok: true; home: string }> {
    const result = await this.openSftp(hostId, userId, tenantId, role)
    try {
      const home = await new Promise<string>((resolve) => {
        result.sftp.realpath('.', (err, path) => resolve(err ? '/' : path))
      })
      return { ok: true, home }
    } finally {
      this.closeAll(result)
    }
  }

  async list(
    hostId: number, userId: number, tenantId: number, role: string,
    path: string,
  ): Promise<{ entries: SftpEntry[]; path: string }> {
    const result = await this.openSftp(hostId, userId, tenantId, role)
    try {
      return await new Promise<{ entries: SftpEntry[]; path: string }>((resolve, reject) => {
        result.sftp.readdir(path, (err, list) => {
          if (err) { reject(err); return }

          const entries: SftpEntry[] = list.map((item) => {
            const mode = item.attrs.mode ?? 0
            let type: SftpEntry['type'] = 'file'
            // S_IFMT mask
            if ((mode & 0o170000) === 0o040000) type = 'directory'
            else if ((mode & 0o170000) === 0o120000) type = 'symlink'

            return {
              name:        item.filename,
              path:        path.replace(/\/$/, '') + '/' + item.filename,
              type,
              size:        item.attrs.size ?? 0,
              permissions: formatPermissions(mode),
              owner:       item.attrs.uid ?? 0,
              group:       item.attrs.gid ?? 0,
              modifiedAt:  new Date((item.attrs.mtime ?? 0) * 1000).toISOString(),
            }
          })

          resolve({ entries, path })
        })
      })
    } finally {
      this.closeAll(result)
    }
  }

  async download(
    hostId: number, userId: number, tenantId: number, role: string,
    path: string,
  ): Promise<Buffer> {
    const result = await this.openSftp(hostId, userId, tenantId, role)
    try {
      return await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = []
        result.sftp.createReadStream(path)
          .on('data', (chunk: Buffer) => chunks.push(chunk))
          .on('end', () => resolve(Buffer.concat(chunks)))
          .on('error', reject)
      })
    } finally {
      this.closeAll(result)
    }
  }

  async upload(
    hostId: number, userId: number, tenantId: number, role: string,
    path: string, data: Buffer,
  ): Promise<void> {
    const result = await this.openSftp(hostId, userId, tenantId, role)
    try {
      await new Promise<void>((resolve, reject) => {
        const stream = result.sftp.createWriteStream(path)
        stream.on('close', resolve)
        stream.on('error', reject)
        stream.end(data)
      })
    } finally {
      this.closeAll(result)
    }
  }

  async mkdir(
    hostId: number, userId: number, tenantId: number, role: string,
    path: string,
  ): Promise<void> {
    const result = await this.openSftp(hostId, userId, tenantId, role)
    try {
      await new Promise<void>((resolve, reject) => {
        result.sftp.mkdir(path, (err) => (err ? reject(err) : resolve()))
      })
    } finally {
      this.closeAll(result)
    }
  }

  async rename(
    hostId: number, userId: number, tenantId: number, role: string,
    oldPath: string, newPath: string,
  ): Promise<void> {
    const result = await this.openSftp(hostId, userId, tenantId, role)
    try {
      await new Promise<void>((resolve, reject) => {
        result.sftp.rename(oldPath, newPath, (err) => (err ? reject(err) : resolve()))
      })
    } finally {
      this.closeAll(result)
    }
  }

  async delete(
    hostId: number, userId: number, tenantId: number, role: string,
    path: string,
  ): Promise<void> {
    const result = await this.openSftp(hostId, userId, tenantId, role)
    try {
      await new Promise<void>((resolve, reject) => {
        result.sftp.stat(path, (statErr, attrs) => {
          if (statErr) { reject(statErr); return }

          const mode = attrs.mode ?? 0
          const isDir = (mode & 0o170000) === 0o040000

          if (isDir) {
            result.sftp.rmdir(path, (err) => (err ? reject(err) : resolve()))
          } else {
            result.sftp.unlink(path, (err) => (err ? reject(err) : resolve()))
          }
        })
      })
    } finally {
      this.closeAll(result)
    }
  }

  async createFile(
    hostId: number, userId: number, tenantId: number, role: string,
    path: string,
  ): Promise<void> {
    const result = await this.openSftp(hostId, userId, tenantId, role)
    try {
      await new Promise<void>((resolve, reject) => {
        // Open with O_CREAT | O_WRONLY | O_TRUNC flags (same as touch)
        result.sftp.open(path, 'w', (err, handle) => {
          if (err) { reject(err); return }
          result.sftp.close(handle, (closeErr) => (closeErr ? reject(closeErr) : resolve()))
        })
      })
    } finally {
      this.closeAll(result)
    }
  }

  async readFile(
    hostId: number, userId: number, tenantId: number, role: string,
    path: string,
  ): Promise<{ content: string; size: number; truncated: boolean }> {
    const MAX_BYTES = 1_048_576 // 1 MB
    const result = await this.openSftp(hostId, userId, tenantId, role)
    try {
      return await new Promise((resolve, reject) => {
        const chunks: Buffer[] = []
        let size      = 0
        let truncated = false
        const stream  = result.sftp.createReadStream(path)
        stream
          .on('data', (chunk: Buffer) => {
            if (size >= MAX_BYTES) return
            const remaining = MAX_BYTES - size
            if (chunk.length > remaining) {
              chunks.push(chunk.slice(0, remaining))
              size     += remaining
              truncated = true
              stream.destroy()
            } else {
              chunks.push(chunk)
              size += chunk.length
            }
          })
          .on('close', () => resolve({ content: Buffer.concat(chunks).toString('utf-8'), size, truncated }))
          .on('error', (err: Error) => {
            if (truncated) resolve({ content: Buffer.concat(chunks).toString('utf-8'), size, truncated })
            else reject(err)
          })
      })
    } finally {
      this.closeAll(result)
    }
  }
}
