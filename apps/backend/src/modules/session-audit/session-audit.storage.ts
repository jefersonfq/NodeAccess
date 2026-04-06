import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { env } from '../../config/env.js'

export interface StoredSessionAuditChunk {
  storageKey: string
  rawSize: number
  compressedSize: number
}

export class SessionAuditStorage {
  async writeChunk(sessionId: number, seq: number, content: string): Promise<StoredSessionAuditChunk> {
    const dir = path.join(env.SESSION_AUDIT_STORAGE_DIR, String(sessionId))
    await mkdir(dir, { recursive: true })

    const filename = `chunk-${String(seq).padStart(6, '0')}.jsonl`
    const fullPath = path.join(dir, filename)
    await writeFile(fullPath, content, 'utf-8')

    return {
      storageKey: fullPath,
      rawSize: Buffer.byteLength(content, 'utf-8'),
      compressedSize: Buffer.byteLength(content, 'utf-8'),
    }
  }

  async readChunk(storageKey: string): Promise<string> {
    return readFile(storageKey, 'utf-8')
  }
}
