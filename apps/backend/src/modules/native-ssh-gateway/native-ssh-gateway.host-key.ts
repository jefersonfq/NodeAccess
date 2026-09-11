import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { NativeSshGatewayHostKeyState } from './native-ssh-gateway.status.js'

const require = createRequire(import.meta.url)
const { parseKey } = require('ssh2').utils as typeof import('ssh2')['utils']

export interface HostKeyDiagnostic {
  state: NativeSshGatewayHostKeyState
  path: string | null
  algorithm: string | null
  fingerprint: string | null
  permissionsSafe: boolean | null
  message: string | null
  key: Buffer | null
}

export function inspectHostKey(path: string | undefined): HostKeyDiagnostic {
  if (!path?.trim()) {
    return { state: 'missing', path: null, algorithm: null, fingerprint: null, permissionsSafe: null, message: 'Host key não configurada', key: null }
  }

  let key: Buffer
  let mode: number
  try {
    key = readFileSync(path)
    mode = statSync(path).mode & 0o777
  } catch (err) {
    return { state: 'unreadable', path, algorithm: null, fingerprint: null, permissionsSafe: null, message: `Não foi possível ler a host key: ${errorMessage(err)}`, key: null }
  }

  const parsed = parseKey(key)
  const parsedKey = Array.isArray(parsed) ? parsed[0] : parsed
  if (!parsedKey || parsedKey instanceof Error) {
    return { state: 'invalid', path, algorithm: null, fingerprint: null, permissionsSafe: (mode & 0o077) === 0, message: parsedKey?.message ?? 'Formato de host key inválido', key: null }
  }
  const publicBlob = parsedKey.getPublicSSH()
  const fingerprint = `SHA256:${createHash('sha256').update(publicBlob).digest('base64').replace(/=+$/, '')}`
  const permissionsSafe = (mode & 0o077) === 0
  return {
    state: 'valid', path, algorithm: parsedKey.type, fingerprint, permissionsSafe,
    message: permissionsSafe ? 'Host key carregada e validada' : `Host key válida, mas as permissões ${mode.toString(8)} permitem acesso a grupo/outros`,
    key,
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
